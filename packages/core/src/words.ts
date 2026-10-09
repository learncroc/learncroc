/**
 * The language-aware word counter used by lint (word caps) and stats.
 * Code blocks and inline code don't count; inline maths counts as one word.
 * Lint passes the pack's `lang` (or `targetLang` for target-language text such as dialogue lines).
 */
export function words(s: string, lang = "en"): number {
  const text = s
    .replace(/```[\s\S]*?```/g, " ") // code blocks don't count
    .replace(/`[^`]*`/g, " ") // inline code doesn't count
    .replace(/\$[^$]*\$/g, " N ") // inline math counts as one word
    .replace(/[*_#>[\]()]/g, " ");
  const seg = new Intl.Segmenter(lang, { granularity: "word" });
  let n = 0;
  for (const part of seg.segment(text)) if (part.isWordLike) n++;
  return n;
}
