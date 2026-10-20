/**
 * Moss inside the card, checkpoint and Relight players (slot): a 240 px column on wide screens,
 * or a 56 px footer bar that expands upward (`collapsed`). Never a second dialog: it lives inside the
 * modal's one focus trap.
 *
 * Top: Moss and the current reaction line. Middle: the conversation for this card. Bottom: chips for
 * the moment and the input. During a checkpoint (and a Relight question) Moss gives hints
 * only, says so in a fixed line, and every hint is recorded on the run (the hint button and Moss share
 * the cap of 2): offline through the run's hint route, with AI by the server's ask route. The pane then
 * refreshes the run so the player's hint pips update.
 *
 * Keys: ⌘J focuses the input; in a card's beats E / X / D ask "Explain it differently", "Another
 * example", "Go deeper".
 */
import type { RunState } from "@learncroc/core";
import { CROC_NAME } from "@learncroc/core";
import { Croc, CrocBubble, cn, Kbd } from "@learncroc/ui";
import { CaretUp } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { isTypingTarget } from "../lib/keys";
import { isTopLayer } from "../lib/layers";
import { runQueryKey, usePackQuery } from "../run/queries";
import type { CrocPaneProps } from "../slots";
import { CrocChat, type CrocChip, defaultOffline, type OfflineAnswer } from "./CrocChat";
import { CROC_COPY, contextLine, placeholderFor } from "./copy";
import { type CrocScope, useCroc } from "./store";
import { useCrocReactions } from "./useCrocReactions";

const CARD_KEYS: Record<string, string> = {
  e: "Explain it differently",
  x: "Another example",
  d: "Go deeper",
};

/** The chips for each moment. */
export function chipsFor(
  context: CrocPaneProps["context"],
  opts: { cardTitle?: string; hintLevel?: number } = {},
): CrocChip[] {
  switch (context) {
    case "hook":
      return [{ label: "Give me a nudge", intent: "hint" }];
    case "card":
      return [
        { label: "Explain it differently", intent: "explain-differently" },
        { label: "Another example", intent: "example" },
        { label: "Go deeper", intent: "deeper" },
      ];
    case "checkpoint":
    case "relight": {
      const level = opts.hintLevel ?? 0;
      if (level >= 2) return [{ label: CROC_COPY.hintsUsed, intent: "hint", disabled: true }];
      if (level === 1) return [{ label: "Another hint", intent: "hint", note: CROC_COPY.secondHint }];
      return [
        {
          label: "Give me a hint",
          intent: "hint",
          ...(context === "checkpoint" ? { note: CROC_COPY.firstHintFree } : {}),
        },
      ];
    }
    case "checkpoint-result":
      return [
        { label: "Why was that one wrong?", intent: "ask" },
        {
          label: opts.cardTitle ? `Explain ${opts.cardTitle} differently` : "Explain it differently",
          intent: "explain-differently",
        },
      ];
  }
}

/** Subscribe to the player's cached run (never fetches by itself). */
function useCachedRun(runId: string | undefined): RunState | undefined {
  const q = useQuery<RunState>({
    queryKey: runQueryKey(runId ?? ""),
    queryFn: async () => (await api.getRun({ runId: runId ?? "" })).run,
    enabled: false,
  });
  return runId ? q.data : undefined;
}

