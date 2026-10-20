/**
 * Colour checks for world themes (lint L014): WCAG contrast, CIE L*, ΔE2000, and the
 * nearest passing colour (`learncroc lint --fix` suggests it).
 */

/** App tokens a world colour must stay away from (ΔE2000 ≥ 15), per world mode. */
export const RESERVED_COLOURS = {
  light: { lumen: "#FFC23D", ember: "#E5793F", sea: "#12877A" },
  dark: { lumen: "#FFCB57", ember: "#F08A50", sea: "#4FD1BF" },
} as const;

export const MIN_LINE_CONTRAST = 3;
export const MIN_INK_CONTRAST = 7;
export const MIN_DELTA_E = 15;
export const DARK_GROUND_MAX_L = 25;
export const LIGHT_GROUND_MIN_L = 88;

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Lab = [number, number, number];

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(lin) as Rgb;
  // sRGB D65 → XYZ, normalised by the D65 white point.
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE L* (0..100). */
export function lightness(hex: string): number {
  return hexToLab(hex)[0];
}

/** CIEDE2000 colour difference. */
export function deltaE2000(a: string, b: string): number {
  const [L1, a1, b1] = hexToLab(a);
  const [L2, a2, b2] = hexToLab(b);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (bb: number, ap: number) => {
    if (bb === 0 && ap === 0) return 0;
    const h = Math.atan2(bb, ap) / rad;
    return h >= 0 ? h : h + 360;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lpm = (L1 + L2) / 2;
  const Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2;
    else hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hpm - 30) * rad) +
    0.24 * Math.cos(2 * hpm * rad) +
    0.32 * Math.cos((3 * hpm + 6) * rad) -
    0.2 * Math.cos((4 * hpm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

export interface LineColourProblem {
  contrast: number;
  /** Closest reserved token and its distance, when too close. */
  near?: { token: string; deltaE: number };
}

/** Problems with one line colour on a ground, or null when it passes. */
export function lineColourProblem(hex: string, ground: string, mode: "light" | "dark"): LineColourProblem | null {
  const contrast = contrastRatio(hex, ground);
  let near: LineColourProblem["near"];
  for (const [token, ref] of Object.entries(RESERVED_COLOURS[mode])) {
    const d = deltaE2000(hex, ref);
    if (d < MIN_DELTA_E && (!near || d < near.deltaE)) near = { token, deltaE: d };
  }
  return contrast >= MIN_LINE_CONTRAST && !near ? null : { contrast, ...(near ? { near } : {}) };
}

/**
 * The nearest passing colour: walk lightness toward more contrast and rotate hue away from the
 * reserved tokens, keeping the change as small as possible. Undefined when nothing passes.
 */
export function suggestLineColour(hex: string, ground: string, mode: "light" | "dark"): string | undefined {
  if (!lineColourProblem(hex, ground, mode)) return hex;
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  let h = 0;
  const d = max - min;
  if (d > 0) {
    if (max === r / 255) h = ((g - b) / 255 / d) % 6;
    else if (max === g / 255) h = (b - r) / 255 / d + 2;
    else h = (r - g) / 255 / d + 4;
    h *= 60;
  }
  const l0 = (max + min) / 2;
  const s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  const hsl = (hh: number, s: number, l: number): string => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = l - c / 2;
    const [r1, g1, b1] =
      hh < 60
        ? [c, x, 0]
        : hh < 120
          ? [x, c, 0]
          : hh < 180
            ? [0, c, x]
            : hh < 240
              ? [0, x, c]
              : hh < 300
                ? [x, 0, c]
                : [c, 0, x];
    return rgbToHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
  };
  let best: { hex: string; cost: number } | undefined;
  for (let dh = 0; dh <= 180; dh += 6) {
    for (const sign of dh === 0 ? [1] : [1, -1]) {
      for (let step = 0; step <= 50; step++) {
        const dl = (mode === "dark" ? 1 : -1) * step * 0.01;
        const l = l0 + dl;
        if (l < 0 || l > 1) break;
        const cand = hsl((((h + sign * dh) % 360) + 360) % 360, Math.max(s0, 0.35), l);
        if (lineColourProblem(cand, ground, mode)) continue;
        const cost = deltaE2000(hex, cand);
        if (!best || cost < best.cost) best = { hex: cand, cost };
        break;
      }
    }
  }
  return best?.hex;
}
