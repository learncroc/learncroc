/**
 * attention-weights: arcs from a focus token. Edit weights that share a budget of 1, tap the words
 * that matter, swap a word and watch the arcs redraw, see a causal mask (CONTRACTS §7.2 #3).
 */
import type { GradeResult } from "@learncroc/core";
import { clamp, setMatch, sum } from "../shared/math";
import { DataSource, validateSource } from "../shared/source";
import { graded } from "../shared/spec-helpers";
import { type WidgetSpec, z } from "../shared/zod";

export const AttentionWeightsProps = z.strictObject({
  /** ≤ 16. */
  tokens: z.array(z.string()),
  /** Index of the token doing the looking. */
  focus: z.number().int(),
  /** Reference weights (sum 1), length = tokens.length. */
  weights: z.array(z.number()).optional(),
  mode: z.enum(["view", "edit", "tap"]),
  /** Hide the reference until answered. */
  hideWeights: z.boolean().optional(),
  /** Dim tokens after focus (cannot be attended). */
  causal: z.boolean().optional(),
  /** Drag to swap a word. */
  swap: z
    .strictObject({
      index: z.number().int(),
      options: z.array(z.string()),
      weightsByOption: z.record(z.string(), z.array(z.number())),
    })
    .optional(),
  source: DataSource,
});

export const AttentionWeightsGoal = z.discriminatedUnion("kind", [
  /** edit: weights[target] ≥ minWeight. */
  z.strictObject({ kind: z.literal("weight"), target: z.number().int(), minWeight: z.number() }),
  z.strictObject({
    kind: z.literal("tap"),
    correct: z.array(z.number().int()),
    match: z.enum(["any", "all", "exact"]),
  }),
  /** Choose the swap that makes the target attended. */
  z.strictObject({ kind: z.literal("swap"), option: z.string() }),
]);

export const AttentionWeightsAnswer = z.object({
  weights: z.array(z.number()).optional(),
  tapped: z.array(z.number()).optional(),
  swapped: z.string().optional(),
});

export type AttentionWeightsProps = z.infer<typeof AttentionWeightsProps>;
export type AttentionWeightsGoal = z.infer<typeof AttentionWeightsGoal>;
export type AttentionWeightsAnswer = z.infer<typeof AttentionWeightsAnswer>;

export const MAX_ATTENTION_TOKENS = 16;

/** Can the focus token attend to token i? (Causal models can't look ahead.) */
export function attendable(props: Pick<AttentionWeightsProps, "focus" | "causal">, i: number): boolean {
  return !props.causal || i <= props.focus;
}

/** An even split over the attendable tokens. */
export function uniformWeights(props: Pick<AttentionWeightsProps, "tokens" | "focus" | "causal">): number[] {
  const allowed = props.tokens.map((_, i) => attendable(props, i));
  const n = allowed.filter(Boolean).length || 1;
  return allowed.map((a) => (a ? 1 / n : 0));
}

/**
 * Set weight i to v and rescale the other attendable weights so the total stays 1 (the budget).
 * When the others are all zero, the remainder is shared evenly among them.
 */
export function redistribute(weights: readonly number[], i: number, v: number, allowed: readonly boolean[]): number[] {
  const n = weights.length;
  if (!allowed[i]) return [...weights];
  const others = weights.map((w, j) => (j !== i && allowed[j] ? w : 0));
  const otherCount = allowed.filter((a, j) => a && j !== i).length;
  const value = otherCount === 0 ? 1 : clamp(v, 0, 1);
  const rest = 1 - value;
  const otherSum = sum(others);
  const out = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    if (j === i) out[j] = value;
    else if (!allowed[j]) out[j] = 0;
    else out[j] = otherSum > 1e-12 ? (others[j] as number) * (rest / otherSum) : rest / otherCount;
  }
  return out.map((w) => Math.round(w * 10000) / 10000);
}

/** The weights the arcs should show for a swap choice (the authored weights for the original word). */
export function swapWeights(props: AttentionWeightsProps, option: string | undefined): number[] | undefined {
  if (!props.swap || option === undefined) return props.weights;
  return props.swap.weightsByOption[option] ?? props.weights;
}

function checkWeights(w: readonly number[], n: number, where: string, props: AttentionWeightsProps, errors: string[]) {
  if (w.length !== n) errors.push(`${where}: needs ${n} weights (one per token)`);
  if (w.some((x) => x < 0 || x > 1)) errors.push(`${where}: weights must be between 0 and 1`);
  const total = sum(w);
  if (Math.abs(total - 1) > 0.02) errors.push(`${where}: weights sum to ${total.toFixed(3)}, not 1`);
  if (props.causal && w.some((x, i) => i > props.focus && x > 1e-6))
    errors.push(`${where}: a causal model can't attend to tokens after the focus`);
}

