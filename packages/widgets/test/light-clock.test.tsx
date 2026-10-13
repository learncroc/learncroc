import { describe, expect, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  boostEvent,
  clockGeometry,
  gamma,
  lampFirstHit,
  lightningFirstStrike,
  lightningFirstToPassenger,
  properTime,
  regionOf,
  speedForGamma,
  ticksAfter,
} from "../src/light-clock/relativity";
import { type LightClockProps, lightClockSpec } from "../src/light-clock/spec";
import { classifyTrace } from "../src/light-clock/trace";
import LightClockView from "../src/light-clock/View";
import { expectAxeClean, renderWidget } from "./_lang-physics-code.harness";

describe("relativity maths", () => {
  test("γ at 0.6c is 1.25 and at 0.8c is 5/3", () => {
    expect(gamma(0.6)).toBeCloseTo(1.25, 12);
    expect(gamma(0.8)).toBeCloseTo(5 / 3, 12);
    expect(gamma(0)).toBe(1);
    expect(speedForGamma(1.25)).toBeCloseTo(0.6, 12);
    expect(() => gamma(1)).toThrow();
  });

  test("the light clock at 0.6c is the 3-4-5 triangle", () => {
    const g = clockGeometry(0.6);
    expect(g.slide).toBeCloseTo(3, 12);
    expect(g.diagonal).toBeCloseTo(5, 12);
    expect(g.tickTime).toBeCloseTo(5, 12);
    // After 20 time units: the resting clock ticks 5 times, the moving one 4.
    expect(ticksAfter(20, 0)).toBe(5);
    expect(ticksAfter(20, 0.6)).toBe(4);
  });

  test("proper time along a two-leg worldline at 0.8c over a 10-year round trip is 6", () => {
    const r = properTime([
      [0, 0],
      [4, 5],
      [0, 10],
    ]);
    expect(r.tau).toBeCloseTo(6, 12);
    expect(r.fasterThanLight).toEqual([]);
    // The stay-at-home twin: 10.
    expect(
      properTime([
        [0, 0],
        [0, 10],
      ]).tau,
    ).toBe(10);
    // A faster-than-light leg is flagged.
    expect(
      properTime([
        [0, 0],
        [5, 1],
      ]).fasterThanLight,
    ).toEqual([0]);
  });

  test("simultaneity order matches hand-computed cases", () => {
    // Lorentz: t' = γ(t − vx). Events A (0, 0) and B (3, 0) simultaneous at rest.
    expect(boostEvent([3, 0], 0.6)[1]).toBeCloseTo(-1.25 * 0.6 * 3, 12); // −2.25: B first for an observer moving +x
    expect(boostEvent([3, 0], 0.6)[0]).toBeCloseTo(3.75, 12);
    // Lamp in mid-car: the platform sees the rear wall first, the train sees both together.
    expect(lampFirstHit(0.6, "platform")).toBe("rear");
    expect(lampFirstHit(0.6, "train")).toBe("same");
    expect(lampFirstHit(0, "platform")).toBe("same");
    // Einstein's lightning: simultaneous on the platform, front first on the train; front reaches the passenger first.
    expect(lightningFirstStrike(0.6, "platform")).toBe("same");
    expect(lightningFirstStrike(0.6, "train")).toBe("front");
    expect(lightningFirstToPassenger(0.6)).toBe("front");
  });

  test("light-cone regions", () => {
    expect(regionOf([1, 3], [0, 0])).toBe("future");
    expect(regionOf([1, -3], [0, 0])).toBe("past");
    expect(regionOf([4, 1], [0, 0])).toBe("elsewhere");
    expect(regionOf([2, 2], [0, 0])).toBe("future"); // on the cone counts as reachable by light
  });
});

describe("trace classifier", () => {
  test("straight, diagonal and curve strokes", () => {
    expect(
      classifyTrace([
        [0, 0],
        [0.1, 2],
        [0, 4],
      ]),
    ).toBe("straight");
    expect(
      classifyTrace([
        [0, 0],
        [1.5, 2],
        [3, 4],
      ]),
    ).toBe("diagonal");
    // An arc bowing out.
    expect(
      classifyTrace([
        [0, 0],
        [2.5, 1],
        [3, 2.5],
        [3, 4],
      ]),
    ).toBe("curve");
    // A keyboard staircase still reads as a diagonal.
    const stairs: [number, number][] = [[0, 0]];
    for (let i = 1; i <= 8; i++) stairs.push(i % 2 ? [stairs[i - 1]?.[0] ?? 0, i / 2] : [i * 0.375, i / 2]);
    expect(classifyTrace(stairs)).toBe("diagonal");
    expect(classifyTrace([[0, 0]])).toBeNull();
  });
});

describe("light-clock spec", () => {
  const spec = lightClockSpec;
  test("validate catches bad props and unreachable goals", () => {
    const base: LightClockProps = {
      v: 0.3,
      vRange: [0, 0.5],
      frame: "platform",
      allowFrameSwitch: false,
      task: "tick",
    };
    expect(spec.validate(base, { kind: "gamma", target: 2, tolerance: 0.05 }).join()).toContain("out of reach");
    expect(spec.validate({ ...base, v: 0.7 }).join()).toContain("outside vRange");
    expect(spec.validate({ ...base, vRange: [0.2, 0.2] }, { kind: "speed", target: 0.2, tolerance: 0.01 }).length).toBe(
      2,
    );
    expect(spec.validate({ ...base, task: "view" }, { kind: "trace", path: "diagonal" }).join()).toContain(
      'task "trace"',
    );
  });
  test("gamma goal grades by γ, not by v", () => {
    const ex = spec.examples[1];
    if (!ex) throw new Error("missing example");
    expect(spec.grade({ props: ex.props, goal: ex.goal, answer: { v: 0.795 } }).correct).toBe(true);
    expect(spec.grade({ props: ex.props, goal: ex.goal, answer: {} }).correct).toBe(false);
  });
});

