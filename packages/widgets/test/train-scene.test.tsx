import { describe, expect, test } from "bun:test";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fmt, gamma } from "../src/light-clock/relativity";
import { pulseX, sceneModel, seenAt } from "../src/train-scene/scene";
import { trainSceneSpec } from "../src/train-scene/spec";
import TrainSceneView from "../src/train-scene/View";
import { expectAxeClean, renderWidget } from "./_lang-physics-code.harness";

describe("train-scene kinematics", () => {
  test("lamp from the platform: rear wall at t = 2, front at t = 8 (v = 0.6, car 8 long)", () => {
    const m = sceneModel("lamp", 0.6, "platform");
    // Car contracted to 6.4: half 3.2. Rear: 3.2 / 1.6 = 2. Front: 3.2 / 0.4 = 8.
    expect(m.carHalf).toBeCloseTo(8 / 2 / gamma(0.6), 12);
    const rear = m.stamps.find((s) => s.id === "hit-rear");
    const front = m.stamps.find((s) => s.id === "hit-front");
    expect(rear?.t).toBeCloseTo(2, 12);
    expect(front?.t).toBeCloseTo(8, 12);
    // The pulse meets the wall exactly where the wall is at that moment.
    expect(m.carCenter(2) - m.carHalf).toBeCloseTo(-2, 12);
    expect(pulseX(m.pulses[0] as never, 2)).toBeCloseTo(-2, 12);
  });

  test("lamp inside the train: both walls at t = 4", () => {
    const m = sceneModel("lamp", 0.6, "train");
    for (const s of m.stamps) expect(s.t).toBeCloseTo(4, 12);
  });

  test("delay correction keeps the platform's order (rear first)", () => {
    const m = sceneModel("lamp", 0.6, "platform");
    const [rear, front] = m.timed;
    if (!rear || !front) throw new Error("missing events");
    expect(seenAt(rear)).toBeCloseTo(4, 12);
    expect(seenAt(front)).toBeCloseTo(16, 12);
    expect(rear.t < front.t).toBe(true);
  });

  test("lightning: simultaneous on the platform, front strike first on the train", () => {
    const pm = sceneModel("lightning", 0.6, "platform");
    const tm = sceneModel("lightning", 0.6, "train");
    const t = (m: typeof pm, id: string) => m.timed.find((e) => e.id === id)?.t ?? Number.NaN;
    expect(t(pm, "flash-front")).toBeCloseTo(t(pm, "flash-rear"), 12);
    expect(t(tm, "flash-front")).toBeCloseTo(-2.4, 12); // −v·L/2 with L = 8
    expect(t(tm, "flash-rear")).toBeCloseTo(2.4, 12);
  });
});

