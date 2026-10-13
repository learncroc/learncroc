/** A tiny requestAnimationFrame tween (no learner state: this only drives decorative motion). */

export type Ease = (t: number) => number;

/** --ease-in-out: cubic-bezier(.65,0,.35,1), approximated. */
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** --ease-out: cubic-bezier(.2,.8,.2,1), approximated. */
export const easeOut: Ease = (t) => 1 - (1 - t) ** 3;

export interface TweenOptions {
  duration: number;
  ease?: Ease;
  onUpdate(t: number): void;
  onComplete?(): void;
}

/** Runs a tween; returns a cancel function. Falls back to an immediate finish without rAF. */
export function tween({ duration, ease = easeInOut, onUpdate, onComplete }: TweenOptions): () => void {
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : undefined;
  const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : undefined;
  if (!raf || duration <= 0) {
    onUpdate(1);
    onComplete?.();
    return () => {};
  }
  let start: number | undefined;
  let id = 0;
  let cancelled = false;
  const frame = (now: number) => {
    if (cancelled) return;
    if (start === undefined) start = now;
    const t = Math.min(1, (now - start) / duration);
    onUpdate(ease(t));
    if (t < 1) id = raf(frame);
    else onComplete?.();
  };
  id = raf(frame);
  return () => {
    cancelled = true;
    caf?.(id);
  };
}
