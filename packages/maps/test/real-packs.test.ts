/**
 * Readability on the real packs: every pack in `packs/` (and every pocket map in `packs/_pocket/`) is
 * laid out by the compiler's own layout step and must render without overlap at 1440×900 in its renderer
 * and in the metro fallback. Only `pack.yaml` and `map.yaml` are needed, so a pack whose stops are still
 * being written is checked too: a stop without its file keeps its map title, or its id.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type CompiledMapNode,
  type CompiledPack,
  dagOf,
  diskFs,
  layoutMap,
  loadPackSources,
  type RendererId,
  topoSort,
} from "@learncroc/core";
import { boxesOverlap, polylineDistance } from "../src/lib/geometry";
import { labelCollisions, placeLabels, placeLineTitles } from "../src/lib/labels";
import { buildScene, CLEARANCE, ROUTE_STYLE } from "../src/lib/scene";

const PACKS = resolve(import.meta.dir, "../../../packs");
const RENDERER_IDS: RendererId[] = ["metro", "circuit", "atlas", "sketchbook"];
/** The v0.1 launch packs: the acceptance bar for map readability. */
const LAUNCH = new Set([
  "how-llms-work",
  "special-relativity",
  "spanish-tapas-bar",
  "programming-basics",
  "art-of-persuasion",
]);

function packDirs(): string[] {
  const list = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
        .map((e) => join(dir, e.name));
    } catch {
      return [];
    }
  };
  return [...list(PACKS), ...list(join(PACKS, "_pocket"))].sort();
}

interface LaidOut {
  id: string;
  renderer: RendererId;
  map: CompiledPack["map"];
}

/** The compiler's layout of a pack's map, from its manifest and map file only. */
async function layoutOf(dir: string): Promise<LaidOut | string> {
  const sources = await loadPackSources(diskFs(fsp as never, dir));
  const manifest = sources.manifest?.value;
  const mapFile = sources.map?.value;
  if (!manifest || !mapFile) return "no valid pack.yaml and map.yaml yet";
  const { order, cycle } = topoSort(dagOf(mapFile.nodes));
  if (cycle) return `the map has a cycle: ${cycle.join(" → ")}`;
  const nodes: Record<string, CompiledMapNode> = {};
  for (const id of order) {
    const e = mapFile.nodes[id];
    if (!e) continue;
    const kind = e.kind ?? "node";
    const title = (kind === "checkpoint" ? undefined : sources.nodes[id]?.value?.title) ?? e.title ?? id;
    nodes[id] = {
      id,
      requires: [...e.requires],
      line: e.line,
      kind,
      status: e.status ?? "playable",
      title,
      teaser: e.teaser ?? "",
    };
  }
  const pins: Record<string, { col: number; row: number }> = {};
  for (const [id, e] of Object.entries(mapFile.nodes)) if (e.pin) pins[id] = e.pin;
  const layout = await layoutMap({
    nodes: order.map((id) => nodes[id]).filter((n): n is CompiledMapNode => n !== undefined),
    lines: mapFile.lines,
    direction: manifest.theme.direction,
    pins,
  });
  return {
    id: manifest.id,
    renderer: manifest.theme.renderer,
    map: { lines: mapFile.lines, nodes, topo: order, layout },
  };
}

const dirs = packDirs();
const laidOut = await Promise.all(dirs.map(async (d) => ({ dir: d, result: await layoutOf(d) })));

describe("real pack maps are readable at 1440×900", () => {
  test("there are packs to check", () => {
    expect(laidOut.some((p) => typeof p.result !== "string")).toBe(true);
  });

  for (const { dir, result } of laidOut) {
    const name = dir.slice(PACKS.length + 1);
    if (typeof result === "string") {
      test.skip(`${name}: ${result}`, () => {});
      continue;
    }
    const { id, renderer, map } = result;

    test(`${name}: no glyph or label overlaps in ${renderer} and the metro fallback`, () => {
      expect(labelCollisions(map, renderer)).toEqual([]);
      expect(labelCollisions(map, "metro")).toEqual([]);
    });

    test(`${name}: line titles clear every glyph and label; labels stay inside the map`, () => {
      const labels = [...placeLabels(map, renderer).values()];
      for (const t of placeLineTitles(map, renderer)) {
        for (const l of labels) {
          expect(boxesOverlap(t.box, l.glyph)).toBe(false);
          expect(boxesOverlap(t.box, l.box)).toBe(false);
        }
      }
      for (const l of labels) {
        expect(l.box.x).toBeGreaterThanOrEqual(-8);
        expect(l.box.y).toBeGreaterThanOrEqual(-8);
        expect(l.box.x + l.box.w).toBeLessThanOrEqual(map.layout.width + 8);
        expect(l.box.y + l.box.h).toBeLessThanOrEqual(map.layout.height + 8);
      }
    });

    test(`${name}: edges keep clear of stops they don't serve, in every renderer`, () => {
      const problems: string[] = [];
      for (const r of RENDERER_IDS) {
        const scene = buildScene(map, ROUTE_STYLE[r], id);
        for (const e of scene.edges) {
          for (const n of scene.nodes) {
            if (n.id === e.from || n.id === e.to) continue;
            const d = polylineDistance([n.x, n.y], e.points);
            if (d < CLEARANCE - 2) problems.push(`${r}: ${e.key} passes ${n.id} at ${d.toFixed(1)}px`);
          }
        }
        for (const n of Object.values(map.nodes)) {
          for (const req of n.requires) {
            if (!scene.edgeByKey.has(`${req}>${n.id}`)) problems.push(`${r}: ${req}>${n.id} is not drawn`);
          }
        }
      }
      expect(problems).toEqual([]);
    });

    test(`${name}: fits the 1440×900 map viewport with labels at a readable size`, () => {
      // Map viewport at 1440×900: 1440 − 64 rail, 900 − header and footer. Labels are 13 px at 1×. The
      // launch packs and pocket maps keep them ≥ 11 px when the whole map fits; other packs (tall
      // bottom-to-top worlds) may go down to 10 px at fit, a zoom step from full size.
      const fit = Math.min((1376 - 80) / map.layout.width, (780 - 80) / map.layout.height, 1.3);
      const strict = LAUNCH.has(id) || name.startsWith("_pocket/");
      expect(fit * 13).toBeGreaterThanOrEqual(strict ? 11 : 10);
    });
  }
});
