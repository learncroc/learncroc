/**
 * Run services: start, attempt (the ONLY grading path), advance, hint, crocHint, scratch, finish, abandon.
 * The server wraps these in HTTP; the static demo and try-runs call them directly.
 */
import { ratingOf, updateElo } from "../adaptive";
import { resolveClose, revisitScreen } from "../card";
import {
  buildCheckpointPlan,
  CHECKPOINT_HINT_CAP,
  checkpointResult,
  earlierCards,
  itemKey,
  revisitTargets,
} from "../checkpoint";
import { plainText } from "../compile/text";
import { answerLeak, itemHintText } from "../croc";
import { dagOf } from "../dag";
import {
  creditFlowsDown,
  DAY_MS,
  fadeAt,
  flashcardId,
  lightNodeCard,
  newCard,
  retrievability,
  reviewCard,
} from "../fsrs";
import {
  answerText,
  type ExplainTarget,
  GradeError,
  gradeExplainOffline,
  gradeFromExplainGrade,
  gradeInteraction,
  solutionOf,
} from "../grade";
import { hashString, instantiateItem } from "../params";
import { checkpointCredit, creditedScore, isCounted } from "../pass";
import { relightGrade } from "../relight";
import {
  cardAt,
  createRun,
  currentInteractionId,
  expectedInteraction,
  RunError,
  reduceRun,
  SOLUTION_HINT_LEVEL,
} from "../run";
import type {
  AnswerValue,
  AttemptInput,
  AttemptResult,
  AttemptRow,
  CardState,
  CompiledPack,
  ExplainGrade,
  GradeResult,
  Interaction,
  Item,
  Markdown,
  Millis,
  NodeId,
  NodeProgress,
  PackNode,
  RunEvent,
  RunState,
  RunSummary,
  Screen,
  StartRunBody,
  StartRunResponse,
} from "../schema/index";
import { type CheckpointRecord, isMapFinished, newlyUnlocked, nextAfter } from "../state";
import {
  type Ctx,
  checkNodeId,
  checkpointKey,
  findItem,
  fsrsOpts,
  getPack,
  nodeCardsOf,
  nodeOf,
  type Plan,
  planKey,
  runNodeOrThrow,
  runPack,
  ServiceError,
  viewsOf,
} from "./context";

/** A relight counts toward "durable" only on a later day than the light. */
export const LATER_DAY_MS = 16 * 60 * 60 * 1000;
/** Widget scratch is small partial state; refuse anything bigger. */
export const MAX_SCRATCH_BYTES = 64 * 1024;

const emptyProgress = (nodeId: NodeId): NodeProgress => ({
  nodeId,
  status: "started",
  source: "run",
  theta: 0,
  relightsOk: 0,
});

/** Card views from which a card run may start (others: 409). */
const CARD_OPENABLE = new Set(["ready", "in-progress", "done", "lit", "fading"]);
/** A card already closed: a new run replays it and writes no progress. */
const CARD_CLOSED = new Set(["done", "lit", "fading"]);

function reduce(run: RunState, pack: CompiledPack | null, event: RunEvent, now: Millis): RunState {
  try {
    return reduceRun(run, pack, event, now);
  } catch (e) {
    if (e instanceof RunError) throw new ServiceError(e.code === "not_found" ? "not_found" : "conflict", e.message);
    throw e;
  }
}

async function loadRun(ctx: Ctx, runId: string, open = true): Promise<RunState> {
  const run = await ctx.repo.run(runId);
  if (!run) throw new ServiceError("not_found", `no run "${runId}"`);
  if (open && run.finishedAt !== undefined) throw new ServiceError("conflict", `run ${runId} is finished`);
  return run;
}

// ── start

/** The guess of the latest finished card run on this card (for a replay), if any. */
async function earlierGuess(ctx: Ctx, packId: string, nodeId: NodeId): Promise<RunState["guess"]> {
  const runIds = new Set(
    (await ctx.repo.attempts({ packId, nodeId })).filter((a) => a.phase === "hook").map((a) => a.runId),
  );
  let best: RunState | undefined;
  for (const id of runIds) {
    const r = await ctx.repo.run(id);
    if (r?.kind !== "card" || r.finishedAt === undefined || !r.guess) continue;
    if (!best || (r.finishedAt ?? 0) > (best.finishedAt ?? 0)) best = r;
  }
  return best?.guess;
}

/** The beat a revisit opens at: the beat behind the questions missed on this card at that checkpoint. */
async function revisitStart(
  ctx: Ctx,
  pack: CompiledPack,
  packId: string,
  cpId: NodeId,
  nodeId: NodeId,
): Promise<number> {
  const node = pack.nodes[nodeId];
  if (!node) return 0;
  const rec = await ctx.repo.kv<CheckpointRecord>(checkpointKey(packId, cpId));
  let rows = rec?.lastRunId ? await ctx.repo.attempts({ runId: rec.lastRunId }) : [];
  if (!rows.length) {
    // No record (the gate since opened): the latest checkpoint attempts on this card.
    const all = (await ctx.repo.attempts({ packId, nodeId })).filter((a) => a.phase === "checkpoint");
    const last = all.reduce<AttemptRow | undefined>((b, a) => (!b || a.at >= b.at ? a : b), undefined);
    rows = last ? all.filter((a) => a.runId === last.runId) : [];
  }
  const missed = rows
    .filter(
      (a) => a.phase === "checkpoint" && a.nodeId === nodeId && !checkpointCredit(a.correct, a.hintLevel, a.assisted),
    )
    .map((a) => a.interactionId);
  return revisitScreen(node, missed);
}

