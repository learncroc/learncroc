/**
 * CardPlayer: one map stop as a conversation with Moss (docs/design/teach-first.md). A stop is one
 * server-run `card` session (hook → beats → close) played as typed cards: Ask (the hook, an optional
 * hunch), Teach (a beat's words: Moss and the article), Try or Check (a beat's action), Takeaway (the
 * close and what's next). The intro node plays its run on its own behind one Intro card.
 *
 * The thread is derived from the server's run, so a resumed or replayed stop rebuilds it; only what
 * appears now animates. The only local state is presentational: which Try/Check cards were opened,
 * the side questions asked, a typed hunch (sessionStorage) and a right answer held until "Go on".
 * The learner moves on with reply chips (the dark one is Enter). Entering the close finishes the run.
 */
import {
  type AnswerValue,
  type AttemptInput,
  type CardStep,
  type CompiledPack,
  cardStep,
  type NodeId,
  type PackNode,
  type RunState,
  type RunSummary,
  resolveClose,
  type StartRunBody,
} from "@learncroc/core";
import { Button } from "@learncroc/ui";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import { ArrowRight, MapTrifold } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { crocReactions } from "../../croc/reactions";
import {
  actionType,
  answerText,
  askHeadline,
  CARD_TYPE_LABEL,
  hasTeach,
  hookTask,
  isCanvasAsk,
  isIntroNode,
  nodeCards,
  screenTask,
  type Task,
  type TypedCard,
} from "../content";
import { Md } from "../Markdown";
import { useReducedMotion } from "../prefs";
import { useAiConfigured, useInvalidateProgress } from "../queries";
import { useRunSounds } from "../sound";
import { type SubmitOutcome, type TaskFeedback, type TaskSubmit, TaskView } from "../TaskView";
import { errorText, type RunSession, useRunSession } from "../useRunSession";
import { Indent, MeLine, type Reply, ReplyBar } from "./moss";
import { ALT_LABEL, type Aside, Feedback, readHunch, TypeDivider, writeHunch } from "./shared";
import { TypedCardBody } from "./TypedCardBody";
import { blockItems, Headline, type Item, moss, plain, Seq, useNextStep, VisualCanvas } from "./thread";

export interface CardPlayerStepInfo {
  /** The server step (hook, beat, card, close, done). */
  step: CardStep["kind"];
  nodeId: NodeId;
  runId: string;
  screenId?: string;
  /** Beat index (beats only). */
  beat?: number;
  /** The typed card on screen now, and its place among this stop's cards. */
  card: TypedCard;
  cardIndex: number;
  /** The run finished and the stop is Done. */
  done: boolean;
  /** A replay of a closed stop (nothing on the map changes). */
  replay: boolean;
}

export interface CardPlayerProps {
  /** A `card` run (map) or a `try` run (marketplace; the server sends the pack with the run). */
  start: StartRunBody;
  /** The compiled pack, when the caller has it (the map always does). */
  pack?: CompiledPack;
  /** A pre-locked hook option id or "idk": the hunch is sent at once and the stop opens at beat 1. */
  guess?: string;
  /** Revisit: the checkpoint the end returns to. */
  from?: NodeId;
  /** The card's keys are active (false while another layer is on top). */
  keysActive?: boolean;
  /** Bump to abandon this run and start the stop over ("Restart this card"). */
  restartSignal?: number;
  onStep?(info: CardPlayerStepInfo): void;
  onNavigate?(to: { nodeId: NodeId; kind: "node" | "checkpoint"; from?: NodeId }): void;
  onSummary?(summary: RunSummary): void;
  /** Back to the map (or out of the embed). */
  onExit?(): void;
  variant?: "modal" | "embed";
}

const ctx = { widgets: widgetSpecRegistry };

