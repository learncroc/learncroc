import { describe, expect, test } from "bun:test";
import type { CompiledPack, PackProgress } from "@learncroc/core";
import packJson from "@learncroc/core/fixtures/mini-pack/pack.json";
import progressJson from "@learncroc/core/fixtures/progress.json";
import { galleryPack, galleryPacks, scenarioViews, simulateViews } from "../src/gallery";
import { describeChanges, describeStop } from "../src/lib/a11y";
import { contrast, worldColors } from "../src/lib/color";
import {
  edgeState,
  everythingLit,
  fogLevels,
  navigate,
  readingOrder,
  tokenPath,
  unmetAncestors,
  viewFor,
} from "../src/lib/graph";

const fixture = packJson as unknown as CompiledPack;
const progress = progressJson as unknown as PackProgress;
const llm = galleryPack("how-llms-work");
if (!llm) throw new Error("gallery pack missing");

// Asserts revision-2 behaviour (sparked, termini, hop fog, stops); to be rewritten for gates and sections.
describe.skip("views and fog", () => {
  test("missing views are filled from the map (planned, building, ready roots, locked)", () => {
    expect(viewFor(fixture.map, {}, "units").state).toBe("ready");
    expect(viewFor(fixture.map, {}, "unit-conversion").state).toBe("locked");
    expect(viewFor(fixture.map, {}, "unit-conversion").missing).toEqual(["units"]);
    expect(viewFor(fixture.map, {}, "average-speed").state).toBe("planned");
  });

  test("fog: open stops and one hop beyond are clear, further stops are silhouettes, termini poke through", () => {
    const views = simulateViews(llm, {});
    const fog = fogLevels(llm.map, views);
    expect(fog.get("next-token")).toBe(0);
    expect(fog.get("sampling")).toBe(1);
    expect(fog.get("attention")).toBe(1);
    expect(fog.get("pretraining")).toBe(2);
    expect(fog.get("hallucination")).toBe(2);
    // Two or more hops away but a terminus: always visible.
    expect(fog.get("boss-support-bot")).toBe(1);
  });

  test("fog rolls back as stops light", () => {
    const before = fogLevels(llm.map, simulateViews(llm, {}));
    const after = fogLevels(llm.map, simulateViews(llm, { lit: ["neural-nets", "next-token", "training"] }));
    expect(before.get("pretraining")).toBe(2);
    expect(after.get("pretraining")).toBe(1);
  });

  test("edge states: lit, dim (reduced service), open, locked, planned", () => {
    const views = simulateViews(llm, { lit: ["next-token", "tokens"], fading: ["neural-nets"] });
    expect(edgeState(llm.map, views, { from: "next-token", to: "sampling" })).toBe("open");
    expect(edgeState(llm.map, views, { from: "sampling", to: "hallucination" })).toBe("locked");
    expect(edgeState(llm.map, views, { from: "pretraining", to: "post-training" })).toBe("planned");
    const lit = simulateViews(llm, { lit: ["next-token", "sampling"] });
    expect(edgeState(llm.map, lit, { from: "next-token", to: "sampling" })).toBe("lit");
    const dim = simulateViews(llm, { lit: ["next-token"], fading: ["sampling"] });
    expect(edgeState(llm.map, dim, { from: "next-token", to: "sampling" })).toBe("dim");
  });

  test("fading never re-locks children (sticky unlocks)", () => {
    const views = simulateViews(llm, { fading: ["next-token"] });
    expect(views.sampling?.state).toBe("ready");
    expect(views.sampling?.fadingPrereqs).toEqual(["next-token"]);
  });

  test("everything lit is detected for the dawn shift", () => {
    expect(everythingLit(llm.map, scenarioViews(llm, "all-lit"))).toBe(true);
    expect(everythingLit(llm.map, scenarioViews(llm, "journey"))).toBe(false);
  });

  test("the journey scenario shows every learner state at once", () => {
    const states = new Set(Object.values(scenarioViews(llm, "journey")).map((v) => v.state));
    for (const s of ["lit", "fading", "done", "in-progress", "ready", "locked", "planned"] as const) {
      expect(states.has(s)).toBe(true);
    }
  });
});

