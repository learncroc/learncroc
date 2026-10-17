/**
 * TaskView: one question on screen, laid out as canvas + coach (or a single column). It owns the
 * learner's draft, the canvas performance (chosen-option visualState, reveal visualState), feedback
 * for right / wrong / second miss, hints and the built-in fallback for canvas asks. The server grades
 * every attempt; this view only renders what came back.
 */
import {
  type AnswerValue,
  type ChoiceOption,
  type CompiledPack,
  type Confidence,
  type FallbackInteraction,
  solutionOf,
  answerText as solutionText,
  type VisualState,
} from "@learncroc/core";
import { Button, cn, IrisMark } from "@learncroc/ui";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import { Lightbulb } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Canvas, type CanvasContent, type HtmlReport } from "./Canvas";
import { type Ask, fillVars, isCanvasAsk, type Task } from "./content";
import { BuiltInInput } from "./interactions/AskInput";
import type { ExplainResult } from "./interactions/Explain";
import type { LastAttempt } from "./interactions/types";
import { useKeys } from "./keys";
import { Md } from "./Markdown";
import { useRunSounds } from "./sound";

/** What the caller reports back after the server graded an attempt. */
export interface SubmitOutcome {
  correct: boolean;
  score: number;
  feedback?: string;
  misconception?: string;
  matched?: string[];
  attempts: number;
  plotTwist?: boolean;
  /** The explain grade came from a model. */
  aiGraded?: boolean;
  /** The view should keep showing this task (the cursor did not move on). */
  stay: boolean;
}

export interface TaskSubmit {
  answer: AnswerValue;
  confidence?: Confidence;
  ms: number;
}

/** The graded outcome in words, for callers that speak it themselves (Moss in the card thread). */
export interface TaskFeedback {
  tone: "right" | "wrong";
  /** The authored or server feedback line. */
  text?: string;
  /** Second miss: the worked answer is shown. */
  second: boolean;
  /** "The answer is …" after the second miss. */
  worked?: string;
  /** The beat's reveal, once the task is answered or moved on. */
  reveal?: string;
  /** The canvas is showing what the chosen answer would mean. */
  canvasNote?: boolean;
}

export interface TaskViewProps {
  task: Task;
  pack: Pick<CompiledPack, "manifest">;
  /**
   * "modal": the card and checkpoint modals (canvas 280–340 px over the text over the action, ≤ 700 px).
   * "hook": the guess (never graded on screen: no right/wrong, no solution). "stack"/"split": Relight.
   */
  layout: "split" | "stack" | "hook" | "modal";
  /** Coach slots above "Do this": pinned guess, the previous reveal, setup blocks. */
  coachTop?: ReactNode;
  /** Coach slot at the bottom: the Ask input. */
  coachBottom?: ReactNode;
  /** The previous canvas, still performing its reveal, before this task's canvas morphs in. */
  prelude?: { content: CanvasContent; visualState?: VisualState; holdMs?: number };
  submit: (s: TaskSubmit) => Promise<SubmitOutcome | null>;
  onHint?: () => Promise<{ hint: string; source: "authored" | "ai" } | null>;
  /** Persisted partial state for this ask (run scratch). */
  scratch?: unknown;
  onScratch?: (value: unknown) => void;
  aiConfigured: boolean;
  /** "No idea yet" on hooks. */
  idk?: string;
  submitLabel?: string;
  /** Heading above the instruction; default "Do this". */
  doThisLabel?: string;
  reducedMotion: boolean;
  /** This task owns the run keys (false while an overlay is open). */
  keysActive: boolean;
  /** Show the reveal under the feedback after a right answer (when the caller won't move on). */
  revealInline?: boolean;
  /** Second miss: show the worked solution. Hooks reveal immediately. */
  solutionAfter?: number;
  /** Called after every graded attempt. */
  onResult?: (o: SubmitOutcome) => void;
  /** Extra content under the input (e.g. relight's shaky/solid). */
  extra?: ReactNode;
  /** No right/wrong feedback or sounds (the hook). */
  silent?: boolean;
  /**
   * Checkpoint questions: one answer, then "Right. {why}" or "Not this one. {why}" with the right answer
   * shown. No retry, no hint button (the checkpoint owns its hint control), no worked solution.
   */
  oneShot?: boolean;
  /** Speak the feedback yourself (the default feedback lines are not shown). */
  renderFeedback?: (f: TaskFeedback) => ReactNode;
  className?: string;
}