export function CrocPane({ packId, nodeId, screenId, runId, context, collapsed }: CrocPaneProps) {
  const pack = usePackQuery(packId).data;
  const qc = useQueryClient();
  const mood = useCrocReactions({ filter: (e) => e.packId === packId });
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<{ label: string; tick: number }>();
  const storeTick = useCroc((s) => s.focusTick);
  const [focusTick, setFocusTick] = useState(0);
  const run = useCachedRun(runId);
  const hintOnly = context === "checkpoint" || context === "relight" || context === "hook";
  const itemId = run?.current?.ref.itemId;
  const hintLevel = itemId ? Math.min(2, run?.hints[itemId] ?? 0) : 0;

  const scope = useMemo<CrocScope>(
    () => ({
      packId,
      ...(nodeId ? { nodeId } : {}),
      ...(screenId ? { screenId } : {}),
      ...(runId ? { runId } : {}),
      context,
    }),
    [packId, nodeId, screenId, runId, context],
  );
  const cardTitle = nodeId ? (pack?.nodes[nodeId]?.title ?? pack?.map.nodes[nodeId]?.title) : undefined;
  const chips = chipsFor(context, { ...(cardTitle ? { cardTitle } : {}), hintLevel });
  const mode = hintOnly ? "hint" : "full";

  // Offline hints in a checkpoint or Relight question go through the run's hint route, so the server
  // records them against the same cap as the hint button.
  const offline = useMemo(() => {
    const base = defaultOffline(pack, scope, mode);
    if ((context !== "checkpoint" && context !== "relight") || !runId) return base;
    return async (chip: CrocChip): Promise<OfflineAnswer> => {
      const current = (qc.getQueryData<RunState>(runQueryKey(runId)) ?? run)?.current?.ref.itemId;
      if (!current) return base(chip);
      const res = await api.requestHint({ runId }, { interactionId: current });
      qc.setQueryData(runQueryKey(runId), res.run);
      return {
        text: res.hint,
        note: res.source === "ai" ? "" : CROC_COPY.offlineLabel,
        hintLevel: Math.min(2, res.level) as 0 | 1 | 2,
      };
    };
  }, [pack, scope, mode, context, runId, qc, run]);

  // With AI, the server records the hint; refresh the run so pips and the hint button agree.
  const onReply = useCallback(() => {
    if (runId && (context === "checkpoint" || context === "relight"))
      void qc.invalidateQueries({ queryKey: runQueryKey(runId) });
  }, [qc, runId, context]);

  // ⌘J: focus the input (the bar expands first).
  useEffect(() => {
    if (!storeTick) return;
    setOpen(true);
    setFocusTick((t) => t + 1);
  }, [storeTick]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && k === "j") {
        e.preventDefault();
        useCroc.getState().requestFocus();
        return;
      }
      if (context !== "card" || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (!isTopLayer("modal")) return;
      const label = CARD_KEYS[k];
      if (!label) return;
      e.preventDefault();
      setOpen(true);
      setTrigger((t) => ({ label, tick: (t?.tick ?? 0) + 1 }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [context]);

  const state = thinking ? "thinking" : listening ? "listening" : mood.state;
  const fixedNote = context === "checkpoint" ? CROC_COPY.hintOnly : context === "hook" ? CROC_COPY.hookNote : undefined;

  const chat = (
    <CrocChat
      scope={scope}
      {...(pack ? { pack } : {})}
      chips={chips}
      mode={mode}
      placeholder={placeholderFor(context, cardTitle)}
      inputLabel={context === "checkpoint" ? "Hints only during a checkpoint" : `Ask ${CROC_NAME} about this card`}
      {...(fixedNote ? { fixedNote } : {})}
      offline={offline}
      onReply={onReply}
      onThinking={setThinking}
      onListening={setListening}
      focusTick={focusTick}
      {...(trigger ? { trigger } : {})}
      {...(context === "card"
        ? { chipKeys: { "Explain it differently": "E", "Another example": "X", "Go deeper": "D" } }
        : {})}
      className="min-h-0 flex-1"
    />
  );

  if (collapsed) {
    return (
      <div
        className={cn("shrink-0 border-t border-line bg-surface-2", open && "flex max-h-[min(440px,55dvh)] flex-col")}
        data-slot="croc-pane"
        data-context={context}
        data-collapsed
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-14 w-full shrink-0 items-center gap-3 px-4 text-left"
        >
          <span className="lm-pop-in inline-flex">
            <Croc state={state} size={40} lumen={mood.lumen} decorative />
          </span>
          <span className="min-w-0 flex-1 truncate text-small text-ink-2" aria-live="polite">
            {mood.line ?? contextLine(context, cardTitle)}
          </span>
          {context === "checkpoint" ? (
            <span className="hidden text-micro text-ink-3 sm:inline">{CROC_COPY.hintOnly}</span>
          ) : null}
          <Kbd keys={["⌘", "J"]} kind="chord" />
          <CaretUp size={16} aria-hidden className={cn("transition-transform duration-quick", !open && "rotate-180")} />
        </button>
        {open ? <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">{chat}</div> : null}
      </div>
    );
  }

  return (
    <aside
      aria-label={`${CROC_NAME}: ${contextLine(context, cardTitle)}`}
      className="flex h-full min-h-0 w-[240px] shrink-0 flex-col gap-3 border-l border-line bg-surface-2 p-4"
      data-slot="croc-pane"
      data-context={context}
    >
      <div className="flex min-h-[64px] flex-col items-start gap-2">
        {mood.line ? (
          <CrocBubble tail="bottom-left" onDone={mood.clearLine}>
            {mood.line}
          </CrocBubble>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="lm-pop-in inline-flex">
            <Croc state={state} size={56} lumen={mood.lumen} title={CROC_NAME} />
          </span>
          <p className="m-0 min-w-0 text-micro text-ink-3">{contextLine(context, cardTitle)}</p>
        </div>
      </div>
      {chat}
    </aside>
  );
}
