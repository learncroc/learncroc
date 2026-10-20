/**
 * hotspot: tap parts of an SVG, or drag labels onto hotspots.
 */
import type { GradeResult } from "@learncroc/core";
import { setMatch } from "../shared/math";
import { graded } from "../shared/spec-helpers";
import { AssetPath, type WidgetSpec, z } from "../shared/zod";

export const HotspotProps = z.strictObject({
  /** svg or png. */
  image: AssetPath,
  /** Width, height of the image coordinate space. */
  viewBox: z.tuple([z.number(), z.number()]),
  spots: z.array(
    z.strictObject({
      id: z.string(),
      x: z.number(),
      y: z.number(),
      r: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
      label: z.string(),
    }),
  ),
  mode: z.enum(["tap", "label"]),
  /** label mode: draggable labels (may include distractors). */
  labels: z.array(z.string()).optional(),
  /** Explore mode. */
  showLabels: z.boolean().optional(),
});

export const HotspotGoal = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("tap"), correct: z.array(z.string()), match: z.enum(["any", "all"]) }),
  /** spot id → label. */
  z.strictObject({ kind: z.literal("label"), mapping: z.record(z.string(), z.string()) }),
]);

export const HotspotAnswer = z.object({
  tapped: z.array(z.string()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

export type HotspotProps = z.infer<typeof HotspotProps>;
export type HotspotGoal = z.infer<typeof HotspotGoal>;
export type HotspotAnswer = z.infer<typeof HotspotAnswer>;
export type HotspotSpot = HotspotProps["spots"][number];

/** Default radius when a spot has neither r nor w/h: 4% of the shorter side. */
export function spotRadius(props: Pick<HotspotProps, "viewBox">, spot: HotspotSpot): number {
  return spot.r ?? Math.min(props.viewBox[0], props.viewBox[1]) * 0.04;
}

/** Bounding box of a spot in image coordinates (x, y is the centre). */
export function spotBox(
  props: Pick<HotspotProps, "viewBox">,
  spot: HotspotSpot,
): { x0: number; y0: number; x1: number; y1: number } {
  if (spot.w !== undefined && spot.h !== undefined)
    return { x0: spot.x - spot.w / 2, y0: spot.y - spot.h / 2, x1: spot.x + spot.w / 2, y1: spot.y + spot.h / 2 };
  const r = spotRadius(props, spot);
  return { x0: spot.x - r, y0: spot.y - r, x1: spot.x + r, y1: spot.y + r };
}

/** "upper left", "centre"… for naming a spot without giving its answer away. */
export function spotPlace(props: Pick<HotspotProps, "viewBox">, spot: Pick<HotspotSpot, "x" | "y">): string {
  const fx = spot.x / props.viewBox[0];
  const fy = spot.y / props.viewBox[1];
  const v = fy < 0.34 ? "upper" : fy > 0.66 ? "lower" : "middle";
  const h = fx < 0.34 ? "left" : fx > 0.66 ? "right" : "centre";
  return v === "middle" && h === "centre" ? "centre" : `${v} ${h}`;
}

function validate(props: HotspotProps, goal?: HotspotGoal): string[] {
  const errors: string[] = [];
  const [vw, vh] = props.viewBox;
  if (!(vw > 0 && vh > 0)) errors.push("viewBox width and height must be positive");
  if (!/\.(svg|png|webp)$/i.test(props.image)) errors.push("image must be an .svg, .png or .webp asset");
  if (props.spots.length < 1 || props.spots.length > 12) errors.push("hotspot needs 1–12 spots");
  const ids = props.spots.map((s) => s.id);
  if (new Set(ids).size !== ids.length) errors.push("spot ids must be unique");
  for (const s of props.spots) {
    if (s.r !== undefined && (s.w !== undefined || s.h !== undefined))
      errors.push(`spot "${s.id}": use r or w/h, not both`);
    if ((s.w === undefined) !== (s.h === undefined)) errors.push(`spot "${s.id}": w and h go together`);
    if (s.r !== undefined && !(s.r > 0)) errors.push(`spot "${s.id}": r must be positive`);
    if (s.x < 0 || s.y < 0 || s.x > vw || s.y > vh) errors.push(`spot "${s.id}": centre is outside the viewBox`);
    if (!s.label.trim()) errors.push(`spot "${s.id}": label may not be empty`);
  }
  const labels = props.labels ?? [];
  if (props.mode === "label") {
    if (labels.length < 2) errors.push("label mode needs at least 2 labels");
    if (new Set(labels).size !== labels.length) errors.push("labels must be unique");
  }
  if (!goal) return errors;
  if (goal.kind !== props.mode) errors.push(`goal kind "${goal.kind}" doesn't match mode "${props.mode}"`);
  if (goal.kind === "tap") {
    if (goal.correct.length === 0) errors.push("tap goal needs at least one correct spot");
    for (const id of goal.correct) if (!ids.includes(id)) errors.push(`tap goal names unknown spot "${id}"`);
    if (goal.correct.length === props.spots.length)
      errors.push("every spot is correct: add at least one spot that isn't");
  } else {
    const entries = Object.entries(goal.mapping);
    if (entries.length === 0) errors.push("label goal needs at least one spot → label");
    for (const [spot, label] of entries) {
      if (!ids.includes(spot)) errors.push(`label goal names unknown spot "${spot}"`);
      if (!labels.includes(label)) errors.push(`label goal uses "${label}", which isn't in labels`);
    }
  }
  return errors;
}

function grade({ goal, answer }: { props: HotspotProps; goal: HotspotGoal; answer: HotspotAnswer }): GradeResult {
  if (goal.kind === "tap") {
    const r = setMatch(answer.tapped ?? [], goal.correct, goal.match);
    return graded(r.ok, r.score, { solution: { tapped: goal.correct } satisfies HotspotAnswer });
  }
  const entries = Object.entries(goal.mapping);
  const right = entries.filter(([spot, label]) => answer.labels?.[spot] === label).length;
  return graded(entries.length > 0 && right === entries.length, entries.length ? right / entries.length : 0, {
    solution: { labels: goal.mapping } satisfies HotspotAnswer,
  });
}

export const hotspotSpec: WidgetSpec<HotspotProps, HotspotGoal, HotspotAnswer> = {
  id: "hotspot",
  version: 1,
  title: "Hotspot",
  family: "generic",
  description: "A picture with marked parts. The learner taps the right parts, or drags labels onto them.",
  llmDoc: {
    useWhen: "Parts of a diagram matter: a circuit, an eye, a code listing, a map, a chart's features.",
    notFor: "Ordering or categorising (use sorter), or pictures where the parts aren't separable regions.",
    learnerDoes:
      "tap: taps the parts that answer the question (a wrong tap never passes; match any = one right part, all = every right part). label: drags each label onto its part (distractor labels allowed).",
    reports: "tap → { tapped: [spotId…] }; label → { labels: { spotId: label } }.",
  },
  props: HotspotProps,
  goal: HotspotGoal,
  answer: HotspotAnswer,
  validate,
  grade,
  initialAnswer: (p) => (p.mode === "tap" ? { tapped: [] } : { labels: {} }),
  textAlternative: (p) => {
    const parts = p.spots.map((s, i) =>
      p.showLabels ? `${s.label} (${spotPlace(p, s)})` : `part ${i + 1} (${spotPlace(p, s)})`,
    );
    const labels = p.mode === "label" && p.labels?.length ? ` Labels to place: ${p.labels.join(", ")}.` : "";
    return `A picture with ${p.spots.length} marked part${p.spots.length === 1 ? "" : "s"}: ${parts.join(", ")}.${labels}`;
  },
  toText: (p, a) => {
    const lines = [`Parts: ${p.spots.map((s) => `${s.id} = ${s.label}`).join(", ")}`];
    if (a?.tapped) lines.push(`Tapped: ${a.tapped.join(", ") || "(none)"}`);
    if (a?.labels)
      lines.push(
        `Labels: ${Object.entries(a.labels)
          .map(([s, l]) => `${s} ← ${l}`)
          .join(", ")}`,
      );
    return lines.join("\n");
  },
  explore: (p) => ({ ...p, showLabels: true }),
  examples: [
    {
      note: "Tap: which part pushes the current round the circuit?",
      props: {
        image: "assets/img/circuit.svg",
        viewBox: [320, 200],
        spots: [
          { id: "battery", x: 60, y: 100, w: 52, h: 70, label: "battery" },
          { id: "bulb", x: 200, y: 44, r: 26, label: "bulb" },
          { id: "switch", x: 262, y: 150, w: 56, h: 36, label: "switch" },
        ],
        mode: "tap",
      },
      goal: { kind: "tap", correct: ["battery"], match: "all" },
      correctAnswer: { tapped: ["battery"] },
      wrongAnswer: { tapped: ["battery", "bulb"] },
    },
    {
      note: "Label: name the parts of the circuit (one label is a decoy)",
      props: {
        image: "assets/img/circuit.svg",
        viewBox: [320, 200],
        spots: [
          { id: "battery", x: 60, y: 100, w: 52, h: 70, label: "battery" },
          { id: "bulb", x: 200, y: 44, r: 26, label: "bulb" },
          { id: "switch", x: 262, y: 150, w: 56, h: 36, label: "switch" },
        ],
        mode: "label",
        labels: ["bulb", "battery", "switch", "resistor"],
      },
      goal: { kind: "label", mapping: { battery: "battery", bulb: "bulb", switch: "switch" } },
      correctAnswer: { labels: { battery: "battery", bulb: "bulb", switch: "switch" } },
      wrongAnswer: { labels: { battery: "bulb", bulb: "battery", switch: "switch" } },
    },
  ],
};
