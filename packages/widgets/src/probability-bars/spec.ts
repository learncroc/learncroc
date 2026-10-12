/**
 * probability-bars: drag bars to predict a next-token distribution, then see the real one
 * (precomputed, model named). Rank, temperature, pick and the score→pick→append loop (CONTRACTS §7.2 #1).
 */
import type { GradeResult } from "@learncroc/core";
import { stableShuffle, sum } from "../shared/math";
import { DataSource, validateSource } from "../shared/source";
import { graded } from "../shared/spec-helpers";
import { type WidgetSpec, z } from "../shared/zod";

const TokenP = z.strictObject({ text: z.string(), p: z.number().min(0).max(1) });

export const ProbabilityBarsProps = z.strictObject({
  /** "I poured milk into my" */
  context: z.string(),
  /** 3–8; p sums to ≤ 1 (remainder = "other"). */
  tokens: z.array(TokenP),
  /** Default "everything else". */
  otherLabel: z.string().optional(),
  task: z.enum(["predict", "rank", "temperature", "pick", "loop", "view"]),
  /** Default 1.0, range 0.1–2.0. */
  temperature: z.number().optional(),
  /** Pre-sampled continuations (shown when sampling). */
  samples: z.array(z.strictObject({ temperature: z.number(), outputs: z.array(z.string()) })).optional(),
  /** task "loop": successive distributions. */
  loop: z.strictObject({ steps: z.array(z.strictObject({ context: z.string(), tokens: z.array(TokenP) })) }).optional(),
  /** Hide the real bars until answered. */
  hideTruth: z.boolean().optional(),
  /** "precomputed:gpt2" renders "computed with GPT-2"; "illustrative" renders a tag. */
  source: DataSource,
});

export const ProbabilityBarsGoal = z.discriminatedUnion("kind", [
  /** L1 distance between guess and truth (0..2); 2 = always correct. */
  z.strictObject({ kind: z.literal("predict"), maxL1: z.number() }),
  /** Overlap of the learner's top-K with the truth. */
  z.strictObject({ kind: z.literal("rank"), topK: z.number().int(), minOverlap: z.number().int() }),
  z.strictObject({ kind: z.literal("temperature"), range: z.tuple([z.number(), z.number()]) }),
  z.strictObject({ kind: z.literal("pick"), token: z.string() }),
  /** Complete N score→pick→append cycles. */
  z.strictObject({ kind: z.literal("loop"), runs: z.number().int() }),
]);

export const ProbabilityBarsAnswer = z.object({
  probs: z.array(z.number()).optional(),
  ranking: z.array(z.string()).optional(),
  temperature: z.number().optional(),
  picked: z.string().optional(),
  appended: z.array(z.string()).optional(),
});

export type ProbabilityBarsProps = z.infer<typeof ProbabilityBarsProps>;
export type ProbabilityBarsGoal = z.infer<typeof ProbabilityBarsGoal>;
export type ProbabilityBarsAnswer = z.infer<typeof ProbabilityBarsAnswer>;

export const TEMPERATURE_MIN = 0.1;
export const TEMPERATURE_MAX = 2;
/** "Everything else" is modelled as this many equally likely tokens when temperature reshapes it. */
export const OTHER_SPREAD = 20;

/** Probability left over for "everything else" (never negative). */
export function otherMass(tokens: readonly { p: number }[]): number {
  return Math.max(0, 1 - sum(tokens.map((t) => t.p)));
}

/**
 * Reshape a T = 1 distribution at temperature T: p_i^(1/T), renormalised. The "everything else"
 * remainder is treated as OTHER_SPREAD equal tokens, so it shrinks when cold and grows when hot.
 * Returns the listed tokens' probabilities plus the remainder as the last element.
 */
export function applyTemperature(tokens: readonly { p: number }[], temperature: number): number[] {
  const t = Math.max(TEMPERATURE_MIN / 4, temperature);
  const other = otherMass(tokens);
  const max = Math.max(...tokens.map((x) => x.p), other / OTHER_SPREAD, 1e-12);
  // Work relative to the max so tiny probabilities at low T don't underflow to 0/0.
  const w = tokens.map((x) => (x.p > 0 ? (x.p / max) ** (1 / t) : 0));
  const wo = other > 0 ? OTHER_SPREAD * (other / OTHER_SPREAD / max) ** (1 / t) : 0;
  const total = sum(w) + wo;
  if (!(total > 0)) return [...tokens.map((x) => x.p), other];
  return [...w.map((x) => x / total), wo / total];
}

