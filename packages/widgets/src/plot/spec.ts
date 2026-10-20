/**
 * plot: function or data chart with parameter sliders, readouts, a draggable marker and
 * "you draw it" prediction. Expressions use core/expr.ts; variables are `x`
 * and the param names; constants pi and e. The AI's main chart output.
 */
import { compileExpr, ExprError, exprVariables, LineColor, type WidgetSpec } from "@learncroc/core";
import { z } from "zod";
import type { WidgetCanvas } from "../shared/canvas";
import { graded } from "../shared/spec-helpers";

const Axis = {
  label: z.string(),
  scale: z.enum(["linear", "log"]).optional(),
  unit: z.string().optional(),
};

export const PlotProps = z.strictObject({
  title: z.string().optional(),
  kind: z.enum(["function", "data", "bar"]),
  x: z.strictObject({ ...Axis, min: z.number(), max: z.number() }),
  y: z.strictObject({ ...Axis, min: z.number().optional(), max: z.number().optional() }),
  series: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      expr: z.string().optional(),
      points: z.array(z.tuple([z.number(), z.number()])).optional(),
      bars: z.array(z.strictObject({ label: z.string(), value: z.number() })).optional(),
      color: LineColor.optional(),
    }),
  ),
  params: z
    .array(
      z.strictObject({
        name: z.string(),
        label: z.string(),
        min: z.number(),
        max: z.number(),
        step: z.number(),
        value: z.number(),
        unit: z.string().optional(),
      }),
    )
    .optional(),
  readouts: z
    .array(
      z.strictObject({
        label: z.string(),
        expr: z.string(),
        unit: z.string().optional(),
        digits: z.number().int().optional(),
      }),
    )
    .optional(),
  /** Draggable marker for answering. */
  marker: z.enum(["x", "point"]).optional(),
  /** x position of a static marker (e.g. set by a reveal). */
  markerAt: z.number().optional(),
  /** "You draw it" before the truth appears. */
  drawPrediction: z.boolean().optional(),
  dataSource: z.enum(["formula", "sources", "illustrative"]),
});

export const PlotGoal = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("param"), name: z.string(), target: z.number(), tolerance: z.number() }),
  /** tolerance is absolute, in the units of each coordinate the goal sets. */
  z.strictObject({
    kind: z.literal("point"),
    x: z.number().optional(),
    y: z.number().optional(),
    tolerance: z.number(),
  }),
  /** Mean absolute error in y-units. */
  z.strictObject({ kind: z.literal("draw"), series: z.string(), maxError: z.number() }),
  z.strictObject({ kind: z.literal("readout"), label: z.string(), target: z.number(), tolerance: z.number() }),
]);

export const PlotAnswer = z.object({
  params: z.record(z.string(), z.number()).optional(),
  point: z.tuple([z.number(), z.number()]).optional(),
  drawn: z.array(z.tuple([z.number(), z.number()])).optional(),
});

export type PlotProps = z.infer<typeof PlotProps>;
export type PlotGoal = z.infer<typeof PlotGoal>;
export type PlotAnswer = z.infer<typeof PlotAnswer>;

/** A drawn prediction needs at least this many distinct x positions to be graded as a curve. */
export const MIN_DRAWN_POINTS = 3;

/** Param values: authored defaults overridden by the answer's values. */
export function paramValues(props: PlotProps, answer?: PlotAnswer): Record<string, number> {
  const values: Record<string, number> = {};
  for (const p of props.params ?? []) values[p.name] = p.value;
  return { ...values, ...(answer?.params ?? {}) };
}

