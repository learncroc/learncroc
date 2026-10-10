/**
 * Test doubles for the two widgets the fixture pack uses (sorter, plot). Core never imports
 * packages/widgets; these follow the same contract (CONTRACTS §7) with the grading the fixture needs.
 */
import { z } from "zod";
import { evaluate } from "../../src/expr";
import type { GradeResult, WidgetId, WidgetSpec, WidgetSpecRegistry } from "../../src/index";

const SorterProps = z.object({
  mode: z.enum(["buckets", "rank"]),
  buckets: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  cards: z.array(z.object({ id: z.string(), text: z.string() })),
  rankLabels: z.tuple([z.string(), z.string()]).optional(),
});
const SorterGoal = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("buckets"), assignment: z.record(z.string(), z.string()) }),
  z.object({ kind: z.literal("rank"), order: z.array(z.string()) }),
]);
const SorterAnswer = z.object({
  assignment: z.record(z.string(), z.string()).optional(),
  order: z.array(z.string()).optional(),
});
type SP = z.infer<typeof SorterProps>;
type SG = z.infer<typeof SorterGoal>;
type SA = z.infer<typeof SorterAnswer>;

const graded = (correct: boolean, extra: Partial<GradeResult> = {}): GradeResult => ({
  correct,
  score: correct ? 1 : 0,
  ...extra,
});

export const fakeSorter: WidgetSpec<SP, SG, SA> = {
  id: "sorter",
  version: 1,
  title: "Sorter",
  family: "generic",
  description: "test double",
  llmDoc: { useWhen: "", notFor: "", learnerDoes: "", reports: "" },
  props: SorterProps,
  goal: SorterGoal,
  answer: SorterAnswer,
  validate: (props, goal) => {
    const errors: string[] = [];
    if (goal && goal.kind !== props.mode) errors.push(`goal kind "${goal.kind}" doesn't match mode "${props.mode}"`);
    return errors;
  },
  grade: ({ goal, answer }) => {
    if (goal.kind === "buckets") {
      const ok = Object.entries(goal.assignment).every(([c, b]) => answer.assignment?.[c] === b);
      return graded(ok, { solution: { assignment: goal.assignment } });
    }
    const ok = JSON.stringify(goal.order) === JSON.stringify(answer.order ?? []);
    return graded(ok, { solution: { order: goal.order } });
  },
  initialAnswer: () => ({}),
  textAlternative: (p) => `${p.cards.length} cards`,
  toText: (p, a) => (a?.order ? `Order: ${a.order.join(" < ")}` : `Sorter with ${p.cards.length} cards`),
  examples: [],
};

const PlotProps = z
  .object({
    kind: z.string(),
    params: z.array(z.object({ name: z.string(), value: z.number() }).passthrough()).optional(),
    readouts: z.array(z.object({ label: z.string(), expr: z.string() }).passthrough()).optional(),
  })
  .passthrough();
const PlotGoal = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("param"), name: z.string(), target: z.number(), tolerance: z.number() }),
  z.object({ kind: z.literal("point"), x: z.number().optional(), y: z.number().optional(), tolerance: z.number() }),
  z.object({ kind: z.literal("readout"), label: z.string(), target: z.number(), tolerance: z.number() }),
]);
const PlotAnswer = z.object({
  params: z.record(z.string(), z.number()).optional(),
  point: z.tuple([z.number(), z.number()]).optional(),
});
type PP = z.infer<typeof PlotProps>;
type PG = z.infer<typeof PlotGoal>;
type PA = z.infer<typeof PlotAnswer>;

export const fakePlot: WidgetSpec<PP, PG, PA> = {
  id: "plot",
  version: 1,
  title: "Plot",
  family: "generic",
  description: "test double",
  llmDoc: { useWhen: "", notFor: "", learnerDoes: "", reports: "" },
  props: PlotProps,
  goal: PlotGoal,
  answer: PlotAnswer,
  validate: () => [],
  grade: ({ props, goal, answer }) => {
    const near = (a: number, b: number, t: number) => Math.abs(a - b) <= t + 1e-9;
    if (goal.kind === "param") {
      const v = answer.params?.[goal.name];
      return graded(v !== undefined && near(v, goal.target, goal.tolerance), {
        solution: { params: { [goal.name]: goal.target } },
      });
    }
    if (goal.kind === "point") {
      const p = answer.point;
      return graded(
        p !== undefined &&
          (goal.x === undefined || near(p[0], goal.x, goal.tolerance)) &&
          (goal.y === undefined || near(p[1], goal.y, goal.tolerance)),
      );
    }
    const vars: Record<string, number> = {};
    for (const p of props.params ?? []) vars[p.name] = answer.params?.[p.name] ?? p.value;
    const r = props.readouts?.find((x) => x.label === goal.label);
    return graded(r !== undefined && near(evaluate(r.expr, vars), goal.target, goal.tolerance));
  },
  initialAnswer: () => ({}),
  textAlternative: () => "a plot",
  toText: (_p, a) => (a?.params ? `params ${JSON.stringify(a.params)}` : "a plot"),
  examples: [],
};

// biome-ignore lint/suspicious/noExplicitAny: a heterogeneous map of specs.
const SPECS: Partial<Record<WidgetId, WidgetSpec<any, any, any>>> = { sorter: fakeSorter, plot: fakePlot };

export const fakeWidgets: WidgetSpecRegistry = {
  get: (id) => SPECS[id] as WidgetSpec<unknown, unknown, unknown> | undefined,
};