export async function startRun(ctx: Ctx, body: StartRunBody): Promise<StartRunResponse> {
  const now = ctx.clock.now();
  if (body.kind === "try") {
    const pack = await getPack(ctx, body.packId);
    const target = pack.manifest.entry.suggestedStart ?? pack.map.topo.find((id) => pack.nodes[id]);
    if (!target) throw new ServiceError("not_found", `pack ${body.packId} has no playable card`);
    const id = ctx.newId();
    const run = createRun({ id, kind: "card", pack, target, now, seed: hashString(id) });
    await ctx.repo.putRun(run);
    return { run, resumed: false, now, tryPack: pack };
  }
  const pack = await getPack(ctx, body.packId);
  const packId = pack.manifest.id;
  const target = checkNodeId(body.target);
  const entry = pack.map.nodes[target];
  if (!entry) throw new ServiceError("not_found", `no "${target}" in ${packId}`);
  if (entry.kind !== (body.kind === "card" ? "node" : "checkpoint"))
    throw new ServiceError("invalid", `"${target}" is not a ${body.kind === "card" ? "card" : "checkpoint"}`);

  const { views } = await viewsOf(ctx, pack, now);
  const state = views[target]?.state ?? "locked";
  const from = body.kind === "card" && body.from ? checkNodeId(body.from) : undefined;
  const open = (await ctx.repo.openRuns({ packId })).find((r) => r.kind === body.kind && r.target === target);
  if (open) {
    // A replay asked for differently ("Guess again", or a revisit from another checkpoint) starts over;
    // everything else resumes where the learner left.
    const restart =
      body.kind === "card" &&
      open.replay === true &&
      CARD_CLOSED.has(state) &&
      ((body.mode === "again" && open.guess !== undefined && open.cursor.phase !== "hook") || open.from !== from);
    if (!restart) {
      if (body.kind === "card" && from && open.from !== from) {
        const withFrom = { ...open, from };
        await ctx.repo.putRun(withFrom);
        return { run: withFrom, resumed: true, now };
      }
      return { run: open, resumed: true, now };
    }
    await ctx.repo.putRun(reduce(open, pack, { type: "abandon" }, now));
  }
  const id = ctx.newId();
  const seed = hashString(id);

  if (body.kind === "card") {
    if (!CARD_OPENABLE.has(state))
      throw new ServiceError("conflict", `"${target}" isn't open yet: ${views[target]?.missing.join(", ") || state}`);
    nodeOf(pack, target);
    let run: RunState;
    if (CARD_CLOSED.has(state)) {
      // Replay: the guess from the latest finished run stays pinned (none → a fresh hook, as "again").
      const guess = body.mode === "again" ? undefined : await earlierGuess(ctx, packId, target);
      const startScreen = guess && from ? await revisitStart(ctx, pack, packId, from, target) : 0;
      run = createRun({
        id,
        kind: "card",
        pack,
        target,
        now,
        seed,
        replay: true,
        ...(guess ? { guess, startScreen } : {}),
        ...(from ? { from } : {}),
      });
    } else {
      run = createRun({ id, kind: "card", pack, target, now, seed, ...(from ? { from } : {}) });
    }
    await ctx.repo.putRun(run);
    return { run, resumed: false, now };
  }

  // checkpoint
  if (state !== "ready" && state !== "in-progress" && state !== "lit")
    throw new ServiceError("conflict", "Finish the cards before this checkpoint");
  const rec = await ctx.repo.kv<CheckpointRecord>(checkpointKey(packId, target));
  const progress = await ctx.repo.progress(packId);
  const cards = await nodeCardsOf(ctx, packId);
  const opts = await fsrsOpts(ctx);
  const earlier = earlierCards(pack.map, target)
    .filter((n) => progress[n]?.status === "lit")
    .map((nodeId) => {
      const c = cards[nodeId];
      return { nodeId, retrievability: c ? retrievability(c, now, opts) : 1 };
    });
  const theta: Record<NodeId, number> = {};
  const ratings: Record<NodeId, Record<string, number>> = {};
  for (const n of [...(pack.map.nodes[target]?.covers ?? []), ...earlier.map((e) => e.nodeId)]) {
    theta[n] = progress[n]?.theta ?? 0;
    ratings[n] = await ctx.repo.itemRatings(packId, n);
  }
  const entries = buildCheckpointPlan({
    pack,
    cpId: target,
    earlier,
    theta,
    ratings,
    avoid: new Set(rec?.asked ?? []),
    avoidVars: rec?.vars ?? {},
    missedLast: rec?.missed ?? [],
    seed,
  });
  const first = entries[0];
  if (!first) throw new ServiceError("conflict", "This checkpoint has no questions yet");
  await ctx.repo.setKv<Plan>(planKey(id), { entries });
  const run = createRun({
    id,
    kind: "checkpoint",
    pack,
    target,
    now,
    seed,
    current: first,
    size: entries.length,
    practice: state === "lit",
  });
  await ctx.repo.putRun(run);
  return { run, resumed: false, now };
}

