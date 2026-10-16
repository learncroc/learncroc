/**
 * Settings → Appearance applied to <html>: theme (System follows the OS live), the easier-to-read
 * font, more contrast, the reduce-motion override and the text size (scales the type tokens).
 */
import type { Settings } from "@learncroc/core";
import { useEffect, useSyncExternalStore } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Type tokens scaled by Settings → Text size (px values in tokens.css). */
export const TYPE_TOKENS: Record<string, [size: number, lh: number]> = {
  hero: [56, 64],
  display: [40, 48],
  title: [30, 36],
  heading: [24, 32],
  lead: [19, 30],
  body: [16, 24],
  small: [14, 20],
  micro: [12, 16],
  code: [15, 24],
  voice: [19, 28],
};

function subscribeScheme(cb: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener?.("change", cb);
  return () => mql.removeEventListener?.("change", cb);
}
const systemDark = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;

/** The OS colour scheme, live. */
export function useSystemDark(): boolean {
  return useSyncExternalStore(subscribeScheme, systemDark, () => false);
}

export function resolveTheme(theme: Settings["appearance"]["theme"], osDark: boolean): "light" | "dark" {
  return theme === "system" ? (osDark ? "dark" : "light") : theme;
}

/** Write the appearance settings onto an element (default <html>). Pure DOM; tested directly. */
export function applyAppearance(
  a: Settings["appearance"] | undefined,
  osDark: boolean,
  root: HTMLElement = document.documentElement,
): void {
  const theme = resolveTheme(a?.theme ?? "system", osDark);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  if (a?.font === "atkinson") root.dataset.font = "atkinson";
  else delete root.dataset.font;
  if (a?.contrast === "more") root.dataset.contrast = "more";
  else delete root.dataset.contrast;
  if (a?.reducedMotion === "on") root.dataset.motion = "reduced";
  else if (a?.reducedMotion === "off") root.dataset.motion = "full";
  else delete root.dataset.motion;
  const scale = a?.textScale ?? 1;
  for (const [name, [size, lh]] of Object.entries(TYPE_TOKENS)) {
    if (scale === 1) {
      root.style.removeProperty(`--t-${name}-size`);
      root.style.removeProperty(`--t-${name}-lh`);
    } else {
      root.style.setProperty(`--t-${name}-size`, `${Math.round(size * scale)}px`);
      root.style.setProperty(`--t-${name}-lh`, `${Math.round((lh * scale) / 2) * 2}px`);
    }
  }
}

/** Keep <html> in sync with the appearance settings (and the OS scheme for System). */
export function useAppearance(a: Settings["appearance"] | undefined): void {
  const osDark = useSystemDark();
  useEffect(() => {
    applyAppearance(a, osDark);
  }, [a, osDark]);
}
