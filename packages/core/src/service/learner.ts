/**
 * Learner-state services: pack progress, the progress summary, Relight, flashcards, the Logbook,
 * legacy Field Notes and the local numbers.
 */
import { resolveClose } from "../card";
import { checkpointResult } from "../checkpoint";
import { plainText } from "../compile/text";
import { fadeAt, isDue, LIT_THRESHOLD, newCard, reviewCard, userCardId } from "../fsrs";
import { answerText, gradeInteraction } from "../grade";
import { hashString, instantiateItem } from "../params";
import { checkpointCredit } from "../pass";
import { buildRelightQueue, type RelightCandidate, relightDue } from "../relight";
import { createRun } from "../run";
import type {
  AnswerValue,
  AttemptRow,
  CardState,
  CompiledPack,
  FieldNote,
  Grade,
  Item,
  ItemRef,
  LocalNumbers,
  Logbook,
  Markdown,
  Millis,
  NodeId,
  NodeProgress,
  NodeView,
  PackId,
  PackProgress,
  RunState,
} from "../schema/index";
import { isMapFinished } from "../state";
import {
  type CreateNumbers,
  type Ctx,
  checkNodeId,
  checkPackId,
  crocAsksKey,
  findItem,
  fsrsOpts,
  getPack,
  openedKey,
  type Plan,
  planKey,
  ServiceError,
  viewsOf,
} from "./context";

// ── progress

export async function packProgress(ctx: Ctx, packId: PackId): Promise<PackProgress> {
  const now = ctx.clock.now();
  const pack = await getPack(ctx, checkPackId(packId));
  const { views, progress, nodeCards } = await viewsOf(ctx, pack, now);
  const opts = await fsrsOpts(ctx);
  const open = (await ctx.repo.openRuns({ packId }))[0];
  const flashcards = (await ctx.repo.cards({ packId })).filter((c) => c.kind !== "node" && isDue(c, now, opts)).length;
  const lastOpenedAt = await ctx.repo.kv<Millis>(openedKey(packId));
  const finished = isMapFinished(pack, views);
  const finishedAt = finished ? finishedAtOf(pack, progress) : undefined;
  const callback = await callbackCard(ctx, pack, views, progress, now);
  return {
    packId,
    nodes: progress,
    views,
    nodeCards,
    due: { relight: relightDue(Object.values(nodeCards), now, opts, 0).length, flashcards },
    ...(open ? { openRun: { runId: open.id, kind: open.kind, ...(open.target ? { target: open.target } : {}) } } : {}),
    ...(lastOpenedAt !== undefined ? { lastOpenedAt } : {}),
    ...(callback ? { callback } : {}),
    finished,
    ...(finishedAt !== undefined ? { finishedAt } : {}),
    now,
  };
}

/** When a finished map was finished: the latest gate opening (else the latest card lit). */
function finishedAtOf(pack: CompiledPack, progress: Readonly<Record<NodeId, NodeProgress>>): Millis | undefined {
  const gates = Object.values(progress).filter((p) => pack.map.nodes[p.nodeId]?.kind === "checkpoint");
  const at = (gates.length ? gates : Object.values(progress)).map((p) => p.litAt ?? 0);
  const max = Math.max(0, ...at);
  return max > 0 ? max : undefined;
}

/** A card closed at least this long ago may come back as "Yesterday's question" … */
export const CALLBACK_MIN_MS = 20 * 60 * 60 * 1000;
/** … until this long after it closed. */
export const CALLBACK_MAX_MS = 72 * 60 * 60 * 1000;

/**
 * "Yesterday's question": the card closed longest ago within 20–72 h whose hook hasn't been re-asked
 * (a "Guess again" run answered ≥ 20 h after the close). One re-ask per card, so the chip moves on.
 */