// ── attempt

function gradeCtx(ctx: Ctx, pack: CompiledPack | null, vars?: Record<string, number>) {
  return {
    widgets: ctx.widgets,
    lang: pack?.manifest.targetLang ?? pack?.manifest.lang ?? "en",
    ...(vars ? { vars } : {}),
  };
}

function safeGrade(fn: () => GradeResult): GradeResult {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GradeError) throw new ServiceError("invalid", e.message);
    throw e;
  }
}

function attemptRow(
  run: RunState,
  input: AttemptInput & { packId: string },
  grade: GradeResult,
  x: {
    counted: boolean;
    credited: number;
    hint: number;
    assisted: boolean;
    now: Millis;
    vars?: Record<string, number>;
  },
): AttemptRow {
  const row: AttemptRow = {
    runId: run.id,
    packId: input.packId,
    nodeId: input.nodeId,
    interactionId: input.interactionId,
    phase: input.phase,
    answer: input.answer,
    correct: grade.correct,
    score: grade.score,
    creditedScore: x.credited,
    counted: x.counted,
    hintLevel: Math.min(3, Math.max(0, x.hint)) as 0 | 1 | 2 | 3,
    assisted: x.assisted,
    ms: Math.max(0, input.ms),
    at: x.now,
  };
  if (input.confidence !== undefined) row.confidence = input.confidence;
  if (x.vars) row.vars = x.vars;
  if (input.answer.kind === "explain" && input.answer.selfRating) row.selfRating = input.answer.selfRating;
  return row;
}

interface Graded {
  grade: GradeResult;
  explain?: ExplainGrade | null;
  item?: Item;
  vars?: Record<string, number>;
}

/** Grade an explain answer: the AI verdict when configured and text was typed, else offline. */
async function gradeExplain(
  ctx: Ctx,
  pack: CompiledPack,
  run: RunState,
  nodeId: NodeId,
  target: ExplainTarget,
  aiTarget: string,
  answer: AnswerValue,
): Promise<Graded> {
  if (answer.kind !== "explain")
    return {
      grade: target.offline
        ? safeGrade(() => gradeInteraction(target.offline as never, answer, gradeCtx(ctx, pack)))
        : { correct: false, score: 0 },
    };
  if (
    answer.text &&
    answer.choice === undefined &&
    answer.tiles === undefined &&
    answer.selfRating === undefined &&
    (await ctx.ai.configured())
  ) {
    const verdict = await ctx.ai
      .gradeExplain({
        pack,
        nodeId,
        target: aiTarget,
        keyPoints: [...target.keyPoints],
        minHits: target.minHits,
        text: answer.text,
        runId: run.id,
      })
      .catch(() => null);
    if (verdict) return { grade: gradeFromExplainGrade(verdict, target), explain: verdict };
  }
  return { grade: gradeExplainOffline(target, answer, pack.manifest.lang), explain: null };
}

async function gradeAttempt(ctx: Ctx, run: RunState, pack: CompiledPack | null, input: AttemptInput): Promise<Graded> {
  if (input.phase === "checkpoint" || input.phase === "relight") {
    const cur = run.current;
    if (!cur) throw new ServiceError("conflict", "no current item");
    const itemPack = pack ?? (await getPack(ctx, cur.ref.packId));
    const item = await findItem(ctx, run, itemPack, cur.ref);
    if (item.kind === "explain") {
      const g = await gradeExplain(ctx, itemPack, run, cur.ref.nodeId, item, item.id, input.answer);
      return { ...g, item };
    }
    const grade = safeGrade(() => gradeInteraction(item, input.answer, gradeCtx(ctx, itemPack, cur.vars)));
    return { grade, item, ...(cur.vars ? { vars: cur.vars } : {}) };
  }
  if (!pack) throw new ServiceError("conflict", "this run has no pack");
  const node = runNodeOrThrow(run, pack);
  if (input.phase === "hook")
    return { grade: safeGrade(() => gradeInteraction(node.hook.interaction, input.answer, gradeCtx(ctx, pack))) };
  if (input.phase === "card") {
    const at = cardAt(run, node);
    if (!at) throw new ServiceError("conflict", "this run isn't on a card");
    // An ask card's hunch is recorded, never graded.
    if (at.card.type === "ask") return { grade: { correct: false, score: 0 } };
    if (at.card.type !== "try" && at.card.type !== "check")
      throw new ServiceError("conflict", "this card has no action");
    const cix = at.card.interaction;
    if (cix.kind === "explain") return gradeExplain(ctx, pack, run, node.id, cix, cix.id, input.answer);
    return { grade: safeGrade(() => gradeInteraction(cix, input.answer, gradeCtx(ctx, pack))) };
  }
  const ix = node.screens[run.cursor.screen ?? -1]?.interaction;
  if (!ix) throw new ServiceError("conflict", "this beat has no action");
  if (ix.kind === "explain") return gradeExplain(ctx, pack, run, node.id, ix, ix.id, input.answer);
  return { grade: safeGrade(() => gradeInteraction(ix, input.answer, gradeCtx(ctx, pack))) };
}

