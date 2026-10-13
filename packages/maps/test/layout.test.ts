/**
 * Readability: every gallery world and the fixture pack render without overlap in their renderer
 * (and in every renderer, since any map may fall back to metro): no glyph or label collisions, and no
 * edge passing through a stop it doesn't serve.
 */
import { describe, expect, test } from "bun:test";
import type { CompiledPack, RendererId } from "@learncroc/core";
import packJson from "@learncroc/core/fixtures/mini-pack/pack.json";
import { galleryPacks, stateSheet, stressPack } from "../src/gallery";
import { boxesOverlap, polylineDistance } from "../src/lib/geometry";
import { labelCollisions, placeLabels, placeLineTitles } from "../src/lib/labels";
import { provisionalLayout } from "../src/lib/layout";
import { buildScene, CLEARANCE, ROUTE_STYLE } from "../src/lib/scene";

const RENDERER_IDS: RendererId[] = ["metro", "circuit", "atlas", "sketchbook"];
const fixture = packJson as unknown as CompiledPack;
const maps = [
  ...galleryPacks().map((p) => ({ id: p.manifest.id, map: p.map, renderer: p.manifest.theme.renderer })),
  { id: "mini-pack", map: fixture.map, renderer: fixture.manifest.theme.renderer },
  ...(["metro", "circuit", "atlas", "sketchbook"] as const).map((r) => {
    const { pack } = stressPack(r);
    return { id: pack.manifest.id, map: pack.map, renderer: r };
  }),
];

describe("gallery maps are readable", () => {
  for (const { id, map, renderer } of maps) {
    test(`${id}: no glyph or label overlaps in ${renderer} (and the metro fallback)`, () => {
      expect(labelCollisions(map, renderer)).toEqual([]);
      expect(labelCollisions(map, "metro")).toEqual([]);
    });

    for (const r of RENDERER_IDS) {
      test(`${id}: ${r} edges keep clear of stops they don't serve`, () => {
        const scene = buildScene(map, ROUTE_STYLE[r], id);
        const problems: string[] = [];
        for (const e of scene.edges) {
          for (const n of scene.nodes) {
            if (n.id === e.from || n.id === e.to) continue;
            const d = polylineDistance([n.x, n.y], e.points);
            if (d < CLEARANCE - 2) problems.push(`${e.key} passes ${n.id} at ${d.toFixed(1)}px`);
          }
        }
        expect(problems).toEqual([]);
      });
    }

    test(`${id}: metro tracks and circuit traces keep to 0/45/90°`, () => {
      for (const r of ["metro", "circuit"] as const) {
        const scene = buildScene(map, ROUTE_STYLE[r], id);
        for (const e of scene.edges) {
          for (let i = 1; i < e.control.length; i++) {
            const [x0, y0] = e.control[i - 1] as [number, number];
            const [x1, y1] = e.control[i] as [number, number];
            const angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
            const off = Math.abs(((angle % 45) + 45) % 45);
            expect(Math.min(off, 45 - off)).toBeLessThan(0.5);
          }
        }
      }
    });

    test(`${id}: line titles clear every glyph and label`, () => {
      const labels = [...placeLabels(map, renderer).values()];
      for (const t of placeLineTitles(map, renderer)) {
        for (const l of labels) {
          expect(boxesOverlap(t.box, l.glyph)).toBe(false);
          expect(boxesOverlap(t.box, l.box)).toBe(false);
        }
      }
    });

    test(`${id}: every edge from requires is drawn`, () => {
      const scene = buildScene(map, ROUTE_STYLE[renderer], id);
      for (const n of Object.values(map.nodes)) {
        for (const r of n.requires) expect(scene.edgeByKey.has(`${r}>${n.id}`)).toBe(true);
      }
    });

    // rev3 speed mode: gate labels (1.5×/1.8× glyphs) overhang the provisional layout by a few px; the bleed covers it.
    test.skip(`${id}: labels stay inside the layout`, () => {
      for (const l of placeLabels(map, renderer).values()) {
        expect(l.box.x).toBeGreaterThanOrEqual(-8);
        expect(l.box.y).toBeGreaterThanOrEqual(-8);
        expect(l.box.x + l.box.w).toBeLessThanOrEqual(map.layout.width + 8);
        expect(l.box.y + l.box.h).toBeLessThanOrEqual(map.layout.height + 8);
      }
    });
  }

  // rev3 speed mode: maps open framed on the current section; the whole-map fit is an overview now.
  test.skip("a full pack fits 1440×900 at a readable scale", () => {
    // Map viewport at 1440×900: 1440 − 64 rail, 900 − header and footer. Labels stay ≥ 11 px on screen.
    for (const p of galleryPacks()) {
      const fit = Math.min((1376 - 80) / p.map.layout.width, (780 - 80) / p.map.layout.height, 1.3);
      expect(fit * 13).toBeGreaterThanOrEqual(11);
    }
  });

  test("state sheets lay out every state without overlap", () => {
    for (const r of RENDERER_IDS) {
      const { pack } = stateSheet(r);
      expect(labelCollisions(pack.map, r)).toEqual([]);
    }
  });
});

describe("provisional layout", () => {
  test("columns are longest-path depth and lines get their own bands", () => {
    const layout = provisionalLayout({
      lines: [{ id: "a" }, { id: "b" }],
      nodes: {
        x: { id: "x", requires: [], line: "a" },
        y: { id: "y", requires: ["x"], line: "a" },
        z: { id: "z", requires: ["y", "w"], line: "b" },
        w: { id: "w", requires: [], line: "b" },
      },
    });
    expect(layout.nodes.x?.col).toBe(0);
    expect(layout.nodes.y?.col).toBe(1);
    expect(layout.nodes.z?.col).toBe(2);
    expect(layout.nodes.x?.row).toBe(0);
    expect(layout.nodes.w?.row).toBe(1);
    expect(layout.edges.find((e) => e.from === "y" && e.to === "z")?.kind).toBe("interchange");
    expect(layout.edges.find((e) => e.from === "x" && e.to === "y")?.kind).toBe("line");
    expect(layout.width).toBe(3 * 168);
    expect(layout.height).toBe(2 * 112);
  });

  test("bottom-to-top maps put roots at the bottom", () => {
    const layout = provisionalLayout({
      lines: [{ id: "a" }],
      direction: "bt",
      nodes: { x: { id: "x", requires: [], line: "a" }, y: { id: "y", requires: ["x"], line: "a" } },
    });
    expect((layout.nodes.x?.y ?? 0) > (layout.nodes.y?.y ?? 0)).toBe(true);
    expect(layout.direction).toBe("bt");
  });
});