/** Token texts sorted from most to least likely (stable for ties). */
export function truthRanking(tokens: readonly { text: string; p: number }[]): string[] {
  return tokens
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.p - a.t.p || a.i - b.i)
    .map((x) => x.t.text);
}

/** The order rank chips start in: shuffled, never the authored order (authors often list tokens by p). */
export function initialRanking(tokens: readonly { text: string }[]): string[] {
  return stableShuffle(tokens.map((t) => t.text));
}

/** L1 distance between a guess (one value per listed token) and the truth, "everything else" included. */
export function predictionL1(tokens: readonly { p: number }[], probs: readonly number[]): number {
  let d = 0;
  for (let i = 0; i < tokens.length; i++) d += Math.abs((probs[i] ?? 0) - (tokens[i]?.p ?? 0));
  const guessOther = Math.max(0, 1 - sum(tokens.map((_, i) => probs[i] ?? 0)));
  return d + Math.abs(guessOther - otherMass(tokens));
}

/** The distribution shown at loop step `i` (step 0 = the props' own context and tokens). */
export function loopStep(
  props: ProbabilityBarsProps,
  i: number,
): { context: string; tokens: { text: string; p: number }[] } {
  if (i === 0 || !props.loop?.steps.length) return { context: props.context, tokens: props.tokens };
  const steps = props.loop.steps;
  return steps[Math.min(i, steps.length) - 1] ?? { context: props.context, tokens: props.tokens };
}

const GOAL_FOR_TASK: Record<ProbabilityBarsProps["task"], ProbabilityBarsGoal["kind"] | null> = {
  predict: "predict",
  rank: "rank",
  temperature: "temperature",
  pick: "pick",
  loop: "loop",
  view: null,
};

function validateTokens(tokens: readonly { text: string; p: number }[], where: string, errors: string[]): void {
  if (tokens.length < 3 || tokens.length > 8) errors.push(`${where}: needs 3–8 tokens`);
  const total = sum(tokens.map((t) => t.p));
  if (total > 1 + 1e-6) errors.push(`${where}: probabilities sum to ${total.toFixed(3)}, more than 1`);
  const texts = tokens.map((t) => t.text);
  if (new Set(texts).size !== texts.length) errors.push(`${where}: token texts must be unique`);
  if (texts.some((t) => t.length === 0)) errors.push(`${where}: token text may not be empty`);
}

function validate(props: ProbabilityBarsProps, goal?: ProbabilityBarsGoal): string[] {
  const errors: string[] = [...validateSource(props.source)];
  validateTokens(props.tokens, "tokens", errors);
  if (props.temperature !== undefined && (props.temperature < TEMPERATURE_MIN || props.temperature > TEMPERATURE_MAX)) {
    errors.push("temperature must be between 0.1 and 2.0");
  }
  for (const s of props.samples ?? []) {
    if (s.temperature < TEMPERATURE_MIN || s.temperature > TEMPERATURE_MAX)
      errors.push("samples: temperature must be between 0.1 and 2.0");
    if (s.outputs.length === 0) errors.push("samples: each entry needs at least one output");
  }
  if (props.task === "loop") {
    if (!props.loop?.steps.length) errors.push('task "loop" needs loop.steps');
    for (const [i, s] of (props.loop?.steps ?? []).entries()) validateTokens(s.tokens, `loop.steps[${i}]`, errors);
  }
  if (!goal) return errors;
  const expected = GOAL_FOR_TASK[props.task];
  if (expected === null) errors.push('task "view" is a visual; it takes no goal');
  else if (goal.kind !== expected) errors.push(`goal kind "${goal.kind}" doesn't match task "${props.task}"`);
  switch (goal.kind) {
    case "predict":
      if (!(goal.maxL1 > 0 && goal.maxL1 <= 2)) errors.push("maxL1 must be in (0, 2]");
      if (props.hideTruth === false) errors.push("a predict goal should hide the real bars (hideTruth)");
      break;
    case "rank":
      if (goal.topK < 1 || goal.topK > props.tokens.length) errors.push(`topK must be 1..${props.tokens.length}`);
      if (goal.minOverlap < 1 || goal.minOverlap > goal.topK) errors.push("minOverlap must be 1..topK");
      break;
    case "temperature": {
      const [lo, hi] = goal.range;
      if (!(lo < hi)) errors.push("temperature range must be [low, high] with low < high");
      if (lo < TEMPERATURE_MIN || hi > TEMPERATURE_MAX) errors.push("temperature range must sit inside 0.1–2.0");
      break;
    }
    case "pick":
      if (!props.tokens.some((t) => t.text === goal.token))
        errors.push(`goal token "${goal.token}" isn't one of the bars`);
      break;
    case "loop":
      if (goal.runs < 1) errors.push("runs must be at least 1");
      if (goal.runs > (props.loop?.steps.length ?? 0) + 1)
        errors.push("runs can't exceed the number of loop steps + 1");
      break;
  }
  return errors;
}

