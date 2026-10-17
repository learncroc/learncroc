/**
 * The checkpoint modal: the card's 960 px shell, a small boss feel with no punishment.
 *
 *   rule card → one shot per question → pass ("Open the gate") or not yet (revisit rows + fresh questions)
 *
 * The server decides everything: the questions (`run.current`), the size (`run.size`), the hint level
 * (`run.hints`, shared with Moss through the run query), right/wrong (`creditedScore`) and the outcome
 * (`summary.checkpoint`). Esc closes without asking; the run is kept and resumes at the same question.
 */
import {
  type CompiledPack,
  defaultCheckpointSize,
  earlierCards,
  type Item,
  type NodeId,
  type RunState,
  type RunSummary,
  type StartRunBody,
} from "@learncroc/core";
import { Button, Croc, cn, GateCharge, Kbd, Modal, type PipState, Pips, StopGlyph, toast } from "@learncroc/ui";
import { ArrowCounterClockwise, ArrowRight, ArrowUUpLeft, Lightbulb, MapTrifold } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { crocReactions } from "../../croc/reactions";
import { useIsTopLayer, useLayer } from "../../lib/layers";
import { CrocPane, type CrocPaneProps } from "../../slots";
import { MossLine } from "../card/moss";
import { itemOf, itemTask, sectionName, titleOf } from "../content";
import type { CheckpointModalProps } from "../index";
import { digitIndex, useKeys } from "../keys";
import { Md } from "../Markdown";
import { useReducedMotion } from "../prefs";
import { useAiConfigured, useInvalidateProgress, usePackQuery, useProgressQuery } from "../queries";
import { rememberCheckpoint } from "../revisit";
import { BackToMap, useCloseModal, useWide } from "../shell";
import { useRunSounds } from "../sound";
import { type SubmitOutcome, TaskView } from "../TaskView";
import { errorText, type RunSession, useRunSession } from "../useRunSession";

/** What the shell shows around the current screen. */
interface ShellState {
  title: string;
  croc?: { context: CrocPaneProps["context"]; nodeId?: NodeId; runId?: string };
  /** Run open and unfinished: Esc says where it picks up. */
  resumeAt?: number;
}

export function CheckpointModal(p: CheckpointModalProps) {
  const pack = usePackQuery(p.packId).data;
  const views = useProgressQuery(p.packId).data?.views;
  const view = views?.[p.checkpointId];
  const wide = useWide();
  const [phase, setPhase] = useState<"intro" | "run">("intro");
  const [attempt, setAttempt] = useState(0);
  const [shell, setShell] = useState<ShellState>({ title: "Checkpoint" });
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const autoStarted = useRef(false);

  // An attempt already under way resumes at its question (C9): no rule card in between.
  useEffect(() => {
    if (!autoStarted.current && view?.state === "in-progress") {
      autoStarted.current = true;
      setPhase("run");
    }
  }, [view?.state]);

  const close = useCallback(() => {
    const at = shellRef.current.resumeAt;
    if (at !== undefined) toast({ message: `Saved. The checkpoint picks up at question ${at}.`, duration: 4000 });
    p.onClose();
  }, [p.onClose]);
  const layerId = useLayer("modal", { onClose: close });
  const top = useIsTopLayer(layerId);

  const entry = pack?.map.nodes[p.checkpointId];
  const section = pack ? sectionName(pack, p.checkpointId) : "";
  const croc = shell.croc;

  const crocPane = (collapsed: boolean) =>
    croc ? (
      <CrocPane
        packId={p.packId}
        {...(croc.nodeId ? { nodeId: croc.nodeId } : {})}
        {...(croc.runId ? { runId: croc.runId } : {})}
        context={croc.context}
        {...(collapsed ? { collapsed: true } : {})}
      />
    ) : null;

  return (
    <Modal open onClose={close} title={entry?.title ?? "Checkpoint"} hideTitle size="card" initialFocus={-1}>
      <div className="flex h-full min-h-0" data-modal="checkpoint" data-layer-id={layerId}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface-2 px-6 py-3 lg:px-8">
            <div className="min-w-0 flex-1">
              <p className="t-micro truncate text-ink-3 uppercase tracking-wide">
                Checkpoint{section && section !== "Checkpoint" ? ` · ${section}` : ""}
              </p>
              <p className="t-heading truncate text-ink" aria-hidden>
                {shell.title}
              </p>
            </div>
            <BackToMap />
          </header>
          {!pack ? (
            <div className="grid flex-1 place-items-center text-small text-ink-3" role="status">
              Opening the checkpoint…
            </div>
          ) : phase === "intro" ? (
            <Intro
              pack={pack}
              checkpointId={p.checkpointId}
              state={view?.state}
              missing={view?.missing ?? []}
              retry={(view?.tries ?? 0) > 0 || attempt > 0}
              keysActive={top}
              onStart={() => setPhase("run")}
              onShell={setShell}
            />
          ) : (
            <CheckpointRun
              key={attempt}
              {...p}
              pack={pack}
              keysActive={top}
              onShell={setShell}
              onRetry={() => setAttempt((a) => a + 1)}
            />
          )}
          {wide ? null : crocPane(true)}
        </div>
        {wide ? crocPane(false) : null}
      </div>
    </Modal>
  );
}

