import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  applyTemperature,
  initialRanking,
  type ProbabilityBarsGoal,
  type ProbabilityBarsProps,
  predictionL1,
  probabilityBarsSpec as spec,
  truthRanking,
} from "../src/probability-bars/spec";
import View from "../src/probability-bars/View";
import { expectAxeClean, gradeLast, renderView } from "./widget-harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("probability-bars spec", () => {
  test("has at least two examples, each grading right and wrong", () => {
    expect(spec.examples.length).toBeGreaterThanOrEqual(2);
    for (const e of spec.examples) {
      const props = spec.props.parse(e.props);
      const goal = spec.goal?.parse(e.goal) as ProbabilityBarsGoal;
      expect(spec.validate(props, goal)).toEqual([]);
      expect(spec.grade({ props, goal, answer: e.correctAnswer }).correct).toBe(true);
      expect(spec.grade({ props, goal, answer: e.wrongAnswer }).correct).toBe(false);
    }
  });

  test("validate catches bad props", () => {
    const base = ex(0).props;
    expect(spec.validate({ ...base, tokens: base.tokens.slice(0, 2) })).toContain("tokens: needs 3–8 tokens");
    expect(
      spec
        .validate({ ...base, tokens: base.tokens.map((t) => ({ ...t, p: 0.5 })) })
        .some((e) => e.includes("more than 1")),
    ).toBe(true);
    expect(spec.validate(base, { kind: "pick", token: " soup" }).some((e) => e.includes("isn't one of the bars"))).toBe(
      true,
    );
    expect(spec.validate(base, { kind: "rank", topK: 9, minOverlap: 1 }).some((e) => e.includes("topK"))).toBe(true);
    expect(spec.validate({ ...base, task: "loop" }).some((e) => e.includes("loop.steps"))).toBe(true);
    expect(spec.validate({ ...base, source: "precomputed:" }).some((e) => e.includes("model id"))).toBe(true);
  });

  test("temperature sharpens when cold and flattens when hot", () => {
    const tokens = ex(1).props.tokens;
    const cold = applyTemperature(tokens, 0.2);
    const hot = applyTemperature(tokens, 2);
    const base = applyTemperature(tokens, 1);
    expect(cold[0]).toBeGreaterThan(0.9);
    expect(hot[0]).toBeLessThan(base[0] ?? 0);
    expect(base[0]).toBeCloseTo(0.31, 6);
    for (const d of [cold, hot, base]) expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  test("L1 includes the 'everything else' remainder", () => {
    const tokens = [
      { text: "a", p: 0.5 },
      { text: "b", p: 0.3 },
      { text: "c", p: 0.1 },
    ];
    expect(predictionL1(tokens, [0.5, 0.3, 0.1])).toBeCloseTo(0, 9);
    expect(predictionL1(tokens, [0, 0, 0])).toBeCloseTo(0.9 + 0.9, 9);
    expect(truthRanking(tokens)).toEqual(["a", "b", "c"]);
  });

  test("text alternative hides the truth when the task does", () => {
    expect(spec.textAlternative(ex(0).props)).not.toContain("31%");
    expect(spec.textAlternative(ex(3).props)).toContain("86%");
  });
});

describe("probability-bars view", () => {
  test("predict: keyboard reaches a correct guess, the budget holds, truth stays hidden", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    expect(document.querySelector("[data-truth]")).toBeNull();
    const coffee = screen.getByRole("slider", { name: /coffee/ });
    coffee.focus();
    await user.keyboard("{PageUp}{PageUp}{PageUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}");
    const tea = screen.getByRole("slider", { name: /tea/ });
    tea.focus();
    await user.keyboard("{PageUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}");
    const cereal = screen.getByRole("slider", { name: /cereal/ });
    cereal.focus();
    await user.keyboard("{PageUp}");
    const bowl = screen.getByRole("slider", { name: /bowl/ });
    bowl.focus();
    await user.keyboard("{ArrowUp>5/}");
    expect(r.last()?.probs).toEqual([0.35, 0.15, 0.1, 0.05]);
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    // Budget: 65% used, so bowl can't pass 70%.
    await user.keyboard("{End}");
    expect(r.last()?.probs?.[3]).toBeCloseTo(0.4, 6);
    expect(r.announcements.some((a) => a.startsWith("Budget full"))).toBe(true);
    await expectAxeClean(r.container);
  });

  test("predict review shows the real bars", () => {
    const { props, goal, correctAnswer } = ex(0);
    renderView(View, { props, goal, mode: "review", value: correctAnswer });
    expect(document.querySelectorAll("[data-truth]").length).toBe(props.tokens.length + 1);
    expect(screen.getAllByRole("slider")[0]).toHaveAttribute("aria-readonly", "true");
  });

  test("temperature: keyboard turns the dial into the goal range", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(1);
    const r = renderView(View, { props, goal });
    const dial = screen.getByRole("slider", { name: "Temperature" });
    dial.focus();
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(r.last()?.temperature).toBeCloseTo(0.3, 6);
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await user.click(screen.getByRole("button", { name: /Sample 10/ }));
    expect(document.querySelector("[data-draws]")).not.toBeNull();
    await expectAxeClean(r.container);
  });

  test("rank: Space picks a chip up, arrows move it, Space drops it", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(2);
    const start = initialRanking(props.tokens);
    // Chips start shuffled (never the authored order), and an untouched Check grades what is shown.
    expect(start).not.toEqual(props.tokens.map((t) => t.text));
    expect(spec.initialAnswer(props).ranking).toEqual(start);
    const r = renderView(View, { props, goal });
    expect(screen.getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(start.map((t) => t.trim()));
    screen.getByRole("button", { name: /^Paris/ }).focus();
    await user.keyboard(` ${"{ArrowUp}".repeat(start.indexOf(" Paris"))} `);
    expect(r.last()?.ranking?.[0] ?? start[0]).toBe(" Paris");
    const order = r.last()?.ranking ?? start;
    screen.getByRole("button", { name: /^the/ }).focus();
    await user.keyboard(` ${"{ArrowUp}".repeat(order.indexOf(" the") - 1)} `);
    expect(r.last()?.ranking?.slice(0, 2)).toEqual([" Paris", " the"]);
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("rank and loop grading can't be gamed", () => {
    const rank = ex(2);
    expect(spec.grade({ props: rank.props, goal: rank.goal, answer: { ranking: [" Paris", " Paris"] } }).correct).toBe(
      false,
    );
    const loop = ex(4);
    expect(spec.grade({ props: loop.props, goal: loop.goal, answer: { appended: ["x", "y", "z"] } }).correct).toBe(
      false,
    );
    expect(
      spec.grade({ props: loop.props, goal: loop.goal, answer: { appended: [" floor", ",", " slept"] } }).correct,
    ).toBe(true);
  });

  test("pick: tapping a bar picks it", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(3);
    const r = renderView(View, { props, goal });
    await user.click(screen.getByRole("radio", { name: /^time/ }));
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("loop: score → pick → append three times", async () => {
    const user = userEvent.setup();
    const props: ProbabilityBarsProps = ex(4).props;
    const goal = ex(4).goal;
    const r = renderView(View, { props, goal });
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: /Score/ }));
      await user.click(screen.getByRole("button", { name: /Pick/ }));
      await user.click(screen.getByRole("button", { name: /Append/ }));
    }
    expect(r.last()?.appended?.length).toBe(3);
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    expect(screen.getByText(/every step we computed/)).toBeInTheDocument();
    await expectAxeClean(r.container);
  });
});
