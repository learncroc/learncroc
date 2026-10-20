/**
 * Colour maths for the design system: WCAG contrast, mixing, and the world tokens (--w-*) derived
 * from a pack's theme. Pure functions; used by <WorldTheme>, the tokens check and tests.
 */
import type { PackTheme } from "@learncroc/core";

export type Rgb = readonly [r: number, g: number, b: number];

const HEX = /^#?([0-9a-f]{6})$/i;

/** "#1C1A3D" → [28, 26, 61]. Throws on anything but #RRGGBB. */
export function hexToRgb(hex: string): Rgb {
  const m = HEX.exec(hex.trim());
  if (!m?.[1]) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const h = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear mix in sRGB: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

/** The smallest mix of `from` toward `toward` that reaches `ratio` against `against` (or `toward` itself). */
export function mixToContrast(from: string, toward: string, against: string, ratio: number): string {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = mix(from, toward, Math.min(1, t));
    if (contrast(c, against) >= ratio) return c;
  }
  return toward;
}

/** Ink defaults that match the app's own ink tokens. */
const INK_ON_DARK = "#ECEBFA";
const INK_ON_LIGHT = "#1C1A3D";

/** Text colour for a world ground: the theme's ink if set, else the app ink for that mode, pushed to ≥ 7:1. */
export function worldInk(theme: Pick<PackTheme, "ground" | "mode" | "ink">): string {
  if (theme.ink) return theme.ink;
  const base = theme.mode === "dark" ? INK_ON_DARK : INK_ON_LIGHT;
  if (contrast(base, theme.ground) >= 7) return base;
  return mixToContrast(base, theme.mode === "dark" ? "#FFFFFF" : "#000000", theme.ground, 7);
}

export type WorldVars = Record<
  "--w-ground" | "--w-ink" | "--w-ink-2" | "--w-grid" | "--w-1" | "--w-2" | "--w-3" | "--w-4" | "--w-5" | "--w-mode",
  string
>;

/**
 * manifest.theme → the world tokens (--w-*). --w-ink-2 is the softest ink that still reads at 4.5:1,
 * --w-grid a faint rule for textures.
 */
export function worldVars(theme: Pick<PackTheme, "ground" | "mode" | "ink" | "lines">): WorldVars {
  const ink = worldInk(theme);
  const ink2 = mixToContrast(mix(theme.ground, ink, 0.6), ink, theme.ground, 4.5);
  const [w1, w2, w3, w4, w5] = theme.lines;
  return {
    "--w-ground": theme.ground,
    "--w-ink": ink,
    "--w-ink-2": ink2,
    "--w-grid": mix(theme.ground, ink, theme.mode === "dark" ? 0.1 : 0.12),
    "--w-1": w1,
    "--w-2": w2,
    "--w-3": w3,
    "--w-4": w4,
    "--w-5": w5,
    "--w-mode": theme.mode,
  };
}
