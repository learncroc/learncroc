/**
 * token-splitter: type text and see it split into tokens with ids (cl100k_base via gpt-tokenizer,
 * loaded with the widget chunk). Predict token counts, craft strings, tap a token.
 */
import type { GradeResult } from "@learncroc/core";
import { graded } from "../shared/spec-helpers";
import { type WidgetSpec, z } from "../shared/zod";
import { tokenCount, tokenIds, tokenizerReady, tokenPieces, wordCount } from "./tokenize";

export const TokenSplitterProps = z.strictObject({
  /** Initial text. */
  text: z.string(),
  editable: z.boolean(),
  showIds: z.boolean(),
  encoding: z.literal("cl100k_base"),
  /** Substring to emphasise. */
  highlight: z.string().optional(),
});

export const TokenSplitterGoal = z.discriminatedUnion("kind", [
  /** Predict the token count of `text` before seeing it. */
  z.strictObject({ kind: z.literal("count"), text: z.string(), tolerance: z.number() }),
  z.strictObject({
    kind: z.literal("craft"),
    minTokens: z.number().int().optional(),
    maxTokens: z.number().int().optional(),
    maxWords: z.number().int().optional(),
    mustInclude: z.string().optional(),
  }),
  /** Tap the token at `index` in `text`'s split. */
  z.strictObject({ kind: z.literal("pick-token"), text: z.string(), index: z.number().int() }),
  /** Mark where the tokenizer cuts `text`; the reveal shows the real cl100k split. */
  z.strictObject({ kind: z.literal("split"), text: z.string() }),
]);

export const TokenSplitterAnswer = z.object({
  count: z.number().optional(),
  text: z.string().optional(),
  index: z.number().optional(),
  /** split: character indices where a new token starts (0 and text.length excluded). */
  boundaries: z.array(z.number().int()).optional(),
});

export type TokenSplitterProps = z.infer<typeof TokenSplitterProps>;
export type TokenSplitterGoal = z.infer<typeof TokenSplitterGoal>;
export type TokenSplitterAnswer = z.infer<typeof TokenSplitterAnswer>;

/** Max characters of a split goal's text: the word is laid out one cell per character, so it must fit a card. */
export const SPLIT_MAX_CHARS = 32;

/** Max characters the learner may type (keeps tokenising instant). */
export const TOKEN_SPLITTER_MAX_CHARS = 400;

export interface CraftCheck {
  id: "minTokens" | "maxTokens" | "maxWords" | "mustInclude";
  label: string;
  ok: boolean;
}

/** Each craft constraint and whether `text` meets it. */
export function craftChecks(goal: Extract<TokenSplitterGoal, { kind: "craft" }>, text: string): CraftCheck[] {
  const tokens = tokenCount(text);
  const words = wordCount(text);
  const out: CraftCheck[] = [];
  if (goal.minTokens !== undefined)
    out.push({ id: "minTokens", label: `at least ${goal.minTokens} tokens`, ok: tokens >= goal.minTokens });
  if (goal.maxTokens !== undefined)
    out.push({ id: "maxTokens", label: `at most ${goal.maxTokens} tokens`, ok: tokens <= goal.maxTokens });
  if (goal.maxWords !== undefined)
    out.push({
      id: "maxWords",
      label: goal.maxWords === 1 ? "one word" : `at most ${goal.maxWords} words`,
      ok: words >= 1 && words <= goal.maxWords,
    });
  if (goal.mustInclude !== undefined)
    out.push({
      id: "mustInclude",
      label: `includes “${goal.mustInclude}”`,
      ok: text.toLowerCase().includes(goal.mustInclude.toLowerCase()),
    });
  return out;
}

/** The real cl100k boundaries of `text`: the character index where each token after the first starts. */
export function splitBoundaries(text: string): number[] {
  return tokenPieces(text)
    .map((p) => p.start)
    .filter((b) => b > 0 && b < text.length);
}

/** Normalise a learner's boundaries: in range, unique, sorted. */
export function normaliseBoundaries(text: string, boundaries: readonly number[] | undefined): number[] {
  return [...new Set((boundaries ?? []).filter((b) => Number.isInteger(b) && b > 0 && b < text.length))].sort(
    (a, b) => a - b,
  );
}