describe("train-scene spec", () => {
  test("validate catches a physically wrong lamp goal and a foreign pick", () => {
    const props = { scenario: "lamp", v: 0.6, frame: "platform", allowFrameSwitch: false } as const;
    expect(trainSceneSpec.validate(props, { kind: "pick", answer: "front" }).join()).toContain("rear wall first");
    expect(trainSceneSpec.validate(props, { kind: "pick", answer: "c" }).join()).toContain("isn't one");
    expect(trainSceneSpec.validate({ ...props, v: 1.2 }).join()).toContain("between 0 and 0.99");
    expect(
      trainSceneSpec.validate({ ...props, scenario: "headlight" }, { kind: "pick", answer: "faster" }).join(),
    ).toContain('must be "c"');
    // With the frame switch, either frame may be asked about, but "front" is never true for the lamp.
    const switchable = { ...props, allowFrameSwitch: true };
    expect(trainSceneSpec.validate(switchable, { kind: "pick", answer: "same" })).toEqual([]);
    expect(trainSceneSpec.validate(switchable, { kind: "pick", answer: "front" }).join()).toContain("never");
  });

  test("validate knows which lightning answers can be true", () => {
    const props = { scenario: "lightning", v: 0.6, frame: "platform", allowFrameSwitch: false } as const;
    // Platform: strikes simultaneous; the passenger still gets the front flash first.
    expect(trainSceneSpec.validate(props, { kind: "pick", answer: "same" })).toEqual([]);
    expect(trainSceneSpec.validate(props, { kind: "pick", answer: "front" })).toEqual([]);
    expect(trainSceneSpec.validate(props, { kind: "pick", answer: "rear" }).join()).toContain("never");
    // Train frame: only the front strike comes first.
    expect(trainSceneSpec.validate({ ...props, frame: "train" }, { kind: "pick", answer: "same" }).join()).toContain(
      "never",
    );
    // At rest everything is simultaneous.
    expect(trainSceneSpec.validate({ ...props, v: 0 }, { kind: "pick", answer: "front" }).join()).toContain("never");
  });

  test("the stopwatch shows when light reaches the observer only once it has", async () => {
    const props = {
      scenario: "lightning",
      v: 0.6,
      frame: "train",
      allowFrameSwitch: false,
      showDelayCorrection: true,
    } as const;
    const h = renderWidget(TrainSceneView, { props, mode: "explore" });
    const m = sceneModel("lightning", 0.6, "train");
    const front = m.timed.find((e) => e.id === "flash-front");
    if (!front) throw new Error("missing strike");
    const slider = screen.getByRole("slider");
    // Just after the front strike, its light hasn't reached the passenger yet.
    fireEvent.change(slider, { target: { value: String(front.t + 0.5) } });
    const row = () => within(screen.getByRole("row", { name: /Front strike/ })).getAllByRole("cell")[0]?.textContent;
    expect(row()).toBe("…");
    fireEvent.change(slider, { target: { value: String(seenAt(front) + 0.05) } });
    expect(row()).toBe(`t = ${fmt(seenAt(front))}`);
    h.container.remove();
  });
});

describe("train-scene view", () => {
  const ex = trainSceneSpec.examples[1];
  if (!ex) throw new Error("missing example");

  test("keyboard: pick first (play is locked until then), then play and correct for delay", async () => {
    const user = userEvent.setup();
    const h = renderWidget(TrainSceneView, { props: ex.props, goal: ex.goal });
    const show = screen.getByRole("button", { name: "Show what happens" });
    expect(show).toBeDisabled();
    const group = screen.getByRole("group", { name: "Your answer" });
    const rear = within(group).getByRole("button", { name: /Rear wall first/ });
    rear.focus();
    await user.keyboard("{Enter}");
    expect(h.last()).toEqual({ pick: "rear" });
    expect(trainSceneSpec.grade({ props: ex.props, goal: ex.goal, answer: h.last() ?? { pick: "same" } }).correct).toBe(
      true,
    );
    expect(show).toBeEnabled();
    await user.click(show);
    expect(h.container.querySelector('[data-stamp="hit-rear"]')).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Subtract light-travel time" }));
    expect(h.announcements.at(-1)).toContain("light hits the rear wall first");
  });

  test("axe clean in answer and review modes, every scenario", async () => {
    for (const e of trainSceneSpec.examples) {
      const a = renderWidget(TrainSceneView, { props: e.props, goal: e.goal });
      await expectAxeClean(a.container);
      a.container.remove();
      const b = renderWidget(TrainSceneView, {
        props: e.props,
        goal: e.goal,
        mode: "review",
        value: e.wrongAnswer,
        solution: e.correctAnswer,
      });
      await expectAxeClean(b.container);
      b.container.remove();
    }
  });

  test("frame switch announces and keeps working", async () => {
    const e = trainSceneSpec.examples[2];
    if (!e) throw new Error("missing example");
    const h = renderWidget(TrainSceneView, { props: e.props, goal: e.goal, mode: "explore" });
    await userEvent.click(screen.getByRole("button", { name: "From the train" }));
    expect(h.announcements).toContain("Seen from inside the train.");
    await userEvent.click(screen.getByRole("button", { name: "Show what happens" }));
    expect(h.container.querySelector('[data-stamp="hit-front"]')).not.toBeNull();
  });
});