export function CardPlayer(p: CardPlayerProps) {
  const session = useRunSession(p.start);
  const pack = p.pack ?? session.tryPack;
  const run = session.run;
  const targetId = run?.target ?? (p.start.kind === "card" ? p.start.target : undefined);
  const node = targetId && pack ? pack.nodes[targetId] : undefined;

  if (session.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3 p-8" role="alert" data-card-error>
        <p className="text-body text-ink-2">Couldn't open this card. {session.error ?? ""}</p>
        <div className="flex gap-3">
          <Button variant="primary" onClick={session.retry}>
            Try again
          </Button>
          {p.onExit ? <Button onClick={p.onExit}>Back to map</Button> : null}
        </div>
      </div>
    );
  }
  if (!pack || !run) {
    return (
      <div className="grid min-h-[420px] flex-1 place-items-center text-small text-ink-3" role="status">
        Opening the card…
      </div>
    );
  }
  if (!node) {
    return (
      <div className="flex flex-col items-start gap-3 p-8" role="alert">
        <p className="text-body text-ink-2">This card is still being written. Usually under a minute.</p>
        {p.onExit ? <Button onClick={p.onExit}>Back to map</Button> : null}
      </div>
    );
  }
  // A node with authored typed cards plays them directly (a run begun before the cards existed keeps the old path).
  if (node.cards?.length && run.cursor.phase !== "hook" && run.cursor.phase !== "screen")
    return <TypedCardBody {...p} pack={pack} node={node} run={run} session={session} />;
  return <CardBody {...p} pack={pack} node={node} run={run} session={session} />;
}

