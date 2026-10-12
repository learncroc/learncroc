import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sorterSpec as spec } from "../src/sorter/spec";
import View, { initialRankOrder } from "../src/sorter/View";
import { expectAxeClean, gradeLast, renderView } from "./widget-harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("sorter view", () => {
  test("buckets: Space, arrows, Space sorts every card", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    // Targets in arrow order: Distance, Time, unsorted pile. Picking up a tray card starts over Distance.
    for (const [name, moves] of [
      ["kilometre", ""],
      ["hour", "{ArrowRight}"],
      ["mile", ""],
      ["second", "{ArrowRight}"],
    ] as const) {
      screen.getByRole("button", { name: new RegExp(`^${name}`) }).focus();
      await user.keyboard(` ${moves} `);
    }
    expect(r.last()?.assignment).toEqual({ km: "distance", h: "time", mi: "distance", s: "time" });
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    expect(r.announcements).toContain("second placed in Time.");
    await expectAxeClean(r.container);
  });

  test("buckets: Escape cancels a carry", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    screen.getByRole("button", { name: /^kilometre/ }).focus();
    await user.keyboard(" {ArrowRight}{Escape}");
    expect(r.changes.length).toBe(0);
    expect(r.announcements.at(-1)).toBe("kilometre put back.");
  });

  test("buckets: tap a card, then tap a bucket", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    await user.click(screen.getByRole("button", { name: /^hour/ }));
    await user.click(screen.getByRole("region", { name: /^Time/ }));
    expect(r.last()?.assignment).toEqual({ h: "time" });
  });

  test("buttons mode puts a button per bucket on every card", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    await user.click(screen.getByRole("switch", { name: "Use buttons instead" }));
    await user.click(screen.getByRole("button", { name: "Put mile in Distance" }));
    expect(r.last()?.assignment).toEqual({ mi: "distance" });
    await user.click(screen.getByRole("switch", { name: "Use buttons instead" }));
  });

  test("buckets review: misplaced cards say where they belong", () => {
    const { props, goal, wrongAnswer } = ex(0);
    renderView(View, { props, goal, mode: "review", value: wrongAnswer });
    expect(screen.getByText("belongs in Distance")).toBeInTheDocument();
    expect(screen.getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  test("rank: starts shuffled and the keyboard reaches the right order", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(1);
    const start = initialRankOrder(props.cards);
    expect(start).not.toEqual(props.cards.map((c) => c.id));
    const r = renderView(View, { props, goal });
    // Move each card to its target position: a → 1, b → 2.
    screen.getByRole("button", { name: /^45 minutes/ }).focus();
    await user.keyboard(`{Home}`);
    await user.keyboard(" ");
    const posA = start.indexOf("a");
    await user.keyboard(`${"{ArrowUp}".repeat(posA)} `);
    let order = r.last()?.order ?? start;
    const posB = order.indexOf("b");
    screen.getByRole("button", { name: /^1 hour/ }).focus();
    await user.keyboard(` ${"{ArrowUp}".repeat(posB - 1)}${posB < 1 ? "{ArrowDown}" : ""} `);
    order = r.last()?.order ?? order;
    expect(order).toEqual(["a", "b", "c"]);
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });
});
