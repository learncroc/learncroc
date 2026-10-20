/**
 * The map's moment queue, fed by run summaries (`onSummary`, `onOpenGate`), not
 * by sessionStorage diffs. One moment plays at a time and moments never overlap. They wait for the
 * modal to close, except a `cardDone` marked `behind` (the learner pressed Next: it plays behind the
 * scrim while the next card opens). Any key or click skips the playing moment to its end state.
 *
 * MapView reports the end of its moments through `onMomentDone(key)`; a fallback timer ends a moment
 * that can't play (list view, a renderer that never reports), so the queue never stalls.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MapMoment } from "./mapLogic";

const FALLBACK_MS: Record<MapMoment["kind"], number> = {
  cardDone: 2_500,
  gateOpen: 7_000,
  revisit: 4_000,
  dawn: 2_400,
};

export interface MapMoments {
  /** The moment playing now. */
  current: MapMoment | null;
  enqueue(m: MapMoment): void;
  /** Drop queued moments of a kind that haven't started (a revisit route the learner already followed). */
  drop(kind: MapMoment["kind"]): void;
  /** MapView (or the dawn overlay) finished the moment with this key. */
  done(key: number): void;
  /** True while anything is queued or playing. */
  busy: boolean;
}

export function useMapMoments(opts: {
  modalOpen: boolean;
  /** MapView can't play moments (list view): end each at once. */
  canPlay: boolean;
  onEnd(m: MapMoment, skipped: boolean): void;
}): MapMoments {
  const [queue, setQueue] = useState<MapMoment[]>([]);
  const onEnd = useRef(opts.onEnd);
  onEnd.current = opts.onEnd;
  const head = queue[0];
  const playable = head && (!opts.modalOpen || (head.kind === "cardDone" && head.behind)) ? head : null;
  const current = playable ?? null;
  const ending = useRef(new Set<number>());

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const finish = useCallback((key: number, skipped: boolean) => {
    if (ending.current.has(key)) return;
    const m = queueRef.current.find((x) => x.key === key);
    if (!m) return;
    ending.current.add(key);
    // Side effects stay out of the state updater (StrictMode runs updaters twice).
    setQueue((q) => q.filter((x) => x.key !== key));
    onEnd.current(m, skipped);
  }, []);

  // Fallback end, and "can't play here" (list view) ends at once.
  useEffect(() => {
    if (!current) return;
    const key = current.key;
    const ms = opts.canPlay || current.kind === "dawn" ? FALLBACK_MS[current.kind] : 0;
    const t = setTimeout(() => finish(key, ms === 0), ms);
    return () => clearTimeout(t);
  }, [current, opts.canPlay, finish]);

  // Any key or click skips the playing moment (the key is not otherwise consumed, except Esc).
  useEffect(() => {
    if (!current || opts.modalOpen) return;
    const key = current.key;
    const skip = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.metaKey || e.ctrlKey || e.key === "Shift" || e.key === "Meta" || e.key === "Control") return;
        if (e.key === "Escape") e.preventDefault();
      }
      finish(key, true);
    };
    // Let the click or key that started the moment settle first.
    const arm = setTimeout(() => {
      window.addEventListener("keydown", skip, { capture: true });
      window.addEventListener("pointerdown", skip, { capture: true });
      window.addEventListener("wheel", skip, { capture: true, passive: true });
    }, 250);
    return () => {
      clearTimeout(arm);
      window.removeEventListener("keydown", skip, { capture: true });
      window.removeEventListener("pointerdown", skip, { capture: true });
      window.removeEventListener("wheel", skip, { capture: true });
    };
  }, [current, opts.modalOpen, finish]);

  const enqueue = useCallback((m: MapMoment) => setQueue((q) => [...q, m]), []);
  const drop = useCallback((kind: MapMoment["kind"]) => setQueue((q) => q.filter((x) => x.kind !== kind)), []);
  const done = useCallback((key: number) => finish(key, false), [finish]);

  return { current, enqueue, drop, done, busy: queue.length > 0 };
}
