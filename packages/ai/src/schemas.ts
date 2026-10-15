/**
 * LLM-facing output schemas. They are deliberately flat (arrays instead of records, nullable
 * instead of optional, no regex or length rules) so every provider's structured-output mode can
 * follow them; host code converts them into the contract types (PackNode, ExplainGrade, …) and the
 * deterministic checks (zod contracts, word caps, widget validation) do the strict part.
 */
import { z } from "zod";

// ── runtime features

export const ExplainGradeDraft = z.object({
  /** Key point ids expressed by the learner. */
  hit: z.array(z.string()),
  missing: z.string().nullable(),
  misconception: z.string().nullable(),
  feedback: z.string(),
});

export const HintDraft = z.object({ hint: z.string() });

export const OptionDraft = z.object({
  text: z.string(),
  correct: z.boolean(),
  misconception: z.string().nullable(),
});

export const ItemDraft = z.object({
  kind: z.enum(["choice", "numeric", "order", "text"]),
  prompt: z.string(),
  /** choice: 3–4 options, exactly one correct. */
  options: z.array(OptionDraft),
  /** order: the steps in the correct order. */
  steps: z.array(z.string()),
  numericAnswer: z.number().nullable(),
  tolerance: z.number().nullable(),
  unit: z.string().nullable(),
  /** text: accepted answers. */
  accept: z.array(z.string()),
  level: z.enum(["recall", "apply", "transfer"]),
  difficulty: z.number().int(),
  feedbackRight: z.string().nullable(),
  why: z.string().nullable(),
  /** The prompt calls back to the card's hook ("Remember the … question?"). */
  callback: z.boolean(),
});

export const QuizVariantDraft = z.object({ item: ItemDraft });

export const SolverAnswer = z.object({
  choice: z.string().nullable(),
  number: z.number().nullable(),
  order: z.array(z.number().int()).nullable(),
  text: z.string().nullable(),
});

export const CardDraftsDraft = z.object({
  cards: z.array(
    z.object({
      front: z.string(),
      back: z.string(),
      kind: z.enum(["qa", "cloze"]),
      reason: z.enum(["used-to-think", "misconception", "close"]),
    }),
  ),
});

// ── create (article maps)

export const HookStyleDraft = z.enum(["puzzle", "surprise", "what-would-you-do"]);

export const SkeletonNodeDraft = z.object({
  id: z.string(),
  title: z.string(),
  landmark: z.string(),
  objective: z.string(),
  keyPoints: z.array(z.string()),
  paras: z.array(z.string()),
  hookIdea: z.string(),
  hookStyle: HookStyleDraft.nullable(),
  misconceptions: z.array(z.object({ id: z.string(), label: z.string() })),
  caution: z.string().nullable(),
  requires: z.array(z.string()),
});

/** Field order matters: cards stream (in reading order) before edges. */
export const SkeletonDraft = z.object({
  title: z.string(),
  gist: z.string(),
  palette: z.array(z.string()),
  nodes: z.array(SkeletonNodeDraft),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
});

/** A wrong option explains itself: `why` is shown on the first miss. */
export const ActionOptionDraft = OptionDraft.extend({ why: z.string().nullable() });

/** A beat's action: the small hands-on step. */
export const ActionDraft = z.object({
  kind: z.enum(["choice", "sort", "order", "numeric"]),
  prompt: z.string(),
  options: z.array(ActionOptionDraft),
  buckets: z.array(z.object({ label: z.string(), cards: z.array(z.string()) })),
  steps: z.array(z.string()),
  numericAnswer: z.number().nullable(),
  tolerance: z.number().nullable(),
  unit: z.string().nullable(),
  feedbackRight: z.string().nullable(),
  /** ≤ 25 words, shown after the action: names what just happened. */
  reveal: z.string(),
});

export const ContrastDraft = z.object({
  a: z.object({ label: z.string(), text: z.string() }),
  b: z.object({ label: z.string(), text: z.string() }),
});

/**
 * One teach beat, told by Moss: a lead-in line, the source's own words (a verbatim passage), Moss's
 * plain-words line, an optional closing line and an optional action (a Try, or the card's Check).
 */
export const BeatDraft = z.object({
  /** The beat's one idea in a plain line (≤ 12 words). */
  idea: z.string(),
  /** ≤ 35 words: Moss sets the scene and hands over to the source. */
  lead: z.string(),
  /** 40–120 words copied exactly, sentence for sentence, from ONE of `paras`, or null (a Check-only beat, or no source text). */
  passage: z.string().nullable(),
  /** ≤ 80 words: Moss says the passage again in plain words, with a concrete example. */
  plain: z.string(),
  /** ≤ 35 words: Moss's closing line that leads into the action or the next beat, or "". */
  aside: z.string(),
  paras: z.array(z.string()),
  action: ActionDraft.nullable(),
  figure: z.object({ description: z.string(), labels: z.array(z.string()) }),
  contrast: ContrastDraft,
});