function grade({
  props,
  goal,
  answer,
}: {
  props: ProbabilityBarsProps;
  goal: ProbabilityBarsGoal;
  answer: ProbabilityBarsAnswer;
}): GradeResult {
  switch (goal.kind) {
    case "predict": {
      const probs = answer.probs;
      if (!probs || probs.length !== props.tokens.length || probs.some((p) => !(p >= 0 && p <= 1)))
        return graded(false, 0, { solution: { probs: props.tokens.map((t) => t.p) } });
      if (sum(probs) > 1 + 1e-6) return graded(false, 0, { solution: { probs: props.tokens.map((t) => t.p) } });
      const l1 = predictionL1(props.tokens, probs);
      return graded(l1 <= goal.maxL1 + 1e-9, 1 - l1 / 2, {
        solution: { probs: props.tokens.map((t) => t.p) } satisfies ProbabilityBarsAnswer,
      });
    }
    case "rank": {
      const truth = truthRanking(props.tokens).slice(0, goal.topK);
      // A ranking names each chip once; repeats can't fill the top K.
      const mine = [...new Set(answer.ranking ?? [])].slice(0, goal.topK);
      const overlap = mine.filter((t) => truth.includes(t)).length;
      return graded(overlap >= goal.minOverlap, overlap / goal.topK, {
        solution: { ranking: truthRanking(props.tokens) } satisfies ProbabilityBarsAnswer,
      });
    }
    case "temperature": {
      const t = answer.temperature;
      const [lo, hi] = goal.range;
      const ok = t !== undefined && t >= lo - 1e-9 && t <= hi + 1e-9;
      return graded(ok, undefined, {
        solution: { temperature: Number(((lo + hi) / 2).toFixed(2)) } satisfies ProbabilityBarsAnswer,
      });
    }
    case "pick": {
      const ok = answer.picked !== undefined && answer.picked.trim() === goal.token.trim();
      return graded(ok, undefined, { solution: { picked: goal.token } satisfies ProbabilityBarsAnswer });
    }
    case "loop": {
      // Count the runs that appended a token the model actually offered at that step.
      const appended = answer.appended ?? [];
      let runs = 0;
      for (const [i, token] of appended.entries()) {
        if (!loopStep(props, i).tokens.some((t) => t.text === token)) break;
        runs++;
      }
      return graded(runs >= goal.runs, Math.min(1, runs / goal.runs));
    }
  }
}

function describe(tokens: readonly { text: string; p: number }[]): string {
  return tokens.map((t) => `"${t.text}" ${Math.round(t.p * 100)}%`).join(", ");
}

