/**
 * Learner-facing word counts (L001/L001b) and plain-text helpers.
 * Story, quote and callout blocks count; math, code and audio blocks don't. Choice options longer
 * than 6 words count toward their hook or beat.
 */
import type { Block, Hook, Interaction, PackNode, Screen } from "../schema/index";
import { words } from "../words";

/** Words of the blocks that count toward a word cap. */
export function blockWords(blocks: readonly Block[] | undefined, lang: string): number {
  let n = 0;
  for (const b of blocks ?? []) {
    if (b.type === "story" || b.type === "callout" || b.type === "quote") n += words(b.text, lang);
  }
  return n;
}

/** Words of choice options longer than 6 words (they count toward the hook or beat). */
export function longOptionWords(ix: Interaction | Hook["interaction"], lang: string): number {
  if (ix.kind !== "choice") return 0;
  let n = 0;
  for (const o of ix.options) {
    const w = words(o.text, lang);
    if (w > 6) n += w;
  }
  return n;
}

export interface ScreenWords {
  id: string;
  blocks: number;
  prompt: number;
  reveal: number;
  options: number;
  /** blocks + prompt + reveal + options (a beat's L001 cap is 120). */
  total: number;
}

export interface CardWords {
  hook: { blocks: number; prompt: number; options: number; total: number };
  screens: ScreenWords[];
  /** max over close.text and every byGuess value, with {guess} counted as 2 words. */
  close: number;
  teaser: number;
  /** hook + Σ beats + close + teaser (L001b). Feedback, items, flashcards, faq, alts, toy, underTheHood excluded. */
  total: number;
}

/** Words of a close variant: `{guess}` stands for the learner's guess and counts as 2 words. */
export function closeTextWords(text: string, lang: string): number {
  const guesses = text.match(/\{guess\}/g)?.length ?? 0;
  return words(text.replace(/\{guess\}/g, " "), lang) + 2 * guesses;
}

/** Learner-facing words of one teach beat (a read-only beat counts its blocks only). */
export function screenWords(s: Screen, lang: string): ScreenWords {
  const blocks = blockWords(s.blocks, lang);
  const prompt = s.interaction ? words(s.interaction.prompt, lang) : 0;
  const reveal = s.reveal ? words(s.reveal.text, lang) : 0;
  const options = s.interaction ? longOptionWords(s.interaction, lang) : 0;
  return { id: s.id, blocks, prompt, reveal, options, total: blocks + prompt + reveal + options };
}

/** Learner-facing words of a card: the only word counter for lint, the AI pipeline and compile stats. */
export function cardWords(node: PackNode, lang: string): CardWords {
  const hb = blockWords(node.hook.blocks, lang);
  const hp = words(node.hook.interaction.prompt, lang);
  const ho = longOptionWords(node.hook.interaction, lang);
  const hook = { blocks: hb, prompt: hp, options: ho, total: hb + hp + ho };
  const screens = node.screens.map((s) => screenWords(s, lang));
  const variants = [node.close.text, ...Object.values(node.close.byGuess ?? {})];
  const close = Math.max(0, ...variants.map((t) => closeTextWords(t, lang)));
  const teaser = words(node.close.teaser, lang);
  const total = hook.total + screens.reduce((t, s) => t + s.total, 0) + close + teaser;
  return { hook, screens, close, teaser, total };
}

/** Inline Markdown → plain text (map teasers, flashcards, search). `==mark==` loses its markers. */
export function plainText(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
