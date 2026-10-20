/**
 * The map gallery: every launch world, sampler world and article map as a compiled-pack-shaped preview
 * (with checkpoints every 2–3 cards), plus a "state sheet" per renderer that shows every card state and
 * every gate state side by side (for /dev/maps and tests).
 */
import type { NodeId, NodeState, NodeView, RendererId, TextureId, TokenGlyph } from "@learncroc/core";
import { buildGalleryPack, type GalleryPack, type GallerySpec, scenarioViews } from "./build";
import { GALLERY_SPECS } from "./specs";

export type { GalleryPack, GallerySpec, NodeSpec, Scenario, SimulatedProgress } from "./build";
export { buildGalleryPack, scenarioViews, sectionize, simulateViews } from "./build";
export * from "./specs";

let built: GalleryPack[] | undefined;

/** All gallery packs, built once. */
export function galleryPacks(): GalleryPack[] {
  built ??= GALLERY_SPECS.map(buildGalleryPack);
  return built;
}

export function galleryPack(id: string): GalleryPack | undefined {
  return galleryPacks().find((p) => p.manifest.id === id);
}

interface SheetStop {
  id: NodeId;
  title: string;
  state: NodeState;
  durable?: boolean;
  gate?: boolean;
  status?: "planned" | "building";
}

const SHEET_A: SheetStop[] = [
  { id: "later", title: "Later", state: "locked" },
  { id: "ready", title: "Ready", state: "ready" },
  { id: "in-progress", title: "In progress", state: "in-progress" },
  { id: "done", title: "Done", state: "done" },
  { id: "lit", title: "Lit", state: "lit" },
  { id: "fading", title: "Fading", state: "fading" },
  { id: "durable", title: "Lit, durable", state: "lit", durable: true },
  { id: "planned", title: "Planned", state: "planned", status: "planned" },
  { id: "building", title: "Writing", state: "building", status: "building" },
];
const SHEET_B: SheetStop[] = [
  { id: "gate-locked", title: "Locked", state: "locked", gate: true },
  { id: "revisit", title: "Revisit", state: "done" },
  { id: "gate-ready", title: "Ready", state: "ready", gate: true },
  { id: "gate-in-progress", title: "In progress", state: "in-progress", gate: true },
  { id: "gate-open", title: "Open", state: "lit", gate: true },
  { id: "final", title: "Final", state: "ready", gate: true },
];

const SHEET_LOOK: Record<
  RendererId,
  {
    texture: TextureId;
    token: TokenGlyph;
    ground: string;
    mode: "dark" | "light";
    lines: [string, string, string, string, string];
  }
> = {
  metro: {
    texture: "grid-fine",
    token: "train",
    ground: "#0F1430",
    mode: "dark",
    lines: ["#7FB2FF", "#C792F2", "#F07DA6", "#9AD07A", "#E6E1D3"],
  },
  circuit: {
    texture: "pcb",
    token: "electron",
    ground: "#0E1A1F",
    mode: "dark",
    lines: ["#6CC4FF", "#C59BFF", "#FF8FC2", "#A6E36F", "#E9E4D6"],
  },
  atlas: {
    texture: "topo",
    token: "scooter",
    ground: "#F4EFE4",
    mode: "light",
    lines: ["#2E64A8", "#8A4FB5", "#3D7A35", "#9C3F8F", "#4F4A68"],
  },
  sketchbook: {
    texture: "paper",
    token: "paper-plane",
    ground: "#F7F4EE",
    mode: "light",
    lines: ["#2B5FA8", "#7B45AE", "#38782F", "#A23A7E", "#555066"],
  },
  trail: {
    texture: "meadow",
    token: "lantern",
    ground: "#E4F1D6",
    mode: "light",
    lines: ["#5B3FC4", "#2F6DA8", "#A2457A", "#3B7A2E", "#7E5A1E"],
  },
};

