/**
 * TypedCardBody: a stop whose node has authored typed cards (`node.cards`), played in order in the
 * Moss thread. The server cursor (phase "card", `cursor.card`) says which card is live:
 * - intro / teach / takeaway move on with `advance { card }`;
 * - ask takes the hunch as an attempt (a hunch chip, or "No idea" with an optional typed hunch kept in
 *   session storage), never graded;
 * - try is graded like a beat (retry, hints, worked answer after two misses);
 * - check is one shot: any answer is recorded, Moss reacts to the picked option, then "Go on".
 * Entering the end (the close, or a last read-only card) finishes the run.
 */
import {
  type AnswerValue,
  type AttemptInput,
  type Card,
  type CompiledPack,
  isReadOnlyCard,
  type PackNode,
  type RunState,
  type RunSummary,
  type StartRunBody,
  type TakeawayCard,
} from "@learncroc/core";
import { ArrowRight, MapTrifold } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { crocReactions } from "../../croc/reactions";
import { answerText, CARD_TYPE_LABEL, cardTask, isIntroNode, nodeCards, type Task } from "../content";
import { Md } from "../Markdown";
import { useReducedMotion } from "../prefs";
import { useAiConfigured, useInvalidateProgress } from "../queries";
import { useRunSounds } from "../sound";
import { type SubmitOutcome, type TaskFeedback, type TaskSubmit, TaskView } from "../TaskView";
import { errorText, type RunSession } from "../useRunSession";
import type { CardPlayerProps } from "./CardPlayer";
import { Indent, MeLine, MossLine, type Reply, ReplyBar } from "./moss";
import {
  ALT_LABEL,
  type Aside,
  Feedback,
  IntroQuestions,
  introStops,
  readHunch,
  TypeDivider,
  writeHunch,
} from "./shared";
import { blockItems, Headline, type Item, moss, plain, Seq, useNextStep, VisualCanvas } from "./thread";

interface CheckResult {
  answer: AnswerValue;
  outcome: SubmitOutcome;
}