async function callbackCard(
  ctx: Ctx,
  pack: CompiledPack,
  views: Readonly<Record<NodeId, NodeView>>,
  progress: Readonly<Record<NodeId, NodeProgress>>,
  now: Millis,
): Promise<NodeId | undefined> {
  const packId = pack.manifest.id;
  const candidates = Object.values(progress)
    .filter(
      (p) =>
        p.doneAt !== undefined &&
        pack.nodes[p.nodeId] &&
        pack.map.nodes[p.nodeId]?.kind === "node" &&
        ["done", "lit", "fading"].includes(views[p.nodeId]?.state ?? "") &&
        now - p.doneAt >= CALLBACK_MIN_MS &&
        now - p.doneAt <= CALLBACK_MAX_MS,
    )
    .sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0) || a.nodeId.localeCompare(b.nodeId));
  for (const p of candidates) {
    const reasked = await reaskedHooks(ctx, packId, p.nodeId, (p.doneAt ?? 0) + CALLBACK_MIN_MS);
    if (reasked.length === 0) return p.nodeId;
  }
  return undefined;
}

/** Hook answers from "Guess again" (replay) runs on a card at or after `since`. */
async function reaskedHooks(ctx: Ctx, packId: PackId, nodeId: NodeId, since: Millis): Promise<AttemptRow[]> {
  const out: AttemptRow[] = [];
  for (const a of await ctx.repo.attempts({ packId, nodeId })) {
    if (a.phase !== "hook" || a.at < since) continue;
    const run = await ctx.repo.run(a.runId);
    if (run?.kind === "card" && run.replay) out.push(a);
  }
  return out;
}

type PackCounts = { done: number; lit: number; fading: number; playable: number; due: number; finished: boolean };

export async function progressSummary(ctx: Ctx): Promise<{ now: Millis; packs: Record<PackId, PackCounts> }> {
  const now = ctx.clock.now();
  const opts = await fsrsOpts(ctx);
  const packs: Record<PackId, PackCounts> = {};
  for (const s of await ctx.packs.list()) {
    if (s.status !== "ok") continue;
    const pack = await getPack(ctx, s.id).catch(() => null);
    if (!pack) continue;
    const { views, nodeCards } = await viewsOf(ctx, pack, now);
    const list = Object.values(views);
    const isCard = (id: NodeId) => pack.map.nodes[id]?.kind === "node";
    packs[s.id] = {
      done: list.filter((v) => v.state === "done").length,
      lit: list.filter((v) => v.state === "lit" && isCard(v.id)).length,
      fading: list.filter((v) => v.state === "fading").length,
      playable: Object.values(pack.map.nodes).filter((n) => n.status === "playable" && n.kind === "node").length,
      due: relightDue(Object.values(nodeCards), now, opts, 0).length,
      finished: isMapFinished(pack, views),
    };
  }
  return { now, packs };
}

export async function markOpened(ctx: Ctx, packId: PackId): Promise<{ ok: true }> {
  await getPack(ctx, checkPackId(packId));
  await ctx.repo.setKv(openedKey(packId), ctx.clock.now());
  return { ok: true };
}

// ── relight

export interface RelightResponse {
  run: RunState;
  items: { ref: ItemRef; interaction: Item; vars?: Record<string, number>; nodeTitle: string; packTitle: string }[];
  nothingDue: boolean;
  nextDueAt?: Millis;
  now: Millis;
}

/** Items asked in a card's most recent checkpoint or relight (for "never repeat the last questions"). */
async function lastAsked(ctx: Ctx, packId: PackId, nodeId: NodeId, pack: CompiledPack) {
  const rows = (await ctx.repo.attempts({ packId, nodeId })).filter(
    (a) => a.phase === "checkpoint" || a.phase === "relight",
  );
  const lastRun = rows.reduce<{ runId?: string; at: number }>(
    (best, a) => (a.at >= best.at ? { runId: a.runId, at: a.at } : best),
    { at: -1 },
  ).runId;
  const recent = rows.filter((a) => a.runId === lastRun);
  const node = pack.nodes[nodeId];
  const kinds = recent
    .map((a) => node?.items.find((i) => i.id === a.interactionId)?.kind)
    .filter((k): k is Item["kind"] => !!k);
  const lastVars: Record<string, Record<string, number>> = {};
  for (const a of recent) if (a.vars) lastVars[a.interactionId] = a.vars;
  return { lastCheck: recent.map((a) => a.interactionId), lastKinds: kinds, lastVars };
}

