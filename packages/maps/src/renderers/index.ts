/**
 * The four v0.1 renderers. Each draws decorative SVG only (CONTRACTS §9.3); interaction lives in
 * StopLayer. MapView falls back to metro when a renderer throws or the graph has more than 60 nodes.
 */
import type { CompiledMap, RendererId } from "@learncroc/core";
import type { RendererComponent } from "../types";
import { AtlasRenderer } from "./atlas";
import { CircuitRenderer } from "./circuit";
import { MetroRenderer } from "./metro";
import { SketchbookRenderer } from "./sketchbook";

export const RENDERERS: Record<RendererId, RendererComponent> = {
  metro: MetroRenderer,
  circuit: CircuitRenderer,
  atlas: AtlasRenderer,
  sketchbook: SketchbookRenderer,
};

/** Above this many nodes every map uses the metro renderer. */
export const MAX_NODES_FOR_THEMED_RENDERER = 60;

/** The renderer a map actually uses: its theme's, unless the graph is too big for it. */
export function resolveRenderer(requested: RendererId, map: CompiledMap): RendererId {
  return Object.keys(map.nodes).length > MAX_NODES_FOR_THEMED_RENDERER ? "metro" : requested;
}
