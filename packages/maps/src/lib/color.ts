/**
 * Small colour helpers for world themes: hex parsing, mixing, WCAG contrast and the derived world
 * tokens (--w-*) a map root sets from manifest.theme.
 */
import type { PackTheme } from "@learncroc/core";
import { worldVars } from "@learncroc/ui";

export type Rgb = readonly [number, number, number];

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** "#0E1A1F" or "#abc" → [r, g, b]. Invalid input yields mid grey so a bad theme never crashes a map. */
export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [128, 128, 128];
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Linear mix: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return rgbToHex([ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t]);
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** `rgb(r g b / a)` for SVG fills that need transparency of a hex colour. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

export interface WorldColors {
  ground: string;
  /** Text and strong strokes on the ground (≥ 7:1). */
  ink: string;
  /** Secondary text, locked strokes (≥ 4.5:1). */
  ink2: string;
  /** Faint texture lines. */
  grid: string;
  /** Locked / unetched strokes: visible but quiet (≥ 3:1 for non-text UI). */
  muted: string;
  /** --w-1..--w-5 */
  lines: readonly [string, string, string, string, string];
  mode: "light" | "dark";
}

/**
 * Derive the full world palette from a pack theme. Ink, secondary ink and grid are the design system's
 * world tokens (the same values <WorldTheme> sets), so map labels match run screens exactly.
 */
export function worldColors(theme: PackTheme): WorldColors {
  const vars = worldVars(theme);
  const ink = vars["--w-ink"];
  return {
    ground: theme.ground,
    ink,
    ink2: vars["--w-ink-2"],
    grid: vars["--w-grid"],
    muted: pickInk(theme.ground, ink, 3, 0.5),
    lines: theme.lines,
    mode: theme.mode,
  };
}

/**
 * Mix `ground` towards `target` until the contrast with the ground reaches `min`. `start` is the mix
 * amount tried first (so secondary inks stay as quiet as the contrast rule allows).
 */
function pickInk(ground: string, target: string, min: number, start = 1): string {
  for (let t = start; t <= 1.0001; t += 0.04) {
    const c = mix(ground, target, Math.min(1, t));
    if (contrast(c, ground) >= min) return c;
  }
  return target;
}

/** CSS custom properties for a world root: the design system's --w-* tokens plus --w-muted (locked strokes). */
export function worldStyle(theme: PackTheme): Record<string, string> {
  return { ...worldVars(theme), "--w-muted": worldColors(theme).muted };
}

/** The dawn palette for the everything-lit shift (craft): a warm horizon that is never Lumen gold. */
export function dawnColors(theme: PackTheme): { top: string; horizon: string } {
  return theme.mode === "dark"
    ? { top: mix(theme.ground, "#5B4B8A", 0.45), horizon: mix(theme.ground, "#E7A3B4", 0.42) }
    : { top: mix(theme.ground, "#FFE3EC", 0.6), horizon: mix(theme.ground, "#F6C7B8", 0.55) };
}
