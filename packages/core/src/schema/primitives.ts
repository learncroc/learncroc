/**
 * Primitives and the shared enums used across schemas.
 *
 * Ids and semvers are checked against these regexes BEFORE any filesystem use
 * (route params, query strings, archive entries).
 */
import { z } from "zod";

export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const NODE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SEMVER_RE = /^\d+\.\d+\.\d+$/;
export const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
export const SCREEN_ID_RE = /^s\d+(-[a-z0-9-]+)?$/;
/** Keys of `close.byGuess`: choice option ids, "idk", "under"/"over", "right"/"wrong". */
export const GUESS_KEY_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const ASSET_PATH_RE = /^assets\/([a-z0-9._-]+\/)*[a-z0-9_-][a-z0-9._-]*\.(svg|png|webp|mp3|ogg|html)$/;
/** Asset paths that may be served from the app origin (html is sandbox-origin only). */
export const SERVABLE_ASSET_RE = /^assets\/([a-z0-9._-]+\/)*[a-z0-9_-][a-z0-9._-]*\.(svg|png|webp|mp3|ogg)$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** "how-llms-work". Pocket maps use generated ids "pm-<base32>". */
export const PackId = z.string().regex(PACK_ID_RE, "pack id: lowercase letters, digits and dashes (2-64 chars)");
/** Unique within a pack. */
export const NodeId = z.string().regex(NODE_ID_RE, "node id: lowercase letters, digits and dashes");
/** Same pattern as NodeId. */
export const LineId = z.string().regex(NODE_ID_RE, "line id: lowercase letters, digits and dashes");
/** Unique within a node: hook, screen interactions, items and flashcards share one namespace. */
export const ItemId = z.string().regex(NODE_ID_RE, "item id: lowercase letters, digits and dashes");
/** "1.2.0" */
export const SemVer = z.string().regex(SEMVER_RE, "version: MAJOR.MINOR.PATCH");
/** "#RRGGBB" */
export const Hex = z.string().regex(HEX_RE, "colour: #RRGGBB");
/** Inline Markdown: bold, italic, code, http(s) links or stop:<nodeId>. No raw HTML, no links into assets/. `$…$` maths allowed. */
export const Markdown = z.string();
/**
 * Pack-relative asset path. No ".." segment; .html only under assets/interactive/.
 * The resolved real path must stay under the pack root (checked by the loader, not here).
 */
export const AssetPath = z
  .string()
  .regex(ASSET_PATH_RE, "asset path: assets/<dirs>/<name>.(svg|png|webp|mp3|ogg|html), lowercase")
  .refine((p) => !p.split("/").includes(".."), "asset path may not contain '..'")
  .refine(
    (p) => !p.endsWith(".html") || p.startsWith("assets/interactive/"),
    "html assets live under assets/interactive/",
  );
/** "2026-10-20T08:00:00Z" (a plain date "2026-10-20" is also accepted in files). */
export const IsoDate = z.string().regex(ISO_DATE_RE, "ISO 8601 date or date-time");
/** Epoch milliseconds (UTC). */
export const Millis = z.number();

/** Index into theme.lines. */
export const LineColor = z.literal([1, 2, 3, 4, 5]);
/** 1 = guessing, 2 = think so, 3 = sure. */
export const Confidence = z.literal([1, 2, 3]);
/** FSRS: 1 Again | 2 Hard | 3 Good | 4 Easy. */
export const Grade = z.literal([1, 2, 3, 4]);
export const Normalize = z.enum(["case", "accents", "punct", "space", "articles"]);
export const SelfRating = z.enum(["got-it", "partly", "missed"]);
export const LintProfile = z.enum(["curated", "sampler", "community", "pocket"]);

/** v0.1 built-in widgets. v0.2 adds "icon-array" | "color-lab" | "piano". */
export const WIDGET_IDS = [
  "probability-bars",
  "token-splitter",
  "attention-weights",
  "embedding-plane",
  "plot",
  "sorter",
  "hotspot",
  "ab-compare",
  "light-clock",
  "train-scene",
  "spacetime-diagram",
  "tile-builder",
  "dialogue",
  "listen",
  "code-stepper",
] as const;
export const WidgetId = z.enum(WIDGET_IDS);