// ── the rule card

function Intro(p: {
  pack: CompiledPack;
  checkpointId: NodeId;
  state?: string;
  missing: NodeId[];
  retry: boolean;
  keysActive: boolean;
  onStart(): void;
  onShell(s: ShellState): void;
}) {
  const { pack } = p;
  const closeModal = useCloseModal();
  const entry = pack.map.nodes[p.checkpointId];
  const covers = entry?.covers ?? [];
  const size = entry?.size ?? defaultCheckpointSize(covers.length);
  const need = size - 1;
  const hasEarlier = earlierCards(pack.map, p.checkpointId).length > 0;
  const practice = p.state === "lit";
  const locked = p.state === "locked";
  const minutes = Math.max(2, Math.round(entry?.estMinutes ?? size * 0.7));
  const startRef = useRef<HTMLButtonElement>(null);
  const onShell = p.onShell;

  useEffect(() => {
    onShell({ title: practice ? "Practice" : "Checkpoint" });
  }, [onShell, practice]);
  useEffect(() => {
    startRef.current?.focus({ preventScroll: true });
  }, []);

  useKeys(
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || locked) return false;
      p.onStart();
      return true;
    },
    { enabled: p.keysActive && !locked },
  );

  const names = covers.map((id) => titleOf(pack, id));
  const cardList =
    names.length <= 1 ? (names[0] ?? "this section") : names.length > 3 ? "these cards" : listJoin(names);

  if (locked) {
    const missing = p.missing.map((id) => titleOf(pack, id));
    return (
      <div className="flex flex-1 flex-col items-start gap-5 overflow-y-auto px-6 py-8 lg:px-8" data-checkpoint-locked>
        <StopGlyph state="locked" kind="checkpoint" size={72} decorative />
        <p className="text-lead text-ink">
          {missing.length ? `Close ${listJoin(missing)} first.` : "Close this section's cards first."}
        </p>
        <Button variant="primary" onClick={closeModal} icon={<MapTrifold size={16} />}>
          Back to map
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-checkpoint-intro>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7 lg:px-8">
        <div className="mx-auto flex max-w-[640px] flex-col gap-6">
          <div className="flex items-center gap-5">
            <span className="grid size-24 place-items-center rounded-pill bg-sea-soft/60">
              <StopGlyph state="ready" kind="checkpoint" size={64} breathe decorative />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="t-title text-ink">{entry?.title ?? "Checkpoint"}</h2>
              <p className="text-body text-ink-2">
                {practice ? "Practice · nothing changes on your map" : `About ${minutes} minutes`}
              </p>
            </div>
          </div>
          {covers.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="It asks about">
              {covers.map((id) => (
                <li
                  key={id}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1 text-small text-ink"
                >
                  <StopGlyph state={practice ? "lit" : "done"} size={14} decorative />
                  {titleOf(pack, id)}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-lead text-ink" data-rule-head>
            {p.retry
              ? `Fresh questions this time. Same rule: ${need} of ${size}.`
              : `${size} questions on ${cardList}${hasEarlier ? ", plus one from earlier" : ""}.`}
          </p>
          <ul className="flex flex-col gap-2 text-body text-ink-2" data-rules>
            <li className="flex gap-3">
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              They're new situations, not lines from the cards.
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              {practice
                ? `Get ${need} of ${size} right. It's practice: nothing changes on your map.`
                : `Get ${need} of ${size} right to open the next part of the map.`}
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              One answer per question. I'll give hints, not answers. A first hint is free; a second hint means that
              question won't count.
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              Missing is fine. You'll see what to look at, and the next try uses fresh questions.
            </li>
          </ul>
          <MossLine
            text="Hints, not answers: that's the deal here. They're new situations, not quotes, so you'll be using what you learned. You know more than you think."
            mood="curious"
            packId={pack.manifest.id}
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-line px-6 py-3 lg:px-8">
        <Button variant="ghost" onClick={closeModal}>
          Not now
        </Button>
        <Button ref={startRef} variant="primary" onClick={p.onStart} kbd="⏎" icon={<ArrowRight size={16} />}>
          {practice ? "Start practice" : "Start"}
        </Button>
      </div>
    </div>
  );
}

const countRight = (pips: PipState[]) => pips.filter((x) => x === "right" || x === "hinted").length;

function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

// ── the questions

type RunProps = CheckpointModalProps & {
  pack: CompiledPack;
  keysActive: boolean;
  onShell(s: ShellState): void;
  onRetry(): void;
};

function CheckpointRun(p: RunProps) {
  const { pack } = p;
  const packId = pack.manifest.id;
  const body = useMemo<StartRunBody>(
    () => ({ kind: "checkpoint", packId, target: p.checkpointId }),
    [packId, p.checkpointId],
  );
  const session = useRunSession(body);
  const run = session.run;
  const closeModal = useCloseModal();

  if (session.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3 p-8" role="alert">
        <p className="text-body text-ink-2">The checkpoint didn't open. {session.error ?? ""}</p>
        <div className="flex gap-3">
          <Button variant="primary" onClick={session.retry}>
            Try again
          </Button>
          <Button onClick={closeModal}>Back to map</Button>
        </div>
      </div>
    );
  }
  if (!run) {
    return (
      <div className="grid flex-1 place-items-center text-small text-ink-3" role="status">
        Picking your questions…
      </div>
    );
  }
  return <Questions {...p} run={run} session={session} />;
}

/** Pip results per run, kept for this tab so a resumed attempt shows its earlier answers. */
function loadPips(runId: string, size: number, asked: number): PipState[] {
  let saved: PipState[] = [];
  try {
    saved = JSON.parse(sessionStorage.getItem(`lm.pips.${runId}`) ?? "[]") as PipState[];
  } catch {
    saved = [];
  }
  return Array.from({ length: size }, (_, i) => saved[i] ?? (i < asked ? "right" : "pending"));
}
function savePips(runId: string, pips: PipState[]): void {
  try {
    sessionStorage.setItem(`lm.pips.${runId}`, JSON.stringify(pips));
  } catch {
    /* storage off */
  }
}

interface Shown {
  item: Item;
  nodeId: NodeId;
  key: string;
  index: number;
  vars?: Record<string, number>;
}

function Questions(p: RunProps & { run: RunState; session: RunSession }) {
  const { pack, run, session } = p;
  const packId = pack.manifest.id;
  const reducedMotion = useReducedMotion();
  const aiConfigured = useAiConfigured();
  const sounds = useRunSounds();
  const invalidate = useInvalidateProgress();
  const size = run.size ?? 4;
  const need = size - 1;
  const asked = run.cursor.item ?? 0;
  const [pips, setPips] = useState<PipState[]>(() => loadPips(run.id, size, asked));
  const [held, setHeld] = useState<Shown | null>(null);
  /** Right, but after the second hint: it doesn't count toward the gate. */
  const [uncounted, setUncounted] = useState(false);
  const [summary, setSummary] = useState<RunSummary>();
  const [error, setError] = useState<string>();
  const [finishTry, setFinishTry] = useState(0);
  const finishing = useRef(false);
  const allAnswered = run.cursor.phase === "done" || asked >= size;
  const covers = useMemo(() => new Set(pack.map.nodes[p.checkpointId]?.covers ?? []), [pack, p.checkpointId]);
  const onShell = p.onShell;

  useEffect(() => sounds.resetRun(), [sounds]);
  useEffect(() => savePips(run.id, pips), [run.id, pips]);

  // Every question answered (and the last one read): finish for the result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: finish once (or on "Try again")
  useEffect(() => {
    if (!allAnswered || held || summary || finishing.current) return;
    finishing.current = true;
    session
      .finish()
      .then((s) => {
        setSummary(s);
        invalidate(packId);
        if (s.checkpoint) rememberCheckpoint(packId, s.checkpoint);
        p.onSummary(s);
        if (s.checkpoint?.passed ?? s.passed) {
          if (!s.checkpoint?.practice) sounds.gate();
        } else
          crocReactions.emit({
            type: "checkpoint-not-yet",
            packId,
            checkpointId: p.checkpointId,
            close: s.checkpoint ? s.checkpoint.right >= s.checkpoint.needed - 1 : false,
          });
      })
      .catch((e: unknown) => {
        finishing.current = false;
        setError(errorText(e));
      });
  }, [allAnswered, held, summary, finishTry]);

  const current: Shown | null =
    held ??
    (() => {
      const ref = run.current?.ref;
      if (!ref || allAnswered) return null;
      const item = itemOf(pack, ref);
      return item
        ? {
            item,
            nodeId: ref.nodeId,
            key: `${run.id}:${ref.itemId}:${asked}`,
            index: asked,
            ...(run.current?.vars ? { vars: run.current.vars } : {}),
          }
        : null;
    })();

  const missed = pips.filter((x) => x === "missed").length;
  const decided = missed > size - need;
  const shownIndex = current?.index ?? Math.min(asked, size - 1);

  // The shell: header title, Moss's context, where Esc picks up.
  const currentNode = current?.nodeId;
  useEffect(() => {
    if (summary) {
      const passed = summary.checkpoint?.passed ?? summary.passed;
      onShell({
        title: passed ? (summary.checkpoint?.practice ? "Practice" : "Section open") : "Not yet",
        // A pass has nothing missed to talk about: Moss talks about the cards that just lit.
        croc:
          passed && !summary.checkpoint?.revisit[0]
            ? {
                context: "card",
                ...(summary.litNow.find((id) => id !== summary.checkpoint?.checkpointId)
                  ? { nodeId: summary.litNow.find((id) => id !== summary.checkpoint?.checkpointId) }
                  : {}),
              }
            : {
                context: "checkpoint-result",
                runId: run.id,
                ...(summary.checkpoint?.revisit[0] ? { nodeId: summary.checkpoint.revisit[0].nodeId } : {}),
              },
      });
      return;
    }
    onShell({
      title: `Question ${shownIndex + 1} of ${size}`,
      croc: { context: "checkpoint", runId: run.id, ...(currentNode ? { nodeId: currentNode } : {}) },
      resumeAt: Math.min(asked + 1, size),
    });
  }, [onShell, summary, shownIndex, size, run.id, currentNode, asked]);

  useKeys(
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || !held) return false;
      setHeld(null);
      return true;
    },
    { enabled: p.keysActive && held !== null },
  );

  if (summary) {
    // A resumed attempt may not know its earlier answers: trust the server's count.
    const r = summary.checkpoint?.right;
    const shown =
      r !== undefined && countRight(pips) !== r
        ? Array.from({ length: size }, (_, i): PipState => (i < r ? "right" : "missed"))
        : pips;
    return <Result {...p} summary={summary} pips={shown} />;
  }

  const fromEarlier = current ? !covers.has(current.nodeId) : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-checkpoint-run={run.id}>
      <div className="flex shrink-0 items-center gap-4 border-b border-line/60 px-6 py-2.5 lg:px-8">
        <GateCharge total={size} lit={countRight(pips)} size={40} decorative />
        <div className="flex flex-col gap-1">
          <Pips
            results={pips}
            current={held ? undefined : shownIndex}
            label={`Question ${shownIndex + 1} of ${size}`}
          />
          <motion.p
            key={decided ? "practice" : run.practice ? "open" : "pass"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22 }}
            className="text-micro text-ink-3"
            data-pass-line
          >
            {run.practice
              ? "Practice · nothing changes on your map"
              : decided
                ? "This round is practice now. Fresh questions next time."
                : `Pass with ${need} of ${size}`}
          </motion.p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-8 lg:px-8">
        {current ? (
          <motion.div
            key={current.key}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0.12 : 0.36 }}
            className="mx-auto flex w-full max-w-[700px] flex-col gap-4"
          >
            <p
              className={cn(
                "self-start rounded-pill py-0.5 t-micro uppercase tracking-wide",
                fromEarlier ? "bg-iris-soft px-2.5 text-ink-2" : "text-ink-3",
              )}
              data-from={current.nodeId}
            >
              {fromEarlier ? "From earlier: " : "From: "}
              {titleOf(pack, current.nodeId)}
            </p>
            <TaskView
              key={current.key}
              task={itemTask(packId, current.nodeId, current.item, "checkpoint", current.vars, `:${current.key}`)}
              pack={pack}
              layout="modal"
              oneShot
              submitLabel="Submit"
              renderFeedback={(f) => (
                <MossLine
                  text={f.text ?? (f.tone === "right" ? "Right." : "Not this one.")}
                  mood={f.tone === "right" ? "happy" : "curious"}
                  packId={packId}
                  reducedMotion={reducedMotion}
                />
              )}
              submit={async (s): Promise<SubmitOutcome> => {
                const res = await session.attempt({
                  nodeId: current.nodeId,
                  interactionId: current.item.id,
                  phase: "checkpoint",
                  answer: s.answer,
                  ...(s.confidence ? { confidence: s.confidence } : {}),
                  ms: s.ms,
                });
                const right = res.creditedScore >= 1;
                const hinted = (run.hints[current.item.id] ?? 0) >= 1;
                setPips((r) =>
                  r.map((x, i) => (i === current.index ? (right ? (hinted ? "hinted" : "right") : "missed") : x)),
                );
                setUncounted(res.correct && !right);
                setHeld(current);
                return {
                  correct: res.correct,
                  score: res.score,
                  attempts: res.attemptsOnInteraction,
                  stay: false,
                };
              }}
              aiConfigured={aiConfigured}
              reducedMotion={reducedMotion}
              keysActive={p.keysActive && !held}
            />
            {held && uncounted ? (
              <p className="text-small text-ink-2" data-uncounted>
                It took the second hint, so this one doesn't count toward the gate.
              </p>
            ) : null}
            {held ? (
              <div className="flex justify-end border-t border-line pt-4">
                <Button
                  variant="primary"
                  onClick={() => setHeld(null)}
                  icon={<ArrowRight size={16} />}
                  kbd="⏎"
                  autoFocus
                  className="lm-pop-in"
                  data-next-question
                >
                  {allAnswered ? "See how it went" : "Next question"}
                </Button>
              </div>
            ) : (
              <HintControl
                key={`${current.key}:hint`}
                run={run}
                itemId={current.item.id}
                session={session}
                packId={packId}
                keysActive={p.keysActive}
              />
            )}
          </motion.div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3" role="alert">
            <p className="text-body text-ink-2">Couldn't check your answers just now. {error}</p>
            <Button
              variant="primary"
              onClick={() => {
                setError(undefined);
                setFinishTry((n) => n + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <p className="text-small text-ink-3" role="status">
            Checking your answers…
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * H: hint level 1 (free), then level 2 behind the C24 warning, then nothing (no worked solution in a
 * checkpoint). The level is `run.hints[item]`, shared with Moss: a hint taken in the croc pane counts.
 */
function HintControl(p: { run: RunState; itemId: string; session: RunSession; packId: string; keysActive: boolean }) {
  const level = p.run.hints[p.itemId] ?? 0;
  const [texts, setTexts] = useState<Partial<Record<1 | 2, string>>>({});
  const [warn, setWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const take = async () => {
    if (busy || level >= 2) return;
    if (level === 1 && !warn) {
      setWarn(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const h = await p.session.hint(p.itemId);
      setTexts((t) => ({ ...t, [Math.min(2, h.level) as 1 | 2]: h.hint }));
      setWarn(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  useKeys(
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.key === "h" || e.key === "H") {
        void take();
        return true;
      }
      if (e.key === "Escape" && warn) {
        setWarn(false);
        return true;
      }
      return false;
    },
    { enabled: p.keysActive && level < 2 },
  );

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4" data-hint-level={level}>
      {([1, 2] as const).map((l) =>
        level >= l ? (
          <p key={l} className="flex gap-2 text-body text-ink-2" data-hint={l}>
            <Lightbulb size={16} className="mt-1 shrink-0" aria-hidden />
            {texts[l] ? (
              <Md text={texts[l] ?? ""} packId={p.packId} />
            ) : (
              <span className="text-ink-3">Hint {l} taken (Moss has it).</span>
            )}
          </p>
        ) : null,
      )}
      {warn ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 px-4 py-3"
          role="alert"
          data-hint-warning
        >
          <p className="text-body text-ink">
            This one won't count if you take it. The retry will have fresh questions.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void take()} kbd="H" disabled={busy}>
              Take the second hint
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWarn(false)}>
              Never mind
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            icon={<Lightbulb size={16} />}
            kbd="H"
            disabled={level >= 2 || busy}
            onClick={() => void take()}
          >
            {level === 0 ? "Give me a hint" : level === 1 ? "Another hint" : "No more hints here"}
          </Button>
          <span className="text-small text-ink-3">
            {level === 0
              ? "A first hint is free."
              : level === 1
                ? "This one won't count if you take another."
                : "Checkpoints never show the worked answer."}
          </span>
        </div>
      )}
      {error ? (
        <p className="text-small text-ink-2" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── results

function Result(p: RunProps & { summary: RunSummary; pips: PipState[] }) {
  const { summary, pack } = p;
  const closeModal = useCloseModal();
  const reducedMotion = useReducedMotion();
  const outcome = summary.checkpoint;
  const passed = outcome?.passed ?? summary.passed;
  const practice = outcome?.practice ?? false;
  const right = outcome?.right ?? countRight(p.pips);
  const size = outcome?.size ?? p.pips.length;
  const need = outcome?.needed ?? Math.max(0, size - 1);
  const [sweep, setSweep] = useState(false);
  const revisit = outcome?.revisit ?? [];
  const lit = summary.litNow.filter((id) => id !== p.checkpointId && pack.map.nodes[id]?.kind === "node");
  const next = summary.next;
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!passed || practice) return;
    const t = setTimeout(() => setSweep(true), reducedMotion ? 0 : 300);
    return () => clearTimeout(t);
  }, [passed, practice, reducedMotion]);
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, []);

  const retry = p.onRetry;
  useKeys(
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (passed) {
        if (e.key !== "Enter") return false;
        if (practice) closeModal();
        else p.onOpenGate(summary);
        return true;
      }
      if (e.key === "t" || e.key === "T") {
        retry();
        return true;
      }
      const d = digitIndex(e);
      const row = d !== undefined ? revisit[d] : undefined;
      if (row) {
        p.onNavigate({ nodeId: row.nodeId, kind: "node", from: p.checkpointId });
        return true;
      }
      return false;
    },
    { enabled: p.keysActive },
  );

  if (passed) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-result="pass">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7 lg:px-8">
          <div className="mx-auto flex max-w-[640px] flex-col gap-6">
            <div className="flex items-center gap-5">
              <GateCharge total={size} lit={right} open={!practice && sweep} size={72} decorative />
              <div className="flex flex-col gap-2">
                <Pips results={p.pips} sweep={!practice && sweep} label={`${right} of ${size} right`} />
                <h2 className="t-title text-ink" data-pass-head>
                  {practice
                    ? `${right} of ${size}. Good practice; nothing changes on the map.`
                    : outcome?.perfect
                      ? `${size} of ${size}. Clean.`
                      : `${right} of ${size}. The next part of the map is open.`}
                </h2>
              </div>
              <Croc state="cheering" size={72} lumen={!practice} decorative className="ml-auto hidden sm:block" />
            </div>
            <MossLine
              text={
                practice
                  ? "Good practice. Spacing it out like this is exactly what keeps it."
                  : "That's the section. The lantern's yours: these cards are Lit, and I'll bring them back before they fade."
              }
              mood="happy"
              lumen={!practice}
              packId={pack.manifest.id}
              reducedMotion={reducedMotion}
            />
            {!practice && lit.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="t-micro text-ink-3 uppercase tracking-wide">Lit now</p>
                <ul className="flex flex-wrap gap-2">
                  {lit.map((id, i) => (
                    <motion.li
                      key={id}
                      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: reducedMotion ? 0 : 0.5 + i * 0.12, duration: 0.3 }}
                      className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1 text-small text-ink"
                    >
                      <StopGlyph state="lit" size={16} decorative />
                      {titleOf(pack, id)}
                    </motion.li>
                  ))}
                </ul>
                <p className="text-small text-ink-2">They'll come back for a quick Relight before you'd forget them.</p>
              </div>
            ) : null}
            {!practice && next ? (
              <p className="text-body text-ink-2">
                Next: <span className="font-semibold text-ink">{titleOf(pack, next.nodeId)}</span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-line px-6 py-3 lg:px-8">
          {practice ? (
            <Button ref={primaryRef} variant="primary" onClick={closeModal} icon={<MapTrifold size={16} />} kbd="⏎">
              Back to map
            </Button>
          ) : (
            <Button ref={primaryRef} variant="primary" onClick={() => p.onOpenGate(summary)} kbd="⏎" data-open-gate>
              Open the gate
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-result="miss">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7 lg:px-8">
        <div className="mx-auto flex max-w-[640px] flex-col gap-6">
          <div className="flex items-center gap-5">
            <GateCharge total={size} lit={right} size={56} decorative />
            <div className="flex flex-col gap-2">
              <Pips results={p.pips} label={`${right} of ${size} right`} />
              <h2 className="t-heading text-ink" data-miss-head>
                {right} of {size} this time. The gate needs {need}.
              </h2>
            </div>
          </div>
          <MossLine
            text="Not yet, and that's fine. Have a look at the card below, then fresh questions. Nothing is lost."
            mood="curious"
            packId={pack.manifest.id}
            reducedMotion={reducedMotion}
          />
          {revisit.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="t-micro text-ink-3 uppercase tracking-wide">Have a look at</p>
              <ul className="flex flex-col gap-2">
                {revisit.map((r, i) => (
                  <li key={r.nodeId}>
                    <button
                      type="button"
                      onClick={() => p.onNavigate({ nodeId: r.nodeId, kind: "node", from: p.checkpointId })}
                      className="flex w-full items-center gap-3 rounded-key border-[1.5px] border-line-strong bg-surface px-4 py-3 text-left shadow-key-rest transition-colors hover:border-sea hover:bg-surface-2"
                      data-revisit-row={r.nodeId}
                    >
                      <ArrowUUpLeft size={18} aria-hidden className="shrink-0 text-ink-2" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-body text-ink">
                          Revisit {r.title} · about {Math.max(1, Math.round(r.estMinutes))} min
                        </span>
                        {r.prompt ? (
                          <span className="truncate text-small text-ink-3">You missed: {r.prompt}</span>
                        ) : null}
                      </span>
                      {i < 9 ? <Kbd keys={String(i + 1)} /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-small text-ink-2">
            Your cards stay Done. Nothing is locked; the next try uses fresh questions.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-line px-6 py-3 lg:px-8">
        <Button variant="ghost" onClick={closeModal} icon={<MapTrifold size={16} />}>
          Back to map
        </Button>
        <Button
          ref={primaryRef}
          variant="primary"
          onClick={retry}
          icon={<ArrowCounterClockwise size={16} />}
          kbd="T"
          data-retry
        >
          Try again with fresh questions
        </Button>
      </div>
    </div>
  );
}
