/**
 * Small pure helpers shared by widget specs and views. No React, no DOM.
 */

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** |a − b| ≤ tol, with a hair of float slack. */
export function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol + 1e-9;
}

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** Round to a step (and to a sane number of decimals, so 0.1 + 0.2 shows as 0.3). */
export function snap(n: number, step: number, origin = 0): number {
  if (!(step > 0)) return n;
  const v = origin + Math.round((n - origin) / step) * step;
  const decimals = Math.max(0, Math.min(10, Math.ceil(-Math.log10(step)) + 1));
  return Number(v.toFixed(decimals));
}

/** "40%" — whole percent, never "-0%". */
export function pct(p: number, digits = 0): string {
  const v = Number((clamp(p, 0, 1) * 100).toFixed(digits));
  return `${v === 0 ? 0 : v}%`;
}

/** Format a number for a readout: fixed digits, trailing zeros kept for alignment. */
export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "–";
  const v = Number(n.toFixed(digits));
  return (v === 0 ? 0 : v).toFixed(digits);
}

/** Compact number for axis ticks: 0.5, 12, 1.2k, 3M. */
export function tickLabel(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`;
  if (a >= 1e4) return `${Number((n / 1e3).toFixed(1))}k`;
  if (a === 0) return "0";
  if (a < 0.01) return n.toExponential(0);
  return String(Number(n.toPrecision(3)));
}

/** Nice evenly spaced ticks covering [lo, hi] (about `count` of them). */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.ceil(lo / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Log-scale ticks: powers of ten inside [lo, hi] (lo > 0). */
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) {
    const v = 10 ** k;
    if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v);
  }
  return out.length >= 2 ? out : [lo, hi];
}

/**
 * Set comparison used by tap goals. Tapping a wrong one never passes, so "tap everything" can't win:
 * - "any": at least one correct item chosen and nothing wrong
 * - "all" / "exact": every correct item chosen and nothing wrong
 * Score is the Jaccard overlap (partial credit).
 */
export function setMatch(
  chosen: readonly (string | number)[],
  correct: readonly (string | number)[],
  match: "any" | "all" | "exact",
): { ok: boolean; score: number } {
  const c = new Set(chosen);
  const want = new Set(correct);
  let hits = 0;
  for (const v of c) if (want.has(v)) hits++;
  const wrong = c.size - hits;
  const union = new Set([...c, ...want]).size;
  const score = union === 0 ? 1 : hits / union;
  if (match === "any") return { ok: hits > 0 && wrong === 0, score: hits > 0 && wrong === 0 ? 1 : score };
  return { ok: hits === want.size && wrong === 0, score };
}

/** Deterministic PRNG (mulberry32): the same seed gives the same samples in tests and screenshots. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw an index from weights (need not sum to 1) with a uniform `u` in [0, 1). */
export function drawIndex(weights: readonly number[], u: number): number {
  const total = sum(weights);
  if (!(total > 0)) return 0;
  let acc = 0;
  const target = u * total;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] ?? 0;
    if (target < acc) return i;
  }
  return weights.length - 1;
}

/**
 * A stable shuffle seeded by the ids themselves that never returns the authored order (which is
 * often the answer). Specs use it for initialAnswer and views for their first render, so what the
 * learner sees and what an untouched Check grades are the same.
 */
export function stableShuffle(ids: readonly string[]): string[] {
  if (ids.length < 2) return [...ids];
  const r = rng(hashString(ids.join("|")));
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as string, out[i] as string];
  }
  if (out.every((id, i) => id === ids[i])) out.push(out.shift() as string);
  return out;
}

/** Stable string hash (FNV-1a) for seeding. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
