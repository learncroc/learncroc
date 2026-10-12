import { describe, expect, test } from "bun:test";
import { WIDGET_IDS, type WidgetSpec } from "@learncroc/core";
import { WIDGET_SPECS, widgetSpecRegistry } from "../src/spec";

describe("widget specs", () => {
  test("every v0.1 widget id has a spec", () => {
    for (const id of WIDGET_IDS) {
      const spec = widgetSpecRegistry.get(id);
      expect(spec?.id).toBe(id);
      expect(spec?.version).toBe(1);
    }
    expect(Object.keys(WIDGET_SPECS).sort()).toEqual([...WIDGET_IDS].sort());
  });

  for (const spec of Object.values(WIDGET_SPECS) as WidgetSpec<unknown, unknown, unknown>[]) {
    describe(spec.id, () => {
      for (const ex of spec.examples) {
        test(`example "${ex.note}": props valid, correct answer grades correct, wrong answer doesn't`, () => {
          const props = spec.props.parse(ex.props);
          const goal = spec.goal ? spec.goal.parse(ex.goal) : ex.goal;
          expect(spec.validate(props, goal)).toEqual([]);
          expect(spec.grade({ props, goal, answer: spec.answer.parse(ex.correctAnswer) }).correct).toBe(true);
          expect(spec.grade({ props, goal, answer: spec.answer.parse(ex.wrongAnswer) }).correct).toBe(false);
        });
      }
    });
  }
});

describe("sorter", () => {
  const spec = WIDGET_SPECS.sorter;
  test("validate catches a goal that names an unknown bucket", () => {
    const ex = spec.examples[0];
    if (!ex) throw new Error("missing example");
    const errors = spec.validate(ex.props, {
      kind: "buckets",
      assignment: { km: "nowhere", h: "time", mi: "distance", s: "time" },
    });
    expect(errors.some((e) => e.includes("unknown bucket"))).toBe(true);
  });
  test("minCorrect allows partial credit to pass", () => {
    const ex = spec.examples[0];
    if (!ex) throw new Error("missing example");
    const r = spec.grade({
      props: ex.props,
      goal: { kind: "buckets", assignment: { km: "distance", mi: "distance", h: "time", s: "time" }, minCorrect: 3 },
      answer: { assignment: { km: "distance", mi: "distance", h: "time", s: "distance" } },
    });
    expect(r.correct).toBe(true);
    expect(r.score).toBe(0.75);
  });
});

describe("plot", () => {
  const spec = WIDGET_SPECS.plot;
  test("validate catches an unknown variable in an expression", () => {
    const ex = spec.examples[0];
    if (!ex) throw new Error("missing example");
    const errors = spec.validate({ ...ex.props, series: [{ id: "s", label: "s", expr: "k * x" }] });
    expect(errors.some((e) => e.includes('unknown variable "k"'))).toBe(true);
  });
  test("draw goal grades by mean absolute error", () => {
    const props = spec.props.parse({
      kind: "function",
      x: { label: "x", min: 0, max: 10 },
      y: { label: "y" },
      series: [{ id: "line", label: "line", expr: "2 * x" }],
      drawPrediction: true,
      dataSource: "formula",
    });
    const goal = { kind: "draw", series: "line", maxError: 0.5 } as const;
    expect(
      spec.grade({
        props,
        goal,
        answer: {
          drawn: [
            [1, 2.2],
            [2, 3.9],
            [3, 6.1],
          ],
        },
      }).correct,
    ).toBe(true);
    expect(
      spec.grade({
        props,
        goal,
        answer: {
          drawn: [
            [1, 5],
            [2, 1],
          ],
        },
      }).correct,
    ).toBe(false);
  });
  test("point goal checks the coordinates it sets", () => {
    const props = spec.props.parse({
      kind: "function",
      x: { label: "minutes", min: 0, max: 180 },
      y: { label: "hours" },
      series: [{ id: "c", label: "c", expr: "x / 60" }],
      marker: "point",
      dataSource: "formula",
    });
    const goal = { kind: "point", x: 40, tolerance: 2.5 } as const;
    expect(spec.grade({ props, goal, answer: { point: [41, 0.68] } }).correct).toBe(true);
    expect(spec.grade({ props, goal, answer: { point: [50, 0.83] } }).correct).toBe(false);
  });
});
