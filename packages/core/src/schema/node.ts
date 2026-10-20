/**
 * Node files: packs/<id>/nodes/<nodeId>.yaml. A node is one card on the map:
 * hook → guess → 2–3 teach beats (`screens`) → close → teaser, plus its item bank.
 *
 * Word limits in comments ("≤ N words") are enforced by lint, not by the schema.
 * Volume limits ("≥ 6 items") are the `curated` profile numbers; other profiles differ.
 */
import { z } from "zod";
import { Block, Visual } from "./blocks";
import { Provenance, Source, VisualState, WidgetRef } from "./common";
import { HookInteraction, Interaction, Item } from "./interactions";
import { AssetPath, GUESS_KEY_RE, ItemId, Markdown, NodeId, SCREEN_ID_RE } from "./primitives";

export const Misconception = z.strictObject({
  /** The wrong belief, stated as a belief. */
  label: z.string().min(1),
  /** Optional ancestor node id: the card a checkpoint miss points back to when it isn't the item's own card. */
  upstream: NodeId.optional(),
  /** ≤ 30 words, never states the answer. Feeds checkpoint hints and the offline croc. */
  hint: Markdown,
});

export const Hook = z.strictObject({
  /** Hook total ≤ 30 words: blocks + prompt + options longer than 6 words (L001). */
  blocks: z.array(Block).optional(),
  visual: Visual.optional(),
  /** Always excluded from tuning and grading credit; may set confidence: true. */
  interaction: HookInteraction,
  /** Option id commonly guessed → "Lots of people guess …". */
  lotsGuess: z.string().optional(),
  /** For the AI judge and analytics; not shown. */
  style: z.enum(["puzzle", "surprise", "what-would-you-do"]).optional(),
});

export const Close = z.strictObject({
  /** ≤ 60 words. Answers the exact hook ("Why…?" → "Because…"). May contain {guess}. Default variant. */
  text: Markdown,
  /** Guess key → a close that names that guess, ≤ 60 words each (keys: allowedGuessKeys, checked by L023). */
  byGuess: z
    .record(z.string().regex(GUESS_KEY_RE, "guess key: lowercase letters, digits and dashes"), Markdown)
    .optional(),
  /** ≤ 20 words; opens the next card's hook (the next card in map order). */
  teaser: Markdown,
});

export const Reveal = z.strictObject({
  /** ≤ 50 words, shown after answering; names what the canvas just did, doesn't re-explain it. */
  text: Markdown,
  speaker: z.string().optional(),
  /** Applied to the canvas after answering. */
  visualState: VisualState.optional(),
});

export const AltStrategy = z.enum(["simpler", "example", "analogy", "why", "story"]);

/** A teach beat. YAML key `screens`, run phase "screen"; designers say "beat". */
export const Screen = z.strictObject({
  /** /^s\d+(-[a-z0-9-]+)?$/, e.g. "s1-trace". */
  id: z.string().regex(SCREEN_ID_RE, "screen id: s<n> or s<n>-<slug>"),
  /** ≤ 1 new idea. */
  newIdea: z.string().optional(),
  /** An in-world character only (a waiter, a customer). No guides. */
  speaker: z.string().optional(),
  /** Canvas (the beat's illustration); ignored if interaction.kind is "widget" or "html". */
  visual: Visual.optional(),
  /** The beat's teaching text. Beat total ≤ 120 words: blocks + prompt + reveal + long options (L001). */
  blocks: z.array(Block),
  /** The beat's small action. Optional per beat; ≥ 1 beat per card has one (L006). */
  interaction: Interaction.optional(),
  /** Required when interaction is set (L006); forbidden otherwise. */
  reveal: Reveal.optional(),
  /** Each ≤ 60 words; the croc's offline "explain it differently" and "another example". */
  alts: z.partialRecord(AltStrategy, Markdown).optional(),
  /** Source ids, or paragraph ids ("p12") for pocket maps. */
  src: z.array(z.string()).optional(),
  confidence: z.enum(["sourced", "model"]).optional(),
});

// ── typed cards: when a node has `cards`, they ARE the stop, played in order.

export const CARD_ID_RE = /^[a-z][a-z0-9-]*$/;
const cardId = z.string().regex(CARD_ID_RE, "card id: lowercase letters, digits and dashes, starting with a letter");

/** Article opening (quote) + Moss lines; the player derives the questions list from the other stops' ask cards. */
export const IntroCard = z.strictObject({ type: z.literal("intro"), id: cardId, blocks: z.array(Block) });

/** A hunch chip on an ask card; never graded. */
export const Hunch = z.strictObject({ id: z.string().regex(GUESS_KEY_RE, "hunch id"), text: Markdown });

/** The stop's question. Hunches are optional chips, never graded. */
export const AskCard = z.strictObject({
  type: z.literal("ask"),
  id: cardId,
  blocks: z.array(Block).optional(),
  /** The headline question. */
  prompt: Markdown,
  hunches: z.array(Hunch).optional(),
});

/** Teaching text (+ optional canvas); read-only. */
export const TeachCard = z.strictObject({
  type: z.literal("teach"),
  id: cardId,
  blocks: z.array(Block),
  visual: Visual.optional(),
  alts: z.partialRecord(AltStrategy, Markdown).optional(),
  src: z.array(z.string()).optional(),
  confidence: z.enum(["sourced", "model"]).optional(),
});

