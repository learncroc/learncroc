import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type HotspotGoal, hotspotSpec as spec } from "../src/hotspot/spec";
import View from "../src/hotspot/View";
import { expectAxeClean, gradeLast, renderView } from "./widget-harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("hotspot spec", () => {
  test("examples grade right and wrong", () => {
    for (const e of spec.examples) {
      const props = spec.props.parse(e.props);
      const goal = spec.goal?.parse(e.goal) as HotspotGoal;
      expect(spec.validate(props, goal)).toEqual([]);
      expect(spec.grade({ props, goal, answer: e.correctAnswer }).correct).toBe(true);
      expect(spec.grade({ props, goal, answer: e.wrongAnswer }).correct).toBe(false);
    }
  });
  test("validate catches bad props", () => {
    const p = ex(0).props;
    expect(
      spec
        .validate({ ...p, spots: [...p.spots, { id: "far", x: 999, y: 1, r: 4, label: "far" }] })
        .some((e) => e.includes("outside")),
    ).toBe(true);
    expect(
      spec
        .validate({ ...p, spots: [{ id: "a", x: 1, y: 1, r: 2, w: 3, h: 3, label: "a" }] })
        .some((e) => e.includes("not both")),
    ).toBe(true);
    expect(
      spec.validate(p, { kind: "tap", correct: ["nope"], match: "any" }).some((e) => e.includes("unknown spot")),
    ).toBe(true);
    expect(
      spec
        .validate(ex(1).props, { kind: "label", mapping: { bulb: "lamp" } })
        .some((e) => e.includes("isn't in labels")),
    ).toBe(true);
    expect(
      spec
        .validate(p, { kind: "tap", correct: ["battery", "bulb", "switch"], match: "all" })
        .some((e) => e.includes("every spot")),
    ).toBe(true);
  });
  test("tapping everything never passes", () => {
    const { props } = ex(0);
    const all = { tapped: props.spots.map((s) => s.id) };
    expect(spec.grade({ props, goal: { kind: "tap", correct: ["battery"], match: "any" }, answer: all }).correct).toBe(
      false,
    );
    expect(
      spec.grade({ props, goal: { kind: "tap", correct: ["battery"], match: "any" }, answer: { tapped: ["battery"] } })
        .correct,
    ).toBe(true);
  });
  test("text alternative names parts by position, not by answer", () => {
    expect(spec.textAlternative(ex(0).props)).not.toContain("battery");
    expect(spec.textAlternative({ ...ex(0).props, showLabels: true })).toContain("battery");
  });
});

describe("hotspot view", () => {
  test("tap: keyboard taps a part; names stay hidden until review", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    expect(screen.queryByText("battery")).toBeNull();
    screen.getByRole("button", { name: /^part 1, / }).focus();
    await user.keyboard("{Enter}");
    expect(r.last()).toEqual({ tapped: ["battery"] });
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("tap review rings the right parts and shows names", () => {
    const { props, goal } = ex(0);
    renderView(View, { props, goal, mode: "review", value: { tapped: ["bulb"] } });
    expect(screen.getByText("battery")).toBeInTheDocument();
  });

  test("label: carry each label to its part with the keyboard", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(1);
    const r = renderView(View, { props, goal });
    // Targets: part 1 (battery), part 2 (bulb), part 3 (switch), tray. A tray label starts over part 1.
    for (const [label, moves] of [
      ["battery", ""],
      ["bulb", "{ArrowRight}"],
      ["switch", "{ArrowRight}{ArrowRight}"],
    ] as const) {
      screen.getByRole("button", { name: `${label} (not placed)` }).focus();
      await user.keyboard(` ${moves} `);
    }
    expect(r.last()?.labels).toEqual({ battery: "battery", bulb: "bulb", switch: "switch" });
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    expect(screen.getByRole("button", { name: "resistor (not placed)" })).toBeInTheDocument();
    await expectAxeClean(r.container);
  });

  test("label: dropping on a taken part sends the old label back", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(1);
    const r = renderView(View, { props, goal, value: { labels: { battery: "bulb" } } });
    screen.getByRole("button", { name: "resistor (not placed)" }).focus();
    await user.keyboard("  ");
    expect(r.last()?.labels).toEqual({ battery: "resistor" });
  });

  test("buttons mode labels parts with plain buttons", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(1);
    const r = renderView(View, { props, goal });
    await user.click(screen.getByRole("switch", { name: "Use buttons instead" }));
    await user.click(screen.getByRole("button", { name: /Label part 2, .* as bulb/ }));
    expect(r.last()?.labels).toEqual({ bulb: "bulb" });
    await user.click(screen.getByRole("switch", { name: "Use buttons instead" }));
  });
});
