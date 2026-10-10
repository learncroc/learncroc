import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  checkParams,
  checkpointCredit,
  creditedScore,
  creditFlowsDown,
  DAY_MS,
  defaultVars,
  drawVars,
  fadeAt,
  type Item,
  instantiateItem,
  isCounted,
  LIT_THRESHOLD,
  lightNodeCard,
  partialReview,
  pCorrect,
  pickNextItem,
  renderTemplate,
  retrievability,
  reviewCard,
  rng,
  seedRating,
  shuffle,
  updateElo,
} from "../src/index";
import { fixturePack } from "./support/pack";

const T0 = Date.UTC(2026, 9, 20, 9);
const param: Item = {
  id: "i1",
  kind: "numeric",
  level: "apply",
  difficulty: 2,
  prompt: "A car drives {d} km in 2 hours. Its speed in km/h?",
  params: { vars: { d: [120, 80, 150, 200] }, answerExpr: "d / 2" },
  answer: 60,
  tolerance: 0,
};

describe("parametric items", () => {
  test("the same seed always draws the same instance", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
        const a = drawVars(param.params as NonNullable<Item["params"]>, seed, "i1");
        const b = drawVars(param.params as NonNullable<Item["params"]>, seed, "i1");
        expect(a).toEqual(b);
        expect([120, 80, 150, 200]).toContain(a.d as number);
      }),
    );
  });

  test("different seeds spread over the candidates; avoid picks a fresh instance", () => {
    const seen = new Set<number>();
    for (let s = 0; s < 200; s++) seen.add(drawVars(param.params as NonNullable<Item["params"]>, s, "i1").d as number);
    expect(seen.size).toBe(4);
    for (let s = 0; s < 50; s++) {
      const v = drawVars(param.params as NonNullable<Item["params"]>, s, "i1", [{ d: 120 }, { d: 80 }, { d: 150 }]);
      expect(v.d).toBe(200);
    }
  });

  test("render, instantiate and check", () => {
    expect(defaultVars(param.params as NonNullable<Item["params"]>)).toEqual({ d: 120 });
    expect(renderTemplate("{d} km and {x}", { d: 0.1 + 0.2 })).toBe("0.3 km and {x}");
    const inst = instantiateItem(param, { d: 150 });
    expect(inst.prompt).toBe("A car drives 150 km in 2 hours. Its speed in km/h?");
    expect(inst.kind === "numeric" && inst.answer).toBe(75);
    expect(checkParams(param)).toEqual([]);
    expect(checkParams({ ...param, answer: 61 })[0]).toMatch(/gives 60/);
    expect(
      checkParams({ ...param, params: { vars: { d: [0, 1] }, answerExpr: "1 / d" }, answer: Number.POSITIVE_INFINITY }),
    ).toContainEqual(expect.stringMatching(/not finite/));
    expect(checkParams({ ...param, prompt: "{q}?" })[0]).toMatch(/\{q\}/);
  });

  test("seeded rng and shuffle are deterministic", () => {
    expect(rng(7)()).toBe(rng(7)());
    expect(shuffle([1, 2, 3, 4, 5], 3)).toEqual(shuffle([1, 2, 3, 4, 5], 3));
    expect([...shuffle([1, 2, 3, 4, 5], 3)].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("FSRS with a fixed clock", () => {
  const opts = { fuzz: false };
  test("a freshly lit node starts at a few days of stability and fades within days", () => {
    const { card, log } = lightNodeCard("p", "n", T0, 3, opts);
    expect(card.id).toBe("node:p:n");
    expect(card.state).toBe(2);
    expect(card.stability).toBeGreaterThan(1);
    expect(card.stability).toBeLessThan(5);
    expect(log.grade).toBe(3);
    expect(retrievability(card, T0, opts)).toBeCloseTo(1, 5);
    const fade = fadeAt(card, LIT_THRESHOLD, opts) as number;
    expect(fade - T0).toBeGreaterThan(DAY_MS);
    expect(fade - T0).toBeLessThan(10 * DAY_MS);
    expect(retrievability(card, fade - 60_000, opts)).toBeGreaterThanOrEqual(LIT_THRESHOLD);
    expect(retrievability(card, fade + 60_000, opts)).toBeLessThan(LIT_THRESHOLD);
    const easy = lightNodeCard("p", "n", T0, 4, opts).card;
    expect(easy.stability).toBeGreaterThan(card.stability);
  });

  test("retrievability falls over time; reviews grow stability; Again lapses", () => {
    const { card } = lightNodeCard("p", "n", T0, 3, opts);
    const r = [1, 2, 4, 8].map((d) => retrievability(card, T0 + d * DAY_MS, opts));
    for (let i = 1; i < r.length; i++) expect(r[i] as number).toBeLessThan(r[i - 1] as number);
    const good = reviewCard(card, 3, T0 + 3 * DAY_MS, opts);
    expect(good.card.stability).toBeGreaterThan(card.stability);
    expect(good.log.elapsedDays).toBeCloseTo(3, 0);
    const again = reviewCard(card, 1, T0 + 3 * DAY_MS, opts);
    expect(again.card.lapses).toBe(1);
    expect(again.card.stability).toBeLessThan(card.stability);
  });

  test("credit flows down: depth ≤ 3, weight 0.3·0.5^(d−1), only on ≥ Good", () => {
    const dag = { a: [], b: ["a"], c: ["b"], d: ["c"], e: ["d"] };
    const cards = new Map(["a", "b", "c", "d"].map((id) => [id, lightNodeCard("p", id, T0, 3, opts).card]));
    const later = T0 + 2 * DAY_MS;
    const out = creditFlowsDown(dag, "e", 3, cards, later, opts);
    expect(out.map((o) => [o.card.nodeId, o.depth, o.weight])).toEqual([
      ["d", 1, 0.3],
      ["c", 2, 0.15],
      ["b", 3, 0.075],
    ]);
    for (const o of out) expect(o.card.stability).toBeGreaterThan(cards.get(o.card.nodeId as string)?.stability ?? 0);
    expect(creditFlowsDown(dag, "e", 2, cards, later, opts)).toEqual([]);
    const c = cards.get("a");
    if (c) expect(partialReview(c, 0, later, opts)).toBe(c);
  });
});

describe("adaptive", () => {
  test("Elo pieces", () => {
    expect(seedRating(1)).toBe(-1);
    expect(seedRating(5)).toBe(1);
    expect(pCorrect(0, 0)).toBe(0.5);
    const up = updateElo(0, 0, 1);
    expect(up.theta).toBeCloseTo(0.2);
    expect(up.d).toBeCloseTo(-0.025);
  });
  test("picks the unseen item closest to P = 0.80, ties in bank order", () => {
    const node = fixturePack().nodes.units;
    if (!node) throw new Error("fixture");
    // θ = 0: difficulty 1 (d = −1) gives P ≈ 0.73, difficulty 3 gives 0.5.
    expect(pickNextItem({ candidates: node.items, theta: 0 })?.id).toBe("i1");
    expect(pickNextItem({ candidates: node.items, theta: 0, seen: new Set(["i1"]) })?.id).toBe("i3");
    expect(pickNextItem({ candidates: node.items, theta: 2 })?.id).toBe("i4");
    expect(
      pickNextItem({ candidates: node.items, theta: 0, seen: new Set(node.items.map((i) => i.id)) }),
    ).toBeUndefined();
  });
});

describe("credit", () => {
  test("only checkpoint questions count", () => {
    expect(isCounted({ kind: "checkpoint" }, "checkpoint")).toBe(true);
    expect(isCounted({ kind: "card" }, "hook")).toBe(false);
    expect(isCounted({ kind: "card" }, "screen")).toBe(false);
    expect(isCounted({ kind: "relight" }, "relight")).toBe(false);
  });

  test("checkpoint: right = correct with hint ≤ 1 and no assist", () => {
    expect(checkpointCredit(true, 0, false)).toBe(1);
    expect(checkpointCredit(true, 1, false)).toBe(1);
    expect(checkpointCredit(true, 2, false)).toBe(0);
    expect(checkpointCredit(true, 0, true)).toBe(0);
    expect(checkpointCredit(false, 0, false)).toBe(0);
  });

  test("relight: hint 1 halves; hint ≥ 2 or assisted scores 0", () => {
    expect(creditedScore(1, 0, false)).toBe(1);
    expect(creditedScore(1, 1, false)).toBe(0.5);
    expect(creditedScore(1, 2, false)).toBe(0);
    expect(creditedScore(1, 0, true)).toBe(0);
  });

  test("a card lit at a checkpoint may start Hard, Good or Easy", () => {
    const hard = lightNodeCard("p", "n", T0, 2, { fuzz: false }).card;
    const easy = lightNodeCard("p", "n", T0, 4, { fuzz: false }).card;
    expect(hard.stability).toBeLessThan(easy.stability);
  });
});