function validate(props: TokenSplitterProps, goal?: TokenSplitterGoal): string[] {
  const errors: string[] = [];
  if (props.text.length > TOKEN_SPLITTER_MAX_CHARS)
    errors.push(`text must be at most ${TOKEN_SPLITTER_MAX_CHARS} characters`);
  if (props.highlight !== undefined && props.highlight.length > 0 && !props.text.includes(props.highlight)) {
    errors.push(`highlight "${props.highlight}" doesn't occur in text`);
  }
  if (!goal) return errors;
  switch (goal.kind) {
    case "count":
      if (goal.text.trim().length === 0) errors.push("count goal needs non-empty text");
      if (goal.tolerance < 0) errors.push("tolerance must be ≥ 0");
      if (goal.text.length > TOKEN_SPLITTER_MAX_CHARS) errors.push("count text is too long");
      break;
    case "craft": {
      if (!props.editable) errors.push("a craft goal needs editable: true");
      const { minTokens, maxTokens, maxWords, mustInclude } = goal;
      if (minTokens === undefined && maxTokens === undefined && maxWords === undefined && mustInclude === undefined)
        errors.push("a craft goal needs at least one constraint");
      if (minTokens !== undefined && minTokens < 1) errors.push("minTokens must be ≥ 1");
      if (maxTokens !== undefined && maxTokens < 1) errors.push("maxTokens must be ≥ 1");
      if (minTokens !== undefined && maxTokens !== undefined && minTokens > maxTokens)
        errors.push("minTokens can't exceed maxTokens");
      if (maxWords !== undefined && maxWords < 1) errors.push("maxWords must be ≥ 1");
      if (props.editable && craftChecks(goal, props.text).every((c) => c.ok) && props.text.length > 0)
        errors.push("the starting text already meets the craft goal");
      break;
    }
    case "pick-token": {
      const n = tokenIds(goal.text).length;
      if (n === 0) errors.push("pick-token goal needs non-empty text");
      else if (goal.index < 0 || goal.index >= n) errors.push(`index must be 0..${n - 1} (the text has ${n} tokens)`);
      else if (!tokenPieces(goal.text).some((p) => p.index === goal.index))
        errors.push("index points inside a multi-token character; pick the first token of the character");
      break;
    }
    case "split": {
      if (goal.text.trim().length === 0) errors.push("split goal needs non-empty text");
      else if ([...goal.text].length > SPLIT_MAX_CHARS)
        errors.push(`split text must be at most ${SPLIT_MAX_CHARS} characters (a word or a short phrase)`);
      else if (tokenizerReady() && tokenCount(goal.text) < 2) errors.push("split text needs at least 2 tokens");
      break;
    }
  }
  return errors;
}

function grade({
  goal,
  answer,
}: {
  props: TokenSplitterProps;
  goal: TokenSplitterGoal;
  answer: TokenSplitterAnswer;
}): GradeResult {
  switch (goal.kind) {
    case "count": {
      const truth = tokenCount(goal.text);
      const guess = answer.count;
      if (guess === undefined || !Number.isFinite(guess)) return graded(false, 0, { solution: { count: truth } });
      const diff = Math.abs(guess - truth);
      return graded(diff <= goal.tolerance + 1e-9, Math.max(0, 1 - diff / Math.max(1, truth)), {
        solution: { count: truth } satisfies TokenSplitterAnswer,
      });
    }
    case "craft": {
      const text = answer.text ?? "";
      const checks = craftChecks(goal, text);
      const met = checks.filter((c) => c.ok).length;
      return graded(text.length > 0 && met === checks.length, checks.length ? met / checks.length : 0);
    }
    case "pick-token": {
      return graded(answer.index === goal.index, undefined, {
        solution: { index: goal.index } satisfies TokenSplitterAnswer,
      });
    }
    case "split": {
      const truth = splitBoundaries(goal.text);
      const guess = normaliseBoundaries(goal.text, answer.boundaries);
      const t = new Set(truth);
      const both = guess.filter((b) => t.has(b)).length;
      const union = new Set([...truth, ...guess]).size;
      const correct = both === truth.length && guess.length === truth.length;
      return graded(correct, union === 0 ? 1 : both / union, {
        solution: { boundaries: truth } satisfies TokenSplitterAnswer,
      });
    }
  }
}

