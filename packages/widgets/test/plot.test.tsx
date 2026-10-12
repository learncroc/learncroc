import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type PlotGoal, plotSpec as spec } from "../src/plot/spec";
import View, { DRAW_COLUMNS, drawColumns } from "../src/plot/View";
import { expectAxeClean, gradeLast, renderView } from "./widget-harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("plot spec (extra)", () => {
  test("every example validates and grades right and wrong", () => {
    expect(spec.examples.length).toBeGreaterThanOrEqual(4);
    for (const e of spec.examples) {
      const props = spec.props.parse(e.props);
      const goal = spec.goal?.parse(e.goal) as PlotGoal;
      expect(spec.validate(props, goal)).toEqual([]);
      expect(spec.grade({ props, goal, answer: e.correctAnswer }).correct).toBe(true);
      expect(spec.grade({ props, goal, answer: e.wrongAnswer }).correct).toBe(false);
    }
  });
  test("validate: a draw goal needs drawPrediction", () => {
    const e = ex(3);
    expect(spec.validate({ ...e.props, drawPrediction: false }, e.goal).some((m) => m.includes("drawPrediction"))).toBe(
      true,
    );
    expect(spec.validate({ ...e.props, x: { label: "x", min: 5, max: 1 } }).some((m) => m.includes("x.min"))).toBe(
      true,
    );
  });
});

describe("plot view", () => {
  test("param: arrow keys move the slider to the target and the readout follows", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    const slider = screen.getByRole("slider", { name: "speed" });
    slider.focus();
    await user.keyboard("{ArrowRight>6/}");
    expect(r.last()?.params?.v).toBe(50);
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("readout: Shift+arrows take bigger steps", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(1);
    const r = renderView(View, { props, goal });
    screen.getByRole("slider", { name: "speed" }).focus();
    await user.keyboard("{Shift>}{ArrowRight>6/}{/Shift}");
    expect(r.last()?.params?.v).toBeCloseTo(0.6, 9);
    expect(document.querySelector('[data-readout="train length"]')?.textContent).toContain("80.0");
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
  });

  test("point: the marker moves with arrows and reads y off the curve", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(2);
    const r = renderView(View, { props, goal });
    const marker = screen.getByRole("slider", { name: /Marker along minutes/ });
    marker.focus();
    await user.keyboard("{Home}{Shift>}{ArrowRight}{ArrowRight}{/Shift}{ArrowRight}{ArrowRight}");
    const pt = r.last()?.point;
    expect(pt?.[0]).toBeCloseTo(39.6, 6);
    expect(pt?.[1]).toBeCloseTo(0.66, 2);
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("draw: the curve is hidden, the keyboard sketches it, review lays the truth over it", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(3);
    const r = renderView(View, { props, goal });
    expect(document.querySelector('[data-series="growth"]')).toHaveAttribute("data-hidden", "true");
    const pad = screen.getByRole("slider", { name: /Draw your prediction/ });
    pad.focus();
    const cols = drawColumns(spec.props.parse(props));
    expect(cols.length).toBe(DRAW_COLUMNS);
    const yStep = 900 / 50;
    let cur = 450;
    for (let i = 0; i < cols.length; i++) {
      if (i > 0) await user.keyboard("{ArrowRight}");
      const truth = 100 * 1.1 ** (cols[i] as number);
      let n = Math.round((truth - cur) / yStep);
      const key = n > 0 ? "ArrowUp" : "ArrowDown";
      n = Math.abs(n);
      let keys = "";
      if (i === 0 && n === 0) keys = "{ArrowUp}{ArrowDown}";
      for (; n >= 5; n -= 5) keys += `{Shift>}{${key}}{/Shift}`;
      for (; n > 0; n--) keys += `{${key}}`;
      if (keys) await user.keyboard(keys);
      const last = r.last()?.drawn?.find(([x]) => x === cols[i]);
      cur = last?.[1] ?? cur;
    }
    expect(r.last()?.drawn?.length).toBe(DRAW_COLUMNS);
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
    r.unmount();
    renderView(View, { props, goal, mode: "review", value: r.last() });
    expect(document.querySelector('[data-series="growth"]')).not.toHaveAttribute("data-hidden");
    expect(document.querySelector("[data-gap]")).not.toBeNull();
  });

  test("bar charts render one bar per value", () => {
    renderView(View, {
      props: spec.props.parse({
        kind: "bar",
        x: { label: "fruit", min: 0, max: 1 },
        y: { label: "votes" },
        series: [
          {
            id: "v",
            label: "votes",
            bars: [
              { label: "apple", value: 3 },
              { label: "pear", value: 5 },
            ],
          },
        ],
        dataSource: "illustrative",
      }),
      mode: "explore",
    });
    expect(document.querySelectorAll("rect[rx]").length).toBe(2);
  });
});

describe("plot draw grading", () => {
  test("a single dot near the start isn't a prediction", () => {
    const { props, goal } = ex(3);
    expect(spec.grade({ props, goal, answer: { drawn: [[0, 100]] } }).correct).toBe(false);
    expect(
      spec.grade({
        props,
        goal,
        answer: {
          drawn: [
            [0, 100],
            [0, 101],
          ],
        },
      }).correct,
    ).toBe(false);
  });
  test("point goals return a solution on the curve", () => {
    const { props, goal } = ex(2);
    expect(spec.grade({ props, goal, answer: { point: [90, 1.5] } }).solution).toEqual({ point: [40, 40 / 60] });
  });
});
