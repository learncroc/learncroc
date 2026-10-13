/**
 * Shared bits for backdrop illustrations: the props every drawing takes and a few seeded helpers.
 *
 * Colour rules (02 §1.2): only world colours. Secondary ink and grid at 6–14% opacity, line colours at
 * ≤ 10%. Never Lumen, Sea or Ember: those are state colours.
 */
import type { BackdropId } from "@learncroc/core";

export interface BackdropColors {
  ground: string;
  ink2: string;
  grid: string;
  lines: readonly [string, string, string, string, string];
  mode: "light" | "dark";
}

export interface BackdropArtProps {
  /** Unique, url()-safe prefix for pattern ids. */
  uid: string;
  /** Pack id: doodles and scatter are seeded from it, so the art never shifts between renders. */
  seed: string;
  /** Layout size (the map's own box). */
  width: number;
  height: number;
  /** The area to cover: the layout plus bleed. */
  bounds: { x: number; y: number; w: number; h: number };
  c: BackdropColors;
}

/** Opacity steps for secondary ink: faint, soft, firm (all inside the 6–14% band). */
export const INK = { faint: 0.06, soft: 0.09, firm: 0.13 } as const;
/** Line colours never exceed 10%. */
export const LINE = { faint: 0.05, soft: 0.08, firm: 0.1 } as const;

export type DrawnBackdropId = Exclude<BackdropId, "none">;

/** Shared stroke props for line art in secondary ink. */
export const inkStroke = (c: BackdropColors, opacity: number = INK.soft, width = 2) => ({
  stroke: c.ink2,
  strokeOpacity: opacity,
  strokeWidth: width,
  fill: "none",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const line = (c: BackdropColors, i: number) => c.lines[((i % 5) + 5) % 5] as string;

/** A closed, smooth, slightly irregular blob around (cx, cy). */
export function blobPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rnd: () => number,
  n = 9,
  jitter = 0.18,
): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 - jitter + rnd() * jitter * 2;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return closedSmooth(pts);
}

/** Closed Catmull-Rom → Bézier path through points. */
export function closedSmooth(pts: readonly (readonly [number, number])[], tension = 0.5): string {
  const n = pts.length;
  if (n < 3) return "";
  const at = (i: number) => pts[((i % n) + n) % n] as readonly [number, number];
  const f = (v: number) => Math.round(v * 10) / 10;
  let d = `M${f(at(0)[0])} ${f(at(0)[1])}`;
  const k = tension / 3;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    d += `C${f(p1[0] + (p2[0] - p0[0]) * k)} ${f(p1[1] + (p2[1] - p0[1]) * k)} ${f(p2[0] - (p3[0] - p1[0]) * k)} ${f(p2[1] - (p3[1] - p1[1]) * k)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/** Points from a normalised outline (0..1) placed in a box. */
export const place = (
  outline: readonly (readonly [number, number])[],
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number][] => outline.map(([u, v]) => [x + u * w, y + v * h]);

/** Seeded scatter inside a box, keeping a minimum spacing (best effort, capped attempts). */
export function scatter(
  rnd: () => number,
  count: number,
  box: { x: number; y: number; w: number; h: number },
  spacing: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let tries = 0; tries < count * 12 && out.length < count; tries++) {
    const p: [number, number] = [box.x + rnd() * box.w, box.y + rnd() * box.h];
    if (out.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= spacing)) out.push(p);
  }
  return out;
}