export async function relight(ctx: Ctx, body: { packId?: PackId; limit?: number } = {}): Promise<RelightResponse> {
  const now = ctx.clock.now();
  const opts = await fsrsOpts(ctx);
  const settings = await ctx.settings();
  if (body.packId) checkPackId(body.packId);
  const cards = (await ctx.repo.cards({ kind: "node", ...(body.packId ? { packId: body.packId } : {}) })).filter(
    (c) => c.nodeId !== null,
  );
  const due = relightDue(cards, now, opts, 0);
  const candidates: RelightCandidate[] = [];
  const packs = new Map<string, CompiledPack>();
  for (const { card, retrievability: r } of due) {
    const pack = packs.get(card.packId) ?? (await getPack(ctx, card.packId).catch(() => null));
    if (!pack) continue;
    packs.set(card.packId, pack);
    const node = pack.nodes[card.nodeId as NodeId];
    if (!node) continue;
    candidates.push({
      packId: card.packId,
      nodeId: node.id,
      node,
      retrievability: r,
      ...(await lastAsked(ctx, card.packId, node.id, pack)),
    });
  }
  const id = ctx.newId();
  const seed = hashString(id);
  const limit = Math.max(1, Math.min(20, body.limit ?? settings.learning.dailyRelight));
  const entries = buildRelightQueue(candidates, { limit, seed, explain: (await ctx.ai.configured()) ? 1 : 0 });
  const notDue = cards.filter((c) => !due.some((d) => d.card.id === c.id) && !c.suspended);
  // The next moment a node card comes due or fades below the lit threshold.
  const nextDueAt = notDue.reduce<number | undefined>((m, c) => {
    const t = Math.min(c.due, fadeAt(c, LIT_THRESHOLD, opts) ?? c.due);
    return m === undefined ? t : Math.min(m, t);
  }, undefined);
  const singlePack = body.packId ? (packs.get(body.packId) ?? (await getPack(ctx, body.packId))) : null;
  const run = createRun({
    id,
    kind: "relight",
    pack: singlePack,
    packId: body.packId ?? "*",
    packVersion: singlePack?.manifest.version ?? "*",
    now,
    seed,
    ...(entries[0] ? { current: entries[0] } : {}),
  });
  if (!entries.length) {
    return {
      run: { ...run, finishedAt: now },
      items: [],
      nothingDue: true,
      ...(nextDueAt !== undefined ? { nextDueAt } : {}),
      now,
    };
  }
  await ctx.repo.setKv<Plan>(planKey(id), { entries });
  await ctx.repo.putRun(run);
  const items: RelightResponse["items"] = [];
  for (const e of entries) {
    const pack = packs.get(e.ref.packId) as CompiledPack;
    const item = await findItem(ctx, run, pack, e.ref);
    items.push({
      ref: e.ref,
      interaction: instantiateItem(item, e.vars),
      ...(e.vars ? { vars: e.vars } : {}),
      nodeTitle: pack.nodes[e.ref.nodeId]?.title ?? e.ref.nodeId,
      packTitle: pack.manifest.title,
    });
  }
  return { run, items, nothingDue: false, ...(nextDueAt !== undefined ? { nextDueAt } : {}), now };
}

/** A daily "Relight (5 min)" calendar event (no counts). `time` is local "HH:MM". */
export function relightCalendar(time = "19:00", now: Millis = Date.UTC(2026, 0, 1)): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  const hh = m ? Math.min(23, Number(m[1])) : 19;
  const mm = m ? Math.min(59, Number(m[2])) : 0;
  const d = new Date(now);
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const t = `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}00`;
  const end = `${String(hh).padStart(2, "0")}${String(Math.min(59, mm + 5)).padStart(2, "0")}00`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//learncroc//relight//EN",
    "BEGIN:VEVENT",
    `UID:relight-daily@learncroc`,
    `DTSTAMP:${day}T000000Z`,
    `DTSTART:${day}T${t}`,
    `DTEND:${day}T${end}`,
    "RRULE:FREQ=DAILY",
    "SUMMARY:Relight (5 min)",
    "DESCRIPTION:Open Learncroc and relight the cards that are fading.",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

