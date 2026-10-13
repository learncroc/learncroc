import { describe, expect, test } from "bun:test";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { answeredProperTime, earliest, spacetimeDiagramSpec } from "../src/spacetime-diagram/spec";
import SpacetimeDiagramView from "../src/spacetime-diagram/View";
import { expectAxeClean, renderWidget } from "./_lang-physics-code.harness";

const spec = spacetimeDiagramSpec;
const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("spacetime-diagram spec", () => {
  test("simultaneity order matches hand-computed cases", () => {
    const events = [
      { id: "a", x: 0, t: 0, label: "A" },
      { id: "b", x: 3, t: 0, label: "B" },
    ];
    expect(earliest(events, 0)).toEqual(["a", "b"]); // simultaneous at rest
    expect(earliest(events, 0.6)).toEqual(["b"]); // t′_B = 1.25 (0 − 0.6·3) = −2.25
    expect(earliest(events, -0.6)).toEqual(["a"]);
    // (0,0) and (4,2) are simultaneous for v = 0.5 exactly.
    expect(
      earliest(
        [
          { id: "a", x: 0, t: 0, label: "A" },
          { id: "b", x: 4, t: 2, label: "B" },
        ],
        0.5,
      ),
    ).toEqual(["a", "b"]);
  });

  test("validate rejects an order goal that contradicts the physics", () => {
    const e = ex(1);
    expect(spec.validate(e.props, { kind: "order", first: "a", frameV: 0.6 }).join()).toContain('"b" happens first');
    expect(spec.validate(e.props, { kind: "order", first: "same", frameV: 0 })).toEqual([]);
    expect(spec.validate(e.props, { kind: "order", first: "same", frameV: 0.6 }).join()).toContain("not simultaneous");
  });

  test("validate catches faster-than-light worldlines, bad cones, a trivially solved place goal", () => {
    const e = ex(2);
    const bad = {
      ...e.props,
      worldlines: [
        {
          id: "w",
          label: "W",
          points: [
            [0, 0],
            [3, 1],
          ] as [number, number][],
        },
      ],
      lightCones: ["nope"],
    };
    const errors = spec.validate(bad).join("\n");
    expect(errors).toContain("faster-than-light");
    expect(errors).toContain('unknown event "nope"');
    expect(
      spec.validate(e.props, { kind: "place", event: "reply", region: "elsewhere", relativeTo: "email" }).join(),
    ).toContain("already starts");
    expect(spec.validate({ ...e.props, boost: { value: 0, min: -1, max: 0.5 } }).join()).toContain("strictly between");
  });

  test("proper time of the twin round trip at 0.8c is 6 years", () => {
    const e = ex(0);
    const r = answeredProperTime(e.props, {}, "ava");
    expect(r?.tau).toBeCloseTo(6, 12);
    expect(answeredProperTime(e.props, {}, "ben")?.tau).toBe(10);
    expect(spec.grade({ props: e.props, goal: e.goal, answer: { properTime: 6.02 } }).correct).toBe(true);
    // A faster-than-light bend never grades correct.
    const bend = ex(3);
    expect(
      spec.grade({
        props: bend.props,
        goal: bend.goal,
        answer: {
          worldlines: {
            ava: [
              [0, 0],
              [6, 5],
              [0, 10],
            ],
          },
        },
      }).correct,
    ).toBe(false);
  });
});