/** Is the interaction still open after this attempt (keep the solution hidden)? */
function stillOpen(before: RunState, after: RunState, id: string): boolean {
  return (
    before.cursor.phase === after.cursor.phase &&
    before.cursor.screen === after.cursor.screen &&
    before.cursor.card === after.cursor.card &&
    (after.cursor.phase === "screen" || after.cursor.phase === "card") &&
    (after.hints[id] ?? 0) < SOLUTION_HINT_LEVEL &&
    after.finishedAt === undefined
  );
}

export async function attempt(ctx: Ctx, runId: string, input: AttemptInput): Promise<AttemptResult> {
  const now = ctx.clock.now();
  const run = await loadRun(ctx, runId);
  const pack = await runPack(ctx, run);
  const expected = expectedInteraction(run, pack);
  if (!expected) throw new ServiceError("conflict", `run ${runId} isn't waiting for an answer`);
  if (
    expected.phase !== input.phase ||
    expected.interactionId !== input.interactionId ||
    expected.nodeId !== input.nodeId
  )
    throw new ServiceError(
      "conflict",
      `run ${runId} expects ${expected.phase} ${expected.nodeId}/${expected.interactionId}`,
    );
  const packId = (run.packId === "*" ? (input.packId ?? expected.packId) : run.packId) as string;
  if (expected.packId && packId !== expected.packId) throw new ServiceError("conflict", "attempt is for another pack");

  const graded = await gradeAttempt(ctx, run, pack, input);
  const { grade } = graded;
  const id = input.interactionId;
  const hint = run.hints[id] ?? 0;
  const assisted = run.assisted.includes(id);
  const prior = (await ctx.repo.attempts({ runId })).filter((a) => a.interactionId === id && a.nodeId === input.nodeId);
  const counted = isCounted(run, input.phase);
  const credited =
    input.phase === "checkpoint"
      ? checkpointCredit(grade.correct, hint, assisted)
      : creditedScore(grade.score, hint, assisted);

  // Elo: item-bank attempts only (hooks and beats are never tuned; practice and try runs don't tune).
  const tuned = graded.item && (input.phase === "checkpoint" || input.phase === "relight") && !run.practice;
  const itemPack = pack ?? (run.current ? await getPack(ctx, run.current.ref.packId) : null);
  let progress: NodeProgress | undefined;
  let newRating: number | undefined;
  if (tuned && graded.item && itemPack) {
    progress = (await ctx.repo.progress(packId))[input.nodeId] ?? { ...emptyProgress(input.nodeId) };
    const ratings = await ctx.repo.itemRatings(packId, input.nodeId);
    const elo = updateElo(progress.theta, ratingOf(graded.item, ratings), credited);
    progress = { ...progress, theta: elo.theta };
    newRating = elo.d;
  }
  // The first hook (or typed-card) answer marks the card started (not for replays).
  const started =
    (input.phase === "hook" || input.phase === "card") && !run.replay && pack
      ? !(await ctx.repo.progress(packId))[input.nodeId]
      : false;

  let next: RunState["current"];
  if (input.phase === "checkpoint" || input.phase === "relight")
    next = (await ctx.repo.kv<Plan>(planKey(run.id)))?.entries[(run.cursor.item ?? 0) + 1];
  let after = reduce(run, pack, { type: "attempt", input, grade, counted, credited, ...(next ? { next } : {}) }, now);
  const misses = prior.filter((a) => !a.correct).length + (grade.correct ? 0 : 1);
  if (
    !grade.correct &&
    (input.phase === "screen" || input.phase === "card") &&
    misses >= 2 &&
    (after.hints[id] ?? 0) < SOLUTION_HINT_LEVEL &&
    after.cursor.phase === run.cursor.phase &&
    after.cursor.screen === run.cursor.screen &&
    after.cursor.card === run.cursor.card
  )
    after = reduce(after, pack, { type: "hint", interactionId: id, level: 3 }, now);

  const row = attemptRow(run, { ...input, packId }, grade, {
    counted,
    credited,
    hint,
    assisted,
    now,
    ...(graded.vars ? { vars: graded.vars } : {}),
  });
  const attemptId = await ctx.repo.tx(async (repo) => {
    const aid = await repo.addAttempt(row);
    await repo.putRun(after);
    if (started) await repo.putProgress(packId, emptyProgress(input.nodeId));
    if (progress) await repo.putProgress(packId, progress);
    if (newRating !== undefined) await repo.putItemRating(packId, input.nodeId, id, newRating);
    return aid;
  });

  const result: AttemptResult = {
    ...grade,
    attemptId,
    counted,
    creditedScore: credited,
    attemptsOnInteraction: prior.length + 1,
    run: after,
    now,
  };
  if (stillOpen(run, after, id)) delete result.solution;
  if (input.phase === "hook" && input.confidence === 3 && !grade.correct) result.plotTwist = true;
  return result;
}

// ── advance