const PRELUDE_MS = 1600;
/** The canvas performs the chosen option's consequence for this long before the feedback copy shows. */
const CONSEQUENCE_MS = 1000;
const PRELUDE_MS_REDUCED = 700;

function canonicalKey(answer: AnswerValue): string {
  switch (answer.kind) {
    case "choice":
      return Array.isArray(answer.selected) ? answer.selected.join(",") : answer.selected;
    case "numeric":
    case "estimate":
      return String(answer.value);
    default:
      return "default";
  }
}

/** Authored feedback for a wrong answer when the server didn't send any. */
function authoredWrongFeedback(ask: Ask, answer: AnswerValue): string | undefined {
  const onWrong = "onWrong" in ask ? ask.onWrong : undefined;
  const key = canonicalKey(answer);
  const fromMap = onWrong?.[key]?.feedback ?? onWrong?.default?.feedback;
  if (fromMap) return fromMap;
  if (ask.kind === "choice" && answer.kind === "choice" && !Array.isArray(answer.selected)) {
    return ask.options.find((o) => o.id === answer.selected)?.why;
  }
  return undefined;
}

function chosenOption(ask: Ask, answer: AnswerValue | undefined): ChoiceOption | undefined {
  if (!answer || ask.kind !== "choice" || answer.kind !== "choice" || Array.isArray(answer.selected)) return undefined;
  return ask.options.find((o) => o.id === answer.selected);
}

/**
 * The second-miss line when nothing more specific was authored: the worked answer in words, and how
 * to carry on (the server accepts any answer once the solution has been shown).
 */
export function workedAnswerLine(ask: Ask, vars?: Record<string, number>): string {
  if (isCanvasAsk(ask)) return "The canvas shows the answer. Check it to carry on.";
  if (ask.kind === "explain") return "Here's one way to say it.";
  // Typed and arranged inputs show the worked answer in place.
  if (ask.kind !== "choice") return "Here's the worked answer. Use it to carry on.";
  let text = "";
  try {
    text = solutionText(ask, solutionOf(ask, vars ? { vars } : {}), {
      widgets: widgetSpecRegistry,
      ...(vars ? { vars } : {}),
    });
  } catch {
    text = "";
  }
  return text ? `It's “${text}”. Pick it to carry on.` : "The right one is marked. Pick it to carry on.";
}

/**
 * The ask actually shown. Canvas asks switch to their built-in fallback (a11y, failed widget);
 * explain is typed first and switches to its offline built-in only on request.
 */
function effectiveAsk(ask: Ask, useFallback: boolean): Ask {
  if (!useFallback) return ask;
  if (ask.kind === "explain") return withId(ask.offline, ask.id);
  if (isCanvasAsk(ask) && ask.fallback) return withId(ask.fallback, ask.id);
  return ask;
}

function withId(f: FallbackInteraction, id: string): Ask {
  return { ...f, id: f.id ?? id } as Ask;
}

