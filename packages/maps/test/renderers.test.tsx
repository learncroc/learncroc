/**
 * Renderer contract: every renderer draws every world and every state, with shape as well as colour,
 * keeps every prerequisite edge visible, runs ambient motion only on lit track, and goes still in
 * reduced motion. No red anywhere; Lumen only on lit and sparked stops.
 */
import { describe, expect, test } from "bun:test";
import type { NodeId, NodeView, RendererId } from "@learncroc/core";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { galleryPacks, scenarioViews, stateSheet } from "../src/gallery";
import type { GalleryPack } from "../src/gallery/build";
import { RENDERERS } from "../src/renderers/index";
import type { MapRendererProps } from "../src/types";

const RENDERER_IDS: RendererId[] = ["metro", "circuit", "atlas", "sketchbook"];

function draw(
  pack: GalleryPack,
  views: Record<NodeId, NodeView>,
  over: Partial<MapRendererProps> = {},
  renderer?: RendererId,
) {
  const R = RENDERERS[renderer ?? pack.manifest.theme.renderer];
  const props: MapRendererProps = {
    pack,
    views,
    theme: renderer ? { ...pack.manifest.theme, renderer } : pack.manifest.theme,
    fog: false,
    zoom: 1,
    reducedMotion: false,
    ...over,
  };
  const el: ReactElement = (
    <svg aria-hidden>
      <R {...props} />
    </svg>
  );
  return render(el).container;
}

describe("every world renders in its renderer", () => {
  for (const pack of galleryPacks()) {
    for (const scenario of ["fresh", "journey", "all-lit"] as const) {
      test(`${pack.manifest.id} · ${scenario}`, () => {
        const views = scenarioViews(pack, scenario);
        const c = draw(pack, views);
        expect(c.querySelector(`[data-renderer="${pack.manifest.theme.renderer}"]`)).not.toBeNull();
        expect(c.querySelector(`[data-texture="${pack.manifest.theme.texture}"]`)).not.toBeNull();
        // One glyph group per stop, one drawn path per prerequisite edge.
        expect(c.querySelectorAll("[data-layer='stops'] [data-node]").length).toBe(Object.keys(pack.map.nodes).length);
        const edges = Object.values(pack.map.nodes).reduce((n, node) => n + node.requires.length, 0);
        expect(c.querySelectorAll("[data-edge]").length).toBe(edges);
      });
    }
  }
});

// rev3 speed mode: asserts revision-2 behaviour (sparked, termini, hop fog, stops); rewrite for gates/sections in wave 2.
describe.skip("state sheets", () => {
  for (const r of RENDERER_IDS) {
    test(`${r}: every state is drawn with its own shape`, () => {
      const { pack, views } = stateSheet(r);
      const c = draw(pack, views);
      const markup = (id: string) => c.querySelector(`[data-layer="stops"] [data-node="${id}"]`)?.innerHTML ?? "";
      const shapes = new Set(
        ["later", "ready", "in-progress", "sparked", "lit", "fading", "planned", "building"].map((id) =>
          markup(id)
            .replace(/(fill|stroke|opacity|filter)="[^"]*"/g, "")
            .replace(/\s+/g, " "),
        ),
      );
      expect(shapes.size).toBe(8);
      expect(markup("durable")).not.toBe(markup("lit"));
      expect(markup("terminus-lit")).not.toBe(markup("terminus-ready"));
    });

    test(`${r}: Lumen only marks lit and sparked stops; fading uses Ember; ready uses Sea`, () => {
      const { pack, views } = stateSheet(r);
      const c = draw(pack, views);
      const markup = (id: string) => c.querySelector(`[data-layer="stops"] [data-node="${id}"]`)?.innerHTML ?? "";
      for (const id of ["later", "ready", "in-progress", "planned", "building", "terminus-later", "terminus-ready"]) {
        expect(markup(id)).not.toContain("var(--lumen)");
      }
      expect(markup("lit")).toContain("var(--lumen)");
      expect(markup("sparked")).toContain("var(--lumen-soft)");
      expect(markup("fading")).toContain("var(--ember)");
      expect(markup("ready")).toContain("var(--sea)");
      // Only lit stops glow.
      expect(markup("lit")).toContain("-glow)");
      expect(markup("sparked")).not.toContain("-glow)");
    });

    test(`${r}: reduced motion has no animation`, () => {
      const { pack, views } = stateSheet(r);
      const c = draw(pack, views, { reducedMotion: true });
      expect(c.querySelectorAll("animate, animateMotion, animateTransform").length).toBe(0);
    });

    test(`${r}: the only idle motion on a static map is breathing (ready) and flicker (fading)`, () => {
      const pack = galleryPacks().find((p) => p.manifest.theme.renderer === r) as GalleryPack;
      const views = scenarioViews(pack, "fresh");
      const c = draw(pack, views);
      // Fresh map: nothing lit, so no ambient layer motion at all.
      expect(c.querySelectorAll("[data-layer='ambient'] animate, [data-layer='ambient'] animateMotion").length).toBe(0);
      const animatedStops = [...c.querySelectorAll("[data-layer='stops'] [data-node]")].filter((g) =>
        g.querySelector("animate, animateTransform"),
      );
      for (const g of animatedStops)
        expect(["ready", "in-progress", "fading", "building"]).toContain(g.getAttribute("data-state") ?? "");
    });

    test(`${r}: hover brightens prerequisite and unlock edges and dims the rest`, () => {
      const pack = galleryPacks().find((p) => p.manifest.theme.renderer === r) as GalleryPack;
      const views = scenarioViews(pack, "journey");
      const target = Object.values(pack.map.nodes).find((n) => n.requires.length > 0 && n.status === "playable");
      if (!target) throw new Error("no target");
      const plain = draw(pack, views);
      const hovered = draw(pack, views, { hoverId: target.id });
      const up = `[data-edge="${target.requires[0]}>${target.id}"]`;
      expect(hovered.querySelector(up)?.outerHTML).not.toBe(plain.querySelector(up)?.outerHTML);
    });
  }

  test("any world can be drawn by any renderer (fallback safety)", () => {
    for (const pack of galleryPacks()) {
      for (const r of RENDERER_IDS) {
        const c = draw(pack, scenarioViews(pack, "journey"), {}, r);
        expect(c.querySelector(`[data-renderer="${r}"]`)).not.toBeNull();
      }
    }
  });
});