/** Past a read-only beat (`screen`) or card (`card`); 409 unless the cursor is on it. */
export async function advance(
  ctx: Ctx,
  runId: string,
  body: { screen?: number | undefined; card?: number | undefined },
): Promise<{ run: RunState; now: Millis }> {
  const now = ctx.clock.now();
  const run = await loadRun(ctx, runId);
  const pack = await runPack(ctx, run);
  const event: Extract<RunEvent, { type: "advance" }> = { type: "advance" };
  if (body.card !== undefined) event.card = body.card;
  else if (body.screen !== undefined) event.screen = body.screen;
  const after = reduce(run, pack, event, now);
  // Typed cards have no hook: moving past the first card marks the card started (not for replays).
  const started =
    run.cursor.phase === "card" && run.kind === "card" && run.target && !run.replay && pack
      ? !(await ctx.repo.progress(pack.manifest.id))[run.target]
      : false;
  await ctx.repo.tx(async (repo) => {
    await repo.putRun(after);
    if (started && pack && run.target) await repo.putProgress(pack.manifest.id, emptyProgress(run.target));
  });
  return { run: after, now };
}

// ── hints

/** The beat (or typed try/check card) that owns an interaction: its action, alts and reveal. */
function beatOf(
  node: PackNode,
  interactionId: string,
): { interaction?: Interaction; alts?: Screen["alts"]; reveal?: Screen["reveal"] } | undefined {
  const screen = node.screens.find((s) => s.interaction?.id === interactionId);
  if (screen) return screen;
  for (const c of node.cards ?? [])
    if ((c.type === "try" || c.type === "check") && c.interaction.id === interactionId) return c;
  return undefined;
}

/** The misconception hints an interaction points at, in option / onWrong order. */
function taggedHints(node: PackNode, ix: Item | Interaction | undefined) {
  if (!ix) return [];
  const ids =
    ix.kind === "choice"
      ? ix.options.map((o) => o.misconception)
      : Object.values(ix.onWrong ?? {}).map((o) => o.misconception);
  return ids.flatMap((m) => (m && node.misconceptions[m] ? [node.misconceptions[m].hint] : []));
}

/** Level 1–2 hint text for a beat action (checkpoint and relight items use itemHintText, never the close). */
function levelHint(node: PackNode, interactionId: string, level: number, misconception: string | undefined): Markdown {
  const screen = beatOf(node, interactionId);
  const m = misconception ? node.misconceptions[misconception]?.hint : undefined;
  const tagged = taggedHints(node, screen?.interaction);
  const first = Object.values(node.misconceptions)[0]?.hint;
  const closeText = plainText(resolveClose(node, undefined).text);
  if (level <= 1) return m ?? tagged[0] ?? screen?.alts?.simpler ?? first ?? closeText;
  return screen?.alts?.example ?? screen?.alts?.simpler ?? tagged[1] ?? m ?? tagged[0] ?? first ?? closeText;
}

/** Level 3 (beat actions only): the worked answer, in words. */
function solutionHint(ctx: Ctx, node: PackNode, interactionId: string): Markdown {
  const screen = beatOf(node, interactionId);
  const ix = screen?.interaction;
  if (!ix) return node.close.text;
  const words = answerText(ix, solutionOf(ix), { widgets: ctx.widgets });
  const why = screen?.reveal?.text;
  return words ? `The answer: **${words}**.${why ? ` ${why}` : ""}` : (why ?? node.close.text);
}

export async function hint(
  ctx: Ctx,
  runId: string,
  body: { interactionId: string; answer?: AnswerValue },
): Promise<{ hint: Markdown; level: 1 | 2 | 3; source: "authored" | "ai"; run: RunState }> {
  const now = ctx.clock.now();
  const run = await loadRun(ctx, runId);
  const pack = await runPack(ctx, run);
  const current = currentInteractionId(run, pack);
  if (current !== body.interactionId)
    throw new ServiceError("conflict", `hints are for the current interaction (${current ?? "none"})`);
  const capped = run.kind === "checkpoint" || run.kind === "relight";
  const cap = capped ? CHECKPOINT_HINT_CAP : SOLUTION_HINT_LEVEL;
  const level = Math.min(cap, (run.hints[body.interactionId] ?? 0) + 1) as 1 | 2 | 3;
  const itemPack = pack ?? (run.current ? await getPack(ctx, run.current.ref.packId) : null);
  if (!itemPack) throw new ServiceError("conflict", "no pack for this run");
  const nodeId = expectedInteraction(run, pack)?.nodeId as NodeId;
  const node = nodeOf(itemPack, nodeId);
  const item = capped && run.current ? await findItem(ctx, run, itemPack, run.current.ref) : undefined;

  let misconception: string | undefined;
  if (body.answer) {
    try {
      misconception = (
        await gradeAttempt(ctx, run, pack, {
          nodeId,
          interactionId: body.interactionId,
          phase: run.cursor.phase as AttemptInput["phase"],
          answer: body.answer,
          ms: 0,
        })
      ).grade.misconception;
    } catch {
      misconception = undefined;
    }
  }
  let text: Markdown;
  if (item) text = itemHintText(node, item, level >= 2 ? 2 : 1, run.current?.vars, misconception).text;
  else if (level === 3) text = solutionHint(ctx, node, body.interactionId);
  else text = levelHint(node, body.interactionId, level, misconception);
  let source: "authored" | "ai" = "authored";
  let after = reduce(run, pack, { type: "hint", interactionId: body.interactionId, level }, now);
  if (level < 3 && (await ctx.ai.configured())) {
    const ai = await ctx.ai
      .rewriteHint({
        pack: itemPack,
        nodeId,
        interactionId: body.interactionId,
        answer: body.answer ?? { kind: "idk" },
        authoredHint: text,
        level,
        runId,
      })
      .catch(() => null);
    const leaks = ai && item ? answerLeak(ai, instantiateItem(item, run.current?.vars), run.current?.vars).leak : false;
    if (ai && !leaks) {
      text = ai;
      source = "ai";
      // Card beats: an AI rewrite counts as help. Checkpoints: credit follows the hint level only.
      if (!capped) after = reduce(after, pack, { type: "assist", interactionId: body.interactionId }, now);
    }
  }
  await ctx.repo.putRun(after);
  return { hint: text, level, source, run: after };
}