describe("spacetime-diagram view", () => {
  test("keyboard: bend Ava's worldline out to the star until her clock reads 6", async () => {
    const e = ex(3);
    const h = renderWidget(SpacetimeDiagramView, { props: e.props, goal: e.goal });
    const handle = screen.getByRole("button", { name: /Ava's worldline point/ });
    handle.focus();
    // Snap step is 0.25 for an 11-unit range: from x = 1 to x = 4 is 12 steps.
    for (let i = 0; i < 12; i++) fireEvent.keyDown(handle, { key: "ArrowRight" });
    const answer = h.last();
    expect(answer?.worldlines?.ava).toEqual([
      [0, 0],
      [4, 5],
      [0, 10],
    ]);
    expect(spec.grade({ props: e.props, goal: e.goal, answer: answer ?? {} }).correct).toBe(true);
    expect(h.container.querySelector('[data-proper-time="ava"]')?.textContent).toContain("6 yr");
    expect(h.announcements.at(-1)).toContain("Clock time 6 yr");
  });

  test("keyboard: drag the reply into the email's future", async () => {
    const e = ex(2);
    const h = renderWidget(SpacetimeDiagramView, { props: e.props, goal: e.goal });
    const handle = screen.getByRole("button", { name: /Friend replies at x 3, t 2/ });
    expect(h.container.querySelector('[data-order-badge="can-flip"]')).not.toBeNull();
    // Snap 0.25: move left 8 steps (x 3 → 1) and up 8 steps (t 2 → 4).
    for (let i = 0; i < 8; i++) fireEvent.keyDown(handle, { key: "ArrowLeft" });
    for (let i = 0; i < 8; i++)
      fireEvent.keyDown(screen.getByRole("button", { name: /Friend replies/ }), { key: "ArrowUp" });
    const answer = h.last();
    expect(answer?.events?.reply).toEqual([1, 4]);
    expect(spec.grade({ props: e.props, goal: e.goal, answer: answer ?? {} }).correct).toBe(true);
    expect(h.container.querySelector('[data-order-badge="agreed"]')).not.toBeNull();
  });

  test("boost slider and order pick reach correct answers", async () => {
    const e = ex(1);
    const h = renderWidget(SpacetimeDiagramView, { props: e.props, goal: e.goal });
    const group = screen.getByRole("group", { name: "Which happens first?" });
    const b = within(group).getByRole("button", { name: /Flash B/ });
    b.focus();
    await userEvent.keyboard("{Enter}");
    expect(h.last()?.first).toBe("b");
    expect(spec.grade({ props: e.props, goal: e.goal, answer: h.last() ?? {} }).correct).toBe(true);

    const e2 = ex(4);
    const h2 = renderWidget(SpacetimeDiagramView, { props: e2.props, goal: e2.goal });
    const slider = within(h2.container).getByRole("slider");
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(h2.last()?.boost).toBe(0.5);
    expect(spec.grade({ props: e2.props, goal: e2.goal, answer: h2.last() ?? {} }).correct).toBe(true);
    expect(h2.announcements.at(-1)).toContain("same time");
  });

  test("while the order is the question, the t′ labels and verdict stay hidden; review shows them", () => {
    const e = ex(1);
    const a = renderWidget(SpacetimeDiagramView, { props: e.props, goal: e.goal });
    expect(a.container.querySelectorAll("[data-simultaneity]").length).toBe(2);
    expect(a.container.textContent).not.toContain("t′ =");
    a.container.remove();
    const r = renderWidget(SpacetimeDiagramView, {
      props: e.props,
      goal: e.goal,
      mode: "review",
      value: e.correctAnswer,
    });
    expect(r.container.textContent).toContain("t′ =");
  });

  test("validate checks a proper-time target against the worldline", () => {
    const e = ex(0);
    // Ava's fixed path gives 6; a goal of 8 contradicts it.
    expect(
      spec.validate(e.props, { kind: "proper-time", worldline: "ava", target: 8, tolerance: 0.05 }).join(),
    ).toContain("has proper time 6");
    // A bendable path that already shows the target leaves nothing to do.
    const bend = ex(3);
    const solved = {
      ...bend.props,
      worldlines: bend.props.worldlines.map((w) => ({
        ...w,
        points: [
          [0, 0],
          [4, 5],
          [0, 10],
        ] as [number, number][],
      })),
    };
    expect(spec.validate(solved, bend.goal).join()).toContain("nothing to bend");
  });

  test("typed proper time for a fixed worldline", async () => {
    const e = ex(0);
    const h = renderWidget(SpacetimeDiagramView, { props: { ...e.props, readouts: [] }, goal: e.goal });
    const input = screen.getByRole("spinbutton", { name: /Clock time along Ava/ });
    await userEvent.type(input, "6");
    expect(h.last()?.properTime).toBe(6);
  });

  test("axe clean for every example, answer and review", async () => {
    for (const e of spec.examples) {
      const a = renderWidget(SpacetimeDiagramView, { props: e.props, goal: e.goal });
      await expectAxeClean(a.container);
      a.container.remove();
      const r = renderWidget(SpacetimeDiagramView, {
        props: e.props,
        goal: e.goal,
        mode: "review",
        value: e.wrongAnswer,
        solution: e.correctAnswer,
      });
      await expectAxeClean(r.container);
      r.container.remove();
    }
  });
});