describe("light-clock view", () => {
  const traceEx = lightClockSpec.examples[0];
  const speedEx = lightClockSpec.examples[2];
  if (!traceEx || !speedEx) throw new Error("missing examples");

  test("keyboard pen traces a diagonal that grades correct", async () => {
    const h = renderWidget(LightClockView, { props: traceEx.props, goal: traceEx.goal });
    const pad = screen.getByRole("application", { name: "Trace the pulse" });
    pad.focus();
    // Up and along, alternating: a staircase from the bottom mirror to the top.
    for (let i = 0; i < 8; i++) {
      fireEvent.keyDown(pad, { key: "ArrowUp" });
      if (i < 6) fireEvent.keyDown(pad, { key: "ArrowRight" });
    }
    fireEvent.keyDown(pad, { key: "Enter" });
    const answer = h.last();
    expect(answer).toEqual({ traced: "diagonal" });
    expect(lightClockSpec.grade({ props: traceEx.props, goal: traceEx.goal, answer: answer ?? {} }).correct).toBe(true);
    expect(h.announcements.at(-1)).toContain("diagonal");
  });

  test("pen straight up reads as straight", () => {
    const h = renderWidget(LightClockView, { props: traceEx.props, goal: traceEx.goal });
    const pad = screen.getByRole("application", { name: "Trace the pulse" });
    for (let i = 0; i < 8; i++) fireEvent.keyDown(pad, { key: "ArrowUp" });
    fireEvent.keyDown(pad, { key: "Enter" });
    expect(h.last()).toEqual({ traced: "straight" });
  });

  test("buttons mode answers the trace with answer keys", async () => {
    localStorage.setItem("lm:use-buttons", "1");
    try {
      const h = renderWidget(LightClockView, { props: traceEx.props, goal: traceEx.goal });
      await userEvent.click(screen.getByRole("button", { name: /zigzag of slanted diagonals/ }));
      expect(h.last()).toEqual({ traced: "diagonal" });
    } finally {
      localStorage.removeItem("lm:use-buttons");
    }
  });

  test("speed slider reaches the goal from the keyboard", async () => {
    const h = renderWidget(LightClockView, { props: speedEx.props, goal: speedEx.goal });
    const slider = screen.getByRole("slider");
    slider.focus();
    fireEvent.change(slider, { target: { value: "0.6" } });
    const answer = h.last();
    expect(answer?.v).toBeCloseTo(0.6, 9);
    expect(lightClockSpec.grade({ props: speedEx.props, goal: speedEx.goal, answer: answer ?? {} }).correct).toBe(true);
  });

  test("tick counters show the moving clock falling behind by γ", async () => {
    const h = renderWidget(LightClockView, {
      props: { v: 0.6, vRange: [0.6, 0.6], frame: "platform", allowFrameSwitch: true, task: "view", showTicks: true },
      mode: "explore",
    });
    // Reduced motion starts two moving ticks in (10 time units): the train clock shows 2, the platform 2 (10/4).
    for (let i = 0; i < 2; i++) await userEvent.click(screen.getByRole("button", { name: "Step one tick" }));
    const train = h.container.querySelector('[data-ticks="train"]')?.textContent;
    const platform = h.container.querySelector('[data-ticks="platform"]')?.textContent;
    // 18 units: moving 18/5 → 3, resting 18/4 → 4.
    expect(train).toBe("3 ticks");
    expect(platform).toBe("4 ticks");
    await userEvent.click(screen.getByRole("button", { name: "From the train" }));
    expect(h.announcements).toContain("Seen from the train.");
  });

  test("pushing past 0.99c shows Mira's easter egg", () => {
    const h = renderWidget(LightClockView, {
      props: { v: 0.99, vRange: [0, 0.99], frame: "platform", allowFrameSwitch: false, task: "view" },
      mode: "explore",
    });
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(h.container.querySelector("[data-easter-egg]")).not.toBeNull();
    expect(h.container.textContent).toContain("Nice try.");
  });

  test("the easter egg also works when the range ends at 0.999 (the slider's last step is 0.99)", () => {
    const h = renderWidget(LightClockView, {
      props: { v: 0.99, vRange: [0, 0.999], frame: "platform", allowFrameSwitch: false, task: "view" },
      mode: "explore",
    });
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(h.container.querySelector("[data-easter-egg]")).not.toBeNull();
  });

  test("axe clean in answer, trace and review modes", async () => {
    const a = renderWidget(LightClockView, { props: speedEx.props, goal: speedEx.goal });
    await expectAxeClean(a.container);
    a.container.remove();
    const b = renderWidget(LightClockView, { props: traceEx.props, goal: traceEx.goal });
    await expectAxeClean(b.container);
    b.container.remove();
    const c = renderWidget(LightClockView, {
      props: traceEx.props,
      goal: traceEx.goal,
      mode: "review",
      value: { traced: "straight" },
      solution: { traced: "diagonal" },
      revealProps: { showTriangle: true },
    });
    expect(c.container.querySelector("[data-triangle]")).not.toBeNull();
    await expectAxeClean(c.container);
  });
});
