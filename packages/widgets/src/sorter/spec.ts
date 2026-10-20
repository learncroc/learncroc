/**
 * sorter: drag cards into buckets, or rank them in one column.
 */
import { AssetPath, Markdown, type WidgetSpec } from "@learncroc/core";
import { z } from "zod";
import { stableShuffle } from "../shared/math";
import { graded } from "../shared/spec-helpers";

export const SorterProps = z.strictObject({
  mode: z.enum(["buckets", "rank"]),
  /** 2–4 (buckets mode). */
  buckets: z.array(z.strictObject({ id: z.string(), label: z.string(), hint: z.string().optional() })).optional(),
  /** 3–8. */
  cards: z.array(
    z.strictObject({ id: z.string(), text: Markdown, asset: AssetPath.optional(), why: Markdown.optional() }),
  ),
  /** Ends of the rank column, e.g. ["first", "last"]. */
  rankLabels: z.tuple([z.string(), z.string()]).optional(),
});

export const SorterGoal = z.discriminatedUnion("kind", [
  /** minCorrect default: all cards. */
  z.strictObject({
    kind: z.literal("buckets"),
    assignment: z.record(z.string(), z.string()),
    minCorrect: z.number().int().optional(),
  }),
  /** minKendall default 1.0 (exact order). */
  z.strictObject({ kind: z.literal("rank"), order: z.array(z.string()), minKendall: z.number().optional() }),
]);

export const SorterAnswer = z.object({
  assignment: z.record(z.string(), z.string()).optional(),
  order: z.array(z.string()).optional(),
});

export type SorterProps = z.infer<typeof SorterProps>;
export type SorterGoal = z.infer<typeof SorterGoal>;
export type SorterAnswer = z.infer<typeof SorterAnswer>;

/** The order a rank sorter starts in: shuffled, never the authored order (which is often the answer). */
export function initialRankOrder(cards: readonly { id: string }[]): string[] {
  return stableShuffle(cards.map((c) => c.id));
}

/** Kendall's tau between two orderings of the same ids (1 = identical, -1 = reversed). */
export function kendallTau(expected: readonly string[], actual: readonly string[]): number {
  const pos = new Map(actual.map((id, i) => [id, i] as const));
  const n = expected.length;
  if (n < 2) return expected.every((id) => pos.has(id)) ? 1 : -1;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = pos.get(expected[i] as string);
      const b = pos.get(expected[j] as string);
      if (a === undefined || b === undefined) {
        discordant++;
        continue;
      }
      if (a < b) concordant++;
      else discordant++;
    }
  }
  return (concordant - discordant) / ((n * (n - 1)) / 2);
}

function validate(props: SorterProps, goal?: SorterGoal): string[] {
  const errors: string[] = [];
  const cardIds = props.cards.map((c) => c.id);
  if (props.cards.length < 3 || props.cards.length > 8) errors.push("sorter needs 3–8 cards");
  if (new Set(cardIds).size !== cardIds.length) errors.push("card ids must be unique");
  const bucketIds = (props.buckets ?? []).map((b) => b.id);
  if (props.mode === "buckets") {
    if (bucketIds.length < 2 || bucketIds.length > 4) errors.push("buckets mode needs 2–4 buckets");
    if (new Set(bucketIds).size !== bucketIds.length) errors.push("bucket ids must be unique");
  }
  if (!goal) return errors;
  if (goal.kind !== props.mode) errors.push(`goal kind "${goal.kind}" doesn't match mode "${props.mode}"`);
  if (goal.kind === "buckets") {
    for (const [card, bucket] of Object.entries(goal.assignment)) {
      if (!cardIds.includes(card)) errors.push(`goal assigns unknown card "${card}"`);
      if (!bucketIds.includes(bucket)) errors.push(`goal uses unknown bucket "${bucket}"`);
    }
    for (const id of cardIds) if (!(id in goal.assignment)) errors.push(`goal doesn't place card "${id}"`);
    const total = Object.keys(goal.assignment).length;
    if (goal.minCorrect !== undefined && (goal.minCorrect < 1 || goal.minCorrect > total)) {
      errors.push(`minCorrect must be between 1 and ${total}`);
    }
  } else {
    const sorted = [...goal.order].sort();
    if (sorted.length !== cardIds.length || sorted.join("\u0000") !== [...cardIds].sort().join("\u0000")) {
      errors.push("goal order must list every card id exactly once");
    }
    if (goal.minKendall !== undefined && (goal.minKendall < -1 || goal.minKendall > 1)) {
      errors.push("minKendall must be between -1 and 1");
    }
  }
  return errors;
}