export const probabilityBarsSpec: WidgetSpec<ProbabilityBarsProps, ProbabilityBarsGoal, ProbabilityBarsAnswer> = {
  id: "probability-bars",
  version: 1,
  title: "Probability bars",
  family: "llm",
  description:
    "A next-token probability chart. The learner drags bars to predict the distribution, ranks the candidates, turns a temperature dial and samples from it, picks a token, or runs the score→pick→append loop by hand.",
  llmDoc: {
    useWhen:
      "Next-token prediction, temperature or sampling is the idea: what the model thinks comes next, how sure it is, and how one token at a time builds a sentence.",
    notFor: "Distributions that aren't over a handful (3–8) of discrete choices, or anything not about generation.",
    learnerDoes:
      "predict: drags each bar to a guessed probability (budget of 100%), then the real bars slide in. rank: orders chips by likelihood. temperature: turns the dial to reshape the bars and samples. pick: taps a bar. loop: presses score, picks a token, appends it, repeats.",
    reports:
      "predict → { probs: number[] } parallel to tokens; rank → { ranking: string[] }; temperature → { temperature }; pick → { picked }; loop → { appended: string[] }.",
  },
  props: ProbabilityBarsProps,
  goal: ProbabilityBarsGoal,
  answer: ProbabilityBarsAnswer,
  validate,
  grade,
  initialAnswer: (p) => {
    switch (p.task) {
      case "predict":
        return { probs: p.tokens.map(() => 0) };
      case "rank":
        return { ranking: initialRanking(p.tokens) };
      case "temperature":
        return { temperature: p.temperature ?? 1 };
      case "loop":
        return { appended: [] };
      default:
        return {};
    }
  },
  textAlternative: (p) => {
    const head = `Next-token probabilities after "${p.context}"`;
    if (p.hideTruth && p.task === "predict")
      return `${head}: ${p.tokens.length} candidate words, ${p.tokens.map((t) => `"${t.text}"`).join(", ")}. Guess how likely each is.`;
    return `${head}: ${describe(p.tokens)}${otherMass(p.tokens) > 0.005 ? `, ${p.otherLabel ?? "everything else"} ${Math.round(otherMass(p.tokens) * 100)}%` : ""}.`;
  },
  toText: (p, a) => {
    const lines = [`Context: "${p.context}"`, `Model: ${describe(p.tokens)}`];
    if (a?.probs) lines.push(`Guess: ${describe(p.tokens.map((t, i) => ({ text: t.text, p: a.probs?.[i] ?? 0 })))}`);
    if (a?.ranking) lines.push(`Ranking: ${a.ranking.join(" > ")}`);
    if (a?.temperature !== undefined) lines.push(`Temperature: ${a.temperature}`);
    if (a?.picked) lines.push(`Picked: "${a.picked}"`);
    if (a?.appended?.length) lines.push(`Appended: ${a.appended.map((t) => `"${t}"`).join(" ")}`);
    return lines.join("\n");
  },
  explore: (p) => ({ ...p, hideTruth: false }),
  examples: [
    {
      note: "Predict: guess the bars for “I poured milk into my”",
      props: {
        context: "I poured milk into my",
        tokens: [
          { text: " coffee", p: 0.31 },
          { text: " tea", p: 0.14 },
          { text: " cereal", p: 0.09 },
          { text: " bowl", p: 0.06 },
        ],
        task: "predict",
        hideTruth: true,
        source: "illustrative",
      },
      goal: { kind: "predict", maxL1: 0.6 },
      correctAnswer: { probs: [0.35, 0.15, 0.1, 0.05] },
      wrongAnswer: { probs: [0.05, 0.05, 0.05, 0.8] },
    },
    {
      note: "Temperature: make the model pick “coffee” nearly every time",
      props: {
        context: "I poured milk into my",
        tokens: [
          { text: " coffee", p: 0.31 },
          { text: " tea", p: 0.14 },
          { text: " cereal", p: 0.09 },
          { text: " bowl", p: 0.06 },
        ],
        task: "temperature",
        temperature: 1,
        source: "illustrative",
      },
      goal: { kind: "temperature", range: [0.1, 0.4] },
      correctAnswer: { temperature: 0.3 },
      wrongAnswer: { temperature: 1.5 },
    },
    {
      note: "Rank: which two words does the model like best?",
      props: {
        context: "The capital of France is",
        tokens: [
          { text: " a", p: 0.08 },
          { text: " Paris", p: 0.62 },
          { text: " the", p: 0.11 },
          { text: " located", p: 0.04 },
        ],
        task: "rank",
        hideTruth: true,
        source: "illustrative",
      },
      goal: { kind: "rank", topK: 2, minOverlap: 2 },
      correctAnswer: { ranking: [" Paris", " the", " a", " located"] },
      wrongAnswer: { ranking: [" located", " a", " Paris", " the"] },
    },
    {
      note: "Pick: greedy decoding takes the tallest bar",
      props: {
        context: "Once upon a",
        tokens: [
          { text: " time", p: 0.86 },
          { text: " midnight", p: 0.03 },
          { text: " hill", p: 0.02 },
        ],
        task: "pick",
        source: "illustrative",
      },
      goal: { kind: "pick", token: " time" },
      correctAnswer: { picked: " time" },
      wrongAnswer: { picked: " hill" },
    },
    {
      note: "Loop: run score → pick → append three times",
      props: {
        context: "The cat sat on the",
        tokens: [
          { text: " mat", p: 0.42 },
          { text: " floor", p: 0.18 },
          { text: " bed", p: 0.1 },
        ],
        task: "loop",
        loop: {
          steps: [
            {
              context: "The cat sat on the mat",
              tokens: [
                { text: ".", p: 0.38 },
                { text: " and", p: 0.24 },
                { text: ",", p: 0.15 },
              ],
            },
            {
              context: "The cat sat on the mat and",
              tokens: [
                { text: " purred", p: 0.21 },
                { text: " looked", p: 0.17 },
                { text: " slept", p: 0.12 },
              ],
            },
          ],
        },
        source: "illustrative",
      },
      goal: { kind: "loop", runs: 3 },
      correctAnswer: { appended: [" mat", " and", " purred"] },
      wrongAnswer: { appended: [" mat"] },
    },
  ],
};