/**
 * Before a hint-mode croc reply on an open checkpoint or relight question: raise the shared hint counter
 * (cap 2) and return the new level.
 */
export async function crocHint(ctx: Ctx, runId: string): Promise<{ level: 0 | 1 | 2; run: RunState }> {
  const now = ctx.clock.now();
  const run = await loadRun(ctx, runId);
  if (run.kind !== "checkpoint" && run.kind !== "relight")
    throw new ServiceError("conflict", `run ${runId} has no open question`);
  // Between questions (the result screen) there is nothing to hint: level 0, no change.
  if (!run.current) return { level: 0, run };
  const id = run.current.ref.itemId;
  const level = Math.min(CHECKPOINT_HINT_CAP, (run.hints[id] ?? 0) + 1) as 1 | 2;
  if ((run.hints[id] ?? 0) >= level) return { level, run };
  const after = reduce(run, null, { type: "hint", interactionId: id, level }, now);
  await ctx.repo.putRun(after);
  return { level, run: after };
}

// ── scratch, get, abandon

export async function getRun(ctx: Ctx, runId: string): Promise<{ run: RunState; now: Millis }> {
  return { run: await loadRun(ctx, runId, false), now: ctx.clock.now() };
}

export async function patchScratch(ctx: Ctx, runId: string, scratch: Record<string, unknown>): Promise<{ ok: true }> {
  const run = await loadRun(ctx, runId);
  const merged = { ...run.cursor.scratch, ...scratch };
  if (new TextEncoder().encode(JSON.stringify(merged)).byteLength > MAX_SCRATCH_BYTES)
    throw new ServiceError("invalid", `scratch is limited to ${MAX_SCRATCH_BYTES} bytes`);
  await ctx.repo.putRun(reduce(run, null, { type: "scratch", scratch }, ctx.clock.now()));
  return { ok: true };
}

export async function abandon(ctx: Ctx, runId: string): Promise<{ ok: true }> {
  const run = await loadRun(ctx, runId);
  await ctx.repo.putRun(reduce(run, null, { type: "abandon" }, ctx.clock.now()));
  return { ok: true };
}

// ── finish

function baseSummary(run: RunState, now: Millis): RunSummary {
  return {
    runId: run.id,
    kind: run.kind,
    passed: false,
    score: 0,
    counted: 0,
    doneNow: [],
    litNow: [],
    unlocked: [],
    missed: [],
    cardsScheduled: 0,
    now,
  };
}

export async function finish(ctx: Ctx, runId: string, _body: Record<string, never> = {}): Promise<RunSummary> {
  const now = ctx.clock.now();
  const run = await loadRun(ctx, runId);
  const pack = await runPack(ctx, run);
  const closed = reduce(run, pack, { type: "finish" }, now);
  const summary = baseSummary(closed, now);
  const attempts = await ctx.repo.attempts({ runId });

  if (run.kind === "relight") {
    await ctx.repo.putRun(closed);
    return finishRelight(ctx, attempts, summary, now);
  }
  if (!pack) throw new ServiceError("conflict", "no pack");
  const packId = pack.manifest.id;
  const target = run.target as NodeId;

  if (run.kind === "checkpoint") return finishCheckpoint(ctx, pack, run, closed, attempts, summary, now);

  // card
  const before = (await viewsOf(ctx, pack, now)).views;
  const progress = (await ctx.repo.progress(packId))[target];
  const wasDone = progress?.status === "done" || progress?.status === "lit";
  // Replays write nothing (try runs live in a throwaway store, so their writes vanish with it).
  const write = !run.replay;
  const records: [NodeId, CheckpointRecord][] = [];
  for (const cp of Object.keys(pack.map.nodes).filter((id) => pack.map.nodes[id]?.kind === "checkpoint")) {
    const rec = await ctx.repo.kv<CheckpointRecord>(checkpointKey(packId, cp));
    if (rec?.revisit.includes(target)) records.push([cp, rec]);
  }
  await ctx.repo.tx(async (repo) => {
    await repo.putRun(closed);
    if (write && progress?.status !== "lit" && progress?.status !== "done")
      await repo.putProgress(packId, {
        ...(progress ?? emptyProgress(target)),
        status: "done",
        source: "run",
        doneAt: progress?.doneAt ?? now,
      });
    for (const [cp, rec] of records)
      await repo.setKv<CheckpointRecord>(checkpointKey(packId, cp), {
        ...rec,
        revisit: rec.revisit.filter((n) => n !== target),
      });
  });
  const after = (await viewsOf(ctx, pack, now)).views;
  const next = nextAfter(pack, after, target);
  return {
    ...summary,
    passed: true,
    score: 1,
    doneNow: write && !wasDone ? [target] : [],
    unlocked: newlyUnlocked(before, after),
    ...(next ? { next } : {}),
  };
}

