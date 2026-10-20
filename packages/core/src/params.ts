/**
 * Seeded randomness and parametric item instances.
 *
 * Numeric and estimate items may declare `params`: candidate values per variable plus an
 * `answerExpr`. The server draws an instance from the run seed, renders the prompt ({name}
 * placeholders), computes the answer with expr.ts and stores the vars on the attempt.
 * The same seed always yields the same instance.
 */
import { evaluate } from "./expr";
import type { Item, ItemParams } from "./schema/index";

/** FNV-1a over the UTF-16 code units, as an unsigned 32-bit integer. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Combine a seed with any number of labels into a new 32-bit seed. */
export function deriveSeed(seed: number, ...labels: (string | number)[]): number {
  return hashString(`${seed >>> 0}:${labels.join(":")}`);
}

/** mulberry32: a small, fast, seedable PRNG returning floats in [0, 1). */
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

/** Deterministic Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The authored default instance: the first candidate of every variable. */
export function defaultVars(params: ItemParams): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, values] of Object.entries(params.vars)) out[name] = values[0] as number;
  return out;
}

/**
 * Draw an instance for an item from a run seed. `avoid` lists instances already used (e.g. the
 * learner's last check) so a fresh combination is picked when one exists.
 */
export function drawVars(
  params: ItemParams,
  seed: number,
  itemId: string,
  avoid: readonly Record<string, number>[] = [],
): Record<string, number> {
  const names = Object.keys(params.vars).sort();
  const r = rng(deriveSeed(seed, "params", itemId));
  const key = (v: Record<string, number>) => names.map((n) => v[n]).join(",");
  const used = new Set(avoid.map(key));
  const total = names.reduce((n, k) => n * (params.vars[k]?.length ?? 1), 1);
  if (total <= 4096) {
    // Small spaces: pick uniformly among the fresh instances (all of them when none is fresh).
    const all = allInstances(params);
    const fresh = all.filter((v) => !used.has(key(v)));
    const pool = fresh.length ? fresh : all;
    return pool[Math.floor(r() * pool.length)] ?? defaultVars(params);
  }
  let first: Record<string, number> | undefined;
  for (let attempt = 0; attempt < 64; attempt++) {
    const v: Record<string, number> = {};
    for (const n of names) {
      const values = params.vars[n] ?? [];
      v[n] = values[Math.floor(r() * values.length)] as number;
    }
    first ??= v;
    if (!used.has(key(v))) return v;
  }
  return first ?? defaultVars(params);
}

/** Every combination of candidate values (lint checks the expression is finite for each). */
export function allInstances(params: ItemParams, cap = 10_000): Record<string, number>[] {
  let out: Record<string, number>[] = [{}];
  for (const [name, values] of Object.entries(params.vars)) {
    const next: Record<string, number>[] = [];
    for (const partial of out) for (const v of values) next.push({ ...partial, [name]: v });
    out = next.slice(0, cap);
  }
  return out;
}

/** Format a number for a learner-facing prompt (no float noise like 0.30000000000000004). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Number.parseFloat(n.toPrecision(12)));
}

/** Replace {name} placeholders with the instance's values. Unknown names are left as written. */
export function renderTemplate(text: string, vars: Readonly<Record<string, number>>): string {
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name: string) =>
    Object.hasOwn(vars, name) ? formatNumber(vars[name] as number) : m,
  );
}

/** The answer of a parametric item for an instance. Throws ExprError on a bad expression. */
export function paramAnswer(params: ItemParams, vars: Readonly<Record<string, number>>): number {
  return evaluate(params.answerExpr, vars);
}

/**
 * The item as the learner sees it for this instance: prompt rendered and answer recomputed.
 * Non-parametric items (or items without vars) are returned unchanged.
 */
export function instantiateItem<T extends Item>(item: T, vars?: Readonly<Record<string, number>>): T {
  if (!item.params || !vars || (item.kind !== "numeric" && item.kind !== "estimate")) return item;
  const answer = paramAnswer(item.params, vars);
  return { ...item, prompt: renderTemplate(item.prompt, vars), answer };
}

/** Lint helper (L009): problems with an item's params, [] when fine. */
export function checkParams(item: Item): string[] {
  if (!item.params) return [];
  if (item.kind !== "numeric" && item.kind !== "estimate")
    return ["params are allowed on numeric and estimate items only"];
  const errors: string[] = [];
  let value: number;
  try {
    value = paramAnswer(item.params, defaultVars(item.params));
  } catch (e) {
    return [`answerExpr: ${(e as Error).message}`];
  }
  const tol = item.kind === "numeric" ? (item.tolerance ?? 0) : 0;
  if (!(Math.abs(value - item.answer) <= Math.max(tol, 1e-9 * Math.max(1, Math.abs(item.answer)))))
    errors.push(`answerExpr gives ${formatNumber(value)} for the default instance, but answer is ${item.answer}`);
  for (const vars of allInstances(item.params)) {
    let v: number;
    try {
      v = paramAnswer(item.params, vars);
    } catch (e) {
      errors.push(`answerExpr: ${(e as Error).message}`);
      break;
    }
    if (!Number.isFinite(v)) {
      errors.push(`answerExpr is not finite for ${JSON.stringify(vars)}`);
      break;
    }
  }
  const missing = [...item.prompt.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
    .map((m) => m[1] as string)
    .filter((n) => !Object.hasOwn(item.params?.vars ?? {}, n));
  if (missing.length) errors.push(`prompt uses {${missing.join("}, {")}} but params.vars doesn't define it`);
  return errors;
}
