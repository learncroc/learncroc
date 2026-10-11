/**
 * Text overlap helpers for the hook, interactivity and new-situation checks (L005, L006, L011):
 * normalised word tokens, content words, phrase containment and the longest shared run of words.
 * Pure and language-light: English and Spanish stop words; other languages fall back to all words.
 */
import { plainText } from "../compile/text";

const STOP: Record<string, ReadonlySet<string>> = {
  en: new Set(
    (
      "a an the of to in on at for and or but nor is are was were be been being am it its it's this that these those " +
      "with as by from into onto than then so do does did not no you your yours i me my we us our they them their he him " +
      "his she her what which who whom whose how why when where there here can could would should will shall may might " +
      "must just only very more most some any all each both also if about over under out up down off such too " +
      "let's that's they're isn't aren't don't doesn't didn't won't can't you're we're i'm"
    ).split(" "),
  ),
  es: new Set(
    (
      "el la los las lo un una unos unas de del al a y e o u ni que en es son era fue ser por para con sin no se su sus " +
      "como más pero si sí ya muy este esta estos estas ese esa eso qué cuál cómo dónde cuándo quién le les me te nos mi tu"
    ).split(" "),
  ),
};

const stopFor = (lang: string) => STOP[lang.slice(0, 2).toLowerCase()];

/** Normalised word tokens: plain text, lower case, no accents, thousands separators dropped, "6.4" kept whole. */
export function tokens(md: string): string[] {
  const text = plainText(md)
    .replace(/\{guess\}/g, " ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/(\d)[,\u00a0\u202f](?=\d{3}\b)/g, "$1");
  return text.match(/[\p{L}\p{N}]+(?:['.][\p{L}\p{N}]+)*/gu) ?? [];
}

/** Whether a token carries meaning: not a stop word, and two or more characters (or a number). */
export function isContentWord(token: string, lang: string): boolean {
  if (/\d/.test(token)) return true;
  if (token.length < 2) return false;
  return !stopFor(lang)?.has(token);
}

export function contentWords(toks: readonly string[], lang: string): string[] {
  return toks.filter((t) => isContentWord(t, lang));
}

/** `needle` appears as a contiguous run inside `hay`. */
export function containsRun(hay: readonly string[], needle: readonly string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Length of the longest run of words the two token lists share. */
export function longestSharedRun(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        const v = (prev[j - 1] ?? 0) + 1;
        cur[j] = v;
        if (v > best) best = v;
      }
    }
    prev = cur;
  }
  return best;
}

/** The longest shared run itself (for messages), as text. */
export function sharedRunText(a: readonly string[], b: readonly string[]): string {
  let best = 0;
  let end = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        const v = (prev[j - 1] ?? 0) + 1;
        cur[j] = v;
        if (v > best) {
          best = v;
          end = i;
        }
      }
    }
    prev = cur;
  }
  return a.slice(end - best, end).join(" ");
}

/** Numbers written in a text ("1,000", "6.4", "40%" → 1000, 6.4, 40). */
export function numbersIn(md: string): number[] {
  return tokens(md)
    .filter((t) => /^\d+(?:\.\d+)?$/.test(t))
    .map(Number);
}