/** Evaluate a readout by label with the current params. Returns undefined if missing or not finite. */
export function readoutValue(props: PlotProps, label: string, answer?: PlotAnswer): number | undefined {
  const readout = props.readouts?.find((r) => r.label === label);
  if (!readout) return undefined;
  try {
    const v = compileExpr(readout.expr)(paramValues(props, answer));
    return Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** y of a series at x: its expression (with params), or linear interpolation of its points. */
export function seriesY(
  props: PlotProps,
  seriesId: string,
  x: number,
  params: Record<string, number> = paramValues(props),
): number | undefined {
  const s = props.series.find((it) => it.id === seriesId);
  if (!s) return undefined;
  if (s.expr) {
    try {
      const v = compileExpr(s.expr)({ ...params, x });
      return Number.isFinite(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }
  const pts = [...(s.points ?? [])].sort((a, b) => a[0] - b[0]);
  if (pts.length === 0) return undefined;
  const first = pts[0] as [number, number];
  const last = pts[pts.length - 1] as [number, number];
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i] as [number, number];
    const [x0, y0] = pts[i - 1] as [number, number];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

function checkExpr(src: string, allowed: Set<string>, where: string, errors: string[]): void {
  try {
    compileExpr(src);
    for (const v of exprVariables(src)) if (!allowed.has(v)) errors.push(`${where}: unknown variable "${v}"`);
  } catch (e) {
    errors.push(`${where}: ${e instanceof ExprError ? e.message : String(e)}`);
  }
}

function validate(props: PlotProps, goal?: PlotGoal): string[] {
  const errors: string[] = [];
  if (!(props.x.min < props.x.max)) errors.push("x.min must be less than x.max");
  if (props.x.scale === "log" && props.x.min <= 0) errors.push("a log x axis needs x.min > 0");
  if (props.y.min !== undefined && props.y.max !== undefined && !(props.y.min < props.y.max)) {
    errors.push("y.min must be less than y.max");
  }
  if (props.y.scale === "log" && props.y.min !== undefined && props.y.min <= 0)
    errors.push("a log y axis needs y.min > 0");
  if (props.series.length === 0) errors.push("plot needs at least one series");
  const params = props.params ?? [];
  const paramNames = new Set(params.map((p) => p.name));
  if (paramNames.size !== params.length) errors.push("param names must be unique");
  for (const p of params) {
    if (p.name === "x") errors.push('a param may not be called "x"');
    if (!(p.min < p.max)) errors.push(`param "${p.name}": min must be less than max`);
    if (!(p.step > 0)) errors.push(`param "${p.name}": step must be positive`);
    if (p.value < p.min || p.value > p.max) errors.push(`param "${p.name}": value outside min..max`);
  }
  const seriesIds = new Set<string>();
  for (const s of props.series) {
    if (seriesIds.has(s.id)) errors.push(`series id "${s.id}" is duplicated`);
    seriesIds.add(s.id);
    if (props.kind === "function" && !s.expr) errors.push(`series "${s.id}": function plots need expr`);
    if (props.kind === "data" && !s.expr && !s.points?.length) errors.push(`series "${s.id}": data plots need points`);
    if (props.kind === "bar" && !s.bars?.length) errors.push(`series "${s.id}": bar plots need bars`);
    if (s.expr) checkExpr(s.expr, new Set(["x", ...paramNames]), `series "${s.id}"`, errors);
  }
  for (const r of props.readouts ?? []) checkExpr(r.expr, paramNames, `readout "${r.label}"`, errors);
  if (!goal) return errors;
  switch (goal.kind) {
    case "param": {
      const p = params.find((it) => it.name === goal.name);
      if (!p) errors.push(`goal names unknown param "${goal.name}"`);
      else if (goal.target < p.min || goal.target > p.max)
        errors.push(`goal target is outside param "${p.name}" range`);
      break;
    }
    case "point":
      if (goal.x === undefined && goal.y === undefined) errors.push("a point goal needs x, y or both");
      if (!props.marker) errors.push('a point goal needs marker: "x" or "point"');
      break;
    case "draw":
      if (!seriesIds.has(goal.series)) errors.push(`goal names unknown series "${goal.series}"`);
      if (!props.drawPrediction) errors.push("a draw goal needs drawPrediction: true");
      if (props.kind === "bar") errors.push("bar charts can't be drawn");
      if (!(goal.maxError > 0)) errors.push("maxError must be > 0");
      break;
    case "readout":
      if (!props.readouts?.some((r) => r.label === goal.label))
        errors.push(`goal names unknown readout "${goal.label}"`);
      if (params.length === 0) errors.push("a readout goal needs at least one param to move");
      break;
  }
  if (goal.kind !== "draw" && goal.kind !== "point" && goal.tolerance < 0) errors.push("tolerance must be ≥ 0");
  return errors;
}

function grade({ props, goal, answer }: { props: PlotProps; goal: PlotGoal; answer: PlotAnswer }) {
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol + 1e-9;
  switch (goal.kind) {
    case "param": {
      const v = answer.params?.[goal.name];
      return graded(v !== undefined && near(v, goal.target, goal.tolerance), undefined, {
        solution: { params: { [goal.name]: goal.target } } satisfies PlotAnswer,
      });
    }
    case "point": {
      const p = answer.point;
      const ok =
        p !== undefined &&
        (goal.x === undefined || near(p[0], goal.x, goal.tolerance)) &&
        (goal.y === undefined || near(p[1], goal.y, goal.tolerance));
      const sx = goal.x ?? p?.[0] ?? props.x.min;
      const first = props.series[0];
      const sy =
        goal.y ?? (first ? seriesY(props, first.id, sx, paramValues(props, answer)) : undefined) ?? p?.[1] ?? 0;
      return graded(ok, undefined, { solution: { point: [sx, sy] } satisfies PlotAnswer });
    }
    case "draw": {
      const drawn = answer.drawn ?? [];
      // A prediction is a shape: one dot near the start (where most curves look alike) isn't one.
      if (new Set(drawn.map(([x]) => x)).size < MIN_DRAWN_POINTS)
        return graded(false, 0, { feedback: "Sketch the line across the chart, not just one spot." });
      const params = paramValues(props, answer);
      let total = 0;
      for (const [x, y] of drawn) {
        const truth = seriesY(props, goal.series, x, params);
        if (truth === undefined) return graded(false);
        total += Math.abs(truth - y);
      }
      const mae = total / drawn.length;
      const ok = mae <= goal.maxError + 1e-9;
      return graded(ok, ok ? 1 : goal.maxError / Math.max(mae, 1e-9));
    }
    case "readout": {
      const v = readoutValue(props, goal.label, answer);
      return graded(v !== undefined && near(v, goal.target, goal.tolerance));
    }
  }
}

/** Room this widget wants on the card modal's canvas (see shared/canvas.ts). */
export const plotCanvas: WidgetCanvas = { minHeight: 440, prefersTall: true };

export const plotSpec: WidgetSpec<PlotProps, PlotGoal, PlotAnswer> = {
  id: "plot",
  version: 1,
  title: "Plot",
  family: "generic",
  description:
    "A function, data or bar chart with parameter sliders, live readouts, a draggable marker and an optional draw-your-prediction mode.",
  llmDoc: {
    useWhen:
      "A relationship between two quantities matters: tuning a parameter to hit a target, reading a value, or predicting a curve's shape.",
    notFor: "Categorical sorting (use sorter) or anything without a numeric axis.",
    learnerDoes: "Moves sliders, drags a marker, or draws a predicted curve, then checks.",
    reports:
      "{ params: { name: value } } for sliders, { point: [x, y] } for the marker, { drawn: [[x, y]…] } for a drawn prediction.",
  },
  props: PlotProps,
  goal: PlotGoal,
  answer: PlotAnswer,
  validate,
  grade,
  initialAnswer: (props) => (props.params?.length ? { params: paramValues(props) } : {}),
  textAlternative: (props) => {
    const series = props.series.map((s) => s.label).join(", ");
    const sliders = props.params?.length ? ` Sliders: ${props.params.map((p) => p.label).join(", ")}.` : "";
    return `${props.title ?? "A chart"} of ${props.y.label} against ${props.x.label} (${props.x.min} to ${props.x.max}${
      props.x.unit ? ` ${props.x.unit}` : ""
    }), showing ${series}.${sliders}`;
  },
  toText: (props, answer) => {
    const parts = [`Plot of ${props.y.label} vs ${props.x.label}`];
    const values = paramValues(props, answer);
    for (const p of props.params ?? []) parts.push(`${p.label} = ${values[p.name]}${p.unit ? ` ${p.unit}` : ""}`);
    for (const r of props.readouts ?? []) {
      const v = readoutValue(props, r.label, answer);
      if (v !== undefined) parts.push(`${r.label} = ${v.toFixed(r.digits ?? 2)}${r.unit ? ` ${r.unit}` : ""}`);
    }
    if (answer?.point) parts.push(`marker at (${answer.point[0]}, ${answer.point[1]})`);
    return parts.join("; ");
  },
  examples: [
    {
      note: "Param goal: set the speed so the line passes 100 km at 2 h",
      props: {
        kind: "function",
        x: { label: "time", min: 0, max: 4, unit: "h" },
        y: { label: "distance", min: 0, max: 250, unit: "km" },
        series: [{ id: "trip", label: "trip", expr: "v * x", color: 1 }],
        params: [{ name: "v", label: "speed", min: 0, max: 100, step: 5, value: 20, unit: "km/h" }],
        dataSource: "formula",
      },
      goal: { kind: "param", name: "v", target: 50, tolerance: 2.5 },
      correctAnswer: { params: { v: 50 } },
      wrongAnswer: { params: { v: 20 } },
    },
    {
      note: "Readout goal: length contraction hits 80 m at 0.6c",
      props: {
        kind: "function",
        x: { label: "speed (fraction of c)", min: 0, max: 0.99 },
        y: { label: "train length (m)", min: 0, max: 110 },
        series: [{ id: "len", label: "train length", expr: "100 * sqrt(1 - x^2)", color: 2 }],
        params: [{ name: "v", label: "speed", min: 0, max: 0.99, step: 0.01, value: 0 }],
        readouts: [{ label: "train length", expr: "100 * sqrt(1 - v^2)", unit: "m", digits: 1 }],
        dataSource: "formula",
      },
      goal: { kind: "readout", label: "train length", target: 80, tolerance: 0.5 },
      correctAnswer: { params: { v: 0.6 } },
      wrongAnswer: { params: { v: 0.3 } },
    },
    {
      note: "Point goal: drag the marker to 40 minutes",
      props: {
        kind: "function",
        x: { label: "minutes", min: 0, max: 180, unit: "min" },
        y: { label: "hours", min: 0, max: 3, unit: "h" },
        series: [{ id: "conv", label: "hours", expr: "x / 60", color: 1 }],
        marker: "x",
        dataSource: "formula",
      },
      goal: { kind: "point", x: 40, tolerance: 2.5 },
      correctAnswer: { point: [39.6, 0.66] },
      wrongAnswer: { point: [90, 1.5] },
    },
    {
      note: "You draw it: sketch how a balance grows at 10% a year, then see the curve",
      props: {
        title: "£100 left alone at 10% a year",
        kind: "function",
        x: { label: "years", min: 0, max: 22, unit: "yr" },
        y: { label: "balance", min: 0, max: 900, unit: "£" },
        series: [{ id: "growth", label: "balance", expr: "100 * 1.1^x", color: 2 }],
        drawPrediction: true,
        dataSource: "formula",
      },
      goal: { kind: "draw", series: "growth", maxError: 60 },
      correctAnswer: {
        drawn: [
          [0, 100],
          [4, 150],
          [8, 210],
          [12, 310],
          [16, 460],
          [20, 670],
        ],
      },
      wrongAnswer: {
        drawn: [
          [0, 100],
          [4, 140],
          [8, 180],
          [12, 220],
          [16, 260],
          [20, 300],
        ],
      },
    },
  ],
};