/** Graded like a beat: retry, hints, worked answer after 2 misses. */
export const TryCard = z.strictObject({
  type: z.literal("try"),
  id: cardId,
  blocks: z.array(Block).optional(),
  visual: Visual.optional(),
  interaction: Interaction,
  reveal: Reveal.optional(),
});

/** One shot: any answer is recorded and the card is done; feedback for every option is shown. */
export const CheckCard = z.strictObject({
  type: z.literal("check"),
  id: cardId,
  blocks: z.array(Block).optional(),
  interaction: Interaction,
  reveal: Reveal.optional(),
});

/** The answer to an ask card (≤ 60 words, "Because…"); `byHunch` keys: hunch id | "idk" | "typed". */
export const TakeawayCard = z.strictObject({
  type: z.literal("takeaway"),
  id: cardId,
  /** The ask card id this answers. */
  answers: z.string().optional(),
  text: Markdown,
  byHunch: z.record(z.string(), Markdown).optional(),
  teaser: Markdown.optional(),
});

export const Card = z.discriminatedUnion("type", [IntroCard, AskCard, TeachCard, TryCard, CheckCard, TakeawayCard]);
export const CardType = z.enum(["intro", "ask", "teach", "try", "check", "takeaway"]);

/** A spaced-repetition flashcard (FSRS). Never called a "card" in the UI. */
export const Flashcard = z.strictObject({
  id: ItemId,
  kind: z.enum(["qa", "cloze"]),
  /** ≤ 20 words; cloze uses {{answer}} once. */
  front: Markdown,
  /** ≤ 25 words. */
  back: Markdown,
  visual: z.strictObject({ kind: z.literal("figure"), asset: AssetPath, alt: z.string() }).optional(),
});

export const PackNode = z
  .strictObject({
    id: NodeId,
    /** ≤ 6 words; must not give the close away (L005). */
    title: z.string().min(1),
    /** One line on the card's peek. */
    tagline: z.string().optional(),
    /** 2–4. */
    estMinutes: z.number().positive(),
    /** For authors, the croc and lint; never shown as a reading block. */
    bigIdea: z.string().min(1),
    /** 1–3, observable verbs. */
    objectives: z.array(z.string()).min(1),
    /** Shared concept ids for cross-pack bridges, e.g. "llm.attention". */
    concepts: z.array(z.string()).optional(),
    renamedFrom: z.array(NodeId).optional(),
    /** Anchor visual for beats without their own. */
    visual: Visual.optional(),
    /** Key = misconception id. */
    misconceptions: z.record(z.string(), Misconception),
    hook: Hook,
    /** 2–3 beats (L006); the schema allows 1–3 so that drafts parse. */
    screens: z.array(Screen).min(1).max(3),
    close: Close,
    /** Typed cards. When present they are THE stop (played in order); hook/screens/close are derived (legacyFromCards). */
    cards: z.array(Card).min(1).optional(),
    /** ≥ 6 with ≥ 3 level "transfer" (curated/sampler/pocket); community ≥ 4 / ≥ 2 (L011). */
    items: z.array(Item),
    /** 3–6; generated from recall items when omitted. */
    flashcards: z.array(Flashcard).optional(),
    /** Parked. Explore mode, goal omitted; prompt ≤ 20 words. */
    toy: z.strictObject({ widget: WidgetRef, prompt: z.string() }).optional(),
    /** ≤ 200 words; the croc's offline "go deeper". */
    underTheHood: z
      .strictObject({ title: z.string(), body: Markdown, sources: z.array(z.string()).optional() })
      .optional(),
    /** ≤ 3; the croc's offline answers; a ≤ 60 words. */
    faq: z.array(z.strictObject({ q: z.string(), a: Markdown })).optional(),
    /** ≥ 1 unless every claim is confidence "model". */
    sources: z.array(Source),
    /** "reviewed" requires a pack.lock.yaml review covering this file (L017). */
    status: z.enum(["draft", "reviewed"]),
    /** AI-generated nodes. */
    provenance: Provenance.optional(),
    grounding: z.strictObject({ checked: z.boolean(), unsupported: z.number() }).optional(),
  })
  .meta({
    title: "learncroc card",
    description: "One card: hook → guess → 2–3 teach beats → close → teaser, plus its item bank.",
  });

export type Misconception = z.infer<typeof Misconception>;
export type Hook = z.infer<typeof Hook>;
export type Close = z.infer<typeof Close>;
export type Reveal = z.infer<typeof Reveal>;
export type AltStrategy = z.infer<typeof AltStrategy>;
export type Screen = z.infer<typeof Screen>;
export type Flashcard = z.infer<typeof Flashcard>;
export type IntroCard = z.infer<typeof IntroCard>;
export type Hunch = z.infer<typeof Hunch>;
export type AskCard = z.infer<typeof AskCard>;
export type TeachCard = z.infer<typeof TeachCard>;
export type TryCard = z.infer<typeof TryCard>;
export type CheckCard = z.infer<typeof CheckCard>;
export type TakeawayCard = z.infer<typeof TakeawayCard>;
export type Card = z.infer<typeof Card>;
export type CardType = z.infer<typeof CardType>;
export type PackNode = z.infer<typeof PackNode>;