/** A two-line map with one card per state and one gate per gate state (the last is the final gate). */
export function stateSheet(renderer: RendererId): { pack: GalleryPack; views: Record<NodeId, NodeView> } {
  const look = SHEET_LOOK[renderer];
  const chain = (stops: SheetStop[], line: string) =>
    stops.map((s, i) => ({
      id: s.id,
      line,
      title: s.title,
      ...(i > 0 ? { requires: (stops[i - 1] as SheetStop).id } : {}),
      ...(s.gate ? { gate: true } : {}),
      ...(s.status === "planned" ? { planned: true } : {}),
      ...(s.status === "building" ? { building: true } : {}),
    }));
  const spec: GallerySpec = {
    id: `states-${renderer}`,
    title: `Every state: ${renderer}`,
    category: "practical",
    profile: "community",
    theme: {
      renderer,
      world: `${renderer[0]?.toUpperCase()}${renderer.slice(1)} states`,
      mode: look.mode,
      direction: "lr",
      ground: look.ground,
      texture: look.texture,
      lines: look.lines,
      token: look.token,
    },
    sections: false,
    lines: [
      { id: "cards", title: "Cards", color: 1 },
      { id: "gates", title: "Checkpoints", color: 2 },
    ],
    nodes: [...chain(SHEET_A, "cards"), ...chain(SHEET_B, "gates")],
  };
  const pack = buildGalleryPack(spec);
  const views: Record<NodeId, NodeView> = {};
  for (const s of [...SHEET_A, ...SHEET_B]) {
    views[s.id] = {
      id: s.id,
      state: s.state,
      brightness: s.state === "lit" ? 1 : s.state === "fading" ? 0.58 : 0,
      durable: s.durable ?? false,
      suggested: s.id === "ready",
      missing: s.state === "locked" ? ["ready"] : [],
      fadingPrereqs: [],
      ...(s.id === "revisit" ? { revisit: true } : {}),
    };
  }
  return { pack, views };
}

const STRESS_WORDS = [
  "Signals",
  "Weights",
  "Feedback loops",
  "Hidden layers",
  "Patterns",
  "Small samples",
  "Long chains",
  "Tiny errors",
  "Big picture",
  "Fresh starts",
];

/**
 * A 30-entry map (5 lines of 6, with cross-line prerequisites, checkpoints every 2–3 cards and a final
 * gate) in a renderer's look, for
 * checking hover and zoom performance at the size the acceptance bar names. Mid-journey views included.
 */
export function stressPack(renderer: RendererId): { pack: GalleryPack; views: Record<NodeId, NodeView> } {
  const look = SHEET_LOOK[renderer];
  const lines = [1, 2, 3, 4, 5].map((c) => ({ id: `l${c}`, title: `Line ${c}`, color: c as 1 | 2 | 3 | 4 | 5 }));
  const nodes: GallerySpec["nodes"] = [];
  for (let l = 0; l < 5; l++) {
    for (let i = 0; i < 6; i++) {
      const n = l * 6 + i;
      const requires = [i > 0 ? `s${n - 1}` : "", l > 0 && i === 2 ? `s${(l - 1) * 6 + 1}` : ""].filter(Boolean);
      const gate = l === 4 && i === 5;
      nodes.push({
        id: `s${n}`,
        line: `l${l + 1}`,
        title: gate ? "The big test" : `${STRESS_WORDS[n % STRESS_WORDS.length]} ${n}`,
        ...(gate ? { gate: true, requires: [...requires, "s5", "s11"].join(" ") } : { requires: requires.join(" ") }),
      });
    }
  }
  const pack = buildGalleryPack({
    id: `stress-${renderer}`,
    title: `30 stops: ${renderer}`,
    category: "practical",
    profile: "community",
    theme: {
      renderer,
      world: `${renderer[0]?.toUpperCase()}${renderer.slice(1)} at 30 stops`,
      mode: look.mode,
      direction: "lr",
      ground: look.ground,
      texture: look.texture,
      lines: look.lines,
      token: look.token,
    },
    lines,
    nodes,
  });
  return { pack, views: scenarioViews(pack, "journey") };
}