export const tokenSplitterSpec: WidgetSpec<TokenSplitterProps, TokenSplitterGoal, TokenSplitterAnswer> = {
  id: "token-splitter",
  version: 1,
  title: "Token splitter",
  family: "llm",
  description:
    "Text shatters into the tokens a model actually reads (cl100k_base, the GPT-4 tokenizer), with ids. The learner types, predicts token counts, crafts strings that meet token rules, or taps a token.",
  llmDoc: {
    useWhen:
      "Tokenisation is the idea: words aren't tokens, a leading space changes the token, rare words split into pieces, counts surprise.",
    notFor: "Anything not about how text becomes model input; meaning or embeddings (use embedding-plane).",
    learnerDoes:
      "Types or edits text and watches the split live. count: predicts how many tokens a sealed text has, then sees it. craft: writes a string meeting rules like '1 word, ≥ 5 tokens'. pick-token: taps one token in a split. split: marks where the tokenizer cuts a short phrase, then sees the real cuts.",
    reports:
      "count → { count }; craft → { text }; pick-token → { index } (0-based token index); split → { boundaries } (character indices where a token starts); explore → { text }.",
  },
  props: TokenSplitterProps,
  goal: TokenSplitterGoal,
  answer: TokenSplitterAnswer,
  validate,
  grade,
  initialAnswer: (p) => (p.editable ? { text: p.text } : {}),
  textAlternative: (p) => {
    const edit = p.editable ? " You can edit the text." : "";
    // A fixed text is usually a task (count, pick, split): naming its pieces would give the answer
    // away. The view labels each chip once the split is on screen.
    if (!p.editable) return `The text “${p.text}”, ready to split into model tokens.`;
    if (!tokenizerReady()) return `The text “${p.text}” split into model tokens.${edit}`;
    const pieces = tokenPieces(p.text);
    const shown = pieces
      .slice(0, 24)
      .map((x) => `“${x.text}”`)
      .join(", ");
    return `The text “${p.text}” splits into ${tokenCount(p.text)} tokens: ${shown}${pieces.length > 24 ? ", …" : ""}.${edit}`;
  },
  toText: (p, a) => {
    const text = a?.text ?? p.text;
    const lines = [`Text: "${text}"`];
    if (tokenizerReady())
      lines.push(
        `Tokens (${tokenCount(text)}): ${tokenPieces(text)
          .map((x) => `[${x.text}]`)
          .join("")}`,
      );
    if (a?.count !== undefined) lines.push(`Predicted count: ${a.count}`);
    if (a?.index !== undefined) lines.push(`Tapped token #${a.index}`);
    if (a?.boundaries !== undefined) lines.push(`Marked cuts at: ${a.boundaries.join(", ") || "none"}`);
    return lines.join("\n");
  },
  explore: (p) => ({ ...p, editable: true }),
  examples: [
    {
      note: "Count: how many tokens is “antidisestablishmentarianism”?",
      props: { text: "", editable: false, showIds: true, encoding: "cl100k_base" },
      goal: { kind: "count", text: "antidisestablishmentarianism", tolerance: 1 },
      correctAnswer: { count: 6 },
      wrongAnswer: { count: 1 },
    },
    {
      note: "Craft: one word, at least five tokens",
      props: { text: "strawberry", editable: true, showIds: true, encoding: "cl100k_base" },
      goal: { kind: "craft", maxWords: 1, minTokens: 5 },
      correctAnswer: { text: "antidisestablishmentarianism" },
      wrongAnswer: { text: "hello" },
    },
    {
      note: "Pick: tap the token that carries “berry”",
      props: { text: "strawberry", editable: false, showIds: true, encoding: "cl100k_base", highlight: "berry" },
      goal: { kind: "pick-token", text: "strawberry", index: 2 },
      correctAnswer: { index: 2 },
      wrongAnswer: { index: 0 },
    },
    {
      note: "Split: where does the tokenizer cut “strawberry”?",
      props: { text: "strawberry", editable: false, showIds: true, encoding: "cl100k_base" },
      goal: { kind: "split", text: "strawberry" },
      correctAnswer: { boundaries: [3, 5] },
      wrongAnswer: { boundaries: [5] },
    },
  ],
};
