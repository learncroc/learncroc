import { describe, expect, test } from "bun:test";
import {
  buildCheckpointPlan,
  CHECKPOINT_HINT_CAP,
  CHECKPOINT_RIGHT_MAX_HINT,
  cardShapeIssues,
  checkpointCovers,
  checkpointIds,
  checkpointResult,
  defaultCheckpointSize,
  earlierCards,
  type GateGraph,
  gateGraph,
  revisitTargets,
  sectionSizes,
  sections,
} from "../src/index";
import { buildPack, fixturePack, testCard } from "./support/pack";

type Entry = GateGraph["nodes"][string];
const card = (...requires: string[]): Entry => ({ requires });
const gate = (requires: string[], extra: Partial<Entry> = {}): Entry => ({ requires, kind: "checkpoint", ...extra });

/**
 * a ─┬─ b ──┐
 *    └─ c ──┴─ cp1 ─┬─ d ──┐
 *                   └─ e ──┴─ cp2 ─ f (planned) ─ cp3 (planned)
 * x (a root with no gate after it, only an explicit cover of cp2)
 */
const branching = gateGraph({
  a: card(),
  b: card("a"),
  c: card("a"),
  cp1: gate(["b", "c"]),
  d: card("cp1"),
  e: card("cp1"),
  x: card(),
  cp2: gate(["d", "e", "x"]),
  f: { requires: ["cp2"], status: "planned" },
  cp3: gate(["f"], { status: "planned" }),
});

describe("gate graph", () => {
  test("checkpointIds in topo order, planned included", () => {
    expect(checkpointIds(branching)).toEqual(["cp1", "cp2", "cp3"]);
  });

  test("covers: the section's cards, not the ones behind an earlier gate; planned gates cover nothing", () => {
    expect(checkpointCovers(branching, "cp1")).toEqual(["a", "b", "c"]);
    expect(checkpointCovers(branching, "cp2")).toEqual(["d", "e", "x"]);
    expect(checkpointCovers(branching, "cp3")).toEqual([]);
    expect(checkpointCovers(branching, "a")).toEqual([]);
  });

  test("explicit covers win, in topo order", () => {
    const g = gateGraph({ ...branching.nodes, cp2: gate(["d", "e", "x"], { covers: ["x", "d"] }) });
    expect(checkpointCovers(g, "cp2")).toEqual(["d", "x"]);
    expect(earlierCards(g, "cp2")).toEqual(["a", "b", "c", "e"]);
  });

  test("earlierCards: ancestors behind earlier gates", () => {
    expect(earlierCards(branching, "cp1")).toEqual([]);
    expect(earlierCards(branching, "cp2")).toEqual(["a", "b", "c"]);
  });

  test("shared prerequisites: a card two gates both reach belongs to the first", () => {
    const g = gateGraph({
      a: card(),
      b: card("a"),
      cp1: gate(["b"]),
      c: card("a", "cp1"),
      cp2: gate(["c"]),
    });
    expect(checkpointCovers(g, "cp1")).toEqual(["a", "b"]);
    expect(checkpointCovers(g, "cp2")).toEqual(["c"]);
  });

  test("sections: playable checkpoints with their cards", () => {
    expect(sections(branching)).toEqual([
      { index: 0, checkpoint: "cp1", cards: ["a", "b", "c"] },
      { index: 1, checkpoint: "cp2", cards: ["d", "e", "x"] },
    ]);
  });

  test("the compiled mini-pack resolves covers, size, title and gate", () => {
    const { map } = fixturePack();
    expect(map.nodes["checkpoint-basics"]).toMatchObject({
      covers: ["units", "unit-conversion"],
      size: 3,
      title: "Check 1",
    });
    expect(map.nodes["checkpoint-trip"]).toMatchObject({ covers: ["speed"], size: 3, title: "The Trip" });
    expect(map.nodes.units?.gate).toBe("checkpoint-basics");
    expect(map.nodes.speed?.gate).toBe("checkpoint-trip");
    expect(earlierCards(map, "checkpoint-trip")).toEqual(["units", "unit-conversion"]);
    expect(sections(map).map((s) => s.checkpoint)).toEqual(["checkpoint-basics", "checkpoint-trip"]);
  });
});

describe("the test pack builder", () => {
  test("testCard has the curated card shape; buildPack wires two sections", async () => {
    expect(cardShapeIssues("x", testCard("x"), "curated", "en")).toEqual([]);
    const pack = await buildPack({
      map: {
        a: { requires: [] },
        b: { requires: ["a"] },
        cp1: { requires: ["b"], kind: "checkpoint" },
        c: { requires: ["cp1"] },
        d: { requires: ["c"] },
        cp2: { requires: ["d"], kind: "checkpoint", size: 4 },
        later: { requires: ["cp2"], status: "planned", title: "Later", teaser: "What next?" },
      },
    });
    expect(sections(pack.map)).toEqual([
      { index: 0, checkpoint: "cp1", cards: ["a", "b"] },
      { index: 1, checkpoint: "cp2", cards: ["c", "d"] },
    ]);
    expect(pack.map.nodes.cp2).toMatchObject({ size: 4, title: "Check 2" });
    expect(Object.keys(pack.nodes)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("sizes", () => {
  test("defaultCheckpointSize = clamp(covers + 1, 3, 5)", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(defaultCheckpointSize)).toEqual([3, 3, 3, 4, 5, 5, 5]);
  });

  test("sectionSizes splits n cards into balanced sections", () => {
    expect(sectionSizes(3, [2, 3])).toEqual([3]);
    expect(sectionSizes(5, [2, 3])).toEqual([3, 2]);
    expect(sectionSizes(7, [2, 3])).toEqual([3, 2, 2]);
    expect(sectionSizes(12, [2, 3])).toEqual([3, 3, 3, 3]);
    expect(sectionSizes(3, [4, 6])).toEqual([3]);
    expect(sectionSizes(5, [4, 6])).toEqual([5]);
    expect(sectionSizes(7, [4, 6])).toEqual([4, 3]);
    expect(sectionSizes(12, [4, 6])).toEqual([6, 6]);
    expect(sectionSizes(1, [2, 3])).toEqual([1]);
  });

  test("constants", () => {
    expect(CHECKPOINT_HINT_CAP).toBe(2);
    expect(CHECKPOINT_RIGHT_MAX_HINT).toBe(1);
  });
});

describe("placeholders until the checkpoint run lands", () => {
  test("plan, result and revisit targets throw", () => {
    const pack = fixturePack();
    expect(() =>
      buildCheckpointPlan({
        pack,
        cpId: "checkpoint-basics",
        earlier: [],
        theta: {},
        ratings: {},
        avoid: new Set(),
        missedLast: [],
        seed: 1,
      }),
    ).toThrow("rev3: not yet");
    expect(() => checkpointResult([], 3)).toThrow("rev3: not yet");
    expect(() => revisitTargets(pack, "checkpoint-basics", [])).toThrow("rev3: not yet");
  });
});
