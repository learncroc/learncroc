/** Small browser helpers for the AI surfaces. */
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  mql.addEventListener?.("change", cb);
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion", "data-theme"] });
  return () => {
    mql.removeEventListener?.("change", cb);
    obs.disconnect();
  };
}

function reduced(): boolean {
  if (typeof document === "undefined") return false;
  const m = document.documentElement.dataset.motion;
  if (m === "reduced") return true;
  if (m === "full") return false;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function theme(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Settings → Reduce motion (or the OS setting), live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reduced, () => false);
}

/** The resolved app theme, live. */
export function useThemeMode(): "light" | "dark" {
  return useSyncExternalStore(subscribe, theme, () => "light");
}

/** "⌘" on macOS, "Ctrl" elsewhere. */
export function isMacLike(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}
