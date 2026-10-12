/**
 * ab-compare: flip, wipe or compare two panels, then say which (CONTRACTS §7.2 #8). The "why" is
 * the interaction's own feedback; the widget makes the contrast easy to see.
 */
import type { GradeResult } from "@learncroc/core";
import { graded } from "../shared/spec-helpers";
import { AssetPath, Markdown, type WidgetSpec, z } from "../shared/zod";

export const AbComparePanel = z.strictObject({
  label: z.string(),
  text: Markdown.optional(),
  asset: AssetPath.optional(),
  caption: z.string().optional(),
});

export const AbCompareProps = z.strictObject({
  a: AbComparePanel,
  b: AbComparePanel,
  layout: z.enum(["side-by-side", "toggle", "wipe"]),
  allowSame: z.boolean().optional(),
});

export const AbCompareGoal = z.strictObject({ kind: z.literal("pick"), answer: z.enum(["a", "b", "same"]) });
export const AbCompareAnswer = z.object({ pick: z.enum(["a", "b", "same"]) });

export type AbComparePanel = z.infer<typeof AbComparePanel>;
export type AbCompareProps = z.infer<typeof AbCompareProps>;
export type AbCompareGoal = z.infer<typeof AbCompareGoal>;
export type AbCompareAnswer = z.infer<typeof AbCompareAnswer>;

function validate(props: AbCompareProps, goal?: AbCompareGoal): string[] {
  const errors: string[] = [];
  for (const key of ["a", "b"] as const) {
    const panel = props[key];
    if (!panel.text && !panel.asset) errors.push(`panel ${key} needs text or an asset`);
    if (!panel.label.trim()) errors.push(`panel ${key} needs a label`);
    if (panel.text && panel.text.split(/\s+/).filter(Boolean).length > 60)
      errors.push(`panel ${key}: keep text under 60 words`);
  }
  if (props.a.label.trim() === props.b.label.trim()) errors.push("the two panels need different labels");
  if (props.layout === "wipe" && !(props.a.asset && props.b.asset))
    errors.push("wipe layout needs an image on both panels");
  if (goal?.answer === "same" && !props.allowSame) errors.push('goal answer "same" needs allowSame: true');
  return errors;
}

function grade({ goal, answer }: { props: AbCompareProps; goal: AbCompareGoal; answer: AbCompareAnswer }): GradeResult {
  return graded(answer.pick === goal.answer, undefined, { solution: { pick: goal.answer } satisfies AbCompareAnswer });
}

const describePanel = (p: AbComparePanel) =>
  `${p.label}${p.text ? `: ${p.text}` : ""}${p.caption ? ` (${p.caption})` : ""}`;

export const abCompareSpec: WidgetSpec<AbCompareProps, AbCompareGoal, AbCompareAnswer> = {
  id: "ab-compare",
  version: 1,
  title: "A/B compare",
  family: "generic",
  description:
    "Two versions of the same thing: side by side, flipped like a card, or wiped across like a before/after photo. The learner picks A, B or (if allowed) the same.",
  llmDoc: {
    useWhen:
      "Contrasting cases: two versions that differ in one important way (two headlines, two charts, two sentences, two designs), so the difference itself is the lesson.",
    notFor: "More than two options (use a choice interaction), or panels that differ in many ways at once.",
    learnerDoes: "Compares the panels (flipping or wiping between them), then picks A, B or same.",
    reports: '{ pick: "a" | "b" | "same" }',
  },
  props: AbCompareProps,
  goal: AbCompareGoal,
  answer: AbCompareAnswer,
  validate,
  grade,
  initialAnswer: () => ({ pick: "a" }),
  textAlternative: (p) =>
    `Two panels to compare. A, ${describePanel(p.a)}. B, ${describePanel(p.b)}.${p.allowSame ? " They might be the same." : ""}`,
  toText: (p, a) => `A: ${describePanel(p.a)}\nB: ${describePanel(p.b)}${a ? `\nPicked: ${a.pick}` : ""}`,
  examples: [
    {
      note: "Side by side: which headline makes a vaguer claim?",
      props: {
        a: { label: "Headline A", text: "**Coffee linked to longer life**" },
        b: {
          label: "Headline B",
          text: "**Coffee drinkers in a 10-year study of 400,000 adults lived slightly longer**",
        },
        layout: "side-by-side",
      },
      goal: { kind: "pick", answer: "a" },
      correctAnswer: { pick: "a" },
      wrongAnswer: { pick: "b" },
    },
    {
      note: "Toggle: flip between them. Which one invites Grandma to dinner?",
      props: {
        a: { label: "Version A", text: "Let's eat, Grandma." },
        b: { label: "Version B", text: "Let's eat Grandma." },
        layout: "toggle",
        allowSame: true,
      },
      goal: { kind: "pick", answer: "a" },
      correctAnswer: { pick: "a" },
      wrongAnswer: { pick: "same" },
    },
    {
      note: "Wipe: which chart starts its axis at zero?",
      props: {
        a: { label: "Chart A", asset: "assets/img/axis-cropped.svg", caption: "Sales, 2023 vs 2024" },
        b: { label: "Chart B", asset: "assets/img/axis-zero.svg", caption: "Sales, 2023 vs 2024" },
        layout: "wipe",
      },
      goal: { kind: "pick", answer: "b" },
      correctAnswer: { pick: "b" },
      wrongAnswer: { pick: "a" },
    },
  ],
};
