/**
 * Text helpers for typed answers. None of this grades (the server is the only grading path): it
 * highlights key-point keywords next to the exemplar offline, and turns a near miss into a kind hint.
 */
import type { KeyPoint, Normalize } from "@learncroc/core";
import { matchKeywords as coreMatchKeywords } from "@learncroc/core/grade";

export interface KeywordMatch {
  /** Key point ids with at least one keyword present. */
  matched: string[];
  /** Ranges [start, end) in the original text to highlight, sorted and merged. */
  ranges: [number, number][];
}

/**
 * Key-point keyword matching, the same function the server uses for offline explain grading (case-
 * and accent-insensitive, whole words), shaped for highlighting.
 */
export function matchKeywords(text: string, keyPoints: KeyPoint[], lang = "en"): KeywordMatch {
  const hits = coreMatchKeywords(text, keyPoints, lang);
  const matchedSet = new Set(hits.map((h) => h.keyPoint));
  const matched = keyPoints.filter((k) => matchedSet.has(k.id)).map((k) => k.id);
  const ranges: [number, number][] = [];
  for (const h of hits) {
    const last = ranges[ranges.length - 1];
    if (last && h.start <= last[1]) last[1] = Math.max(last[1], h.end);
    else ranges.push([h.start, h.end]);
  }
  return { matched, ranges };
}

/** Split text into plain and highlighted segments. */
export function segments(text: string, ranges: [number, number][]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

const ARTICLES = /\b(the|a|an|el|la|los|las|un|una|unos|unas|le|les|der|die|das)\b/g;

/** Apply the authored normalisations (default case, punct, space). */
export function normalizeText(s: string, rules: Normalize[] = ["case", "punct", "space"]): string {
  let out = s;
  if (rules.includes("accents")) out = out.normalize("NFD").replace(/\p{M}/gu, "");
  if (rules.includes("case")) out = out.toLowerCase();
  if (rules.includes("punct")) out = out.replace(/[\p{P}\p{S}]/gu, " ");
  if (rules.includes("articles")) out = out.replace(ARTICLES, " ");
  if (rules.includes("space") || rules.includes("punct") || rules.includes("articles")) {
    out = out.replace(/\s+/g, " ").trim();
  }
  return out;
}

/**
 * After the server marks a typed answer wrong: was it only the accents? Returns the accepted spelling
 * to show as a gentle hint ("Nearly: check the accents"), or undefined.
 */
export function accentHint(value: string, accept: string[], rules?: Normalize[]): string | undefined {
  const withAccents = (rules ?? ["case", "punct", "space"]).filter((r) => r !== "accents");
  const loose: Normalize[] = [...withAccents, "accents"];
  const v = normalizeText(value, loose);
  if (!v) return undefined;
  for (const a of accept) {
    if (normalizeText(a, loose) === v && normalizeText(a, withAccents) !== normalizeText(value, withAccents)) return a;
  }
  return undefined;
}

/** Word count for typed explanations (soft guidance only). */
export function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}
