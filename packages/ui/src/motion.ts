/**
 * Motion presets (craft not research). Springs for `motion`; durations mirror tokens.css.
 *
 * Reduced motion comes from the OS (`prefers-reduced-motion`) unless the app overrides it with
 * `data-motion="reduced" | "full"` on <html> (Settings → Appearance → Reduce motion). Under reduced
 * motion, springs become 120 ms crossfades (`reduced`), light flow is an instant state change and
 * breathing is a static ring (handled in theme.css).
 */
import { useSyncExternalStore } from "react";

export const springs = {
  drag: { type: "spring", stiffness: 420, damping: 34, mass: 1 },
  snap: { type: "spring", stiffness: 700, damping: 30 },
  wobble: { type: "spring", stiffness: 300, damping: 12 },
} as const;

export const durations = {
  press: 0.08,
  quick: 0.14,
  base: 0.22,
  move: 0.36,
  reveal: 0.7,
  flow: 0.9,
  lightup: 2.4,
} as const;

export const easings = {
  out: [0.2, 0.8, 0.2, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.5, 0, 0.75, 0],
} as const;

export const reduced = { type: "tween", duration: 0.12, ease: "linear" } as const;

export type MotionPreset = keyof typeof springs | "panel" | "drawer" | "reveal" | "quick";

/** A `motion` transition for a preset, swapped for the 120 ms crossfade under reduced motion. */
export function transition(preset: MotionPreset, isReduced: boolean) {
  if (isReduced) return reduced;
  switch (preset) {
    case "panel":
      return { type: "tween", duration: durations.base, ease: easings.out } as const;
    case "drawer":
      return { type: "tween", duration: durations.move, ease: easings.out } as const;
    case "reveal":
      return { type: "tween", duration: durations.reveal, ease: easings.out } as const;
    case "quick":
      return { type: "tween", duration: durations.quick, ease: easings.out } as const;
    default:
      return springs[preset];
  }
}

const QUERY = "(prefers-reduced-motion: reduce)";

/** Is reduced motion on right now (app override first, then the OS)? */
export function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  const override = document.documentElement.dataset.motion;
  if (override === "reduced") return true;
  if (override === "full") return false;
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(QUERY).matches
    : false;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : undefined;
  mql?.addEventListener?.("change", onChange);
  const mo = typeof MutationObserver === "function" ? new MutationObserver(onChange) : undefined;
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => {
    mql?.removeEventListener?.("change", onChange);
    mo?.disconnect();
  };
}

/** React hook: true when motion should be reduced. Re-renders when the OS or app setting changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
