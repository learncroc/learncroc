import { describe, expect, test } from "bun:test";
import {
  allowedGuessKeys,
  cardStep,
  createRun,
  guessKeys,
  type HookInteraction,
  nextCardInOrder,
  type PackNode,
  type RunState,
  resolveClose,
  revisitScreen,
} from "../src/index";
import { fixturePack, testCard } from "./support/pack";

type Guess = NonNullable<RunState["guess"]>;
const choice = (selected: string | string[], correct: boolean): Guess => ({
  interactionId: "hook-q",
  answer: { kind: "choice", selected },
  correct,
});

const choiceHook = testCard("x").hook.interaction;
const estimateHook: HookInteraction = {
  kind: "estimate",
  id: "hook-q",
  prompt: "How many?",
  scale: { min: 1, max: 1000, log: true, unit: "km" },
  answer: 100,
  accept: { factor: 1.5 },
};
const orderHook: HookInteraction = {
  kind: "order",
  id: "hook-q",
  prompt: "Order them.",
  items: ["a", "b"],
  answer: [0, 1],
};

describe("allowedGuessKeys", () => {
  test("choice: option ids + idk/right/wrong; estimate: under/over too; order and widget: the base keys", () => {
    expect([...allowedGuessKeys(choiceHook)].sort()).toEqual(["a", "b", "c", "idk", "right", "wrong"]);
    expect([...allowedGuessKeys(estimateHook)].sort()).toEqual(["idk", "over", "right", "under", "wrong"]);
    expect([...allowedGuessKeys(orderHook)].sort()).toEqual(["idk", "right", "wrong"]);
  });
});

describe("guessKeys", () => {
  test("no guess or idk → idk", () => {
    expect(guessKeys(choiceHook, undefined)).toEqual(["idk"]);
    expect(guessKeys(choiceHook, { interactionId: "hook-q", answer: { kind: "idk" }, correct: false })).toEqual([
      "idk",
    ]);
  });

  test("choice: the option id first, then right/wrong; multi: right/wrong only", () => {
    expect(guessKeys(choiceHook, choice("a", false))).toEqual(["a", "wrong"]);
    expect(guessKeys(choiceHook, choice("b", true))).toEqual(["b", "right"]);
    const multi: HookInteraction = { ...(choiceHook as Extract<HookInteraction, { kind: "choice" }>), multi: true };
    expect(guessKeys(multi, choice(["a", "b"], false))).toEqual(["wrong"]);
  });

  test("estimate: right, or under/over then wrong", () => {
    const est = (value: number, correct: boolean): Guess => ({
      interactionId: "hook-q",
      answer: { kind: "estimate", value },
      correct,
    });
    expect(guessKeys(estimateHook, est(110, true))).toEqual(["right"]);
    expect(guessKeys(estimateHook, est(10, false))).toEqual(["under", "wrong"]);
    expect(guessKeys(estimateHook, est(900, false))).toEqual(["over", "wrong"]);
  });

  test("order and widget: right/wrong", () => {
    const g: Guess = { interactionId: "hook-q", answer: { kind: "order", order: [1, 0] }, correct: false };
    expect(guessKeys(orderHook, g)).toEqual(["wrong"]);
  });
});

describe("resolveClose", () => {
  const node = testCard("x");

  test("the first guess key present in byGuess wins, else close.text", () => {
    const a = resolveClose(node, choice("a", false));
    expect(a.key).toBe("a");
    expect(a.text).toBe(node.close.byGuess?.a as string);
    expect(a.guessText).toBe("Option A");
    expect(a.teaser).toBe(node.close.teaser);
    const right = resolveClose(node, choice("b", true));
    expect(right.key).toBeNull();
    expect(right.text).toBe(
      "B is right. The close answers the hook in a sentence or two and names *Option B* when it can.",
    );
  });

  test("a verdict key applies when the option has no variant", () => {
    const n: PackNode = { ...node, close: { ...node.close, byGuess: { wrong: "Wrong: {guess}.", idk: "No guess." } } };
    expect(resolveClose(n, choice("c", false))).toMatchObject({ key: "wrong", text: "Wrong: *Option C*." });
  });

  test("{guess} with no guess text falls back to byGuess.idk", () => {
    const idk = resolveClose(node, undefined);
    expect(idk).toMatchObject({ key: "idk", guessText: null, text: node.close.byGuess?.idk });
    const n: PackNode = {
      ...node,
      close: { text: "You said {guess}.", teaser: "t", byGuess: { idk: "Nothing yet." } },
    };
    expect(resolveClose(n, { interactionId: "hook-q", answer: { kind: "idk" }, correct: false })).toMatchObject({
      key: "idk",
      text: "Nothing yet.",
    });
  });

  test("estimate closes pick under or over", () => {
    const n: PackNode = {
      ...node,
      hook: { interaction: estimateHook },
      close: { text: "About 100.", byGuess: { under: "Too low: {guess}.", over: "Too high." }, teaser: "t" },
    };
    const low = resolveClose(n, { interactionId: "hook-q", answer: { kind: "estimate", value: 10 }, correct: false });
    expect(low).toMatchObject({ key: "under", text: "Too low: *10 km*." });
    const high = resolveClose(n, { interactionId: "hook-q", answer: { kind: "estimate", value: 900 }, correct: false });
    expect(high.key).toBe("over");
    const ok = resolveClose(n, { interactionId: "hook-q", answer: { kind: "estimate", value: 100 }, correct: true });
    expect(ok).toMatchObject({ key: null, text: "About 100." });
  });
});

describe("cardStep", () => {
  const pack = fixturePack();
  const node = pack.nodes["unit-conversion"] as PackNode;
  const run = createRun({ id: "r", kind: "card", pack, target: node.id, now: 0, seed: 1 });

  test("hook → beats (read-only flagged) → close → done", () => {
    expect(cardStep(run, node)).toEqual({ kind: "hook" });
    const beat = (i: number) => cardStep({ ...run, cursor: { phase: "screen", screen: i } }, node);
    expect(beat(0)).toMatchObject({ kind: "beat", index: 0, readOnly: false });
    expect(beat(1)).toMatchObject({ kind: "beat", index: 1, readOnly: true });
    const close = cardStep({ ...run, cursor: { phase: "close" }, guess: choice("h09", false) }, node);
    expect(close.kind === "close" && close.close.key).toBe("h09");
    expect(cardStep({ ...run, finishedAt: 5 }, node)).toEqual({ kind: "done" });
  });
});

describe("nextCardInOrder", () => {
  test("skips checkpoints and planned entries in reading order", () => {
    const { map } = fixturePack();
    expect(nextCardInOrder(map, "units")).toBe("unit-conversion");
    expect(nextCardInOrder(map, "unit-conversion")).toBe("speed");
    expect(nextCardInOrder(map, "checkpoint-basics")).toBe("speed");
    expect(nextCardInOrder(map, "speed")).toBeUndefined();
    expect(nextCardInOrder(map, "ghost")).toBeUndefined();
  });
});

describe("revisitScreen", () => {
  test("the first beat whose action tags a misconception of a missed item, else 0", () => {
    const node = fixturePack().nodes.units as PackNode;
    // i1 tags all-units-same; the only beat tagging it is s3-transfer (index 2).
    expect(revisitScreen(node, ["i1"])).toBe(2);
    expect(revisitScreen(node, ["i2"])).toBe(0);
    expect(revisitScreen(node, [])).toBe(0);
  });
});