export const ProviderId = z.enum(["none", "anthropic", "openai-compatible", "ollama"]);
export const ModelTier = z.enum(["fast", "smart", "deep"]);
export const Effort = z.enum(["low", "medium", "high"]);
export const AiFeature = z.enum(["ask", "hint", "grade", "quiz", "cards", "teach", "create", "build", "test"]);

export const RendererId = z.enum(["metro", "circuit", "atlas", "sketchbook", "trail"]);
/**
 * Map designs: named presets of a whole theme (renderer, ground, texture, backdrop, palette, token) that
 * any map can wear. The presets themselves live in `designs.ts`.
 */
export const MapDesignId = z.enum(["pond", "paper", "metro", "circuit", "atlas"]);
/** A learner's design pick for one map: a design, or the map's own theme ("original"). */
export const MapDesignChoice = z.union([MapDesignId, z.literal("original")]);
export const TextureId = z.enum([
  "none",
  // metro
  "grid-fine",
  "spacetime",
  "world",
  "ice",
  // circuit
  "pcb",
  "blueprint",
  // atlas
  "topo",
  "marble",
  "snow",
  "night-fair",
  // sketchbook
  "paper",
  "corkboard",
  "watercolour",
  // trail
  "meadow",
]);
export const TokenGlyph = z.enum([
  "train",
  "comet",
  "packet",
  "note",
  "electron",
  "scooter",
  "scroll",
  "hiker",
  "lantern",
  "paper-plane",
  "pin",
]);
export const LandmarkGlyph = z.enum([
  "chip",
  "core",
  "furnace",
  "station",
  "clock",
  "tunnel",
  "town",
  "plaza",
  "temple",
  "theatre",
  "lodge",
  "venue",
  "tower",
  "lighthouse",
  "star",
  "box",
  "tent",
]);
/** Code-drawn map backdrops (theme.backdrop). `transit-grid` and `terrain` are renderer defaults. */
export const BackdropId = z.enum([
  "circuit-board",
  "factory-floor",
  "light-cones",
  "ice-core",
  "cable-globe",
  "staff-town",
  "iberia-road",
  "agora",
  "mountain",
  "fairground",
  "case-board",
  "prism",
  "sketchbook",
  "transit-grid",
  "terrain",
  "pond",
  "none",
]);
export const PackCategory = z.enum(["languages", "science", "tech-ai", "thinking", "arts", "practical"]);

export type PackId = z.infer<typeof PackId>;
export type NodeId = z.infer<typeof NodeId>;
export type LineId = z.infer<typeof LineId>;
export type ItemId = z.infer<typeof ItemId>;
export type SemVer = z.infer<typeof SemVer>;
export type Hex = z.infer<typeof Hex>;
export type Markdown = z.infer<typeof Markdown>;
export type AssetPath = z.infer<typeof AssetPath>;
export type IsoDate = z.infer<typeof IsoDate>;
export type Millis = z.infer<typeof Millis>;
export type LineColor = z.infer<typeof LineColor>;
export type Confidence = z.infer<typeof Confidence>;
export type Grade = z.infer<typeof Grade>;
export type Normalize = z.infer<typeof Normalize>;
export type SelfRating = z.infer<typeof SelfRating>;
export type LintProfile = z.infer<typeof LintProfile>;
export type WidgetId = z.infer<typeof WidgetId>;
export type ProviderId = z.infer<typeof ProviderId>;
export type ModelTier = z.infer<typeof ModelTier>;
export type Effort = z.infer<typeof Effort>;
export type AiFeature = z.infer<typeof AiFeature>;
export type RendererId = z.infer<typeof RendererId>;
export type MapDesignId = z.infer<typeof MapDesignId>;
export type MapDesignChoice = z.infer<typeof MapDesignChoice>;
export type TextureId = z.infer<typeof TextureId>;
export type TokenGlyph = z.infer<typeof TokenGlyph>;
export type LandmarkGlyph = z.infer<typeof LandmarkGlyph>;
export type BackdropId = z.infer<typeof BackdropId>;
export type PackCategory = z.infer<typeof PackCategory>;
