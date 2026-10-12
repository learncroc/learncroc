import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type AttentionWeightsGoal,
  redistribute,
  attentionWeightsSpec as spec,
  uniformWeights,
} from "../src/attention-weights/spec";
import View from "../src/attention-weights/View";
import { expectAxeClean, gradeLast, renderView } from "./widget-harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};
const total = (w: number[]) => w.reduce((a, b) => a + b, 0);

describe("attention-weights spec", () => {
  test("examples grade right and wrong", () => {
    expect(spec.examples.length).toBeGreaterThanOrEqual(2);
    for (const e of spec.examples) {
      const props = spec.props.parse(e.props);
      const goal = spec.goal?.parse(e.goal) as AttentionWeightsGoal;
      expect(spec.validate(props, goal)).toEqual([]);
      expect(spec.grade({ props, goal, answer: e.correctAnswer }).correct).toBe(true);
      expect(spec.grade({ props, goal, answer: e.wrongAnswer }).correct).toBe(false);
    }
  });

  test("validate catches bad props", () => {
    const p = ex(0).props;
    expect(spec.validate({ ...p, focus: 40 }).some((e) => e.includes("focus"))).toBe(true);
    expect(spec.validate({ ...p, weights: [0.5, 0.5] }).some((e) => e.includes("needs 12 weights"))).toBe(true);
    expect(spec.validate({ ...p, causal: true }).some((e) => e.includes("can't attend"))).toBe(true);
    expect(
      spec.validate({ ...p, tokens: Array.from({ length: 17 }, (_, i) => `w${i}`) }).some((e) => e.includes("2–16")),
    ).toBe(true);
    expect(spec.validate(p, { kind: "tap", correct: [1], match: "all" }).some((e) => e.includes('mode "tap"'))).toBe(
      true,
    );
    expect(
      spec.validate(ex(2).props, { kind: "swap", option: "tiny" }).some((e) => e.includes("isn't a swap option")),
    ).toBe(true);
  });

  test("redistribute keeps the budget at 1 and respects the mask", () => {
    const props = { tokens: ["a", "b", "c", "d"], focus: 2, causal: true };
    const allowed = [true, true, true, false];
    const u = uniformWeights(props);
    expect(u).toEqual([1 / 3, 1 / 3, 1 / 3, 0]);
    const next = redistribute(u, 0, 0.7, allowed);
    expect(next[0]).toBeCloseTo(0.7, 4);
    expect(next[3]).toBe(0);
    expect(total(next)).toBeCloseTo(1, 3);
    const all = redistribute(next, 0, 1, allowed);
    expect(all).toEqual([1, 0, 0, 0]);
    const back = redistribute(all, 0, 0.4, allowed);
    expect(back[1]).toBeCloseTo(0.3, 4);
    expect(back[2]).toBeCloseTo(0.3, 4);
  });

  test("grade rejects weight on masked tokens", () => {
    const props = spec.props.parse({ ...ex(0).props, causal: true, weights: undefined, hideWeights: false });
    const w = new Array(12).fill(0);
    w[1] = 0.5;
    w[11] = 0.5;
    expect(
      spec.grade({ props, goal: { kind: "weight", target: 1, minWeight: 0.4 }, answer: { weights: w } }).correct,
    ).toBe(false);
  });
});

describe("attention-weights view", () => {
  test("edit: keyboard raises “trophy” past the goal while the budget stays 100%", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    expect(document.querySelector('[data-arcs="reference"]')).toBeNull();
    const fader = screen.getByRole("slider", { name: "Attention to “trophy”" });
    fader.focus();
    await user.keyboard("{Shift>}{ArrowUp}{ArrowUp}{/Shift}");
    const w = r.last()?.weights ?? [];
    expect(total(w)).toBeCloseTo(1, 2);
    expect(w[1]).toBeGreaterThanOrEqual(0.4);
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("edit review shows the reference", () => {
    const { props, goal, correctAnswer } = ex(0);
    renderView(View, { props, goal, mode: "review", value: correctAnswer });
    expect(document.querySelector('[data-arcs="reference"]')).not.toBeNull();
    expect(document.querySelector('[data-arcs="learner"]')).not.toBeNull();
  });

  test("tap: keyboard toggles the right words", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(1);
    const r = renderView(View, { props, goal });
    screen.getByRole("button", { name: "dog" }).focus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: "tired" }).focus();
    await user.keyboard(" ");
    expect(r.last()).toEqual({ tapped: [1, 8] });
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    expect(screen.getByRole("button", { name: /it \(looking from here\)/ })).toBeDisabled();
    await expectAxeClean(r.container);
  });

  test("swap: arrows move between options, Space swaps the word", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(2);
    const r = renderView(View, { props, goal });
    screen.getByRole("radio", { name: "big" }).focus();
    await user.keyboard("{ArrowRight} ");
    expect(r.last()).toEqual({ swapped: "small" });
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    expect(r.announcements.at(-1)).toContain("suitcase");
    await expectAxeClean(r.container);
  });
});
