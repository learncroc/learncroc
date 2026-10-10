import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import packJson from "../fixtures/mini-pack/pack.json";
import progressJson from "../fixtures/progress.json";
import { CompiledPack, MapFile, nodeViews, PackLock, PackManifest, PackNode, PackProgress } from "../src/index";

const dir = join(import.meta.dir, "../fixtures/mini-pack");
const yaml = (rel: string) => parse(readFileSync(join(dir, rel), "utf8"));

describe("mini-pack fixture", () => {
  test("source files validate; no bosses/ or toy.yaml", () => {
    expect(PackManifest.safeParse(yaml("pack.yaml")).success).toBe(true);
    expect(MapFile.safeParse(yaml("map.yaml")).success).toBe(true);
    expect(PackLock.safeParse(yaml("pack.lock.yaml")).success).toBe(true);
    for (const f of readdirSync(join(dir, "nodes"))) {
      const r = PackNode.safeParse(yaml(`nodes/${f}`));
      expect(r.error?.issues ?? []).toEqual([]);
    }
    expect(readdirSync(dir)).not.toContain("bosses");
    expect(readdirSync(dir)).not.toContain("toy.yaml");
  });

  test("pack.json validates and matches the sources", () => {
    const pack = CompiledPack.parse(packJson);
    expect(pack.manifest).toEqual(PackManifest.parse(yaml("pack.yaml")));
    expect(Object.keys(pack.nodes).sort()).toEqual(["speed", "unit-conversion", "units"]);
    expect(pack.map.topo).toEqual(Object.keys(MapFile.parse(yaml("map.yaml")).nodes));
    for (const id of pack.map.topo) expect(pack.map.layout.nodes[id]).toBeDefined();
    // Two sections, a read-only beat, real closes, 6 items per card.
    expect(pack.nodes["unit-conversion"]?.screens.filter((s) => !s.interaction)).toHaveLength(1);
    for (const node of Object.values(pack.nodes)) {
      expect(node.items.length).toBe(6);
      expect(node.close.teaser.length).toBeGreaterThan(0);
      expect(Object.keys(node.close.byGuess ?? {})).toContain("idk");
    }
  });

  test("progress.json views are what nodeViews derives from its rows", () => {
    const pack = CompiledPack.parse(packJson);
    const progress = PackProgress.parse(progressJson);
    const views = nodeViews({ pack, progress: progress.nodes, nodeCards: progress.nodeCards, now: progress.now });
    expect(views).toEqual(progress.views);
  });
});
