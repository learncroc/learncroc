/** Hand-drawn ink helpers for the surveying map: seeded wobble so a stop always looks the same. */

export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => Math.round(n * 10) / 10;

/** A slightly uneven closed circle, like a pen stroke that overlaps where it started. */
export function wobblyCircle(cx: number, cy: number, r: number, seed: number, wobble = 1.6): string {
  const rand = rng(seed);
  const n = 10;
  const start = rand() * Math.PI * 2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n + 1; i++) {
    const a = start + (i / n) * Math.PI * 2;
    const rr = r + (rand() - 0.5) * wobble * 2;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  let d = `M ${f(pts[0]?.[0] ?? cx)} ${f(pts[0]?.[1] ?? cy)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i] as [number, number];
    const [nx, ny] = pts[i + 1] as [number, number];
    d += ` Q ${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  return d;
}

/** A gently bowed line between two stops, trimmed so it starts and ends at the circles' edges. */
export function inkEdge(a: { x: number; y: number }, b: { x: number; y: number }, r: number, seed: number): string {
  const rand = rng(seed);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = a.x + ux * (r + 4);
  const sy = a.y + uy * (r + 4);
  const ex = b.x - ux * (r + 8);
  const ey = b.y - uy * (r + 8);
  const bow = (rand() - 0.5) * Math.min(28, len * 0.18);
  const mx = (sx + ex) / 2 - uy * bow;
  const my = (sy + ey) / 2 + ux * bow;
  return `M ${f(sx)} ${f(sy)} Q ${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}`;
}

/** A small open arrowhead at the end of an edge. */
export function arrowHead(a: { x: number; y: number }, b: { x: number; y: number }, r: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tx = b.x - ux * (r + 7);
  const ty = b.y - uy * (r + 7);
  const s = 7;
  const lx = tx - ux * s + -uy * s * 0.6;
  const ly = ty - uy * s + ux * s * 0.6;
  const rx = tx - ux * s - -uy * s * 0.6;
  const ry = ty - uy * s - ux * s * 0.6;
  return `M ${f(lx)} ${f(ly)} L ${f(tx)} ${f(ty)} L ${f(rx)} ${f(ry)}`;
}