export function TypedCardBody(
  p: CardPlayerProps & { pack: CompiledPack; node: PackNode; run: RunState; session: RunSession },
) {
  const { pack, node, run, session } = p;
  const cards: Card[] = node.cards ?? [];
  const total = cards.length;
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
  const [answeredHere, setAnsweredHere] = useState<ReadonlySet<number>>(new Set());
  const [checks, setChecks] = useState<ReadonlyMap<number, CheckResult>>(new Map());
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const setHunch = useCallback(
    (v: string) => {
      writeHunch(packId, node.id, v);
      setHunchState(v);
    },
    [packId, node.id],
  );

  // ── where the run is
  const phase = run.cursor.phase;
  const ended = phase === "close" || phase === "done";
  const liveIndex = phase === "card" ? Math.max(0, Math.min(run.cursor.card ?? 0, total - 1)) : total - 1;
  const lastCard = cards[total - 1];
  const endsOnCard = Boolean(lastCard && isReadOnlyCard(lastCard) && lastCard.type !== "ask");
  /** The stop is over (or over once this card is read): finish and offer what's next. */
  const atEnd = ended || (phase === "card" && liveIndex === total - 1 && endsOnCard);
  const currentIndex = held ?? liveIndex;
  const typed = useMemo(() => nodeCards(node), [node]);
  const current = typed[currentIndex];
  const visible = typed.slice(0, currentIndex + 1);

  // Segments already there when the thread first drew (a resumed run) don't animate.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(rm ? typed.map((c) => c.key) : visible.map((c) => c.key));
  const animates = (key: string) => !rm && !seen.current?.has(key);
  const markReady = useCallback((key: string) => {
    setReady((r) => (r.has(key) ? r : new Set(r).add(key)));
  }, []);
  const isReady = (key: string) => !animates(key) || ready.has(key);

  const onStep = p.onStep;
  // biome-ignore lint/correctness/useExhaustiveDependencies: report when what the header shows changes
  useEffect(() => {
    if (!current) return;
    onStep?.({
      step: ended ? (phase === "done" ? "done" : "close") : "card",
      nodeId: node.id,
      runId: run.id,
      card: current,
      cardIndex: currentIndex,
      done: Boolean(summary) || run.finishedAt !== undefined,
      replay: Boolean(run.replay),
    });
  }, [onStep, phase, node.id, run.id, currentIndex, summary]);

  useEffect(() => sounds.resetRun(), [sounds]);

  // "Restart this card": abandon the open run and start over from the first card.
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
    setAnsweredHere(new Set());
    setChecks(new Map());
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
      clearTimeout(settle);
      settle = setTimeout(() => outer.scrollTo({ top: outer.scrollHeight }), 450);
    });
    ro.observe(inner);
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
        phase: "card",
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
          res.run.cursor.card === before?.card &&
          res.run.finishedAt === undefined,
      };
    },
    [session],
  );

  // ── the hunch on an ask card (an attempt carrying it; never graded)
  const lockHunch = useCallback(
    async (askId: string, answer: AnswerValue, typedHunch?: string) => {
      if (busy) return;
      setBusy(true);
      setActionError(undefined);
      try {
        if (typedHunch !== undefined) setHunch(typedHunch);
        sounds.commit();
        await session.attempt({ nodeId: node.id, interactionId: askId, phase: "card", answer, ms: 0 });
        setDraft("");
        crocReactions.emit({ type: answer.kind === "idk" ? "idk-locked" : "guess-locked", packId, nodeId: node.id });
      } catch (e) {
        setActionError(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, session, node.id, sounds, packId, setHunch],
  );

  // ── the pre-locked hunch (first-run question, "?guess=") on a live first ask card
  useEffect(() => {
    const c = phase === "card" ? cards[liveIndex] : undefined;
    if (c?.type !== "ask" || !p.guess || guessSent.current) return;
    if (run.guess?.interactionId === c.id) return;
    const answer =
      p.guess === "idk"
        ? ({ kind: "idk" } as const)
        : c.hunches?.some((h) => h.id === p.guess)
          ? ({ kind: "choice", selected: p.guess } as const)
          : undefined;
    if (!answer) return;
    guessSent.current = true;
    void lockHunch(c.id, answer);
  }, [phase, liveIndex, p.guess, run.guess, cards, lockHunch]);

  // ── entering the end finishes the run
  // biome-ignore lint/correctness/useExhaustiveDependencies: finish once per end (or on "Try again")
  useEffect(() => {
    if (!atEnd || phase === "done" || run.finishedAt !== undefined || finishing.current || summary) return;
    finishing.current = true;
    setFinishError(undefined);
    session
      .finish()
      .then((s) => {
        setSummary(s);
        if (!intro) sounds.done();
        invalidate(packId);
        p.onSummary?.(s);
      })
      .catch((e: unknown) => {
        finishing.current = false;
        setFinishError(errorText(e));
      });
  }, [atEnd, run.id, summary, finishTry]);

  const advance = async (index: number) => {
    if (busy) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await session.advanceCard(index);
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

  // ── side questions: the node's FAQ and a teach card's other explanations, each answered once
  const askSide = (seg: string, q: string, a: string) => setAsides((xs) => [...xs, { seg, q, a }]);
  const asked = new Set(asides.map((x) => x.q));
  const sideReplies = (seg: string, card?: Card): Reply[] => {
    const out: Reply[] = [];
    const alts = card?.type === "teach" ? card.alts : undefined;
    for (const [k, v] of Object.entries(alts ?? {})) {
      const label = ALT_LABEL[k] ?? "Say it another way";
      if (v && !asked.has(label)) out.push({ label, onSelect: () => askSide(seg, label, v) });
    }
    for (const f of node.faq ?? []) {
      if (!asked.has(f.q)) out.push({ label: f.q, onSelect: () => askSide(seg, f.q, f.a) });
    }
    return out.slice(0, 3);
  };

  function visualOf(visual: NonNullable<PackNode["visual"]>, key: string) {
    return <VisualCanvas pack={pack} node={node} visual={visual} visualKey={key} rm={rm} />;
  }

  // ── what each card says
  function itemsFor(card: Card, i: number, key: string): Item[] {
    switch (card.type) {
      case "intro":
        return introItems(card, key);
      case "ask":
        return askItems(card, i, key);
      case "teach": {
        const items = blockItems(key, card.blocks, {
          packId,
          lang,
          rm,
          ...(card.visual ? { visual: visualOf(card.visual, `${node.id}/${card.id}/visual`) } : {}),
        });
        return items.length ? items : [plain(`${key}-empty`, null)];
      }
      case "try":
      case "check":
        return actionItems(card, i, key);
      case "takeaway":
        return takeawayItems(card, i, key);
    }
  }

  function introItems(card: Extract<Card, { type: "intro" }>, key: string): Item[] {
    const items = blockItems(key, card.blocks, { packId, lang, rm });
    if (!items.length)
      items.push(
        moss(
          `${key}-hi`,
          "Hi. I'm Moss. I read this one before you got here, so I'll walk you through it.",
          packId,
          "happy",
          rm,
        ),
      );
    const stops = introStops(pack, node.id);
    if (stops.length) {
      items.push(moss(`${key}-stops`, `${stops.length} stops, one question each:`, packId, "idle", rm));
      items.push(plain(`${key}-list`, <IntroQuestions pack={pack} stops={stops} />));
    }
    return items;
  }

  function hunchSaid(card: Extract<Card, { type: "ask" }>): string | undefined {
    const g = run.guess;
    if (!g || g.interactionId !== card.id) return undefined;
    if (g.answer.kind === "idk") return hunch ? `My hunch: ${hunch}` : "No idea, go on";
    if (g.answer.kind === "choice") {
      const id = Array.isArray(g.answer.selected) ? g.answer.selected[0] : g.answer.selected;
      const h = card.hunches?.find((x) => x.id === id);
      return `My hunch: ${h?.text ?? id ?? ""}`;
    }
    return `My hunch: ${answerText(undefined, g.answer)}`;
  }

  function askItems(card: Extract<Card, { type: "ask" }>, i: number, key: string): Item[] {
    const items: Item[] = card.blocks?.length ? blockItems(key, card.blocks, { packId, lang, rm }) : [];
    items.push(
      plain(
        `${key}-headline`,
        <Indent>
          <Headline label="This stop asks" text={card.prompt} packId={packId} />
        </Indent>,
      ),
    );
    const said = hunchSaid(card);
    if (said) {
      items.push(plain(`${key}-me`, <MeLine text={said} reducedMotion={rm} />));
      return items;
    }
    if (i < liveIndex || ended) return items;
    items.push(
      moss(
        `${key}-hunch`,
        card.hunches?.length
          ? "Got a hunch? Pick one, type your own, or just go on. I won't grade it."
          : "Got a hunch? Type it, or just go on. I won't grade it.",
        packId,
        "curious",
        rm,
      ),
    );
    items.push(
      plain(
        `${key}-input`,
        <Indent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = draft.trim();
              if (v) void lockHunch(card.id, { kind: "idk" }, v);
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
    return items;
  }

  function actionItems(card: Extract<Card, { type: "try" | "check" }>, i: number, key: string): Item[] {
    const task = cardTask(pack, node, card, i);
    const isLive = phase === "card" && liveIndex === i;
    const check = card.type === "check";
    const items: Item[] = card.blocks?.length ? blockItems(key, card.blocks, { packId, lang, rm }) : [];
    if (!card.blocks?.length)
      items.push(
        moss(
          `${key}-lead`,
          check ? "One question. Every answer gets an explanation." : "Your turn. Try it.",
          packId,
          "curious",
          rm,
        ),
      );
    if (isLive || answeredHere.has(i)) {
      items.push(
        plain(
          `${key}-task`,
          <div data-act={card.id}>
            <TaskView
              task={task}
              pack={pack}
              layout="modal"
              revealInline
              {...(check ? { oneShot: true } : {})}
              doThisLabel={check ? "Check" : "Try it"}
              renderFeedback={(f) =>
                check ? (
                  <CheckFeedback card={card} result={checks.get(i)} f={f} packId={packId} rm={rm} />
                ) : (
                  <Feedback f={f} packId={packId} rm={rm} />
                )
              }
              submit={async (sub) => {
                const o = await send(task, sub);
                if (check) {
                  setChecks((m) => new Map(m).set(i, { answer: sub.answer, outcome: o }));
                  setAnsweredHere((x) => new Set(x).add(i));
                  setHeld(i);
                } else if (o.correct || !o.stay) {
                  // Right, or moved on after the worked answer: hold the card until "Go on".
                  setAnsweredHere((x) => new Set(x).add(i));
                  setHeld(i);
                } else if (o.attempts === 1) crocReactions.emit({ type: "beat-missed", packId, nodeId: node.id });
                return o;
              }}
              {...(check
                ? {}
                : {
                    onHint: async () => {
                      const h = await session.hint(task.interactionId);
                      return { hint: h.hint, source: h.source };
                    },
                  })}
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
      // Answered before this thread was drawn: the question and its payoff, in Moss's words.
      items.push(
        plain(
          `${key}-past`,
          <Indent>
            <p className="m-0 text-body text-ink-2">{card.interaction.prompt}</p>
          </Indent>,
        ),
      );
      if (card.reveal) items.push(moss(`${key}-reveal`, card.reveal.text, packId, "happy", rm));
    }
    return items;
  }

  function hunchKey(card: TakeawayCard): string | undefined {
    const g = run.guess;
    if (!g) return undefined;
    if (card.answers && g.interactionId !== card.answers) return undefined;
    if (g.answer.kind === "idk") return hunch ? "typed" : "idk";
    if (g.answer.kind === "choice") {
      const id = Array.isArray(g.answer.selected) ? g.answer.selected[0] : g.answer.selected;
      return id;
    }
    return undefined;
  }

  function takeawayItems(card: TakeawayCard, i: number, key: string): Item[] {
    const ask = cards.find((c) => c.type === "ask" && (card.answers ? c.id === card.answers : true));
    const items: Item[] = [moss(`${key}-lead`, "Back to the question we started with.", packId, "idle", rm)];
    items.push(
      plain(
        `${key}-answer`,
        <Indent>
          <div className="rounded-md border-2 border-sea bg-surface px-5 py-4" data-close-text>
            {ask?.type === "ask" ? (
              <p className="t-micro mb-1 text-sea-text uppercase tracking-wide">{ask.prompt}</p>
            ) : null}
            <div className="text-lead font-semibold text-ink">
              <Md text={card.text} packId={packId} />
            </div>
          </div>
        </Indent>,
      ),
    );
    const hk = hunchKey(card);
    const reaction = hk ? card.byHunch?.[hk] : undefined;
    if (reaction) items.push(moss(`${key}-by-hunch`, reaction, packId, "curious", rm));
    else if (hk === "typed")
      items.push(
        moss(
          `${key}-typed`,
          `You wrote "${hunch}". Put it next to the answer: what did you have right, and what's new?`,
          packId,
          "curious",
          rm,
        ),
      );
    const isEnd = i === total - 1;
    if (isEnd && finishError)
      items.push(
        moss(`${key}-error`, `I couldn't mark this stop done just now. ${finishError}`, packId, "curious", rm),
      );
    const teaser = card.teaser?.trim();
    const from = p.from ?? run.from;
    if (isEnd && next.line) items.push(moss(`${key}-next-line`, next.line, packId, "idle", rm));
    else if (teaser && !from && next.kind !== "checkpoint")
      items.push(moss(`${key}-teaser`, teaser, packId, "curious", rm));
    return items;
  }

  // ── the thread
  const asidesPending = asides.some((_a, i) => animates(`aside-${i}`) && !ready.has(`aside-${i}`));
  const segs = visible.map((c) => {
    const i = c.index ?? 0;
    const card = cards[i];
    if (!card) return null;
    const mine = asides.map((a, n) => ({ a, n })).filter(({ a }) => a.seg === c.key);
    return (
      <section key={c.key} className="flex flex-col gap-3" data-typed-card={c.type} data-card-key={c.key}>
        <TypeDivider card={c} />
        <Seq items={itemsFor(card, i, c.key)} animate={animates(c.key)} lang={lang} onDone={() => markReady(c.key)} />
        {mine.map(({ a, n }) => (
          <Seq
            key={`aside-${n}`}
            items={[
              plain(`aside-${n}-q`, <MeLine text={a.q} reducedMotion={rm} />),
              moss(`aside-${n}-a`, a.a, packId, "idle", rm),
            ]}
            animate={animates(`aside-${n}`)}
            lang={lang}
            onDone={() => markReady(`aside-${n}`)}
          />
        ))}
      </section>
    );
  });

  // ── replies for the card on screen
  const endReplies = (): Reply[] => {
    const r: Reply[] = [];
    if (finishError) r.push({ label: "Try again", onSelect: () => setFinishTry((n) => n + 1) });
    if (intro && next.label && !next.disabled) {
      r.push({ label: "Let's start", primary: true, onSelect: next.go });
      return r;
    }
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
  };

  const replies: Reply[] = (() => {
    if (!current || !isReady(current.key) || asidesPending || busy) return [];
    const i = current.index ?? 0;
    const card = cards[i];
    if (!card) return [];
    const isLast = i === total - 1;
    const k = current.key;
    if (card.type === "try" || card.type === "check") {
      if (held !== i) return [];
      if (isLast && ended) return endReplies();
      return [{ label: "Go on", primary: true, onSelect: () => setHeld(null) }];
    }
    if (card.type === "ask") {
      if (phase !== "card" || liveIndex !== i || hunchSaid(card)) return [];
      const r: Reply[] = (card.hunches ?? []).map((h) => ({
        label: h.text,
        onSelect: () => void lockHunch(card.id, { kind: "choice", selected: h.id }),
      }));
      const t = draft.trim();
      r.push(
        t
          ? { label: "That's my hunch", primary: true, onSelect: () => void lockHunch(card.id, { kind: "idk" }, t) }
          : { label: "No idea, go on", primary: true, onSelect: () => void lockHunch(card.id, { kind: "idk" }) },
      );
      return r;
    }
    // intro, teach, takeaway: read, then move on (or the stop's end)
    const r: Reply[] = card.type === "takeaway" ? [] : sideReplies(k, card);
    if (isLast && atEnd) return [...r, ...endReplies()];
    if (phase === "card" && liveIndex === i)
      r.push({
        label: intro && card.type === "intro" ? "Let's start" : "Go on",
        primary: true,
        onSelect: () => void advance(i),
      });
    return r;
  })();

  const note = busy
    ? "One moment…"
    : actionError
      ? actionError
      : atEnd && currentIndex === total - 1 && !summary && !finishError && run.finishedAt === undefined
        ? "Saving…"
        : undefined;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-card={node.id}
      data-step={ended ? phase : "card"}
      data-typed={current?.type}
    >
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

/** A check card's answer: Moss reacts to the option picked (its why, else the feedback), then the reveal. */
function CheckFeedback(p: {
  card: Extract<Card, { type: "check" }>;
  result: CheckResult | undefined;
  f: TaskFeedback;
  packId: string;
  rm: boolean;
}) {
  const { card, result, f } = p;
  const ix = card.interaction;
  let why: string | undefined;
  if (result && ix.kind === "choice" && result.answer.kind === "choice" && !Array.isArray(result.answer.selected)) {
    const sel = result.answer.selected;
    why = ix.options.find((o) => o.id === sel)?.why;
  }
  why ??= result?.outcome.feedback;
  const right = result ? result.outcome.correct : f.tone === "right";
  const first = `${right ? "Right." : "Not this one."}${why ? ` ${why}` : ""}`;
  const reveal = card.reveal?.text;
  return (
    <div className="flex flex-col gap-3" data-feedback={right ? "right" : "wrong"} data-check-feedback>
      <MossLine text={first} mood={right ? "happy" : "curious"} packId={p.packId} reducedMotion={p.rm} />
      {reveal && reveal !== why ? <MossLine text={reveal} mood="idle" packId={p.packId} reducedMotion={p.rm} /> : null}
    </div>
  );
}