/** Per-card FSRS grade at a pass: not asked → Good; all right, never hinted → Easy if perfect else Good; else Hard. */
export function passGrade(
  card: { asked: number; right: number; hinted: boolean } | undefined,
  perfect: boolean,
): 2 | 3 | 4 {
  if (!card || card.asked === 0) return 3;
  if (card.right === card.asked && !card.hinted) return perfect ? 4 : 3;
  return 2;
}

/** Misconceptions behind the wrong checkpoint answers (re-graded; one row per misconception). */
async function missedMisconceptions(ctx: Ctx, pack: CompiledPack, rows: readonly AttemptRow[]) {
  const out: RunSummary["missed"] = [];
  const seen = new Set<string>();
  for (const a of rows) {
    if (a.correct) continue;
    const node = pack.nodes[a.nodeId];
    const item = node?.items.find((i) => i.id === a.interactionId);
    if (!node || !item) continue;
    let m: string | undefined;
    try {
      m = gradeInteraction(item, a.answer, gradeCtx(ctx, pack, a.vars)).misconception;
    } catch {
      m = undefined;
    }
    const mis = m ? node.misconceptions[m] : undefined;
    if (!m || !mis || seen.has(`${a.nodeId}/${m}`)) continue;
    seen.add(`${a.nodeId}/${m}`);
    out.push({ misconception: m, label: mis.label, ...(mis.upstream ? { upstream: mis.upstream } : {}) });
  }
  return out;
}

/**
 * Checkpoint finish. Pass: covers light (node cards born with per-card grades, flashcards scheduled),
 * the gate's lit row, the gate's record deleted. Miss: the record keeps tries, asked items, vars, missed
 * and revisit cards for a fresh retry. Both (not practice): the earlier-section card is reviewed.
 * Practice re-runs of an open gate write nothing.
 */
async function finishCheckpoint(
  ctx: Ctx,
  pack: CompiledPack,
  run: RunState,
  closed: RunState,
  attempts: readonly AttemptRow[],
  summary: RunSummary,
  now: Millis,
): Promise<RunSummary> {
  const packId = pack.manifest.id;
  const cpId = run.target as NodeId;
  const rows = attempts.filter((a) => a.phase === "checkpoint");
  const size = run.size ?? rows.length;
  const res = checkpointResult(rows, size);
  const entry = pack.map.nodes[cpId];
  const covers = entry?.covers ?? [];
  const practice = run.practice === true;
  const key = checkpointKey(packId, cpId);
  const rec = await ctx.repo.kv<CheckpointRecord>(key);
  const revisit = res.passed ? [] : revisitTargets(pack, cpId, res.missed);
  const missed = await missedMisconceptions(ctx, pack, rows);
  const outcome: NonNullable<RunSummary["checkpoint"]> = {
    checkpointId: cpId,
    passed: res.passed,
    size,
    right: res.right,
    needed: res.needed,
    perfect: res.perfect,
    revisit,
    tries: res.passed ? 0 : (rec?.tries ?? 0) + (practice ? 0 : 1),
    practice,
  };
  const scored = {
    ...summary,
    passed: res.passed,
    score: size ? res.right / size : 0,
    counted: rows.length,
    missed,
    checkpoint: outcome,
  };

  if (practice) {
    await ctx.repo.putRun(closed);
    const views = (await viewsOf(ctx, pack, now)).views;
    const next = nextAfter(pack, views, cpId);
    return { ...scored, ...(next ? { next } : {}) };
  }

  const before = (await viewsOf(ctx, pack, now)).views;
  const progress = await ctx.repo.progress(packId);
  const cards = await nodeCardsOf(ctx, packId);
  const opts = await fsrsOpts(ctx);
  const existing = new Set((await ctx.repo.cards({ packId })).map((c) => c.id));
  const plan = await ctx.repo.kv<Plan>(planKey(run.id));
  let cardsScheduled = 0;
  let nextFadeAt: Millis | undefined;
  const fade = (c: CardState) => {
    const t = fadeAt(c, undefined, opts);
    if (t !== undefined) nextFadeAt = Math.min(nextFadeAt ?? t, t);
  };

  await ctx.repo.tx(async (repo) => {
    await repo.putRun(closed);
    // The earlier-section question reviews that card's node card (both outcomes).
    const earlier = new Map<NodeId, boolean[]>();
    for (const a of rows) {
      if (covers.includes(a.nodeId)) continue;
      const r = earlier.get(a.nodeId) ?? [];
      r.push(checkpointCredit(a.correct, a.hintLevel, a.assisted) === 1);
      earlier.set(a.nodeId, r);
    }
    for (const [nodeId, results] of earlier) {
      const card = cards[nodeId];
      if (!card) continue;
      const r = reviewCard(card, relightGrade(results), now, opts);
      await repo.putCard(r.card);
      await repo.addReviewLog({ ...r.log, source: "checkpoint" });
    }

    if (res.passed) {
      for (const c of covers) {
        const p = progress[c];
        const asked = (res.perCard[c]?.asked ?? 0) > 0;
        const grade = passGrade(res.perCard[c], res.perfect);
        const old = cards[c];
        if (p?.status !== "lit") {
          await repo.putProgress(packId, {
            ...(p ?? emptyProgress(c)),
            status: "lit",
            source: "checkpoint",
            litAt: now,
            doneAt: p?.doneAt ?? now,
          });
        }
        if (p?.status !== "lit" || (old && asked)) {
          const r = old ? reviewCard(old, grade, now, opts) : lightNodeCard(packId, c, now, grade, opts);
          await repo.putCard(r.card);
          await repo.addReviewLog({ ...r.log, source: "checkpoint" });
          fade(r.card);
          cardsScheduled++;
        }
        // The card's flashcards start coming up a day later.
        for (const f of pack.nodes[c]?.flashcards ?? []) {
          const id = flashcardId(packId, c, f.id);
          if (existing.has(id)) continue;
          await repo.putCard({
            ...newCard({ id, packId, nodeId: c, kind: "flashcard", now }),
            due: now + DAY_MS,
          });
          existing.add(id);
          cardsScheduled++;
        }
      }
      await repo.putProgress(packId, {
        ...(progress[cpId] ?? emptyProgress(cpId)),
        status: "lit",
        source: "checkpoint",
        litAt: now,
        bestScore: Math.max(progress[cpId]?.bestScore ?? 0, size ? res.right / size : 0),
      });
      await repo.setKv(key, undefined);
    } else {
      const asked = [...(rec?.asked ?? [])];
      const vars: CheckpointRecord["vars"] = { ...(rec?.vars ?? {}) };
      for (const e of plan?.entries ??
        rows.map((a) => ({ ref: { packId, nodeId: a.nodeId, itemId: a.interactionId }, vars: a.vars }))) {
        const k = itemKey(e.ref);
        const at = asked.indexOf(k);
        if (at >= 0) asked.splice(at, 1);
        asked.push(k); // most recently asked last
        if (e.vars) vars[k] = [...(vars[k] ?? []), e.vars].slice(-8);
      }
      await repo.setKv<CheckpointRecord>(key, {
        tries: (rec?.tries ?? 0) + 1,
        asked,
        vars,
        missed: [...new Set(res.missed.map((m) => m.nodeId))],
        revisit: [...new Set([...(rec?.revisit ?? []), ...revisit.map((r) => r.nodeId)])],
        lastRunId: run.id,
        at: now,
      });
    }
  });

  const after = (await viewsOf(ctx, pack, now)).views;
  const next = nextAfter(pack, after, cpId);
  return {
    ...scored,
    litNow: res.passed ? [...covers, cpId] : [],
    unlocked: newlyUnlocked(before, after),
    cardsScheduled,
    ...(nextFadeAt !== undefined ? { nextFadeAt } : {}),
    ...(next ? { next } : {}),
    ...(res.passed ? { mapFinished: isMapFinished(pack, after) } : {}),
  };
}