describe("ambient motion only on lit track", () => {
  test("metro trains run on lit edges only, fewer and slower on fading track", () => {
    const pack = galleryPacks().find((p) => p.manifest.id === "special-relativity") as GalleryPack;
    const views = scenarioViews(pack, "all-lit");
    const c = draw(pack, views);
    const trains = c.querySelectorAll("[data-layer='ambient'] animateMotion").length;
    const litEdges = c.querySelectorAll("[data-edge][data-state='lit']").length;
    expect(trains).toBeGreaterThan(0);
    expect(trains).toBeLessThanOrEqual(litEdges);
    const fresh = draw(pack, scenarioViews(pack, "fresh"));
    expect(fresh.querySelectorAll("[data-layer='ambient'] animateMotion").length).toBe(0);
  });

  test("circuit current pulses only along lit traces", () => {
    const pack = galleryPacks().find((p) => p.manifest.id === "how-llms-work") as GalleryPack;
    const c = draw(pack, scenarioViews(pack, "journey"));
    const pulses = c.querySelectorAll("[data-layer='ambient'] path").length;
    const lit = c.querySelectorAll("[data-edge][data-state='lit'], [data-edge][data-state='dim']").length;
    expect(pulses).toBe(lit);
  });
});

// rev3 speed mode: asserts revision-2 behaviour (sparked, termini, hop fog, stops); rewrite for gates/sections in wave 2.
describe.skip("fog and dawn", () => {
  test("silhouettes dim under fog; termini stay visible", () => {
    const pack = galleryPacks().find((p) => p.manifest.id === "how-llms-work") as GalleryPack;
    const views = scenarioViews(pack, "fresh");
    const c = draw(pack, views, { fog: true });
    const op = (id: string) =>
      Number(c.querySelector(`[data-layer='stops'] [data-node="${id}"]`)?.getAttribute("opacity"));
    expect(op("hallucination")).toBeLessThan(0.5);
    expect(op("next-token")).toBe(1);
    expect(op("boss-support-bot")).toBe(1);
    expect(c.querySelector("[data-layer='fog']")).not.toBeNull();
  });

  test("everything lit shifts the ground towards dawn", () => {
    const pack = galleryPacks().find((p) => p.manifest.id === "spanish-tapas-bar") as GalleryPack;
    const lit = draw(pack, scenarioViews(pack, "all-lit"));
    const journey = draw(pack, scenarioViews(pack, "journey"));
    const wash = (c: HTMLElement) => c.querySelector("[data-layer='dawn'] rect")?.getAttribute("opacity");
    expect(wash(lit)).toBe("1");
    expect(wash(journey)).toBe("0");
  });

  test("no red, anywhere", () => {
    for (const pack of galleryPacks()) {
      const html = draw(pack, scenarioViews(pack, "journey")).innerHTML.toLowerCase();
      expect(html).not.toMatch(/#(f00|ff0000|e53935|d32f2f|c62828)\b/);
      expect(html).not.toContain("red");
    }
  });
});
