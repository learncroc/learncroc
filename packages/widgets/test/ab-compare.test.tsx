import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { abCompareSpec as spec } from "../src/ab-compare/spec";
import View from "../src/ab-compare/View";
import { expectAxeClean, gradeLast, renderView } from "./widget-harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("ab-compare spec", () => {
  test("examples grade right and wrong", () => {
    for (const e of spec.examples) {
      const props = spec.props.parse(e.props);
      const goal = spec.goal?.parse(e.goal) as typeof e.goal;
      expect(spec.validate(props, goal)).toEqual([]);
      expect(spec.grade({ props, goal, answer: e.correctAnswer }).correct).toBe(true);
      expect(spec.grade({ props, goal, answer: e.wrongAnswer }).correct).toBe(false);
    }
  });
  test("validate catches bad props", () => {
    const p = ex(0).props;
    expect(spec.validate(p, { kind: "pick", answer: "same" }).some((e) => e.includes("allowSame"))).toBe(true);
    expect(spec.validate({ ...p, layout: "wipe" }).some((e) => e.includes("wipe"))).toBe(true);
    expect(
      spec.validate({ ...p, b: { label: "Headline A", text: "x" } }).some((e) => e.includes("different labels")),
    ).toBe(true);
    expect(spec.validate({ ...p, a: { label: "A" } }).some((e) => e.includes("text or an asset"))).toBe(true);
  });
});

describe("ab-compare view", () => {
  test("side by side: arrow keys move between the keys, Space picks", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    expect(screen.getAllByRole("radio").every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
    screen.getByRole("radio", { name: /^B ·/ }).focus();
    await user.keyboard("{ArrowLeft} ");
    expect(r.last()).toEqual({ pick: "a" });
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("toggle: F flips the card; Same is offered", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(1);
    const r = renderView(View, { props, goal });
    const flip = screen.getByRole("button", { name: "Flip to B" });
    flip.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Flip to A" })).toBeInTheDocument();
    expect(r.announcements.at(-1)).toBe("Showing B: Version B.");
    await user.click(screen.getByRole("radio", { name: /Same/ }));
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(false);
    await user.click(screen.getByRole("radio", { name: /Version A/ }));
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("wipe: the divider moves with arrow keys", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(2);
    const r = renderView(View, { props, goal });
    const divider = screen.getByRole("slider", { name: "Wipe between A and B" });
    divider.focus();
    await user.keyboard("{Home}");
    expect(divider).toHaveAttribute("aria-valuenow", "0");
    expect(r.announcements.at(-1)).toBe("All Chart B.");
    await user.click(screen.getByRole("radio", { name: /Chart B/ }));
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("review marks the answer without red", () => {
    const { props, goal } = ex(0);
    renderView(View, { props, goal, mode: "review", value: { pick: "b" } });
    expect(screen.getByText("The answer: A")).toBeInTheDocument();
  });
});
