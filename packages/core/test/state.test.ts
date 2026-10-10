import { describe, expect, test } from "bun:test";
import {
  isMapFinished,
  isMet,
  lightNodeCard,
  type NodeProgress,
  newlyUnlocked,
  nextAfter,
  nodeViews,
} from "../src/index";
import { DAY, fixturePack } from "./support/pack";

const T0 = Date.UTC(2026, 0, 1);
const row = (nodeId: string, status: NodeProgress["status"], at = T0): NodeProgress => ({
  nodeId,
  status,
  source: status === "lit" ? "checkpoint" : "run",
  ...(status === "lit" ? { litAt: at } : status === "done" ? { doneAt: at } : {}),
  theta: 0,
  relightsOk: 0,
});
const states = (v: Record<string, { state: string }>) =>
  Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.state]));

describe("nodeViews", () => {
  const pack = fixturePack();

  test("a fresh map: the first card is ready and suggested; the rest wait behind it and the gates", () => {
    const v = nodeViews({ pack, progress: {}, nodeCards: {}, now: T0 });
    expect(states(v)).toEqual({
      units: "ready",
      "unit-conversion": "locked",
      "checkpoint-basics": "locked",
      speed: "locked",
      "checkpoint-trip": "locked",
      "average-speed": "planned",
    });
    expect(v.units?.suggested).toBe(true);
    expect(v["checkpoint-basics"]?.missing).toEqual(["unit-conversion", "units"]);
    expect(v.speed?.missing).toEqual(["checkpoint-basics"]);
  });

  test("done unlocks the next card (no Lumen); the gate opens for play once every cover is done", () => {
    const p1 = { units: row("units", "done") };
    const v1 = nodeViews({ pack, progress: p1, nodeCards: {}, now: T0 });
    expect(v1.units).toMatchObject({ state: "done", brightness: 0 });
    expect(v1["unit-conversion"]?.state).toBe("ready");
    const p2 = { ...p1, "unit-conversion": row("unit-conversion", "done") };
    const v2 = nodeViews({ pack, progress: p2, nodeCards: {}, now: T0 });
    expect(v2["checkpoint-basics"]).toMatchObject({ state: "ready", tries: 0, suggested: true });
    expect(v2.speed?.state).toBe("locked");
    expect(newlyUnlocked(v1, v2)).toEqual(["checkpoint-basics"]);
    const v3 = nodeViews({ pack, progress: p2, nodeCards: {}, now: T0, openTargets: ["checkpoint-basics"] });
    expect(v3["checkpoint-basics"]?.state).toBe("in-progress");
  });

  test("a passed gate is lit (never fades) and lights its covers; cards fade by retrievability", () => {
    const progress = {
      units: row("units", "lit"),
      "unit-conversion": row("unit-conversion", "lit"),
      "checkpoint-basics": row("checkpoint-basics", "lit"),
    };
    const nodeCards = { units: lightNodeCard("mini-pack", "units", T0, 3, { fuzz: false }).card };
    const v = nodeViews({ pack, progress, nodeCards, now: T0 + 60_000 });
    expect(v["checkpoint-basics"]).toMatchObject({ state: "lit", brightness: 1 });
    expect(v.units?.state).toBe("lit");
    expect(v["unit-conversion"]?.state).toBe("lit"); // legacy: lit with no node card
    expect(v.speed).toMatchObject({ state: "ready", suggested: true });
    const later = nodeViews({ pack, progress, nodeCards, now: T0 + 60 * DAY });
    expect(later.units?.state).toBe("fading");
    expect(later["checkpoint-basics"]?.state).toBe("lit");
    expect(later.speed).toMatchObject({ state: "ready" });
  });

  test("the legacy rule: every cover lit means the gate is met", () => {
    const progress = { units: row("units", "lit"), "unit-conversion": row("unit-conversion", "lit") };
    expect(isMet(pack.map, progress, "checkpoint-basics")).toBe(true);
    expect(isMet(pack.map, { units: row("units", "done") }, "units")).toBe(true);
    expect(isMet(pack.map, { units: row("units", "started") }, "units")).toBe(false);
    expect(nodeViews({ pack, progress, nodeCards: {}, now: T0 }).speed?.state).toBe("ready");
  });

  test("revisit flags come from checkpoint records; started cards are in progress; building entries", () => {
    const b = fixturePack();
    b.map.nodes.speed = { ...(b.map.nodes.speed as NonNullable<typeof b.map.nodes.speed>), status: "building" };
    const v = nodeViews({
      pack: b,
      progress: { units: row("units", "done"), "unit-conversion": row("unit-conversion", "started") },
      nodeCards: {},
      now: T0,
      checkpoints: {
        "checkpoint-basics": {
          tries: 1,
          asked: [],
          vars: {},
          missed: ["units"],
          revisit: ["units"],
          lastRunId: "r",
          at: T0,
        },
      },
    });
    expect(v.units).toMatchObject({ state: "done", revisit: true });
    expect(v["unit-conversion"]).toMatchObject({ state: "in-progress", suggested: true });
    expect(v.speed?.state).toBe("building");
  });
});

describe("next and finished", () => {
  const pack = fixturePack();

  test("nextAfter: the next card when open, else the gate that holds it", () => {
    const p1 = { units: row("units", "done") };
    const v1 = nodeViews({ pack, progress: p1, nodeCards: {}, now: T0 });
    expect(nextAfter(pack, v1, "units")).toEqual({ nodeId: "unit-conversion", kind: "node" });
    const p2 = { ...p1, "unit-conversion": row("unit-conversion", "done") };
    const v2 = nodeViews({ pack, progress: p2, nodeCards: {}, now: T0 });
    expect(nextAfter(pack, v2, "unit-conversion")).toEqual({ nodeId: "checkpoint-basics", kind: "checkpoint" });
  });

  test("isMapFinished: every playable card lit and every playable gate open", () => {
    const all = {
      units: row("units", "lit"),
      "unit-conversion": row("unit-conversion", "lit"),
      "checkpoint-basics": row("checkpoint-basics", "lit"),
      speed: row("speed", "lit"),
      "checkpoint-trip": row("checkpoint-trip", "lit"),
    };
    expect(isMapFinished(pack, nodeViews({ pack, progress: all, nodeCards: {}, now: T0 }))).toBe(true);
    const { speed: _s, ...partial } = all;
    expect(
      isMapFinished(
        pack,
        nodeViews({ pack, progress: { ...partial, speed: row("speed", "done") }, nodeCards: {}, now: T0 }),
      ),
    ).toBe(false);
  });
});
