/**
 * Map designs: whole-theme presets (renderer, ground, texture, backdrop, palette, token) that any map can
 * wear. AI-drafted maps get one at creation (`suggestMapDesign`); the map page's Design menu swaps it per
 * map (`settings.appearance.mapDesigns`), and `withMapDesign` applies the pick wherever the map is drawn.
 *
 * Adding a design: add its id to `MapDesignId` (schema/primitives.ts) and an entry here. Palettes follow
 * the theme lint: lines ≥ 3:1 on the ground, clear of Lumen, Ember and Sea.
 */
import type { MapDesignChoice, MapDesignId, PackTheme } from "./schema/index";

/** The parts of a theme a design decides; the map keeps its own world name, landmarks and gate name. */
export type MapDesignLook = Pick<
  PackTheme,
  "renderer" | "mode" | "ground" | "ink" | "texture" | "lines" | "token" | "backdrop"
>;

export interface MapDesign {
  id: MapDesignId;
  /** Menu name: "Pond trail". */
  name: string;
  /** One line under the name in the menu. */
  blurb: string;
  look: MapDesignLook;
  /** Words in a map's title or gist that suggest this design at creation (whole words, lowercase). */
  keywords: readonly string[];
}

/** In menu order. The first is the default for new maps when no keyword matches. */
export const MAP_DESIGNS: readonly MapDesign[] = [
  {
    id: "pond",
    name: "Pond trail",
    blurb: "A winding path past the pond.",
    look: {
      renderer: "trail",
      mode: "light",
      ground: "#E4F1D6",
      ink: "#1F1B3A",
      texture: "meadow",
      lines: ["#5B3FC4", "#2F6DA8", "#A2457A", "#3B7A2E", "#7E5A1E"],
      token: "lantern",
      backdrop: "pond",
    },
    keywords: [],
  },
  {
    id: "paper",
    name: "Paper",
    blurb: "Ink on a sketchbook page.",
    look: {
      renderer: "sketchbook",
      mode: "light",
      ground: "#F7F4EE",
      texture: "paper",
      lines: ["#2F5D8A", "#9C4A2F", "#3E7A4F", "#7A4E8C", "#8A6A1F"],
      token: "paper-plane",
      backdrop: "sketchbook",
    },
    keywords: [
      "essay",
      "writing",
      "philosophy",
      "poetry",
      "psychology",
      "persuasion",
      "negotiation",
      "habits",
      "leadership",
      "career",
      "management",
      "design",
      "art",
    ],
  },
  {
    id: "metro",
    name: "Metro",
    blurb: "Lines and stations on a transit map.",
    look: {
      renderer: "metro",
      mode: "dark",
      ground: "#0F1430",
      texture: "grid-fine",
      lines: ["#7FB2FF", "#C792F2", "#F07DA6", "#9AD07A", "#E6E1D3"],
      token: "train",
      backdrop: "transit-grid",
    },
    keywords: [
      "network",
      "networking",
      "protocol",
      "tcp",
      "http",
      "dns",
      "routing",
      "pipeline",
      "queue",
      "distributed",
      "microservices",
      "kubernetes",
      "workflow",
      "logistics",
      "transit",
    ],
  },
  {
    id: "circuit",
    name: "Circuit board",
    blurb: "Traces and chips on a dark board.",
    look: {
      renderer: "circuit",
      mode: "dark",
      ground: "#0E1A1F",
      texture: "pcb",
      lines: ["#6CC4FF", "#C59BFF", "#FF8FC2", "#A6E36F", "#E9E4D6"],
      token: "electron",
      backdrop: "circuit-board",
    },
    keywords: [
      "llm",
      "llms",
      "neural",
      "transformer",
      "transformers",
      "gpu",
      "cpu",
      "chip",
      "hardware",
      "compiler",
      "embeddings",
      "tokenizer",
      "inference",
      "kernel",
      "electronics",
      "circuit",
    ],
  },
  {
    id: "atlas",
    name: "Atlas",
    blurb: "Roads and towns across the land.",
    look: {
      renderer: "atlas",
      mode: "light",
      ground: "#F4EFE4",
      texture: "topo",
      lines: ["#2E64A8", "#8A4FB5", "#3D7A35", "#9C3F8F", "#4F4A68"],
      token: "hiker",
      backdrop: "terrain",
    },
    keywords: [
      "history",
      "geography",
      "climate",
      "ecology",
      "biology",
      "evolution",
      "travel",
      "language",
      "culture",
      "empire",
      "ocean",
      "geology",
      "planet",
      "economics",
    ],
  },
];

export const DEFAULT_MAP_DESIGN: MapDesignId = "pond";

export function mapDesign(id: MapDesignId): MapDesign {
  return MAP_DESIGNS.find((d) => d.id === id) ?? (MAP_DESIGNS[0] as MapDesign);
}

/**
 * The design a theme already wears: its `design`, or "paper" for maps drafted before designs existed
 * (sketchbook on paper). Undefined for authored worlds.
 */
export function ownMapDesign(theme: PackTheme): MapDesignId | undefined {
  if (theme.design) return theme.design;
  if (theme.renderer === "sketchbook" && theme.texture === "paper" && theme.backdrop === "sketchbook") return "paper";
  return undefined;
}

/** A full theme in `id`'s look, keeping the map's own world name, direction, landmarks and gate name. */
export function designTheme(id: MapDesignId, own: Pick<PackTheme, "world"> & Partial<PackTheme>): PackTheme {
  const { look } = mapDesign(id);
  return {
    ...look,
    design: id,
    world: own.world,
    direction: own.direction ?? "lr",
    ...(own.landmarks ? { landmarks: own.landmarks } : {}),
    ...(own.gateName ? { gateName: own.gateName } : {}),
    ...(own.fieldNoteStyle ? { fieldNoteStyle: own.fieldNoteStyle } : {}),
  };
}

/** The theme to draw for a learner's pick. "original", no pick, or the design it already wears: unchanged. */
export function applyMapDesign(theme: PackTheme, choice: MapDesignChoice | undefined): PackTheme {
  if (!choice || choice === "original" || choice === ownMapDesign(theme)) return theme;
  return designTheme(choice, theme);
}

const designed = new WeakMap<object, Map<MapDesignChoice, object>>();

/**
 * `pack` with its manifest theme swapped for the pick: the same object when nothing changes, and the same
 * designed object for the same pack and pick (so memoised views don't redraw).
 */
export function withMapDesign<T extends { manifest: { theme: PackTheme } }>(
  pack: T,
  choice: MapDesignChoice | undefined,
): T {
  const theme = applyMapDesign(pack.manifest.theme, choice);
  if (theme === pack.manifest.theme || !choice) return pack;
  const byChoice = designed.get(pack) ?? new Map<MapDesignChoice, object>();
  designed.set(pack, byChoice);
  const hit = byChoice.get(choice);
  if (hit) return hit as T;
  const out = { ...pack, manifest: { ...pack.manifest, theme } };
  byChoice.set(choice, out);
  return out;
}

/** A design for a new map from its title and gist: the best keyword match (title words count double), else Pond trail. */
export function suggestMapDesign(title: string, gist = ""): MapDesignId {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const t = words(title);
  const g = words(gist);
  let best: MapDesignId = DEFAULT_MAP_DESIGN;
  let bestScore = 0;
  for (const d of MAP_DESIGNS) {
    const score = d.keywords.reduce((n, k) => n + (t.has(k) ? 2 : 0) + (g.has(k) ? 1 : 0), 0);
    if (score > bestScore) {
      best = d.id;
      bestScore = score;
    }
  }
  return best;
}
