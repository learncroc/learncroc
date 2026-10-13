/**
 * Text matching for typed answers (dialogue replies, listen "type"). Pure, no React.
 * Normalisers follow the core `Normalize` enum: case, accents, punct, space, articles.
 */
import type { Normalize } from "@learncroc/core";

/** Accent-tolerant default for typed production turns. */
export const TYPED_DEFAULT: readonly Normalize[] = ["case", "accents", "punct", "space"];

const ARTICLES = new Set([
  // English
  "a",
  "an",
  "the",
  // Spanish
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  // French
  "le",
  "les",
  "une",
  "des",
]);

/** Apply the normalisers in a fixed order (case → accents → punct → articles → space). */
export function normalizeText(input: string, normalize: readonly Normalize[]): string {
  let s = input.normalize("NFC");
  const has = (n: Normalize) => normalize.includes(n);
  if (has("case")) s = s.toLocaleLowerCase();
  if (has("accents"))
    s = s
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .normalize("NFC");
  if (has("punct")) s = s.replace(/[\p{P}\p{S}]+/gu, " ");
  if (has("articles")) {
    s = s
      .split(/\s+/)
      .filter((w) => !ARTICLES.has(w.toLocaleLowerCase()))
      .join(" ");
  }
  if (has("space") || has("punct") || has("articles")) s = s.replace(/\s+/g, " ").trim();
  return s;
}

export interface TextMatch {
  matched: boolean;
  /** The accepted form that matched, if any. */
  accepted?: string;
  /** Matched only after accents were ignored although they would otherwise count: worth a gentle note. */
  accentSlip?: boolean;
}

/** Does `text` match any accepted form under `normalize`? Reports accent slips when accents are tolerated. */
export function matchText(text: string, accept: readonly string[], normalize: readonly Normalize[]): TextMatch {
  const n = normalizeText(text, normalize);
  if (n.length === 0) return { matched: false };
  for (const a of accept) {
    if (normalizeText(a, normalize) === n) {
      if (normalize.includes("accents")) {
        const strict = normalize.filter((x) => x !== "accents");
        const slip = normalizeText(a, strict) !== normalizeText(text, strict);
        return { matched: true, accepted: a, accentSlip: slip };
      }
      return { matched: true, accepted: a };
    }
  }
  return { matched: false };
}