/** One of the three hook variants. */
export const HookVariantDraft = z.object({
  style: HookStyleDraft,
  /** ≤ 12 words of scene, or "". */
  setup: z.string(),
  /** ≤ 18 words, a question a newcomer can guess at. */
  prompt: z.string(),
  /** 3–4 short options (≤ 6 words each), exactly one correct. */
  options: z.array(OptionDraft),
  /** Index of the wrong option lots of people pick, or null. */
  lotsGuess: z.number().int().nullable(),
  /** One close per option (index), ≤ 60 words, naming that guess and answering the hook. */
  closeByGuess: z.array(z.object({ option: z.number().int(), text: z.string() })),
});

/** A stop as hook variants + beats (what author-node writes for curated builds). */
export const BeatWriteDraft = z.object({
  hooks: z.array(HookVariantDraft),
  beats: z.array(BeatDraft),
  close: z.object({
    /** ≤ 60 words, answers the hook ("Why…?" → "Because…"); guess-free. Mark the key phrase ==like this==. */
    text: z.string(),
    /** ≤ 60 words, for "No idea yet". */
    idk: z.string(),
  }),
  /** ≤ 20 words; opens the next card's hook idea. */
  teaser: z.string(),
  items: z.array(ItemDraft),
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
  misconceptions: z.array(z.object({ id: z.string(), label: z.string(), hint: z.string() })),
  /** Factual claims in the card, each tied to the paragraph that supports it. */
  claims: z.array(z.object({ text: z.string(), para: z.string() })),
  /** 0–3 side questions a learner might ask on the way, answered by Moss in ≤ 60 words. */
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
});

/**
 * One typed card of a stop, flat (every field present; unused ones empty or null). Which fields a
 * type uses:
 * - ask: say (optional scene), prompt (the headline question), hunches (optional chips, never graded);
 * - teach: say (lead-in), passage + paras (verbatim, quoted), plain (Moss in plain words), idea, figure, contrast;
 * - try / check: say (set-up), action (check: a choice on a NEW situation, a why on every wrong option);
 * - takeaway: text (answers the ask, "Because…"), byHunch (one line per hunch index), idk.
 */
export const StopCardDraft = z.object({
  type: z.enum(["ask", "teach", "try", "check", "takeaway"]),
  /** Moss's lines before the card's content, ≤ 35 words each. */
  say: z.array(z.string()),
  /** ask: ≤ 18 words, the question to hold onto. Others: "". */
  prompt: z.string(),
  /** ask: 0 or 2–3 hunches, ≤ 6 words each. */
  hunches: z.array(z.string()),
  /** teach: 40–120 words copied exactly from ONE of `paras`, or null. */
  passage: z.string().nullable(),
  paras: z.array(z.string()),
  /** teach: ≤ 80 words, Moss says the passage again in plain words. */
  plain: z.string(),
  /** teach: the card's one idea in a plain line (≤ 12 words). */
  idea: z.string(),
  /** try / check: the hands-on step. */
  action: ActionDraft.nullable(),
  /** teach: one simple diagram of the idea (drawn later). */
  figure: z.object({ description: z.string(), labels: z.array(z.string()) }).nullable(),
  /** teach / try: two contrasting panels, the visual until a figure is drawn. */
  contrast: ContrastDraft.nullable(),
  /** takeaway: ≤ 60 words, answers the ask. */
  text: z.string(),
  /** takeaway: one line per hunch (index into the ask's hunches), ≤ 60 words, naming it. */
  byHunch: z.array(z.object({ hunch: z.number().int(), text: z.string() })),
  /** takeaway: ≤ 60 words, for "No idea yet". */
  idk: z.string(),
});

/** What create-card writes for one stop: an ordered list of typed cards plus the stop's practice. */
export const CardWriteDraft = z.object({
  cards: z.array(StopCardDraft),
  /** ≤ 20 words; opens the next stop's hook idea. */
  teaser: z.string(),
  items: z.array(ItemDraft),
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
  misconceptions: z.array(z.object({ id: z.string(), label: z.string(), hint: z.string() })),
  /** Factual claims in the stop, each tied to the paragraph that supports it. */
  claims: z.array(z.object({ text: z.string(), para: z.string() })),
  /** 0–3 side questions a learner might ask on the way, answered by Moss in ≤ 60 words. */
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
});