async function finishRelight(
  ctx: Ctx,
  attempts: readonly AttemptRow[],
  summary: RunSummary,
  now: Millis,
): Promise<RunSummary> {
  const opts = await fsrsOpts(ctx);
  const settings = await ctx.settings();
  const byNode = new Map<string, { packId: string; nodeId: NodeId; results: boolean[] }>();
  for (const a of attempts) {
    if (a.phase !== "relight") continue;
    const k = `${a.packId}/${a.nodeId}`;
    const e = byNode.get(k) ?? { packId: a.packId, nodeId: a.nodeId, results: [] };
    e.results.push(a.correct && a.creditedScore >= 0.5);
    byNode.set(k, e);
  }
  const relit: NonNullable<RunSummary["relit"]> = [];
  let cardsScheduled = 0;
  let nextFadeAt: Millis | undefined;
  for (const { packId, nodeId, results } of byNode.values()) {
    const grade = relightGrade(results);
    const cards = await nodeCardsOf(ctx, packId);
    const card = cards[nodeId];
    if (!card) continue;
    const r = reviewCard(card, grade, now, opts);
    const progress = (await ctx.repo.progress(packId))[nodeId];
    await ctx.repo.tx(async (repo) => {
      await repo.putCard(r.card);
      await repo.addReviewLog({ ...r.log, source: "relight" });
      if (progress && grade >= 2 && now - (progress.litAt ?? now) >= LATER_DAY_MS)
        await repo.putProgress(packId, { ...progress, relightsOk: progress.relightsOk + 1 });
      if (settings.experiments.creditFlowsDown && grade >= 3) {
        const pack = await getPack(ctx, packId);
        const credited = creditFlowsDown(
          dagOf(pack.map.nodes),
          nodeId,
          grade,
          new Map(Object.entries(cards)),
          now,
          opts,
        );
        for (const c of credited) await repo.putCard(c.card);
      }
    });
    cardsScheduled++;
    relit.push({ packId, nodeId, grade });
    const fade = fadeAt(r.card, undefined, opts);
    if (fade !== undefined) nextFadeAt = Math.min(nextFadeAt ?? fade, fade);
  }
  const n = attempts.length;
  return {
    ...summary,
    passed: true,
    score: n ? attempts.reduce((s, a) => s + a.creditedScore, 0) / n : 0,
    counted: 0,
    relit,
    cardsScheduled,
    ...(nextFadeAt !== undefined ? { nextFadeAt } : {}),
  };
}
