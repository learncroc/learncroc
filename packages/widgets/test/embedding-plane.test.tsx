import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  analogyTarget,
  type EmbeddingPlaneGoal,
  meanPlacementError,
  neighborsOf,
  embeddingPlaneSpec as spec,
} from "../src/embedding-plane/spec";
import View from "../src/embedding-plane/View";
import { expectAxeClean, gradeLast, renderView } from "./widget-harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("embedding-plane spec", () => {
  test("examples grade right and wrong", () => {
    expect(spec.examples.length).toBeGreaterThanOrEqual(2);
    for (const e of spec.examples) {
      const props = spec.props.parse(e.props);
      const goal = spec.goal?.parse(e.goal) as EmbeddingPlaneGoal;
      expect(spec.validate(props, goal)).toEqual([]);
      expect(spec.grade({ props, goal, answer: e.correctAnswer }).correct).toBe(true);
      expect(spec.grade({ props, goal, answer: e.wrongAnswer }).correct).toBe(false);
    }
  });

  test("validate catches bad props", () => {
    const p = ex(0).props;
    expect(
      spec
        .validate({ ...p, points: [...p.points, { id: "x", label: "x", xy: [1.2, 0] }] })
        .some((e) => e.includes("0..1")),
    ).toBe(true);
    expect(spec.validate({ ...p, placeable: ["ghost"] }).some((e) => e.includes("unknown point"))).toBe(true);
    expect(
      spec.validate(p, { kind: "place", ids: ["dog"], maxDist: 0.1 }).some((e) => e.includes("isn't placeable")),
    ).toBe(true);
    const bad = { ...ex(1).props, analogy: { a: "king", b: "man", c: "woman", answer: "apple" } };
    expect(spec.validate(bad).some((e) => e.includes("lands nearest"))).toBe(true);
    expect(
      spec.validate(ex(2).props, { kind: "nearest", of: "cat", answer: "car" }).some((e) => e.includes("closer")),
    ).toBe(true);
  });

  test("geometry helpers", () => {
    const pts = ex(1).props.points;
    const t = analogyTarget(pts, { a: "king", b: "man", c: "woman", answer: "queen" });
    expect(t?.[0]).toBeCloseTo(0.74, 9);
    expect(t?.[1]).toBeCloseTo(0.6, 9);
    expect(neighborsOf(ex(2).props.points, "cat", 1)[0]?.point.id).toBe("kitten");
    expect(meanPlacementError(ex(0).props.points, {}, ["puppy"])).toBe(1);
  });
});

describe("embedding-plane view", () => {
  test("place: Space picks a word up, arrows carry it, Space drops it", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    // True positions of the words to place are hidden.
    expect(document.querySelector('[data-point="puppy"]')).toBeNull();
    screen.getByRole("button", { name: /puppy \(not placed yet\)/ }).focus();
    await user.keyboard(" ");
    expect(document.activeElement?.getAttribute("data-placed")).toBe("puppy");
    // centre (0.5, 0.5) → (0.2, 0.7): left 15 steps, up 10 steps of 0.02.
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}{ArrowLeft>5/}{Shift>}{ArrowUp}{/Shift} ");
    screen.getByRole("button", { name: /banana \(not placed yet\)/ }).focus();
    await user.keyboard(" ");
    await user.keyboard(
      "{Shift>}{ArrowRight}{/Shift}{ArrowRight}{Shift>}{ArrowDown}{/Shift}{ArrowDown}{ArrowDown}{ArrowDown} ",
    );
    const placed = r.last()?.placed ?? {};
    expect(placed.puppy?.[0]).toBeCloseTo(0.2, 6);
    expect(placed.puppy?.[1]).toBeCloseTo(0.7, 6);
    expect(placed.banana?.[0]).toBeCloseTo(0.72, 6);
    expect(placed.banana?.[1]).toBeCloseTo(0.24, 6);
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("place: Escape puts a word back in the tray", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    screen.getByRole("button", { name: /puppy \(not placed yet\)/ }).focus();
    await user.keyboard(" {ArrowLeft}{Escape}");
    expect(r.last()?.placed?.puppy).toBeUndefined();
    expect(screen.getByRole("button", { name: /puppy \(not placed yet\)/ })).toBeInTheDocument();
  });

  test("place review slides in the true positions", () => {
    const { props, goal, correctAnswer } = ex(0);
    renderView(View, { props, goal, mode: "review", value: correctAnswer });
    expect(document.querySelectorAll("[data-truth]").length).toBe(2);
  });

  test("analogy: arrows move across the words, Enter picks", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(1);
    const r = renderView(View, { props, goal });
    expect(document.querySelector("[data-carried]")).toBeNull();
    screen.getByRole("radio", { name: "queen" }).focus();
    await user.keyboard("{Enter}");
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("analogy review carries the arrow", () => {
    const { props, goal } = ex(1);
    renderView(View, { props, goal, mode: "review", value: { picked: "prince" } });
    expect(document.querySelector("[data-carried]")).not.toBeNull();
  });

  test("explore: tapping a word draws its neighbours", async () => {
    const user = userEvent.setup();
    const r = renderView(View, { props: spec.explore?.(ex(2).props) ?? ex(2).props, mode: "explore" });
    await user.click(screen.getByRole("button", { name: "cat" }));
    expect(document.querySelectorAll("[data-neighbor]").length).toBe(2);
    expect(r.announcements.at(-1)).toBe("cat: nearest kitten, dog.");
  });
});
