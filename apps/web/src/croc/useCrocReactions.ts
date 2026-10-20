/**
 * Listen to the reaction bus and turn events into Moss's state and one bubble line, with these caps:
 *
 * - ≤ 1 line per moment: once a line shows, nothing else speaks for the next few seconds;
 * - ≤ 1 unsolicited bubble per 45 s (the close, a gate opening, a finished map and the first card done
 *   are moments the learner caused, so they skip the wait);
 * - never while typing or dragging, never on idle (nothing emits on idle);
 * - bubbles fade after about 4 s (CrocBubble);
 * - "Quiet" (settings.croc.reactions) keeps the animation and drops every bubble.
 *
 * The caps are shared by every listener (corner and panes), so two surfaces never double up.
 */
import type { CrocState } from "@learncroc/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../app/queries";
import { type CrocReaction, type CrocReactionType, crocReactions, pickLine, REACTION_STATE } from "./reactions";

export const UNSOLICITED_GAP_MS = 45_000;
/** One line per moment: the window after a line in which nothing else speaks. */
export const MOMENT_WINDOW_MS = 1_500;
const STATE_MS = 1_800;

/** Reactions to something the learner just did (not unsolicited). */
export const SOLICITED = new Set<CrocReactionType>([
  "guess-locked",
  "idk-locked",
  "close-wrong",
  "close-right",
  "close-confident-wrong",
  "first-card-done",
  "beat-missed",
  "gate-opened",
  "checkpoint-not-yet",
  "map-finished",
]);

/** Shared caps (module state: every listener sees the same clock). */
const caps = { lastLine: Number.NEGATIVE_INFINITY, lastUnsolicited: Number.NEGATIVE_INFINITY };

let pointerDown = false;
let dragging = false;
let downAt: { x: number; y: number } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      pointerDown = true;
      downAt = { x: e.clientX, y: e.clientY };
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      if (pointerDown && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) dragging = true;
    },
    { capture: true, passive: true },
  );
  const up = () => {
    pointerDown = false;
    dragging = false;
    downAt = null;
  };
  window.addEventListener("pointerup", up, { capture: true, passive: true });
  window.addEventListener("pointercancel", up, { capture: true, passive: true });
}

function typing(): boolean {
  const el = typeof document !== "undefined" ? document.activeElement : null;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && ["text", "search", "number", ""].includes((el as HTMLInputElement).type);
}

/**
 * Decide whether a reaction may speak now; records the decision. Exported for tests and for surfaces
 * that speak outside the hook (none today).
 */
export function mayBubble(e: CrocReaction, opts: { quiet: boolean; now: number }): boolean {
  if (opts.quiet || typing() || dragging) return false;
  if (opts.now - caps.lastLine < MOMENT_WINDOW_MS) return false;
  const unsolicited = !SOLICITED.has(e.type);
  if (unsolicited && opts.now - caps.lastUnsolicited < UNSOLICITED_GAP_MS) return false;
  caps.lastLine = opts.now;
  if (unsolicited) caps.lastUnsolicited = opts.now;
  return true;
}

/** Reset the shared caps (tests). */
export function resetReactionCaps(): void {
  caps.lastLine = Number.NEGATIVE_INFINITY;
  caps.lastUnsolicited = Number.NEGATIVE_INFINITY;
}

export interface CrocMood {
  state: CrocState;
  lumen: boolean;
  line?: string;
  clearLine(): void;
}

export function useCrocReactions(opts: { enabled?: boolean; filter?: (e: CrocReaction) => boolean } = {}): CrocMood {
  const enabled = opts.enabled ?? true;
  const settings = useSettings();
  const quiet = settings.data?.croc?.reactions === "quiet";
  const [state, setState] = useState<CrocState>("idle");
  const [lumen, setLumen] = useState(false);
  const [line, setLine] = useState<string>();
  const filter = useRef(opts.filter);
  filter.current = opts.filter;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    return crocReactions.subscribe((e) => {
      if (filter.current && !filter.current(e)) return;
      const look = REACTION_STATE[e.type];
      setState(look.state);
      setLumen(Boolean(look.lumen));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => {
          setState("idle");
          setLumen(false);
        },
        look.state === "cheering" ? STATE_MS + 1_200 : STATE_MS,
      );
      // Wall-clock pacing of a UI animation (not learner state).
      if (!mayBubble(e, { quiet, now: performance.now() })) return;
      setLine(pickLine(e));
    });
  }, [enabled, quiet]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const clearLine = useCallback(() => setLine(undefined), []);
  return { state, lumen, ...(line ? { line } : {}), clearLine };
}
