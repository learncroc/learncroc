import type { AnswerValue, Confidence } from "@learncroc/core";
import type { Ask } from "../content";

/** The last graded attempt on an ask, as far as the input needs to know. */
export interface LastAttempt {
  answer: AnswerValue;
  correct: boolean;
  /** Second miss (or a reveal): the input may show the worked solution. */
  showSolution: boolean;
  /** Attempts so far on this ask. */
  attempts: number;
}

export interface InputProps<A extends Ask = Ask> {
  ask: A;
  vars?: Record<string, number>;
  /** No more input: submitting, or answered right. */
  locked: boolean;
  /** Partial state restored from run scratch. */
  draft?: unknown;
  onDraft?: (draft: unknown) => void;
  onSubmit: (answer: AnswerValue, confidence?: Confidence) => void;
  last?: LastAttempt;
  /** This ask owns the digit keys right now. */
  keysActive: boolean;
  /** Ask "how sure?" before checking. */
  confidence?: boolean;
  /** "No idea yet" (hooks) / "Not sure" (placement). */
  idk?: string;
  /** Label of the commit control, e.g. "Check" or "Lock in my guess". */
  submitLabel: string;
  /** For seeded shuffles that survive a refresh. */
  seed: string;
  /** Element id for the prompt (aria-labelledby). */
  promptId: string;
}

/** Deterministic shuffle from a string seed (mulberry32). */
export function seededOrder(n: number, seed: string): number[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i] as number;
    order[i] = order[j] as number;
    order[j] = tmp;
  }
  // Never present an "ordering" question already solved.
  if (n > 1 && order.every((v, i) => v === i)) order.push(order.shift() as number);
  return order;
}

/** Parse a typed number: "1,200", "0.5", "-3", "1 200", ",5" (decimal comma when unambiguous). */
export function parseNumber(raw: string): number | undefined {
  let s = raw.trim().replace(/[\s  ]/g, "");
  if (!s) return undefined;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d*,\d+$/.test(s)) s = s.replace(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
