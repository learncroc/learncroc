/**
 * Interactions, items, answers and grading (CONTRACTS §6).
 */
import { z } from "zod";
import { KeyPoint, requiredUnknown, VisualState, WidgetRef } from "./common";
import { AssetPath, ItemId, Markdown, Normalize, SelfRating } from "./primitives";

/** Feedback ≤ 25 words. */
export const OnWrong = z.strictObject({ misconception: z.string().optional(), feedback: Markdown.optional() });

const interactionBase = {
  id: ItemId,
  /** ≤ 40 words. */
  prompt: Markdown,
  /** Ask "how sure?" before checking (hooks, key items). */
  confidence: z.boolean().optional(),
  /** ≤ 20 words: the *why*. */
  feedbackRight: Markdown.optional(),
  /** Key = canonical answer string (option id / number as string / "default"). */
  onWrong: z.record(z.string(), OnWrong).optional(),
};

export const ChoiceOption = z.strictObject({
  id: z.string().min(1),
  text: Markdown,
  misconception: z.string().optional(),
  why: Markdown.optional(),
  /** The canvas acts out what this answer would mean (required on widget canvases, L019). */
  visualState: VisualState.optional(),
});

export const EstimateScale = z.strictObject({
  min: z.number(),
  max: z.number(),
  log: z.boolean().optional(),
  unit: z.string().optional(),
  label: z.string().optional(),
});

/** Graded on the host from the frame's last `report`. */
export const HtmlGoal = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("equals"),
    value: z.union([z.string(), z.number(), z.boolean()]),
    tolerance: z.number().optional(),
  }),
  z.strictObject({ kind: z.literal("range"), min: z.number(), max: z.number() }),
  z.strictObject({ kind: z.literal("set"), values: z.array(z.string()), match: z.enum(["any", "all", "exact"]) }),
]);

// ── built-in kinds (shapes without the shared base, reused by the fallback variants)

const choiceShape = {
  kind: z.literal("choice"),
  /** 2–5 options. No True/False (L018). */
  options: z.array(ChoiceOption).min(2).max(5),
  /** An option id; `multi` → string[]. */
  answer: z.union([z.string(), z.array(z.string())]),
  multi: z.boolean().optional(),
  shuffle: z.boolean().optional(),
};
const numericShape = {
  kind: z.literal("numeric"),
  answer: z.number(),
  /** Default 0. */
  tolerance: z.number().optional(),
  unit: z.string().optional(),
};
const estimateShape = {
  kind: z.literal("estimate"),
  scale: EstimateScale,
  answer: z.number(),
  accept: z.strictObject({ factor: z.number().optional(), abs: z.number().optional() }),
};
const textShape = {
  kind: z.literal("text"),
  accept: z.array(z.string()).min(1),
  /** Default ["case","punct","space"]. */
  normalize: z.array(Normalize).optional(),
  lang: z.string().optional(),
};
const orderShape = {
  kind: z.literal("order"),
  /** Authored in any order; shown shuffled. */
  items: z.array(Markdown).min(2),
  /** Indices of `items` in the correct order. */
  answer: z.array(z.number().int()),
};
const matchShape = {
  kind: z.literal("match"),
  left: z.array(Markdown),
  right: z.array(Markdown),
  answer: z.array(z.tuple([z.number().int(), z.number().int()])),
};
const clozeShape = {
  kind: z.literal("cloze"),
  /** Uses {{1}}, {{2}}… */
  text: Markdown,
  blanks: z.record(z.string(), z.strictObject({ accept: z.array(z.string()), tiles: z.array(z.string()).optional() })),
  normalize: z.array(Normalize).optional(),
};

const ChoiceInteraction = z.strictObject({ ...interactionBase, ...choiceShape });
const NumericInteraction = z.strictObject({ ...interactionBase, ...numericShape });
const EstimateInteraction = z.strictObject({ ...interactionBase, ...estimateShape });
const TextInteraction = z.strictObject({ ...interactionBase, ...textShape });
const OrderInteraction = z.strictObject({ ...interactionBase, ...orderShape });
const MatchInteraction = z.strictObject({ ...interactionBase, ...matchShape });
const ClozeInteraction = z.strictObject({ ...interactionBase, ...clozeShape });

/**
 * A built-in interaction used where a widget, html interactive or explain can't run
 * (a11y, old engines, offline explain). `id` is optional here.
 */
export const FallbackInteraction = z.discriminatedUnion("kind", [
  ChoiceInteraction.omit({ id: true }).extend({ id: ItemId.optional() }),
  NumericInteraction.omit({ id: true }).extend({ id: ItemId.optional() }),
  TextInteraction.omit({ id: true }).extend({ id: ItemId.optional() }),
  OrderInteraction.omit({ id: true }).extend({ id: ItemId.optional() }),
]);