function CardBody(p: CardPlayerProps & { pack: CompiledPack; node: PackNode; run: RunState; session: RunSession }) {
  const { pack, node, run, session } = p;
  const packId = pack.manifest.id;
  const lang = pack.manifest.targetLang ?? pack.manifest.lang;
  const variant = p.variant ?? "modal";
  const rm = useReducedMotion();
  const aiConfigured = useAiConfigured();
  const sounds = useRunSounds();
  const invalidate = useInvalidateProgress();
  const keysActive = p.keysActive ?? true;
  const intro = isIntroNode(node);

  const [held, setHeld] = useState<number | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [answeredHere, setAnsweredHere] = useState<ReadonlySet<number>>(new Set());
  const [asides, setAsides] = useState<Aside[]>([]);
  const [hunch, setHunchState] = useState(() => readHunch(packId, node.id));
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [summary, setSummary] = useState<RunSummary>();
  const [finishError, setFinishError] = useState<string>();
  const [finishTry, setFinishTry] = useState(0);
  const finishing = useRef(false);
  const guessSent = useRef(false);
  const autoBusy = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const setHunch = useCallback(
    (v: string) => {
      writeHunch(packId, node.id, v);
      setHunchState(v);
    },
    [packId, node.id],
  );

  const live: CardStep = cardStep(run, node, ctx);
  const step: CardStep = useMemo(() => {
    if (held !== null) {
      const screen = node.screens[held];
      if (screen) return { kind: "beat", index: held, screen, readOnly: false };
    }
    if (live.kind === "done") return { kind: "close", close: resolveClose(node, run.guess, ctx) };
    return live;
  }, [held, live, node, run.guess]);

  // ── which typed cards are on screen
  const cards = useMemo(() => nodeCards(node), [node]);
  const currentKey = useMemo(() => {
    if (intro) return "intro";
    if (step.kind === "hook") return "ask";
    if (step.kind === "beat") {
      const i = step.index;
      const s = node.screens[i];
      if (!s?.interaction) return `teach-${i}`;
      if (hasTeach(s) && !opened.has(i) && !answeredHere.has(i) && held !== i) return `teach-${i}`;
      return `act-${i}`;
    }
    return "takeaway";
  }, [intro, step, node.screens, opened, answeredHere, held]);
  const currentIndex = Math.max(
    0,
    cards.findIndex((c) => c.key === currentKey),
  );
  const current = cards[currentIndex] ?? cards[0];
  const visible = cards.slice(0, currentIndex + 1);

  // Segments already there when the thread first drew (a resumed run) don't animate.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(rm ? cards.map((c) => c.key) : visible.map((c) => c.key));
  const animates = (key: string) => !rm && !seen.current?.has(key);
  const markReady = useCallback((key: string) => {
    setReady((r) => (r.has(key) ? r : new Set(r).add(key)));
  }, []);
  const isReady = (key: string) => !animates(key) || ready.has(key);

  const screenId = step.kind === "beat" ? step.screen.id : undefined;
  const onStep = p.onStep;
  // biome-ignore lint/correctness/useExhaustiveDependencies: report when what the header shows changes
  useEffect(() => {
    if (!current) return;
    onStep?.({
      step: step.kind,
      nodeId: node.id,
      runId: run.id,
      ...(screenId ? { screenId } : {}),
      ...(step.kind === "beat" ? { beat: step.index } : {}),
      card: current,
      cardIndex: currentIndex,
      done: Boolean(summary) || run.finishedAt !== undefined,
      replay: Boolean(run.replay),
    });
  }, [onStep, step.kind, node.id, run.id, screenId, currentIndex, summary]);

  useEffect(() => sounds.resetRun(), [sounds]);

  // "Restart this card": abandon the open run and start over from the Ask (Done and Lit stay).
  const lastRestart = useRef(p.restartSignal ?? 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to the signal only
  useEffect(() => {
    const sig = p.restartSignal ?? 0;
    if (sig === lastRestart.current) return;
    lastRestart.current = sig;
    const body: StartRunBody =
      p.start.kind === "card"
        ? {
            kind: "card",
            packId: p.start.packId,
            target: p.start.target,
            ...(run.replay || run.finishedAt !== undefined || summary ? { mode: "again" } : {}),
          }
        : p.start;
    setHeld(null);
    setOpened(new Set());
    setAnsweredHere(new Set());
    setAsides([]);
    setHunch("");
    setDraft("");
    setSummary(undefined);
    setFinishError(undefined);
    seen.current = new Set();
    finishing.current = false;
    guessSent.current = true;
    void session
      .abandon()
      .then(() => session.restart(body))
      .catch(() => undefined);
  }, [p.restartSignal]);

  // Keep the newest line in view as the thread grows (or its viewport shrinks).
  useEffect(() => {
    const inner = innerRef.current;
    const outer = scrollRef.current;
    if (!inner || !outer || typeof ResizeObserver === "undefined") return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      outer.scrollTo({ top: outer.scrollHeight, behavior: rm ? "auto" : "smooth" });
      // Overlapping smooth scrolls can stop short of a target that moved: land exactly once it settles.
      clearTimeout(settle);
      settle = setTimeout(() => outer.scrollTo({ top: outer.scrollHeight }), 450);
    });
    ro.observe(inner);
    // The reply bar growing a row shrinks the thread: keep the last line in view then too.
    ro.observe(outer);
    return () => {
      clearTimeout(settle);
      ro.disconnect();
    };
  }, [rm]);

  const send = useCallback(
    async (task: Task, s: TaskSubmit): Promise<SubmitOutcome> => {
      const input: AttemptInput = {
        nodeId: task.nodeId,
        interactionId: task.interactionId,
        phase: task.phase,
        answer: s.answer,
        ...(s.confidence ? { confidence: s.confidence } : {}),
        ms: s.ms,
      };
      const before = session.run?.cursor;
      const res = await session.attempt(input);
      return {
        correct: res.correct,
        score: res.score,
        ...(res.feedback ? { feedback: res.feedback } : {}),
        ...(res.misconception ? { misconception: res.misconception } : {}),
        attempts: res.attemptsOnInteraction,
        ...(res.plotTwist ? { plotTwist: true } : {}),
        stay:
          !res.correct &&
          res.run.cursor.phase === before?.phase &&
          res.run.cursor.screen === before?.screen &&
          res.run.finishedAt === undefined,
      };
    },
    [session],
  );

  // ── the hunch (the hook attempt; never graded on screen)
  const lockHunch = useCallback(
    async (answer: AnswerValue, typed?: string) => {
      if (busy) return;
      setBusy(true);
      setActionError(undefined);
      try {
        if (typed !== undefined) setHunch(typed);
        sounds.commit();
        await send(hookTask(pack, node), { answer, ms: 0 });
        crocReactions.emit({ type: answer.kind === "idk" ? "idk-locked" : "guess-locked", packId, nodeId: node.id });
      } catch (e) {
        setActionError(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, send, pack, node, sounds, packId, setHunch],
  );

  // ── the pre-locked hunch (first-run question, "?guess=")
  useEffect(() => {
    if (!run || live.kind !== "hook" || !p.guess || run.guess || guessSent.current) return;
    const hook = node.hook.interaction;
    const answer =
      p.guess === "idk"
        ? ({ kind: "idk" } as const)
        : hook.kind === "choice" && hook.options.some((o) => o.id === p.guess)
          ? ({ kind: "choice", selected: p.guess } as const)
          : undefined;
    if (!answer) return;
    guessSent.current = true;
    sounds.commit();
    void send(hookTask(pack, node), { answer, ms: 0 })
      .then(() =>
        crocReactions.emit({ type: answer.kind === "idk" ? "idk-locked" : "guess-locked", packId, nodeId: node.id }),
      )
      .catch(() => {
        guessSent.current = false;
      });
  }, [run, live.kind, p.guess, node, pack, send, sounds, packId]);

  // ── the intro plays its own run: hunch "No idea", every beat read, then the close finishes it
  // biome-ignore lint/correctness/useExhaustiveDependencies: step through once per cursor move
  useEffect(() => {
    if (!intro || run.finishedAt !== undefined || autoBusy.current) return;
    let job: Promise<unknown> | undefined;
    if (live.kind === "hook" && !run.guess) job = send(hookTask(pack, node), { answer: { kind: "idk" }, ms: 0 });
    else if (live.kind === "beat" && live.readOnly) job = session.advance(live.index);
    if (!job) return;
    autoBusy.current = true;
    job
      .catch((e: unknown) => setActionError(errorText(e)))
      .finally(() => {
        autoBusy.current = false;
      });
  }, [intro, live.kind, live.kind === "beat" ? live.index : -1, run.guess, run.finishedAt]);

  // ── entering the close finishes the run
  // biome-ignore lint/correctness/useExhaustiveDependencies: finish once per close (or on "Try again")
  useEffect(() => {
    if (!run || live.kind !== "close" || finishing.current || summary) return;
    finishing.current = true;
    setFinishError(undefined);
    session
      .finish()
      .then((s) => {
        setSummary(s);
        if (!intro) sounds.done();
        const g = run.guess;
        if (!intro && !run.replay && g && g.answer.kind !== "idk") {
          const type = g.correct ? "close-right" : g.confidence === 3 ? "close-confident-wrong" : "close-wrong";
          crocReactions.emit({ type, packId, nodeId: node.id });
        }
        invalidate(packId);
        p.onSummary?.(s);
      })
      .catch((e: unknown) => {
        finishing.current = false;
        setFinishError(errorText(e));
      });
  }, [live.kind, run.id, summary, finishTry]);

  const advance = async (index: number) => {
    if (busy) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await session.advance(index);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const next = useNextStep({
    pack,
    node,
    ...(summary ? { summary } : {}),
    ...((p.from ?? run.from) ? { from: p.from ?? run.from } : {}),
    variant,
    ...(p.onNavigate ? { onNavigate: p.onNavigate } : {}),
  });

  // ── side questions: the node's FAQ and the beat's other explanations, each answered once
  const askSide = (seg: string, q: string, a: string) => setAsides((xs) => [...xs, { seg, q, a }]);
  const asked = new Set(asides.map((x) => x.q));
  const sideReplies = (seg: string, screenIndex?: number): Reply[] => {
    const out: Reply[] = [];
    const s = screenIndex !== undefined ? node.screens[screenIndex] : undefined;
    for (const [k, v] of Object.entries(s?.alts ?? {})) {
      const label = ALT_LABEL[k] ?? "Say it another way";
      if (v && !asked.has(label)) out.push({ label, onSelect: () => askSide(seg, label, v) });
    }
    for (const f of node.faq ?? []) {
      if (!asked.has(f.q)) out.push({ label: f.q, onSelect: () => askSide(seg, f.q, f.a) });
    }
    return out.slice(0, 3);
  };

  // ── the thread
  const segs = visible.map((c) => renderCard(c));
  const asidesPending = asides.some((_a, i) => animates(`aside-${i}`) && !ready.has(`aside-${i}`));

  function renderCard(c: TypedCard) {
    const items = itemsFor(c);
    const mine = asides.map((a, i) => ({ a, i })).filter(({ a }) => a.seg === c.key);
    return (
      <section key={c.key} className="flex flex-col gap-3" data-typed-card={c.type} data-card-key={c.key}>
        <TypeDivider card={c} />
        <Seq items={items} animate={animates(c.key)} lang={lang} onDone={() => markReady(c.key)} />
        {mine.map(({ a, i }) => (
          <Seq
            key={`aside-${i}`}
            items={[
              plain(`aside-${i}-q`, <MeLine text={a.q} reducedMotion={rm} />),
              moss(`aside-${i}-a`, a.a, packId, "idle", rm),
            ]}
            animate={animates(`aside-${i}`)}
            lang={lang}
            onDone={() => markReady(`aside-${i}`)}
          />
        ))}
      </section>
    );
  }

  function itemsFor(c: TypedCard): Item[] {
    switch (c.type) {
      case "intro":
        return introItems();
      case "ask":
        return askItems();
      case "teach":
        return teachItems(c.screen ?? 0);
      case "try":
      case "check":
        return actionItems(c.screen ?? 0, c.type);
      case "takeaway":
        return takeawayItems();
    }
  }

  function introItems(): Item[] {
    const s0 = node.screens[0];
    const items: Item[] = s0?.blocks.length
      ? blockItems("intro", s0.blocks, {
          packId,
          lang,
          rm,
          ...(s0.visual ? { visual: visualOf(s0.visual, `${node.id}/${s0.id}/visual`) } : {}),
        })
      : [
          moss(
            "intro-hi",
            "Hi. I'm Moss. I read this one before you got here, so I'll walk you through it.",
            packId,
            "happy",
            rm,
          ),
        ];
    const stops = pack.map.topo.filter((id) => {
      const e = pack.map.nodes[id];
      return id !== node.id && e?.kind === "node" && e.status !== "planned";
    });
    if (stops.length) {
      items.push(moss("intro-stops", `${stops.length} stops, one question each:`, packId, "idle", rm));
      items.push(
        plain(
          "intro-list",
          <Indent>
            <ol className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2" data-intro-questions>
              {stops.map((id, i) => {
                const n = pack.nodes[id];
                return (
                  <li key={id} className="flex gap-2.5 rounded-sm bg-surface-2 px-3 py-2 text-small">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-micro font-semibold">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <b className="block font-semibold text-ink">{n?.title ?? pack.map.nodes[id]?.title ?? id}</b>
                      <span className="text-ink-2">{n ? askHeadline(n) : "Still being written."}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </Indent>,
        ),
      );
    }
    return items;
  }

  function askItems(): Item[] {
    const hook = node.hook;
    const items: Item[] = [
      moss("ask-lead", "New stop. Hold onto this question, because the next few cards answer it.", packId, "idle", rm),
    ];
    if (hook.blocks?.length) items.push(...blockItems("ask", hook.blocks, { packId, lang, rm }));
    if (hook.visual)
      items.push(plain("ask-visual", <Indent>{visualOf(hook.visual, `${node.id}/hook/visual`)}</Indent>));
    items.push(
      plain(
        "ask-headline",
        <Indent>
          <Headline label="This stop asks" text={askHeadline(node)} packId={packId} />
        </Indent>,
      ),
    );
    if (run.guess) {
      const g = run.guess;
      const said =
        g.answer.kind === "idk"
          ? hunch
            ? `My hunch: ${hunch}`
            : "No idea, go on"
          : `My hunch: ${answerText(hook.interaction, g.answer)}`;
      items.push(plain("ask-me", <MeLine text={said} reducedMotion={rm} />));
      return items;
    }
    items.push(
      moss(
        "ask-hunch",
        hook.interaction.kind === "choice"
          ? "Got a hunch? Pick one, type your own, or just go on. I won't grade it."
          : "Got a hunch? Have a go below, or just go on. I won't grade it.",
        packId,
        "curious",
        rm,
      ),
    );
    if (hook.interaction.kind === "choice") {
      items.push(
        plain(
          "ask-input",
          <Indent>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = draft.trim();
                if (v) void lockHunch({ kind: "idk" }, v);
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your own hunch (only you see it)"
                aria-label="Your hunch"
                maxLength={160}
                className="min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-3 py-2 text-body text-ink"
                data-hunch
              />
            </form>
          </Indent>,
        ),
      );
    } else {
      items.push(
        plain(
          "ask-task",
          <Indent>
            <TaskView
              task={hookTask(pack, node)}
              pack={pack}
              layout="hook"
              silent
              idk="No idea, go on"
              submitLabel="That's my hunch"
              submit={async (s): Promise<SubmitOutcome> => {
                await lockHunch(s.answer);
                return { correct: false, score: 0, attempts: 1, stay: false };
              }}
              aiConfigured={aiConfigured}
              reducedMotion={rm}
              keysActive={keysActive && !busy}
            />
          </Indent>,
        ),
      );
    }
    return items;
  }

  function visualOf(visual: NonNullable<PackNode["visual"]>, key: string) {
    return <VisualCanvas pack={pack} node={node} visual={visual} visualKey={key} rm={rm} />;
  }

  function teachItems(i: number): Item[] {
    const s = node.screens[i];
    if (!s) return [];
    // The beat's picture belongs to its words; an action drawn on the canvas keeps it instead.
    const visual = s.interaction && isCanvasAsk(s.interaction) ? undefined : (s.visual ?? node.visual);
    const items = blockItems(`teach-${i}`, s.blocks, {
      packId,
      lang,
      rm,
      ...(visual ? { visual: visualOf(visual, `${node.id}/${s.id}/visual`) } : {}),
    });
    return items.length ? items : [plain(`teach-${i}-empty`, null)];
  }

  function actionItems(i: number, type: "try" | "check"): Item[] {
    const s = node.screens[i];
    const full = s ? screenTask(pack, node, s) : null;
    if (!s || !full) return [];
    // The Teach card already showed the picture; a canvas action still needs it.
    const { visual: _shown, ...bare } = full;
    const task: Task = hasTeach(s) && !isCanvasAsk(full.ask) ? bare : full;
    const isLive = step.kind === "beat" && step.index === i;
    const lead =
      type === "check"
        ? "One question, about a situation we haven't seen. Every answer gets an explanation."
        : hasTeach(s)
          ? "Your turn. Try it."
          : "Try this.";
    const items: Item[] = [moss(`act-${i}-lead`, lead, packId, "curious", rm)];
    if (isLive || answeredHere.has(i)) {
      items.push(
        plain(
          `act-${i}-task`,
          <div data-act={s.id}>
            <TaskView
              task={task}
              pack={pack}
              layout="modal"
              revealInline
              doThisLabel={type === "check" ? "Check" : "Try it"}
              renderFeedback={(f) => <Feedback f={f} packId={packId} rm={rm} />}
              submit={async (sub) => {
                const o = await send(task, sub);
                // Right, or moved on after the worked answer: hold the beat until "Go on".
                if (o.correct || !o.stay) {
                  setAnsweredHere((x) => new Set(x).add(i));
                  setHeld(i);
                } else if (o.attempts === 1) crocReactions.emit({ type: "beat-missed", packId, nodeId: node.id });
                return o;
              }}
              onHint={async () => {
                const h = await session.hint(task.interactionId);
                return { hint: h.hint, source: h.source };
              }}
              scratch={run.cursor.scratch?.[task.interactionId]}
              onScratch={(v) => session.saveScratch({ [task.interactionId]: v })}
              aiConfigured={aiConfigured}
              reducedMotion={rm}
              keysActive={keysActive && isLive && held !== i}
            />
          </div>,
        ),
      );
    } else {
      // Answered before this thread was drawn: the question and how it went, in Moss's words.
      items.push(
        plain(
          `act-${i}-past`,
          <Indent>
            <p className="m-0 text-body text-ink-2">{s.interaction?.prompt}</p>
          </Indent>,
        ),
      );
      if (s.reveal) items.push(moss(`act-${i}-reveal`, s.reveal.text, packId, "happy", rm));
    }
    return items;
  }

  function takeawayItems(): Item[] {
    const close = resolveClose(node, run.guess, ctx);
    const items: Item[] = [moss("tk-lead", "Back to the question we started with.", packId, "idle", rm)];
    items.push(
      plain(
        "tk-answer",
        <Indent>
          <div className="rounded-md border-2 border-sea bg-surface px-5 py-4" data-close-text>
            <p className="t-micro mb-1 text-sea-text uppercase tracking-wide">{askHeadline(node)}</p>
            <div className="text-lead font-semibold text-ink">
              <Md text={close.text} packId={packId} />
            </div>
          </div>
        </Indent>,
      ),
    );
    if (hunch && run.guess?.answer.kind === "idk") {
      items.push(
        moss(
          "tk-hunch",
          `You wrote "${hunch}". Put it next to the answer: what did you have right, and what's new?`,
          packId,
          "curious",
          rm,
        ),
      );
    }
    if (finishError) {
      items.push(moss("tk-error", `I couldn't mark this stop done just now. ${finishError}`, packId, "curious", rm));
    }
    const teaser = close.teaser.trim();
    const from = p.from ?? run.from;
    if (next.line) items.push(moss("tk-next-line", next.line, packId, "idle", rm));
    else if (teaser && !from && next.kind !== "checkpoint")
      items.push(moss("tk-teaser", teaser, packId, "curious", rm));
    return items;
  }

  // ── replies for the card on screen
  const replies: Reply[] = (() => {
    if (!current || !isReady(current.key) || asidesPending || busy) return [];
    const k = current.key;
    if (current.type === "intro") {
      const r: Reply[] = sideReplies(k, 0);
      if (next.label && !next.disabled) r.push({ label: "Let's start", primary: true, onSelect: next.go });
      return r;
    }
    if (current.type === "ask") {
      const hook = node.hook.interaction;
      if (run.guess || hook.kind !== "choice") return [];
      const r: Reply[] = hook.options.map((o) => ({
        label: o.text,
        onSelect: () => void lockHunch({ kind: "choice", selected: o.id }),
      }));
      const typed = draft.trim();
      r.push(
        typed
          ? { label: "That's my hunch", primary: true, onSelect: () => void lockHunch({ kind: "idk" }, typed) }
          : { label: "No idea, go on", primary: true, onSelect: () => void lockHunch({ kind: "idk" }) },
      );
      return r;
    }
    if (current.type === "teach") {
      const i = current.screen ?? 0;
      const s = node.screens[i];
      const r = sideReplies(k, i);
      if (s?.interaction) {
        const t = actionType(node, i);
        r.push({
          label: t === "check" ? "Go on" : "Let me try",
          primary: true,
          onSelect: () => setOpened((x) => new Set(x).add(i)),
        });
      } else r.push({ label: "Go on", primary: true, onSelect: () => void advance(i) });
      return r;
    }
    if (current.type === "try" || current.type === "check") {
      const i = current.screen ?? 0;
      if (held !== i) return [];
      return [{ label: "Go on", primary: true, onSelect: () => setHeld(null) }];
    }
    // takeaway
    const r: Reply[] = [];
    if (finishError) r.push({ label: "Try again", onSelect: () => setFinishTry((n) => n + 1) });
    if (p.onExit)
      r.push({
        label: variant === "embed" ? "Close" : "Back to the map",
        icon: <MapTrifold size={16} aria-hidden />,
        ...(next.label ? {} : { primary: true }),
        onSelect: p.onExit,
      });
    if (next.label && p.onNavigate)
      r.push({
        label: next.label,
        primary: true,
        disabled: next.disabled,
        icon: <ArrowRight size={16} aria-hidden />,
        onSelect: next.go,
      });
    return r;
  })();

  const note = busy
    ? "One moment…"
    : actionError
      ? actionError
      : current?.type === "takeaway" && !summary && !finishError
        ? "Saving…"
        : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-card={node.id} data-step={step.kind} data-typed={current?.type}>
      {variant === "embed" ? (
        <div className="flex items-center gap-3 border-b border-line px-6 py-3">
          <span className="truncate text-small text-ink-2">{node.title}</span>
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {current ? `${CARD_TYPE_LABEL[current.type]} card` : ""}
      </p>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-6 lg:px-8" data-thread>
        <div ref={innerRef} className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
          {segs}
        </div>
      </div>
      <div className="shrink-0 border-t border-line bg-surface px-5 py-3 lg:px-8">
        <div className="mx-auto w-full max-w-[720px]">
          <ReplyBar replies={replies} keysActive={keysActive} {...(note ? { note } : {})} />
        </div>
      </div>
    </div>
  );
}