export function TaskView(p: TaskViewProps) {
  const { task, pack, layout, reducedMotion } = p;
  const theme = pack.manifest.theme;
  const promptId = useId();
  const sounds = useRunSounds();
  const startedAt = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  const doThisRef = useRef<HTMLElement>(null);

  const [useFallback, setUseFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ answer: AnswerValue; outcome: SubmitOutcome } | null>(null);
  const [hint, setHint] = useState<{ hint: string; source: "authored" | "ai" } | null>(null);
  const [canvasValue, setCanvasValue] = useState<unknown>(() => {
    const s = p.scratch as { canvas?: unknown } | undefined;
    return s && typeof s === "object" && "canvas" in s ? s.canvas : undefined;
  });
  const [preluding, setPreluding] = useState(Boolean(p.prelude));
  /** "How sure?" for canvas asks (choice asks have their own tap). */
  const [canvasSure, setCanvasSure] = useState<Confidence | undefined>();

  const ask = effectiveAsk(task.ask, useFallback);
  const onCanvas = isCanvasAsk(ask);
  const correct = last?.outcome.correct === true;
  // The hook is a guess: inputs never learn whether it landed, and nothing reveals the answer.
  const graded = layout !== "hook";
  // Locked while checking, once right, or once the server has moved past this ask.
  const locked = busy || (last !== null && (last.outcome.correct || !last.outcome.stay || p.oneShot === true));
  const solutionAfter = p.solutionAfter ?? 2;
  const lastAttempt: LastAttempt | undefined =
    last && graded
      ? {
          answer: last.answer,
          correct: last.outcome.correct,
          attempts: last.outcome.attempts,
          showSolution: last.outcome.correct || p.oneShot === true || last.outcome.attempts >= solutionAfter,
        }
      : undefined;
  const chosenForTiming = chosenOption(ask, last?.answer);
  // "Pick what happens next": the canvas acts out the chosen option first, then the words arrive.
  const performs = Boolean(
    last && graded && (chosenForTiming?.visualState || (last.outcome.correct && task.reveal?.visualState)),
  );
  const [wordsReady, setWordsReady] = useState(true);
  const lastSeq = last ? `${last.outcome.attempts}:${JSON.stringify(last.answer)}` : "";
  useEffect(() => {
    if (!lastSeq) return;
    if (!performs || reducedMotion) {
      setWordsReady(true);
      return;
    }
    setWordsReady(false);
    const t = setTimeout(() => setWordsReady(true), CONSEQUENCE_MS);
    return () => clearTimeout(t);
  }, [lastSeq, performs, reducedMotion]);

  // The previous canvas keeps performing for a beat, then this task's canvas morphs in.
  useEffect(() => {
    if (!p.prelude) return;
    const t = setTimeout(
      () => setPreluding(false),
      p.prelude.holdMs ?? (reducedMotion ? PRELUDE_MS_REDUCED : PRELUDE_MS),
    );
    return () => clearTimeout(t);
  }, [p.prelude, reducedMotion]);

  // Focus moves to the new "Do this" (and to the fallback input when it swaps in).
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the input swaps
  useEffect(() => {
    const root = doThisRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)");
    (target ?? root).focus({ preventScroll: false });
  }, [useFallback]);

  const draftOf = (key: string): unknown => {
    const s = p.scratch as Record<string, unknown> | undefined;
    return s && typeof s === "object" ? s[key] : undefined;
  };
  const saveDraft = (key: string, value: unknown) => {
    const prev = (p.scratch as Record<string, unknown> | undefined) ?? {};
    p.onScratch?.({ ...prev, [key]: value });
  };

  const doSubmit = useCallback(
    async (answer: AnswerValue, confidence?: Confidence) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      try {
        const outcome = await p.submit({
          answer,
          ...(confidence ? { confidence } : {}),
          ms: Math.round(now - startedAt.current),
        });
        if (!outcome) return;
        setLast({ answer, outcome });
        if (!p.silent) {
          if (outcome.correct) sounds.tok();
          else sounds.hm();
        }
        p.onResult?.(outcome);
        if (!outcome.correct) startedAt.current = typeof performance !== "undefined" ? performance.now() : 0;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't go through.");
      } finally {
        setBusy(false);
      }
    },
    [busy, p, sounds],
  );

  const submitCanvas = () => {
    if (locked) return;
    if (ask.kind === "widget") {
      if (canvasValue === undefined) return;
      void doSubmit({ kind: "widget", value: canvasValue }, canvasSure);
    } else if (ask.kind === "html") {
      if (canvasValue === undefined) return;
      void doSubmit({ kind: "html", value: canvasValue as HtmlReport }, canvasSure);
    }
  };

  const askHint = async () => {
    if (!p.onHint || hint) return;
    const h = await p.onHint().catch(() => null);
    if (h) setHint(h);
  };

  useKeys(
    (e) => {
      if (locked || !p.onHint || p.oneShot || hint) return false;
      if ((e.key === "h" || e.key === "H") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        void askHint();
        return true;
      }
      return false;
    },
    { enabled: p.keysActive && Boolean(p.onHint) && !p.oneShot },
  );

  useKeys(
    (e) => {
      if (!onCanvas || locked) return false;
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        submitCanvas();
        return true;
      }
      return false;
    },
    { enabled: p.keysActive && onCanvas },
  );

  // ── canvas
  const chosen = chosenOption(ask, last?.answer);
  const canvasState: VisualState | undefined = last
    ? last.outcome.correct
      ? (task.reveal?.visualState ?? chosen?.visualState)
      : chosen?.visualState
    : undefined;

  const canvasContent: CanvasContent | undefined = (() => {
    const a = task.ask;
    // With the simpler version swapped in, an open question hides the canvas: in explore mode a
    // widget can show the answer (token-splitter splits live). It comes back once answered.
    const hideOpenCanvas = useFallback && !last && (a.kind === "widget" || a.kind === "html");
    if (hideOpenCanvas)
      return task.visual
        ? { kind: "visual", key: `${task.key}:visual:${JSON.stringify(task.visual).length}`, visual: task.visual }
        : undefined;
    if (a.kind === "widget") {
      // A hook reveals the truth beside the guess whether it landed or not; elsewhere, after a second miss.
      const solution = lastAttempt?.showSolution && !lastAttempt.correct ? a.solution : undefined;
      return {
        kind: "widget",
        key: `${task.key}:widget`,
        widget: a.widget,
        mode: useFallback ? "explore" : solution !== undefined ? "review" : "answer",
        value: canvasValue,
        onChange: (v: unknown) => {
          setCanvasValue(v);
          saveDraft("canvas", v);
        },
        onCommit: (v: unknown) => {
          setCanvasValue(v);
          saveDraft("canvas", v);
          // A hook widget waits for "Lock in my guess"; elsewhere a commit checks at once.
          if (!locked && !useFallback && graded) void doSubmit({ kind: "widget", value: v }, canvasSure);
        },
        ...(solution !== undefined ? { solution } : {}),
      };
    }
    if (a.kind === "html") {
      return {
        kind: "html",
        key: `${task.key}:html`,
        asset: a.asset,
        height: a.height,
        alt: a.alt,
        mode: useFallback ? "explore" : "answer",
        onReport: (v: HtmlReport) => {
          setCanvasValue(v);
          saveDraft("canvas", v);
        },
      };
    }
    if (task.visual)
      return { kind: "visual", key: `${task.key}:visual:${JSON.stringify(task.visual).length}`, visual: task.visual };
    return undefined;
  })();

  const showPrelude = preluding && p.prelude;
  const shownCanvas = showPrelude ? p.prelude?.content : canvasContent;
  const shownState = showPrelude ? p.prelude?.visualState : canvasState;
  const hasCanvas = Boolean(shownCanvas) && layout !== "hook";
  const modal = layout === "modal";
  const hookCanvas = layout === "hook" && Boolean(canvasContent);

  // ── feedback copy
  const feedback = (() => {
    if (!last || p.silent || !graded || !wordsReady) return null;
    const o = last.outcome;
    if (p.oneShot) {
      const why = task.reveal?.text ?? o.feedback;
      return o.correct
        ? { tone: "right" as const, text: why ? `Right. ${why}` : "Right." }
        : { tone: "wrong" as const, text: why ? `Not this one. ${why}` : "Not this one.", second: false };
    }
    if (o.correct) {
      const why = ("feedbackRight" in ask ? ask.feedbackRight : undefined) ?? o.feedback;
      return { tone: "right" as const, text: why };
    }
    // After the worked answer the server moves on whatever was sent: read the payoff, then Continue.
    if (!o.stay && p.revealInline) return { tone: "right" as const, text: "Here's how it goes." };
    const text = o.feedback ?? authoredWrongFeedback(ask, last.answer);
    return { tone: "wrong" as const, text, second: o.attempts >= solutionAfter };
  })();

  const explainResult: ExplainResult | undefined =
    last && ask.kind === "explain" && p.aiConfigured
      ? {
          correct: last.outcome.correct,
          ...(last.outcome.matched ? { matched: last.outcome.matched } : {}),
          ...(last.outcome.feedback ? { feedback: last.outcome.feedback } : {}),
          source: last.outcome.aiGraded ? "ai" : "offline",
        }
      : undefined;

  const prompt = fillVars(ask.prompt, task.vars);
  const submitLabel = p.submitLabel ?? "Check";

  const doThis = (
    <section
      ref={doThisRef}
      tabIndex={-1}
      aria-labelledby={promptId}
      className={cn("flex flex-col outline-none", layout === "hook" ? "gap-6" : "gap-3")}
      data-do-this
      id="run-question"
    >
      {layout === "hook" ? (
        <h2
          id={promptId}
          className="t-title voice-casual max-w-[30ch] text-ink"
          style={{ fontVariationSettings: '"CASL" 0.7' }}
        >
          <Md text={prompt} packId={task.packId} />
        </h2>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-micro text-ink-3">{p.doThisLabel ?? "Do this"}</p>
          <h2 id={promptId} className="text-lead font-semibold text-ink">
            <Md text={prompt} packId={task.packId} />
          </h2>
        </div>
      )}

      {onCanvas ? (
        <div className="flex flex-wrap items-center gap-3" data-input={ask.kind}>
          <Button variant="primary" kbd="⏎" disabled={locked || canvasValue === undefined} onClick={submitCanvas}>
            {submitLabel}
          </Button>
          {canvasValue === undefined && !locked ? (
            <span className="text-small text-ink-3">
              {ask.kind === "html" ? "Try it on the canvas first." : "Move something on the canvas first."}
            </span>
          ) : null}
          {task.confidence && !last ? (
            <CanvasConfidence value={canvasSure} onChange={setCanvasSure} disabled={locked} />
          ) : null}
        </div>
      ) : (
        <BuiltInInput
          ask={ask}
          vars={task.vars}
          locked={locked}
          draft={draftOf(ask.kind)}
          onDraft={(d) => saveDraft(ask.kind, d)}
          onSubmit={(a, c) => void doSubmit(a, c)}
          last={lastAttempt}
          keysActive={p.keysActive && !locked}
          confidence={task.confidence}
          idk={p.idk}
          submitLabel={submitLabel}
          seed={task.key}
          promptId={promptId}
          aiConfigured={p.aiConfigured}
          explainResult={explainResult}
          packId={task.packId}
          onStuckFallback={ask.kind === "explain" ? () => setUseFallback(true) : undefined}
        />
      )}

      {p.idk && ask.kind !== "choice" && !last ? (
        <button
          type="button"
          className="self-start text-small text-ink-2 underline underline-offset-2 disabled:opacity-50"
          disabled={locked}
          onClick={() => void doSubmit({ kind: "idk" })}
          data-idk
        >
          {p.idk}
        </button>
      ) : null}
      {task.ask.kind === "explain" && useFallback ? (
        <button
          type="button"
          className="self-start text-small text-ink-2 underline underline-offset-2"
          onClick={() => setUseFallback(false)}
        >
          Back to typing
        </button>
      ) : null}
      {isCanvasAsk(task.ask) && task.ask.fallback ? (
        <button
          type="button"
          className="self-start text-small text-ink-2 underline underline-offset-2"
          aria-pressed={useFallback}
          onClick={() => {
            setUseFallback((f) => !f);
            setLast(null);
          }}
        >
          {useFallback ? "Use the canvas instead" : "Use a simpler version"}
        </button>
      ) : null}

      {p.extra}

      {busy ? (
        <p className="text-small text-ink-3" role="status">
          Checking…
        </p>
      ) : null}
      {error ? (
        <p className="text-small text-ember-text" role="alert">
          {error}{" "}
          <button type="button" className="underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      ) : null}

      <div aria-live="polite" className="flex flex-col gap-2">
        {p.renderFeedback && feedback
          ? p.renderFeedback({
              tone: feedback.tone,
              ...(feedback.text ? { text: feedback.text } : {}),
              second: feedback.tone === "wrong" && feedback.second,
              ...(feedback.tone === "wrong" && feedback.second ? { worked: workedAnswerLine(ask, task.vars) } : {}),
              ...((correct || (last !== null && !last.outcome.stay)) && task.reveal && !p.oneShot && wordsReady
                ? { reveal: task.reveal.text }
                : {}),
              ...(chosen?.visualState?.note ? { canvasNote: true } : {}),
            })
          : null}
        {!p.renderFeedback && feedback?.tone === "right" ? (
          <p className="text-body text-ink" data-feedback="right">
            {feedback.text ? <Md text={feedback.text} packId={task.packId} /> : "That's it."}
          </p>
        ) : null}
        {!p.renderFeedback && feedback?.tone === "wrong" ? (
          <div className="flex flex-col gap-1" data-feedback={feedback.second ? "second-miss" : "wrong"}>
            {chosen?.visualState?.note ? (
              <p className="text-body text-ink-2">The canvas shows what that answer would mean.</p>
            ) : null}
            <p className="text-body text-ink-2">
              {feedback.text ? (
                <Md text={feedback.text} packId={task.packId} />
              ) : feedback.second ? (
                workedAnswerLine(ask, task.vars)
              ) : (
                "Not quite. One more go."
              )}
            </p>
            {feedback.second && feedback.text && !p.oneShot ? (
              <p className="text-body text-ink" data-worked>
                {workedAnswerLine(ask, task.vars)}
              </p>
            ) : null}
          </div>
        ) : null}
        {!p.renderFeedback &&
        (correct || (last !== null && !last.outcome.stay)) &&
        p.revealInline &&
        task.reveal &&
        !p.oneShot &&
        wordsReady ? (
          <p className="voice-casual text-lead text-ink" data-reveal>
            <Md text={task.reveal.text} packId={task.packId} />
          </p>
        ) : null}
      </div>

      {hint ? (
        hint.source === "ai" ? (
          <IrisMark as="p" className="text-body text-ink">
            <Md text={hint.hint} packId={task.packId} />
          </IrisMark>
        ) : (
          <p className="flex gap-2 text-body text-ink-2">
            <Lightbulb size={16} className="mt-1 shrink-0" aria-hidden />
            <Md text={hint.hint} packId={task.packId} />
          </p>
        )
      ) : null}

      {last && !last.outcome.correct && graded && !p.oneShot && !locked && wordsReady ? (
        <div className="flex flex-wrap gap-2">
          {p.onHint && !hint ? (
            <Button size="sm" variant="ghost" icon={<Lightbulb size={16} />} kbd="H" onClick={() => void askHint()}>
              Hint
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );

  const canvas = (
    <Canvas
      packId={task.packId}
      nodeId={task.nodeId}
      theme={theme}
      content={shownCanvas}
      visualState={shownState}
      reducedMotion={reducedMotion}
      onFail={isCanvasAsk(task.ask) && task.ask.fallback ? () => setUseFallback(true) : undefined}
      className={
        layout === "hook"
          ? "min-h-[280px] lg:min-h-[320px]"
          : modal
            ? "@container min-h-[280px] lg:min-h-[340px]"
            : "min-h-[440px] min-[1100px]:min-h-[560px]"
      }
    />
  );

  if (layout === "hook") {
    return (
      <div
        className={cn("mx-auto flex w-full max-w-[700px] flex-col gap-6", p.className)}
        data-task={task.key}
        data-layout="hook"
      >
        {p.coachTop}
        {hookCanvas ? canvas : null}
        {doThis}
        {p.coachBottom}
      </div>
    );
  }

  if (modal) {
    return (
      <div
        className={cn("mx-auto flex w-full max-w-[700px] flex-col gap-5", p.className)}
        data-task={task.key}
        data-layout="modal"
      >
        {hasCanvas ? canvas : null}
        {p.coachTop}
        {doThis}
        {p.coachBottom}
      </div>
    );
  }

  if (layout === "stack" || !hasCanvas) {
    return (
      <div
        className={cn("mx-auto flex w-full max-w-[760px] flex-col gap-6", p.className)}
        data-task={task.key}
        data-layout="stack"
      >
        {hasCanvas ? canvas : null}
        <div className="flex flex-col gap-5">
          {p.coachTop}
          {doThis}
          {p.coachBottom}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("grid w-full grid-cols-1 gap-6 min-[1100px]:grid-cols-12", p.className)}
      data-task={task.key}
      data-layout="split"
    >
      <div className="min-[1100px]:col-span-8">{canvas}</div>
      <aside aria-label="Coach" className="flex flex-col gap-5 min-[1100px]:col-span-4">
        {p.coachTop}
        {doThis}
        <div className="mt-auto">{p.coachBottom}</div>
      </aside>
    </div>
  );
}

const SURE: { value: Confidence; label: string }[] = [
  { value: 3, label: "Sure" },
  { value: 2, label: "Think so" },
  { value: 1, label: "Guessing" },
];

/** Optional "how sure?" beside a canvas answer; sent with the attempt (a confident miss is a Plot twist). */
function CanvasConfidence({
  value,
  onChange,
  disabled,
}: {
  value: Confidence | undefined;
  onChange: (v: Confidence | undefined) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-wrap items-center gap-2" aria-labelledby={id} disabled={disabled} data-confidence>
      <span id={id} className="text-small text-ink-2">
        How sure?
      </span>
      {SURE.map((c) => (
        <button
          key={c.value}
          type="button"
          aria-pressed={value === c.value}
          onClick={() => onChange(value === c.value ? undefined : c.value)}
          className={cn(
            "rounded-pill border px-3 py-1 text-small",
            value === c.value ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:border-ink",
          )}
        >
          {c.label}
        </button>
      ))}
    </fieldset>
  );
}