/** widget.goal REQUIRED; `solution` must grade correct (L009). */
const WidgetInteraction = z.strictObject({
  ...interactionBase,
  kind: z.literal("widget"),
  widget: WidgetRef,
  solution: requiredUnknown("solution"),
  fallback: FallbackInteraction,
});
/** A sandboxed pack interactive graded on the host. */
const HtmlInteraction = z.strictObject({
  ...interactionBase,
  kind: z.literal("html"),
  asset: AssetPath,
  height: z.number(),
  alt: z.string(),
  goal: HtmlGoal,
  solution: requiredUnknown("solution"),
  fallback: FallbackInteraction,
});
/** Free text graded against key points (AI) or self-checked (offline). */
const ExplainInteraction = z.strictObject({
  ...interactionBase,
  kind: z.literal("explain"),
  keyPoints: z.array(KeyPoint).min(1),
  minHits: z.number().int().min(1),
  exemplar: Markdown,
  offline: FallbackInteraction,
});

const interactionVariants = [
  ChoiceInteraction,
  NumericInteraction,
  EstimateInteraction,
  TextInteraction,
  OrderInteraction,
  MatchInteraction,
  ClozeInteraction,
  WidgetInteraction,
  HtmlInteraction,
  ExplainInteraction,
] as const;

export const Interaction = z.discriminatedUnion("kind", [...interactionVariants]);

/** Hooks are always excluded from tuning and grading credit. */
export const HookInteraction = z.discriminatedUnion("kind", [
  ChoiceInteraction,
  EstimateInteraction,
  OrderInteraction,
  WidgetInteraction,
]);

/** Numeric and estimate only: fresh numbers per instance. */
export const ItemParams = z.strictObject({
  /** Candidate values per variable, e.g. { n: [200, 400, 900] }; the prompt uses {n}. */
  vars: z.record(z.string(), z.array(z.number()).min(1)),
  /** core/expr.ts expression over the vars; `answer` = its value for the first value of each var. */
  answerExpr: z.string().min(1),
});

const itemFields = {
  level: z.enum(["recall", "apply", "transfer"]),
  /** Seeds the Elo rating: 1 → -1.0 … 5 → +1.0. */
  difficulty: z.literal([1, 2, 3, 4, 5]),
  /** Default: both. Checkpoints only draw apply/transfer items whatever this says. */
  use: z.array(z.enum(["checkpoint", "relight"])).optional(),
  params: ItemParams.optional(),
  /** ≤ 25 words, shown after answering. */
  why: Markdown.optional(),
  /** The prompt calls back to this card's hook ("Remember the strawberry question?"). A checkpoint prefers one per attempt. */
  callback: z.boolean().optional(),
};

/** A bank item: an interaction plus tuning fields. */
export const Item = z.discriminatedUnion("kind", [
  ChoiceInteraction.extend(itemFields),
  NumericInteraction.extend(itemFields),
  EstimateInteraction.extend(itemFields),
  TextInteraction.extend(itemFields),
  OrderInteraction.extend(itemFields),
  MatchInteraction.extend(itemFields),
  ClozeInteraction.extend(itemFields),
  WidgetInteraction.extend(itemFields),
  HtmlInteraction.extend(itemFields),
  ExplainInteraction.extend(itemFields),
]);

/** Answers sent by the client (POST /runs/:id/attempts). */
export const AnswerValue = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choice"), selected: z.union([z.string(), z.array(z.string())]) }),
  z.object({ kind: z.literal("numeric"), value: z.number() }),
  z.object({ kind: z.literal("estimate"), value: z.number(), low: z.number().optional(), high: z.number().optional() }),
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("order"), order: z.array(z.number()) }),
  z.object({ kind: z.literal("match"), pairs: z.array(z.tuple([z.number(), z.number()])) }),
  z.object({ kind: z.literal("cloze"), values: z.record(z.string(), z.string()) }),
  /** Validated by the widget's answer schema. */
  z.object({ kind: z.literal("widget"), value: z.unknown() }),
  z.object({ kind: z.literal("html"), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]) }),
  /**
   * Always typed first: `text`. Offline: + selfRating (the client shows the exemplar and
   * core's matchKeywords() highlights). `tiles`/`choice` come from the offline fallback.
   */
  z.object({
    kind: z.literal("explain"),
    text: z.string().optional(),
    selfRating: SelfRating.optional(),
    choice: z.string().optional(),
    tiles: z.array(z.string()).optional(),
  }),
  /** "No idea yet" / "Not sure". */
  z.object({ kind: z.literal("idk") }),
]);

export const GradeResult = z.object({
  correct: z.boolean(),
  /** 0..1 partial credit. */
  score: z.number().min(0).max(1),
  misconception: z.string().optional(),
  feedback: Markdown.optional(),
  /** Shape of the matching answer, for review mode. */
  solution: z.unknown().optional(),
  /** explain: key point ids matched (AI verdict, or offline keyword match). */
  matched: z.array(z.string()).optional(),
});

export type OnWrong = z.infer<typeof OnWrong>;
export type ChoiceOption = z.infer<typeof ChoiceOption>;
export type EstimateScale = z.infer<typeof EstimateScale>;
export type HtmlGoal = z.infer<typeof HtmlGoal>;
export type FallbackInteraction = z.infer<typeof FallbackInteraction>;
export type Interaction = z.infer<typeof Interaction>;
export type HookInteraction = z.infer<typeof HookInteraction>;
export type ItemParams = z.infer<typeof ItemParams>;
export type Item = z.infer<typeof Item>;
export type AnswerValue = z.infer<typeof AnswerValue>;
export type GradeResult = z.infer<typeof GradeResult>;
