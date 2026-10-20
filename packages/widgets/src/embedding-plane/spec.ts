/**
 * embedding-plane: drag words onto a 2D meaning map, then the real (projected) positions slide in.
 * Nearest neighbours, analogy arrows.
 */
import type { GradeResult } from "@learncroc/core";
import type { WidgetCanvas } from "../shared/canvas";
import { DataSource, validateSource } from "../shared/source";
import { graded } from "../shared/spec-helpers";
import { LineColor, type WidgetSpec, z } from "../shared/zod";

export const EmbeddingPlaneProps = z.strictObject({
  /** xy in 0..1. */
  points: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      xy: z.tuple([z.number(), z.number()]),
      cluster: z.string().optional(),
    }),
  ),
  clusters: z.array(z.strictObject({ id: z.string(), label: z.string(), color: LineColor })).optional(),
  /** Point ids the learner places (start in a tray; true xy revealed after). */
  placeable: z.array(z.string()).optional(),
  /** a − b + c ≈ answer (ids). */
  analogy: z.strictObject({ a: z.string(), b: z.string(), c: z.string(), answer: z.string() }).optional(),
  /** Show k nearest for a selected point. */
  showNeighbors: z.number().int().optional(),
  /** precomputed = a 2D projection of real embeddings; the projection is named in the caption. */
  source: DataSource,
});

export const EmbeddingPlaneGoal = z.discriminatedUnion("kind", [
  /** Mean distance to true xy ≤ maxDist (0..1). */
  z.strictObject({ kind: z.literal("place"), ids: z.array(z.string()), maxDist: z.number() }),
  z.strictObject({ kind: z.literal("nearest"), of: z.string(), answer: z.string() }),
  /** Uses props.analogy.answer. */
  z.strictObject({ kind: z.literal("analogy") }),
]);

export const EmbeddingPlaneAnswer = z.object({
  placed: z.record(z.string(), z.tuple([z.number(), z.number()])).optional(),
  picked: z.string().optional(),
});

export type EmbeddingPlaneProps = z.infer<typeof EmbeddingPlaneProps>;
export type EmbeddingPlaneGoal = z.infer<typeof EmbeddingPlaneGoal>;
export type EmbeddingPlaneAnswer = z.infer<typeof EmbeddingPlaneAnswer>;
export type EmbeddingPoint = EmbeddingPlaneProps["points"][number];

