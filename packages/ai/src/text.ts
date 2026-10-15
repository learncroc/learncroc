/**
 * Small text utilities shared by guards, the pipelines and the fake provider.
 */
import { words } from "@learncroc/core";

export { words };

/** Split prose into sentences (good enough for English article text and model replies). */
export function sentences(text: string): string[] {
  return (text.replace(/\s+/g, " ").match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The first n words of a text, ending cleanly. */
export function clip(text: string, maxWords: number): string {
  const parts = text.trim().split(/\s+/);
  if (parts.length <= maxWords) return text.trim();
  return `${parts
    .slice(0, maxWords)
    .join(" ")
    .replace(/[,;:]$/, "")}…`;
}

/** Cut a text to at most maxWords at the last full sentence; falls back to a word cut. */
export function cutAtSentence(text: string, maxWords: number, lang = "en"): string {
  const out: string[] = [];
  let n = 0;
  for (const s of sentences(text)) {
    const w = words(s, lang);
    if (n + w > maxWords) break;
    out.push(s);
    n += w;
  }
  return out.length > 0 ? out.join(" ") : clip(text, maxWords);
}

/** "Attention Is All You Need" → "attention-is-all-you-need" (NodeId-safe, ≤ maxLen). */
export function slug(text: string, maxLen = 40): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return s || "stop";
}

/** Case-, accent- and punctuation-insensitive form for comparisons. */
export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim();
}

/** Deterministic 32-bit hash (FNV-1a), for seeding and cache keys. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Title Case for short labels. */
export function titleCase(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

const STOP = new Set(
  "a an the and or but of to in on at for with by from as is are was were be been being it its this that these those which who whom whose what when where why how not no can could would should will may might must do does did has have had their there they them he she his her we our you your i me my than then so such into over about also more most many much some any each other one two".split(
    " ",
  ),
);

/** Content words of a text, most frequent first (fake provider and keyword hints). */
export function keywords(text: string, max = 6): string[] {
  const counts = new Map<string, number>();
  for (const w of norm(text)
    .replace(/\.(?!\d)/g, " ")
    .split(/\s+/)) {
    if (w.length < 4 || STOP.has(w) || /^\d/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}