// Asserts revision-2 behaviour (sparked, termini, hop fog, stops); to be rewritten for gates and sections.
describe.skip("navigation", () => {
  test("→ follows a dependent, ← a prerequisite, same line first", () => {
    expect(navigate(llm.map, "next-token", "ArrowRight")).toBe("sampling");
    expect(navigate(llm.map, "attention", "ArrowLeft")).toBe("embeddings");
    expect(navigate(llm.map, "embeddings", "ArrowRight")).toBe("attention");
    expect(navigate(llm.map, "next-token", "ArrowLeft")).toBeUndefined();
  });

  test("↑/↓ move to the neighbouring line", () => {
    const down = navigate(llm.map, "next-token", "ArrowDown");
    expect(down).toBeDefined();
    const p0 = llm.map.layout.nodes["next-token"];
    const p1 = down ? llm.map.layout.nodes[down] : undefined;
    expect((p1?.y ?? 0) > (p0?.y ?? 0)).toBe(true);
    expect(navigate(llm.map, "next-token", "ArrowUp")).toBeUndefined();
  });

  test("bottom-to-top maps turn the keys a quarter", () => {
    const climate = galleryPack("climate-science");
    if (!climate) throw new Error("missing");
    expect(navigate(climate.map, "energy-balance", "ArrowUp")).toBe("greenhouse");
    expect(navigate(climate.map, "greenhouse", "ArrowDown")).toBe("energy-balance");
  });

  test("reading order walks line by line", () => {
    const order = readingOrder(llm.map);
    expect(order.slice(0, 4)).toEqual(["next-token", "sampling", "context-window", "boss-machine"]);
    expect(order).toHaveLength(Object.keys(llm.map.nodes).length);
  });

  test("the token prefers lit track", () => {
    const views = simulateViews(llm, { lit: ["next-token", "tokens", "embeddings"] });
    const path = tokenPath(llm.map, views, "sampling", "attention");
    expect(path[0]).toBe("sampling");
    expect(path[path.length - 1]).toBe("attention");
    expect(path).toContain("next-token");
  });

  test("opens-after path lists unmet ancestors nearest first", () => {
    const views = simulateViews(llm, { lit: ["tokens"] });
    expect(unmetAncestors(llm.map, views, "attention")).toEqual(["embeddings", "next-token"]);
    expect(unmetAncestors(llm.map, simulateViews(llm, {}), "attention")).toEqual([
      "embeddings",
      "next-token",
      "tokens",
    ]);
  });
});

// Asserts revision-2 behaviour (sparked, termini, hop fog, stops); to be rewritten for gates and sections.
describe.skip("accessible names", () => {
  test("a stop says its title, state, line, needs, opens and time", () => {
    const views = simulateViews(llm, { lit: ["tokens", "embeddings", "next-token"] });
    expect(describeStop(llm.map, views, "attention")).toBe(
      "Words looking at words. Ready. Meaning line. Needs Meaning as a location (lit) and The guessing machine (lit). Opens The transformer stack. About 4 minutes.",
    );
  });

  test("termini and durable stops say so", () => {
    expect(describeStop(fixture.map, progress.views, "boss-trip")).toContain("Ready, terminus");
    expect(describeStop(fixture.map, progress.views, "unit-conversion")).toContain("Fading, durable");
  });

  test("state changes are announced politely", () => {
    const before = simulateViews(llm, { lit: ["next-token"] });
    const after = simulateViews(llm, { lit: ["next-token", "sampling"] });
    expect(describeChanges(llm.map, before, after)).toBe("Rolling weighted dice is now lit.");
  });
});

describe("world colours", () => {
  test("derived inks meet the contrast rules on every gallery ground", () => {
    for (const p of galleryPacks()) {
      const c = worldColors(p.manifest.theme);
      expect(contrast(c.ink, c.ground)).toBeGreaterThanOrEqual(7);
      expect(contrast(c.ink2, c.ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.muted, c.ground)).toBeGreaterThanOrEqual(3);
    }
  });

  test("gallery line colours are ≥ 3:1 against their ground and never red", () => {
    for (const p of galleryPacks()) {
      for (const line of p.manifest.theme.lines) {
        expect(contrast(line, p.manifest.theme.ground)).toBeGreaterThanOrEqual(3);
        const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(line.slice(i, i + 2), 16)) as [number, number, number];
        expect(r > 180 && g < 90 && b < 90).toBe(false);
      }
    }
  });
});