function validate(props: AttentionWeightsProps, goal?: AttentionWeightsGoal): string[] {
  const errors: string[] = [...validateSource(props.source)];
  const n = props.tokens.length;
  if (n < 2 || n > MAX_ATTENTION_TOKENS) errors.push(`attention needs 2–${MAX_ATTENTION_TOKENS} tokens`);
  if (props.focus < 0 || props.focus >= n) errors.push(`focus must be a token index 0..${n - 1}`);
  if (props.weights) checkWeights(props.weights, n, "weights", props, errors);
  if (props.mode === "view" && !props.weights && !props.swap) errors.push('mode "view" needs weights to draw');
  if (props.hideWeights && !props.weights) errors.push("hideWeights needs reference weights to reveal");
  if (props.swap) {
    const s = props.swap;
    if (s.index < 0 || s.index >= n) errors.push("swap.index must be a token index");
    if (s.index === props.focus) errors.push("swap.index can't be the focus token");
    if (s.options.length < 2) errors.push("swap needs at least 2 options");
    if (new Set(s.options).size !== s.options.length) errors.push("swap options must be unique");
    for (const o of s.options) {
      const w = s.weightsByOption[o];
      if (!w) errors.push(`swap.weightsByOption is missing "${o}"`);
      else checkWeights(w, n, `swap.weightsByOption["${o}"]`, props, errors);
    }
    for (const k of Object.keys(s.weightsByOption))
      if (!s.options.includes(k)) errors.push(`swap.weightsByOption has "${k}", which isn't an option`);
  }
  if (!goal) return errors;
  switch (goal.kind) {
    case "weight":
      if (props.mode !== "edit") errors.push('a weight goal needs mode "edit"');
      if (goal.target < 0 || goal.target >= n) errors.push("goal target must be a token index");
      else if (!attendable(props, goal.target)) errors.push("goal target is masked (after the focus)");
      if (!(goal.minWeight > 0 && goal.minWeight <= 1)) errors.push("minWeight must be in (0, 1]");
      break;
    case "tap":
      if (props.mode !== "tap") errors.push('a tap goal needs mode "tap"');
      if (goal.correct.length === 0) errors.push("tap goal needs at least one correct index");
      if (goal.correct.some((i) => i < 0 || i >= n)) errors.push("tap goal indices must be token indices");
      if (new Set(goal.correct).size !== goal.correct.length) errors.push("tap goal indices must be unique");
      if (goal.correct.some((i) => !attendable(props, i))) errors.push("tap goal includes a masked token");
      break;
    case "swap":
      if (!props.swap) errors.push("a swap goal needs props.swap");
      else if (!props.swap.options.includes(goal.option))
        errors.push(`goal option "${goal.option}" isn't a swap option`);
      break;
  }
  return errors;
}

function grade({
  props,
  goal,
  answer,
}: {
  props: AttentionWeightsProps;
  goal: AttentionWeightsGoal;
  answer: AttentionWeightsAnswer;
}): GradeResult {
  switch (goal.kind) {
    case "weight": {
      const w = answer.weights;
      if (!w || w.length !== props.tokens.length || w.some((x) => !(x >= 0))) return graded(false, 0);
      const total = sum(w);
      if (!(total > 0)) return graded(false, 0);
      // Budget: weights share 1. Normalise small drift; masked tokens can't carry weight.
      if (w.some((x, i) => x > 1e-6 && !attendable(props, i))) return graded(false, 0);
      const target = (w[goal.target] ?? 0) / total;
      return graded(target >= goal.minWeight - 1e-9, Math.min(1, target / goal.minWeight), {
        solution: props.weights ? ({ weights: props.weights } satisfies AttentionWeightsAnswer) : undefined,
      });
    }
    case "tap": {
      const r = setMatch(answer.tapped ?? [], goal.correct, goal.match);
      return graded(r.ok, r.score, { solution: { tapped: goal.correct } satisfies AttentionWeightsAnswer });
    }
    case "swap":
      return graded(answer.swapped === goal.option, undefined, {
        solution: { swapped: goal.option } satisfies AttentionWeightsAnswer,
      });
  }
}

function weightsText(tokens: readonly string[], w: readonly number[]): string {
  return tokens.map((t, i) => `${t} ${Math.round((w[i] ?? 0) * 100)}%`).join(", ");
}