export function dist(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** The k points closest to `id` (excluding itself and any ids in `exclude`), nearest first. */
export function nearestTo(
  points: readonly EmbeddingPoint[],
  xy: readonly [number, number],
  k: number,
  exclude: readonly string[] = [],
): { point: EmbeddingPoint; d: number }[] {
  return points
    .filter((pt) => !exclude.includes(pt.id))
    .map((point) => ({ point, d: dist(point.xy, xy) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(0, k));
}

export function neighborsOf(points: readonly EmbeddingPoint[], id: string, k: number) {
  const p = points.find((x) => x.id === id);
  return p ? nearestTo(points, p.xy, k, [id]) : [];
}

/** Where a − b + c lands on the plane (may fall outside 0..1). */
export function analogyTarget(
  points: readonly EmbeddingPoint[],
  analogy: NonNullable<EmbeddingPlaneProps["analogy"]>,
): [number, number] | null {
  const get = (id: string) => points.find((p) => p.id === id)?.xy;
  const a = get(analogy.a);
  const b = get(analogy.b);
  const c = get(analogy.c);
  if (!a || !b || !c) return null;
  return [a[0] - b[0] + c[0], a[1] - b[1] + c[1]];
}

/** Mean distance between placed and true positions over `ids`; an unplaced word counts as 1. */
export function meanPlacementError(
  points: readonly EmbeddingPoint[],
  placed: Record<string, [number, number]> | undefined,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  let total = 0;
  for (const id of ids) {
    const truth = points.find((p) => p.id === id)?.xy;
    const at = placed?.[id];
    total += truth && at ? dist(truth, at) : 1;
  }
  return total / ids.length;
}

function validate(props: EmbeddingPlaneProps, goal?: EmbeddingPlaneGoal): string[] {
  const errors: string[] = [...validateSource(props.source)];
  const ids = props.points.map((p) => p.id);
  const has = (id: string) => ids.includes(id);
  if (props.points.length < 3 || props.points.length > 40) errors.push("embedding-plane needs 3–40 points");
  if (new Set(ids).size !== ids.length) errors.push("point ids must be unique");
  for (const p of props.points) {
    if (p.xy.some((v) => v < 0 || v > 1)) errors.push(`point "${p.id}": xy must be within 0..1`);
    if (p.cluster && !props.clusters?.some((c) => c.id === p.cluster))
      errors.push(`point "${p.id}": unknown cluster "${p.cluster}"`);
  }
  const clusterIds = (props.clusters ?? []).map((c) => c.id);
  if (new Set(clusterIds).size !== clusterIds.length) errors.push("cluster ids must be unique");
  for (const id of props.placeable ?? []) if (!has(id)) errors.push(`placeable names unknown point "${id}"`);
  if (props.placeable && props.placeable.length >= props.points.length)
    errors.push("leave at least one point on the map as a landmark");
  if (props.showNeighbors !== undefined && (props.showNeighbors < 1 || props.showNeighbors >= props.points.length))
    errors.push(`showNeighbors must be 1..${props.points.length - 1}`);
  if (props.analogy) {
    const { a, b, c, answer } = props.analogy;
    for (const id of [a, b, c, answer]) if (!has(id)) errors.push(`analogy names unknown point "${id}"`);
    if (new Set([a, b, c, answer]).size !== 4) errors.push("analogy a, b, c and answer must be four different points");
    const target = analogyTarget(props.points, props.analogy);
    if (target && has(answer)) {
      const best = nearestTo(props.points, target, 1, [a, b, c])[0];
      if (best && best.point.id !== answer)
        errors.push(`analogy: a − b + c lands nearest "${best.point.id}", not "${answer}" on this projection`);
    }
  }
  if (!goal) return errors;
  switch (goal.kind) {
    case "place":
      if (goal.ids.length === 0) errors.push("place goal needs at least one id");
      for (const id of goal.ids)
        if (!props.placeable?.includes(id)) errors.push(`place goal id "${id}" isn't placeable`);
      if (!(goal.maxDist > 0 && goal.maxDist <= 1)) errors.push("maxDist must be in (0, 1]");
      break;
    case "nearest": {
      if (!has(goal.of)) errors.push(`nearest goal names unknown point "${goal.of}"`);
      if (!has(goal.answer)) errors.push(`nearest goal names unknown point "${goal.answer}"`);
      if (goal.of === goal.answer) errors.push("nearest: of and answer must differ");
      const top = neighborsOf(props.points, goal.of, 1)[0];
      if (top && has(goal.answer) && top.point.id !== goal.answer)
        errors.push(`nearest: on this projection "${top.point.id}" is closer to "${goal.of}" than "${goal.answer}"`);
      break;
    }
    case "analogy":
      if (!props.analogy) errors.push("an analogy goal needs props.analogy");
      break;
  }
  return errors;
}

function grade({
  props,
  goal,
  answer,
}: {
  props: EmbeddingPlaneProps;
  goal: EmbeddingPlaneGoal;
  answer: EmbeddingPlaneAnswer;
}): GradeResult {
  switch (goal.kind) {
    case "place": {
      const err = meanPlacementError(props.points, answer.placed, goal.ids);
      const solution: EmbeddingPlaneAnswer = {
        placed: Object.fromEntries(
          goal.ids.flatMap((id) => {
            const p = props.points.find((x) => x.id === id);
            return p ? [[id, p.xy] as const] : [];
          }),
        ),
      };
      const ok = err <= goal.maxDist + 1e-9;
      return graded(ok, ok ? 1 : Math.max(0, Math.min(1, goal.maxDist / err)), { solution });
    }
    case "nearest":
      return graded(answer.picked === goal.answer, undefined, {
        solution: { picked: goal.answer } satisfies EmbeddingPlaneAnswer,
      });
    case "analogy": {
      const want = props.analogy?.answer;
      return graded(want !== undefined && answer.picked === want, undefined, {
        solution: want ? ({ picked: want } satisfies EmbeddingPlaneAnswer) : undefined,
      });
    }
  }
}

function labelOf(props: EmbeddingPlaneProps, id: string): string {
  return props.points.find((p) => p.id === id)?.label ?? id;
}

/** Room this widget wants on the card modal's canvas (see shared/canvas.ts). */
export const embeddingPlaneCanvas: WidgetCanvas = { minHeight: 440, prefersTall: true };

export const embeddingPlaneSpec: WidgetSpec<EmbeddingPlaneProps, EmbeddingPlaneGoal, EmbeddingPlaneAnswer> = {
  id: "embedding-plane",
  version: 1,
  title: "Embedding plane",
  family: "llm",
  description:
    "A 2D meaning map: words that mean similar things sit close together. The learner drags words to where they feel they belong (then the real projected positions slide in), finds a word's nearest neighbour, or completes an analogy arrow like king − man + woman.",
  llmDoc: {
    useWhen:
      "Meaning as position: similar words cluster, directions carry relationships (analogies), and nearest neighbours show what a model treats as related.",
    notFor: "Exact distances in high dimensions (this is a 2D projection) or more than 40 points.",
    learnerDoes:
      "place: drags tray words onto the map, then sees the true positions. nearest: taps the word closest to a given word. analogy: follows the arrow from b to a, carries it to c, and taps where it lands.",
    reports: "place → { placed: { id: [x, y] } } with x, y in 0..1 (y up); nearest and analogy → { picked: pointId }.",
  },
  props: EmbeddingPlaneProps,
  goal: EmbeddingPlaneGoal,
  answer: EmbeddingPlaneAnswer,
  validate,
  grade,
  initialAnswer: (p) => (p.placeable?.length ? { placed: {} } : {}),
  textAlternative: (p) => {
    const hidden = new Set(p.placeable ?? []);
    const onMap = p.points.filter((pt) => !hidden.has(pt.id));
    const groups = (p.clusters ?? [])
      .map((c) => {
        const members = onMap.filter((pt) => pt.cluster === c.id).map((pt) => pt.label);
        return members.length ? `${c.label}: ${members.join(", ")}` : "";
      })
      .filter(Boolean);
    const loose = onMap.filter((pt) => !pt.cluster).map((pt) => pt.label);
    const body = groups.length
      ? `${groups.join("; ")}${loose.length ? `; also ${loose.join(", ")}` : ""}`
      : onMap.map((pt) => pt.label).join(", ");
    const tray = hidden.size ? ` Words to place: ${[...hidden].map((id) => labelOf(p, id)).join(", ")}.` : "";
    const analogy = p.analogy ? ` An arrow runs from ${labelOf(p, p.analogy.b)} to ${labelOf(p, p.analogy.a)}.` : "";
    return `A meaning map where similar words sit close together. ${body}.${tray}${analogy}`;
  },
  toText: (p, a) => {
    const lines = [
      `Points: ${p.points.map((pt) => `${pt.label} (${pt.xy[0].toFixed(2)}, ${pt.xy[1].toFixed(2)})`).join(", ")}`,
    ];
    if (p.analogy)
      lines.push(`Analogy: ${labelOf(p, p.analogy.a)} − ${labelOf(p, p.analogy.b)} + ${labelOf(p, p.analogy.c)} ≈ ?`);
    if (a?.placed)
      lines.push(
        `Placed: ${Object.entries(a.placed)
          .map(([id, xy]) => `${labelOf(p, id)} (${xy[0].toFixed(2)}, ${xy[1].toFixed(2)})`)
          .join(", ")}`,
      );
    if (a?.picked) lines.push(`Picked: ${labelOf(p, a.picked)}`);
    return lines.join("\n");
  },
  explore: (p) => ({ ...p, placeable: undefined, showNeighbors: p.showNeighbors ?? 3 }),
  examples: [
    {
      note: "Place: drop “puppy” and “banana” where they belong",
      props: {
        points: [
          { id: "dog", label: "dog", xy: [0.2, 0.78], cluster: "animals" },
          { id: "cat", label: "cat", xy: [0.28, 0.7], cluster: "animals" },
          { id: "puppy", label: "puppy", xy: [0.16, 0.68], cluster: "animals" },
          { id: "apple", label: "apple", xy: [0.76, 0.3], cluster: "fruit" },
          { id: "pear", label: "pear", xy: [0.82, 0.22], cluster: "fruit" },
          { id: "banana", label: "banana", xy: [0.7, 0.18], cluster: "fruit" },
          { id: "car", label: "car", xy: [0.52, 0.86] },
        ],
        clusters: [
          { id: "animals", label: "animals", color: 1 },
          { id: "fruit", label: "fruit", color: 4 },
        ],
        placeable: ["puppy", "banana"],
        source: "illustrative",
      },
      goal: { kind: "place", ids: ["puppy", "banana"], maxDist: 0.15 },
      correctAnswer: {
        placed: {
          puppy: [0.2, 0.7],
          banana: [0.72, 0.24],
        },
      },
      wrongAnswer: {
        placed: {
          puppy: [0.75, 0.25],
          banana: [0.2, 0.75],
        },
      },
    },
    {
      note: "Analogy: king − man + woman ≈ ?",
      props: {
        points: [
          { id: "man", label: "man", xy: [0.2, 0.3], cluster: "people" },
          { id: "woman", label: "woman", xy: [0.32, 0.18], cluster: "people" },
          { id: "king", label: "king", xy: [0.62, 0.72], cluster: "royalty" },
          { id: "queen", label: "queen", xy: [0.74, 0.6], cluster: "royalty" },
          { id: "prince", label: "prince", xy: [0.55, 0.82], cluster: "royalty" },
          { id: "apple", label: "apple", xy: [0.86, 0.14] },
          { id: "child", label: "child", xy: [0.12, 0.12], cluster: "people" },
        ],
        clusters: [
          { id: "people", label: "people", color: 2 },
          { id: "royalty", label: "royalty", color: 3 },
        ],
        analogy: { a: "king", b: "man", c: "woman", answer: "queen" },
        source: "illustrative",
      },
      goal: { kind: "analogy" },
      correctAnswer: { picked: "queen" },
      wrongAnswer: { picked: "prince" },
    },
    {
      note: "Nearest: which word sits closest to “cat”?",
      props: {
        points: [
          { id: "cat", label: "cat", xy: [0.3, 0.62] },
          { id: "kitten", label: "kitten", xy: [0.26, 0.55] },
          { id: "dog", label: "dog", xy: [0.42, 0.7] },
          { id: "car", label: "car", xy: [0.8, 0.3] },
          { id: "catalog", label: "catalog", xy: [0.68, 0.82] },
        ],
        showNeighbors: 2,
        source: "illustrative",
      },
      goal: { kind: "nearest", of: "cat", answer: "kitten" },
      correctAnswer: { picked: "kitten" },
      wrongAnswer: { picked: "catalog" },
    },
  ],
};