function grade({ goal, answer }: { props: SorterProps; goal: SorterGoal; answer: SorterAnswer }) {
  if (goal.kind === "buckets") {
    const entries = Object.entries(goal.assignment);
    const total = entries.length;
    const right = entries.filter(([card, bucket]) => answer.assignment?.[card] === bucket).length;
    const need = goal.minCorrect ?? total;
    return graded(right >= need, total === 0 ? 0 : right / total, {
      solution: { assignment: goal.assignment } satisfies SorterAnswer,
    });
  }
  const order = answer.order ?? [];
  const tau = kendallTau(goal.order, order);
  const correct = tau >= (goal.minKendall ?? 1) - 1e-9;
  return graded(correct, correct ? 1 : (tau + 1) / 2, { solution: { order: goal.order } satisfies SorterAnswer });
}

export const sorterSpec: WidgetSpec<SorterProps, SorterGoal, SorterAnswer> = {
  id: "sorter",
  version: 1,
  title: "Sorter",
  family: "generic",
  description: "Drag cards into labelled buckets, or rank them in a single column.",
  llmDoc: {
    useWhen: "The learner should classify 3–8 examples into 2–4 categories, or put steps or quantities in order.",
    notFor: "Free-text answers, numeric answers, or more than 8 cards.",
    learnerDoes: "Drags each card into a bucket (or into position in a ranked column), then checks.",
    reports: "{ assignment: { cardId: bucketId } } in buckets mode, { order: [cardId…] } in rank mode.",
  },
  props: SorterProps,
  goal: SorterGoal,
  answer: SorterAnswer,
  validate,
  grade,
  initialAnswer: (props) => (props.mode === "rank" ? { order: initialRankOrder(props.cards) } : { assignment: {} }),
  textAlternative: (props) =>
    props.mode === "buckets"
      ? `Sort ${props.cards.length} cards (${props.cards.map((c) => c.text).join(", ")}) into ${(props.buckets ?? [])
          .map((b) => b.label)
          .join(" or ")}.`
      : `Rank ${props.cards.length} cards from ${props.rankLabels?.[0] ?? "first"} to ${props.rankLabels?.[1] ?? "last"}: ${props.cards
          .map((c) => c.text)
          .join(", ")}.`,
  toText: (props, answer) => {
    const text = (id: string) => props.cards.find((c) => c.id === id)?.text ?? id;
    if (props.mode === "rank") return `Order: ${(answer?.order ?? props.cards.map((c) => c.id)).map(text).join(" < ")}`;
    const buckets = props.buckets ?? [];
    return buckets
      .map((b) => {
        const cards = Object.entries(answer?.assignment ?? {})
          .filter(([, bucket]) => bucket === b.id)
          .map(([card]) => text(card));
        return `${b.label}: ${cards.join(", ") || "(empty)"}`;
      })
      .join("; ");
  },
  examples: [
    {
      note: "Buckets: distance vs time units",
      props: {
        mode: "buckets",
        buckets: [
          { id: "distance", label: "Distance" },
          { id: "time", label: "Time" },
        ],
        cards: [
          { id: "km", text: "kilometre" },
          { id: "h", text: "hour" },
          { id: "mi", text: "mile" },
          { id: "s", text: "second" },
        ],
      },
      goal: { kind: "buckets", assignment: { km: "distance", mi: "distance", h: "time", s: "time" } },
      correctAnswer: { assignment: { km: "distance", mi: "distance", h: "time", s: "time" } },
      wrongAnswer: { assignment: { km: "time", mi: "distance", h: "distance", s: "time" } },
    },
    {
      note: "Rank: shortest to longest",
      props: {
        mode: "rank",
        rankLabels: ["shortest", "longest"],
        cards: [
          { id: "a", text: "45 minutes" },
          { id: "b", text: "1 hour" },
          { id: "c", text: "90 minutes" },
        ],
      },
      goal: { kind: "rank", order: ["a", "b", "c"] },
      correctAnswer: { order: ["a", "b", "c"] },
      wrongAnswer: { order: ["c", "a", "b"] },
    },
  ],
};