/** card-judge: one call per card, smart tier. */
export const CardJudgeDraft = z.object({
  /** Index of the best hook variant (0–2). */
  hook: z.number().int(),
  /** The close (and every byGuess) answers that hook's exact question. */
  closeAnswersHook: z.boolean(),
  /** Indexes of claims their paragraph does not support. */
  unsupportedClaims: z.array(z.number().int()),
  /** The title or the chosen hook gives the close away. */
  giveaway: z.boolean(),
  /** The teaser could open the next card's hook idea (true when there is no next card). */
  teaserOpensNext: z.boolean(),
  /** One line per problem, written as a fix ("the close explains X, but the hook asks Y"). */
  problems: z.array(z.string()),
  /** One line per Moss line that breaks the voice (exclamation, "most people", hype, a claim not in its passage), written as a fix. */
  voiceProblems: z.array(z.string()),
});

/** card-teaser: a teaser that opens the next card's (final) hook. */
export const TeaserDraft = z.object({ teaser: z.string() });

/** card-split: the second half of an over-long card gets its own hook, close and teaser. */
export const CardSplitDraft = z.object({
  /** Beat index the second card starts at (1 or 2). */
  splitAt: z.number().int(),
  first: z.object({ close: z.string(), idk: z.string(), teaser: z.string() }),
  second: z.object({
    title: z.string(),
    hook: HookVariantDraft,
    close: z.string(),
    idk: z.string(),
    teaser: z.string(),
  }),
});

/** convert-card: fills the close variants and the teaser of a converted card. */
export const ConvertCardDraft = z.object({
  close: z.string(),
  byGuess: z.array(z.object({ key: z.string(), text: z.string() })),
  teaser: z.string(),
});

export const FigureDraft = z.object({ svg: z.string(), alt: z.string() });

// ── learncroc build (authoring)

export const AuthorPlanDraft = z.object({
  lines: z.array(z.object({ id: z.string(), title: z.string(), outcome: z.string() })),
  /** Cards only, in reading order: checkpoints are placed in code. */
  nodes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      line: z.string(),
      requires: z.array(z.string()),
      bigIdea: z.string(),
      hookIdea: z.string(),
      objectives: z.array(z.string()),
      misconceptions: z.array(z.object({ id: z.string(), label: z.string(), upstream: z.string().nullable() })),
      sources: z.array(z.string()),
    }),
  ),
});

/** author-node: the card shape plus a tagline and FAQ (items come from author-practice). */
export const AuthorNodeDraft = BeatWriteDraft.extend({
  tagline: z.string(),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
});

export const AuthorPracticeDraft = z.object({
  items: z.array(
    ItemDraft.extend({
      params: z
        .object({ vars: z.array(z.object({ name: z.string(), values: z.array(z.number()) })), answerExpr: z.string() })
        .nullable(),
    }),
  ),
  cards: z.array(z.object({ front: z.string(), back: z.string() })),
});

export type ExplainGradeDraft = z.infer<typeof ExplainGradeDraft>;
export type HintDraft = z.infer<typeof HintDraft>;
export type OptionDraft = z.infer<typeof OptionDraft>;
export type ItemDraft = z.infer<typeof ItemDraft>;
export type QuizVariantDraft = z.infer<typeof QuizVariantDraft>;
export type SolverAnswer = z.infer<typeof SolverAnswer>;
export type CardDraftsDraft = z.infer<typeof CardDraftsDraft>;
export type SkeletonNodeDraft = z.infer<typeof SkeletonNodeDraft>;
export type SkeletonDraft = z.infer<typeof SkeletonDraft>;
export type ActionOptionDraft = z.infer<typeof ActionOptionDraft>;
export type ActionDraft = z.infer<typeof ActionDraft>;
export type ContrastDraft = z.infer<typeof ContrastDraft>;
export type BeatDraft = z.infer<typeof BeatDraft>;
export type HookVariantDraft = z.infer<typeof HookVariantDraft>;
export type BeatWriteDraft = z.infer<typeof BeatWriteDraft>;
export type StopCardDraft = z.infer<typeof StopCardDraft>;
export type CardWriteDraft = z.infer<typeof CardWriteDraft>;
export type CardJudgeDraft = z.infer<typeof CardJudgeDraft>;
export type TeaserDraft = z.infer<typeof TeaserDraft>;
export type CardSplitDraft = z.infer<typeof CardSplitDraft>;
export type ConvertCardDraft = z.infer<typeof ConvertCardDraft>;
export type FigureDraft = z.infer<typeof FigureDraft>;
export type AuthorPlanDraft = z.infer<typeof AuthorPlanDraft>;
export type AuthorNodeDraft = z.infer<typeof AuthorNodeDraft>;
export type AuthorPracticeDraft = z.infer<typeof AuthorPracticeDraft>;