// ── cards

export type CardWithText = CardState & { front: Markdown; back: Markdown };

async function withText(ctx: Ctx, c: CardState): Promise<CardWithText | null> {
  if (c.kind === "user") return { ...c, front: c.front ?? "", back: c.back ?? "" };
  const pack = await getPack(ctx, c.packId).catch(() => null);
  const node = c.nodeId ? pack?.nodes[c.nodeId] : undefined;
  if (!node) return null;
  if (c.kind === "node") return { ...c, front: node.title, back: plainText(resolveClose(node, undefined).text) };
  const cardId = c.id.split(":").slice(3).join(":");
  const card = node.flashcards?.find((x) => x.id === cardId);
  return card ? { ...c, front: card.front, back: card.back } : null;
}

export async function listCards(
  ctx: Ctx,
  f: { packId?: PackId; kind?: CardState["kind"] } = {},
): Promise<CardWithText[]> {
  const out: CardWithText[] = [];
  for (const c of await ctx.repo.cards({
    ...(f.packId ? { packId: checkPackId(f.packId) } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
  })) {
    const t = await withText(ctx, c);
    if (t) out.push(t);
  }
  return out;
}

export async function dueCards(
  ctx: Ctx,
  f: { packId?: PackId; limit?: number } = {},
): Promise<{ now: Millis; cards: CardWithText[] }> {
  const now = ctx.clock.now();
  const opts = await fsrsOpts(ctx);
  const all = await listCards(ctx, f.packId ? { packId: f.packId } : {});
  const cards = all
    .filter((c) => c.kind !== "node" && isDue(c, now, opts))
    .slice(0, Math.max(1, Math.min(200, f.limit ?? 50)));
  return { now, cards };
}

export async function createCard(
  ctx: Ctx,
  body: { packId: PackId; nodeId?: NodeId; front: Markdown; back: Markdown; source: "session" | "manual" },
): Promise<CardState> {
  const pack = await getPack(ctx, checkPackId(body.packId));
  if (body.nodeId) {
    checkNodeId(body.nodeId);
    if (!pack.map.nodes[body.nodeId]) throw new ServiceError("not_found", `no card "${body.nodeId}"`);
  }
  const front = body.front.trim().slice(0, 500);
  const back = body.back.trim().slice(0, 500);
  if (!front || !back) throw new ServiceError("invalid", "a flashcard needs a front and a back");
  const card = newCard({
    id: userCardId(ctx.newId()),
    packId: body.packId,
    nodeId: body.nodeId ?? null,
    kind: "user",
    now: ctx.clock.now(),
    front,
    back,
  });
  await ctx.repo.putCard(card);
  return card;
}

async function cardById(ctx: Ctx, id: string): Promise<CardState> {
  const c = (await ctx.repo.cards({})).find((x) => x.id === id);
  if (!c) throw new ServiceError("not_found", `no card "${id}"`);
  return c;
}

export async function patchCard(
  ctx: Ctx,
  id: string,
  body: { front?: Markdown; back?: Markdown; suspended?: boolean },
): Promise<CardState> {
  const c = await cardById(ctx, id);
  if ((body.front !== undefined || body.back !== undefined) && c.kind !== "user")
    throw new ServiceError("forbidden", "only your own flashcards can be edited");
  const next: CardState = {
    ...c,
    ...(body.front !== undefined ? { front: body.front.trim().slice(0, 500) } : {}),
    ...(body.back !== undefined ? { back: body.back.trim().slice(0, 500) } : {}),
    ...(body.suspended !== undefined ? { suspended: body.suspended } : {}),
  };
  await ctx.repo.putCard(next);
  return next;
}

export async function deleteCard(ctx: Ctx, id: string): Promise<{ ok: true }> {
  const c = await cardById(ctx, id);
  if (c.kind === "node") throw new ServiceError("forbidden", "node cards follow their card; suspend them instead");
  await ctx.repo.deleteCard(id);
  return { ok: true };
}

export async function reviewFlashcard(
  ctx: Ctx,
  id: string,
  body: { grade?: Grade; correct?: boolean; ms?: number },
): Promise<CardState> {
  const c = await cardById(ctx, id);
  const grade: Grade = body.grade ?? (body.correct === undefined ? 3 : body.correct ? 3 : 1);
  const r = reviewCard(c, grade, ctx.clock.now(), await fsrsOpts(ctx));
  await ctx.repo.tx(async (repo) => {
    await repo.putCard(r.card);
    await repo.addReviewLog({ ...r.log, source: "cards" });
  });
  return r.card;
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export async function exportCards(ctx: Ctx, f: { format: "csv" | "md"; packId?: PackId }): Promise<string> {
  const cards = (await listCards(ctx, f.packId ? { packId: f.packId } : {})).filter((c) => c.kind !== "node");
  if (f.format === "csv") {
    return `${["front,back,pack,card,due", ...cards.map((c) => [c.front, c.back, c.packId, c.nodeId ?? "", new Date(c.due).toISOString()].map(csvCell).join(","))].join("\n")}\n`;
  }
  const lines: string[] = ["# Learncroc flashcards", ""];
  for (const c of cards) lines.push(`- **${c.front.replace(/\n/g, " ")}**: ${c.back.replace(/\n/g, " ")}`);
  return `${lines.join("\n")}\n`;
}

// ── logbook and notes

export async function fieldNotes(ctx: Ctx, f: { packId?: PackId } = {}): Promise<FieldNote[]> {
  return ctx.repo.fieldNotes(f.packId ? { packId: checkPackId(f.packId) } : {});
}

export async function logbook(ctx: Ctx, f: { packId?: PackId } = {}): Promise<Logbook> {
  const now = ctx.clock.now();
  const notes = await fieldNotes(ctx, f);
  const packIds = f.packId
    ? [checkPackId(f.packId)]
    : (await ctx.packs.list()).filter((p) => p.status === "ok").map((p) => p.id);
  const canNow: Logbook["canNow"] = [];
  const usedToThink: Logbook["usedToThink"] = [];
  const badges: Logbook["badges"] = [];
  const counts = new Map<string, number>();
  for (const id of packIds) {
    const pack = await getPack(ctx, id).catch(() => null);
    if (!pack) continue;
    const progress = await ctx.repo.progress(id);
    for (const line of pack.map.lines) {
      const stops = Object.values(pack.map.nodes).filter(
        (n) => n.line === line.id && n.status === "playable" && n.kind === "node",
      );
      if (stops.length && stops.every((n) => progress[n.id]?.status === "lit"))
        canNow.push({ packId: id, lineId: line.id, text: line.outcome });
    }
    const attempts = await ctx.repo.attempts({ packId: id });
    // "I used to think": wrong hook guesses (not "No idea yet") on cards that are now lit.
    const seen = new Set<NodeId>();
    for (const a of [...attempts].reverse()) {
      if (a.phase !== "hook" || a.correct || a.answer.kind === "idk" || seen.has(a.nodeId)) continue;
      const node = pack.nodes[a.nodeId];
      if (!node || progress[a.nodeId]?.status !== "lit") continue;
      seen.add(a.nodeId);
      const guess = { interactionId: a.interactionId, answer: a.answer, correct: false };
      const text = answerText(node.hook.interaction, a.answer, { widgets: ctx.widgets });
      if (!text) continue;
      usedToThink.push({
        packId: id,
        nodeId: a.nodeId,
        guess: text,
        now: plainText(resolveClose(node, guess, { widgets: ctx.widgets }).text),
      });
    }
    const { views } = await viewsOf(ctx, pack, now);
    if (isMapFinished(pack, views)) {
      const litAt = [finishedAtOf(pack, progress) ?? 0];
      badges.push({
        packId: id,
        title: pack.manifest.title,
        world: pack.manifest.theme.world,
        cards: Object.values(pack.map.nodes).filter((n) => n.kind === "node" && n.status === "playable").length,
        finishedAt: Math.max(0, ...litAt),
      });
    }
    for (const a of attempts) {
      const day = new Date(a.at).toISOString().slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  const activity = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
  return { canNow, fieldNotes: notes, usedToThink, activity, badges, now };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY = 24 * HOUR_MS;
const dayOf = (t: Millis) => new Date(t).toISOString().slice(0, 10);
/** Monday-based UTC week index. */
const weekOf = (t: Millis) => Math.floor((t / DAY + 3) / 7);

function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/**
 * GET /numbers: the local success metrics, derived only from attempts, runs, progress, the
 * review log and kv `numbers:create:*` / `numbers:croc`. Nothing here touches the network.
 */
export async function numbers(ctx: Ctx): Promise<LocalNumbers> {
  const now = ctx.clock.now();
  const t = await ctx.repo.exportTables();
  const runs = new Map(t.run.map((r) => [r.id, r] as const));
  const byRun = new Map<string, AttemptRow[]>();
  for (const a of t.attempt) {
    const xs = byRun.get(a.runId) ?? [];
    xs.push(a);
    byRun.set(a.runId, xs);
  }
  const progressKey = (packId: string, nodeId: string) => `${packId}/${nodeId}`;
  const doneAt = new Map<string, Millis>();
  for (const p of t.node_progress) if (p.doneAt !== undefined) doneAt.set(progressKey(p.packId, p.nodeId), p.doneAt);
  const packs = new Map<string, CompiledPack | null>();
  const packOf = async (id: string) => {
    if (!packs.has(id)) packs.set(id, await getPack(ctx, id).catch(() => null));
    return packs.get(id) ?? null;
  };
  const itemOf = async (a: AttemptRow) =>
    (await packOf(a.packId))?.nodes[a.nodeId]?.items.find((i) => i.id === a.interactionId);
  const rightAt = (a: AttemptRow) => checkpointCredit(a.correct, a.hintLevel, a.assisted) === 1;

  // M1: hooks re-asked ≥ 20 h after the card closed ("Guess again" / Yesterday's question), plus
  // checkpoint callback questions asked that late.
  const nextDayExplain = { asked: 0, right: 0 };
  for (const a of t.attempt) {
    const closedAt = doneAt.get(progressKey(a.packId, a.nodeId));
    if (closedAt === undefined || a.at - closedAt < CALLBACK_MIN_MS) continue;
    const run = runs.get(a.runId);
    if (a.phase === "hook" && run?.kind === "card" && run.replay) {
      nextDayExplain.asked++;
      if (a.correct) nextDayExplain.right++;
    } else if (a.phase === "checkpoint" && !run?.practice && (await itemOf(a))?.callback) {
      nextDayExplain.asked++;
      if (rightAt(a)) nextDayExplain.right++;
    }
  }

  // M2: the first finished (every question answered) attempt per checkpoint.
  const firstAttempt = new Map<string, { at: Millis; passed: boolean; packId: string }>();
  for (const r of t.run) {
    if (r.kind !== "checkpoint" || r.practice || r.finishedAt === undefined || r.packId === "*" || !r.target) continue;
    const rows = (byRun.get(r.id) ?? []).filter((a) => a.phase === "checkpoint");
    const size = r.size ?? rows.length;
    if (!rows.length || rows.length < size) continue;
    const k = progressKey(r.packId, r.target);
    const prev = firstAttempt.get(k);
    if (prev && prev.at <= r.finishedAt) continue;
    firstAttempt.set(k, { at: r.finishedAt, passed: checkpointResult(rows, size).passed, packId: r.packId });
  }
  const checkpointFirstTry: LocalNumbers["checkpointFirstTry"] = { attempted: 0, passedFirstTry: 0, perPack: {} };
  for (const f of firstAttempt.values()) {
    const pp = checkpointFirstTry.perPack[f.packId] ?? { attempted: 0, passedFirstTry: 0 };
    pp.attempted++;
    checkpointFirstTry.attempted++;
    if (f.passed) {
      pp.passedFirstTry++;
      checkpointFirstTry.passedFirstTry++;
    }
    checkpointFirstTry.perPack[f.packId] = pp;
  }

  // M3: maps with ≥ 1 card closed, and maps finished.
  const maps = { started: 0, finished: 0 };
  const startedPacks = new Set(
    t.node_progress.filter((p) => p.status === "done" || p.status === "lit").map((p) => p.packId),
  );
  for (const packId of startedPacks) {
    const pack = await packOf(packId);
    if (!pack) continue;
    maps.started++;
    if (isMapFinished(pack, (await viewsOf(ctx, pack, now)).views)) maps.finished++;
  }

  // M4: active days (a card, checkpoint or Relight finished with answers) followed by another within
  // 7 days. Days whose 7-day window is still open and not yet followed are left out.
  const active = new Set<string>();
  for (const r of t.run)
    if (r.finishedAt !== undefined && (byRun.get(r.id)?.length ?? 0) > 0) active.add(dayOf(r.finishedAt));
  const days = [...active].sort();
  const cameBack = { activeDays: 0, returned: 0 };
  for (let n = 0; n < days.length; n++) {
    const d = Date.parse(days[n] as string);
    const next = days[n + 1] ? Date.parse(days[n + 1] as string) : undefined;
    const returned = next !== undefined && next - d <= 7 * DAY;
    if (!returned && now - d < 8 * DAY) continue;
    cameBack.activeDays++;
    if (returned) cameBack.returned++;
  }

  // M5: link → first playable card, written by the create route at the first card-ready.
  const created = ctx.repo.kvList ? await ctx.repo.kvList<CreateNumbers>("numbers:create:") : [];
  const secs: number[] = [];
  const perModel = new Map<string, number[]>();
  for (const [, v] of created) {
    if (!v || typeof v.msToFirstCard !== "number") continue;
    const sec = v.msToFirstCard / 1000;
    secs.push(sec);
    const k = `${v.provider}/${v.model}`;
    perModel.set(k, [...(perModel.get(k) ?? []), sec]);
  }
  const linkToFirstCard: LocalNumbers["linkToFirstCard"] = {
    medianSec: round1(median(secs)),
    samples: secs.length,
    byModel: Object.fromEntries(
      [...perModel].map(([k, xs]) => [k, { medianSec: round1(median(xs)), samples: xs.length }]),
    ),
  };

  // Supporting numbers.
  const opened = new Set<string>();
  const minutes: number[] = [];
  for (const r of t.run) {
    if (r.kind !== "card" || r.replay || r.packId === "*" || !r.target) continue;
    const k = progressKey(r.packId, r.target);
    opened.add(k);
    if (r.finishedAt !== undefined && doneAt.get(k) === r.finishedAt) {
      const m = (r.finishedAt - r.startedAt) / 60_000;
      if (m >= 0 && m <= 120) minutes.push(m);
    }
  }
  const closedCards = new Set(
    t.node_progress
      .filter((p) => p.status === "done" || p.status === "lit")
      .map((p) => progressKey(p.packId, p.nodeId)),
  );
  const cardCompletion = { opened: opened.size, closed: [...opened].filter((k) => closedCards.has(k)).length };
  const cardMinutes = { median: round1(median(minutes)), samples: minutes.length };

  const beats = new Map<string, { misses: number; worked: boolean }>();
  const missedItems = new Map<
    string,
    { packId: string; nodeId: string; itemId: string; asked: number; missed: number }
  >();
  const checkpointHints = { questions: 0, hinted: 0 };
  for (const a of t.attempt) {
    if (a.phase === "screen") {
      const k = `${a.runId}|${a.interactionId}`;
      const b = beats.get(k) ?? { misses: 0, worked: false };
      if (!a.correct) b.misses++;
      if (a.hintLevel >= 3) b.worked = true;
      beats.set(k, b);
    } else if (a.phase === "checkpoint" && !runs.get(a.runId)?.practice) {
      checkpointHints.questions++;
      if (a.hintLevel >= 1) checkpointHints.hinted++;
      const k = `${a.packId}/${a.nodeId}/${a.interactionId}`;
      const m = missedItems.get(k) ?? {
        packId: a.packId,
        nodeId: a.nodeId,
        itemId: a.interactionId,
        asked: 0,
        missed: 0,
      };
      m.asked++;
      if (!rightAt(a)) m.missed++;
      missedItems.set(k, m);
    }
  }
  const workedAnswers = {
    beats: beats.size,
    needed: [...beats.values()].filter((b) => b.worked || b.misses >= 2).length,
  };
  const mostMissed = [...missedItems.values()]
    .filter((m) => m.missed > 0)
    .sort((a, b) => b.missed - a.missed || b.missed / b.asked - a.missed / a.asked || a.itemId.localeCompare(b.itemId))
    .slice(0, 20);

  const croc = await ctx.repo.kv<{ chips: number; freeText: number }>(crocAsksKey);
  const crocAsks = { chips: croc?.chips ?? 0, freeText: croc?.freeText ?? 0 };

  const weeks = new Set(t.attempt.map((a) => weekOf(a.at)));
  const sessions = t.run.filter(
    (r) => r.kind === "relight" && r.finishedAt !== undefined && (byRun.get(r.id)?.length ?? 0) > 0,
  ).length;

  return {
    nextDayExplain,
    checkpointFirstTry,
    maps,
    cameBack,
    linkToFirstCard,
    cardCompletion,
    cardMinutes,
    workedAnswers,
    mostMissed,
    checkpointHints,
    crocAsks,
    relightPerWeek: { sessions, weeks: weeks.size },
    now,
  };
}

/** Count one question to Moss (a chip or typed), for the local numbers. Called by the ask route. */
export async function noteCrocAsk(ctx: Ctx, body: { chip: boolean }): Promise<{ ok: true }> {
  const cur = (await ctx.repo.kv<{ chips: number; freeText: number }>(crocAsksKey)) ?? { chips: 0, freeText: 0 };
  await ctx.repo.setKv(
    crocAsksKey,
    body.chip ? { ...cur, chips: cur.chips + 1 } : { ...cur, freeText: cur.freeText + 1 },
  );
  return { ok: true };
}

/**
 * The items a checkpoint or relight run serves, rendered for this run (parametric prompts filled in).
 */
export async function planItems(
  ctx: Ctx,
  runId: string,
): Promise<{ ref: ItemRef; interaction: Item; vars?: Record<string, number> }[]> {
  const run = await ctx.repo.run(runId);
  if (!run) throw new ServiceError("not_found", `no run "${runId}"`);
  const plan = await ctx.repo.kv<Plan>(planKey(runId));
  const out: { ref: ItemRef; interaction: Item; vars?: Record<string, number> }[] = [];
  for (const e of plan?.entries ?? []) {
    const pack = await getPack(ctx, e.ref.packId);
    const item = await findItem(ctx, run, pack, e.ref);
    out.push({ ref: e.ref, interaction: instantiateItem(item, e.vars), ...(e.vars ? { vars: e.vars } : {}) });
  }
  return out;
}

/** Grade an answer against an item without recording anything (terminal relight, previews). */
export async function previewGrade(
  ctx: Ctx,
  packId: PackId,
  nodeId: NodeId,
  itemId: string,
  answer: AnswerValue,
  vars?: Record<string, number>,
) {
  const pack = await getPack(ctx, checkPackId(packId));
  const item = pack.nodes[checkNodeId(nodeId)]?.items.find((i) => i.id === itemId);
  if (!item) throw new ServiceError("not_found", `no item ${nodeId}/${itemId}`);
  return gradeInteraction(item, answer, {
    widgets: ctx.widgets,
    // Same language rule as attempts: answers are typed in the target language when there is one.
    lang: pack.manifest.targetLang ?? pack.manifest.lang,
    ...(vars ? { vars } : {}),
  });
}
