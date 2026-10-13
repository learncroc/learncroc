/** Geometry for edge routes: polylines, rounded corners, lengths and points along a route. */

export type Pt = readonly [number, number];

export const r1 = (n: number) => Math.round(n * 10) / 10;

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Drop consecutive duplicates and collinear middle points. */
export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 0.01 && Math.abs(last[1] - p[1]) < 0.01) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1] as Pt;
    const b = out[i] as Pt;
    const c = out[i + 1] as Pt;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 0.01) out.splice(i, 1);
  }
  return out;
}

export function polylineLength(points: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1] as Pt, points[i] as Pt);
  return len;
}

/** The point at fraction t (0..1) along a polyline, plus the heading in degrees. */
export function pointAt(points: readonly Pt[], t: number): { x: number; y: number; angle: number } {
  const first = points[0] ?? [0, 0];
  if (points.length < 2) return { x: first[0], y: first[1], angle: 0 };
  const total = polylineLength(points);
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Pt;
    const b = points[i] as Pt;
    const seg = dist(a, b);
    if (target <= seg || i === points.length - 1) {
      const k = seg === 0 ? 0 : Math.min(1, target / seg);
      return {
        x: a[0] + (b[0] - a[0]) * k,
        y: a[1] + (b[1] - a[1]) * k,
        angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
      };
    }
    target -= seg;
  }
  const last = points[points.length - 1] as Pt;
  return { x: last[0], y: last[1], angle: 0 };
}

/** Plain polyline path. */
export function linePath(points: readonly Pt[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${r1(p[0])} ${r1(p[1])}`).join("");
}

/** Polyline with every corner rounded by up to `radius` (metro tracks, string lines). */
export function roundedPath(points: readonly Pt[], radius: number): string {
  if (points.length < 3) return linePath(points);
  let d = `M${r1((points[0] as Pt)[0])} ${r1((points[0] as Pt)[1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1] as Pt;
    const b = points[i] as Pt;
    const c = points[i + 1] as Pt;
    const r = Math.min(radius, dist(a, b) / 2, dist(b, c) / 2);
    const p1 = towards(b, a, r);
    const p2 = towards(b, c, r);
    d += `L${r1(p1[0])} ${r1(p1[1])}Q${r1(b[0])} ${r1(b[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  const last = points[points.length - 1] as Pt;
  return `${d}L${r1(last[0])} ${r1(last[1])}`;
}

/** Polyline whose right-angle corners are cut at 45° by `size` (PCB traces). */
export function chamferPoints(points: readonly Pt[], size: number): Pt[] {
  if (points.length < 3) return [...points];
  const out: Pt[] = [points[0] as Pt];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1] as Pt;
    const b = points[i] as Pt;
    const c = points[i + 1] as Pt;
    const s = Math.min(size, dist(a, b) / 2, dist(b, c) / 2);
    out.push(towards(b, a, s), towards(b, c, s));
  }
  out.push(points[points.length - 1] as Pt);
  return out;
}

function towards(from: Pt, to: Pt, d: number): Pt {
  const len = dist(from, to);
  if (len === 0) return from;
  return [from[0] + ((to[0] - from[0]) * d) / len, from[1] + ((to[1] - from[1]) * d) / len];
}

/** Distance from point p to segment ab. */
export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** Minimum distance from p to any segment of a polyline. */
export function polylineDistance(p: Pt, points: readonly Pt[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++)
    best = Math.min(best, segmentDistance(p, points[i - 1] as Pt, points[i] as Pt));
  return best;
}

/** Sample a cubic Catmull-Rom spline through points into a dense polyline (atlas roads). */
export function catmullRomPoints(points: readonly Pt[], samplesPerSegment = 12, alpha = 0.5): Pt[] {
  if (points.length < 3) return [...points];
  const out: Pt[] = [];
  const pts = [points[0] as Pt, ...points, points[points.length - 1] as Pt];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1] as Pt;
    const p1 = pts[i] as Pt;
    const p2 = pts[i + 1] as Pt;
    const p3 = pts[i + 2] as Pt;
    const t0 = 0;
    const t1 = t0 + dist(p0, p1) ** alpha || 1e-4;
    const t2 = t1 + dist(p1, p2) ** alpha || t1 + 1e-4;
    const t3 = t2 + dist(p2, p3) ** alpha || t2 + 1e-4;
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSegment;
      const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
        const k = tb === ta ? 0 : (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  out.push(points[points.length - 1] as Pt);
  return out;
}

/** Smooth SVG path through points using a Catmull-Rom → Bézier conversion. */
export function smoothPath(points: readonly Pt[], tension = 0.5): string {
  if (points.length < 3) return linePath(points);
  const p = points;
  let d = `M${r1((p[0] as Pt)[0])} ${r1((p[0] as Pt)[1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = (p[i - 1] ?? p[i]) as Pt;
    const p1 = p[i] as Pt;
    const p2 = p[i + 1] as Pt;
    const p3 = (p[i + 2] ?? p2) as Pt;
    const k = tension / 3;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const boxesOverlap = (a: Box, b: Box, pad = 0): boolean =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** Round all numbers in a path string (rough.js emits 15 decimals). */
export const compactPath = (d: string): string => d.replace(/-?\d+\.\d+/g, (m) => String(r1(Number(m))));