export const attentionWeightsSpec: WidgetSpec<AttentionWeightsProps, AttentionWeightsGoal, AttentionWeightsAnswer> = {
  id: "attention-weights",
  version: 1,
  title: "Attention weights",
  family: "llm",
  description:
    "Arcs from one token to every token it can see, thick where attention is high. The learner shares a budget of 100% across the words, taps the words that matter, or swaps a word and watches the arcs redraw. Optional causal mask.",
  llmDoc: {
    useWhen:
      "Which earlier words a token looks at, and why: pronoun resolution (“it” → “trophy”), agreement, the causal mask, attention as a weighted average that always sums to 1.",
    notFor:
      "Sequences longer than 16 tokens, multi-head internals, or claims about what a specific real head does unless precomputed.",
    learnerDoes:
      "edit: drags each word's weight; raising one lowers the others so the total stays 100%. tap: taps the words the focus token should look at. swap: tries another word in one slot and sees which choice moves the attention.",
    reports: "edit → { weights: number[] } (sum 1); tap → { tapped: number[] }; swap → { swapped }.",
  },
  props: AttentionWeightsProps,
  goal: AttentionWeightsGoal,
  answer: AttentionWeightsAnswer,
  validate,
  grade,
  initialAnswer: (p) => (p.mode === "edit" ? { weights: uniformWeights(p) } : p.mode === "tap" ? { tapped: [] } : {}),
  textAlternative: (p) => {
    const from = `“${p.tokens[p.focus] ?? "?"}”`;
    const mask = p.causal ? " Words after it are masked: it can't look ahead." : "";
    if (p.weights && !p.hideWeights)
      return `Attention from ${from} in “${p.tokens.join(" ")}”: ${weightsText(p.tokens, p.weights)}.${mask}`;
    return `Attention from ${from} to the words of “${p.tokens.join(" ")}”.${mask}`;
  },
  toText: (p, a) => {
    const lines = [`Sentence: ${p.tokens.join(" ")}`, `Focus: "${p.tokens[p.focus] ?? "?"}"`];
    if (p.weights) lines.push(`Reference: ${weightsText(p.tokens, p.weights)}`);
    if (a?.weights) lines.push(`Learner: ${weightsText(p.tokens, a.weights)}`);
    if (a?.tapped) lines.push(`Tapped: ${a.tapped.map((i) => p.tokens[i]).join(", ")}`);
    if (a?.swapped) lines.push(`Swapped in: "${a.swapped}"`);
    return lines.join("\n");
  },
  explore: (p) => ({ ...p, hideWeights: false }),
  examples: [
    {
      note: "Edit: where should “it” look? (The trophy didn't fit in the suitcase because it was too big.)",
      props: {
        tokens: ["The", "trophy", "didn't", "fit", "in", "the", "suitcase", "because", "it", "was", "too", "big"],
        focus: 8,
        weights: [0.02, 0.55, 0.03, 0.06, 0.01, 0.02, 0.18, 0.04, 0.05, 0.02, 0.01, 0.01],
        mode: "edit",
        hideWeights: true,
        source: "illustrative",
      },
      goal: { kind: "weight", target: 1, minWeight: 0.4 },
      correctAnswer: { weights: [0.03, 0.5, 0.03, 0.03, 0.03, 0.03, 0.15, 0.04, 0.05, 0.04, 0.03, 0.04] },
      wrongAnswer: { weights: [0.03, 0.1, 0.03, 0.03, 0.03, 0.03, 0.55, 0.04, 0.05, 0.04, 0.03, 0.04] },
    },
    {
      note: "Tap: which words does “it” need to work out what it is?",
      props: {
        tokens: ["The", "dog", "chased", "the", "ball", "until", "it", "was", "tired"],
        focus: 6,
        weights: [0.02, 0.52, 0.06, 0.02, 0.08, 0.03, 0.05, 0.06, 0.16],
        mode: "tap",
        hideWeights: true,
        causal: false,
        source: "illustrative",
      },
      goal: { kind: "tap", correct: [1, 8], match: "all" },
      correctAnswer: { tapped: [1, 8] },
      wrongAnswer: { tapped: [4] },
    },
    {
      note: "Swap: change one word so “it” points at the suitcase",
      props: {
        tokens: ["The", "trophy", "didn't", "fit", "in", "the", "suitcase", "because", "it", "was", "too", "big"],
        focus: 8,
        weights: [0.02, 0.55, 0.03, 0.06, 0.01, 0.02, 0.18, 0.04, 0.05, 0.02, 0.01, 0.01],
        mode: "view",
        swap: {
          index: 11,
          options: ["big", "small"],
          weightsByOption: {
            big: [0.02, 0.55, 0.03, 0.06, 0.01, 0.02, 0.18, 0.04, 0.05, 0.02, 0.01, 0.01],
            small: [0.02, 0.14, 0.03, 0.05, 0.02, 0.04, 0.6, 0.03, 0.04, 0.01, 0.01, 0.01],
          },
        },
        source: "illustrative",
      },
      goal: { kind: "swap", option: "small" },
      correctAnswer: { swapped: "small" },
      wrongAnswer: { swapped: "big" },
    },
  ],
};
