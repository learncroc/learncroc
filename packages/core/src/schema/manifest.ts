/**
 * Pack manifest (pack.yaml) and lock file (pack.lock.yaml) (CONTRACTS §2).
 */
import { z } from "zod";
import { Provenance } from "./common";
import {
  AssetPath,
  BackdropId,
  Hex,
  IsoDate,
  LandmarkGlyph,
  LintProfile,
  NodeId,
  PackCategory,
  PackId,
  RendererId,
  SemVer,
  TextureId,
  TokenGlyph,
  WidgetId,
} from "./primitives";

export const PackOrigin = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("url"),
    url: z.string(),
    title: z.string().optional(),
    site: z.string().optional(),
    fetchedAt: IsoDate,
    license: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal("text"), title: z.string(), createdAt: IsoDate }),
]);

export const PackTheme = z.strictObject({
  renderer: RendererId,
  /** "The Machine" */
  world: z.string().min(1),
  /** The world's ground is always this, regardless of the app theme. */
  mode: z.enum(["dark", "light"]),
  /** Default "lr". */
  direction: z.enum(["lr", "bt"]),
  /** Map background (L* < 25 for dark, > 88 for light). */
  ground: Hex,
  /** Text on ground; default computed (≥ 7:1). */
  ink: Hex.optional(),
  texture: TextureId,
  /** --w-1..--w-5; lint: ≥ 3:1 vs ground, ΔE ≥ 15 from Lumen/Ember/Sea. */
  lines: z.tuple([Hex, Hex, Hex, Hex, Hex]),
  token: TokenGlyph,
  /** ≤ 3 words per name. May key checkpoint ids. */
  landmarks: z.record(NodeId, z.strictObject({ name: z.string(), glyph: LandmarkGlyph.optional() })).optional(),
  /** Default checkpoint title stem, e.g. "Power check" → "Power check 2". */
  gateName: z.string().optional(),
  /** Code-drawn backdrop behind the map (poster-safe). Default: the renderer's own. */
  backdrop: BackdropId.optional(),
  /** Default "card". */
  fieldNoteStyle: z.enum(["spec-sheet", "ticket", "postcard", "card"]).optional(),
  /** Optional decorative SVG, aria-hidden, rendered via <img>. */
  art: z.strictObject({ background: AssetPath.optional() }).optional(),
});

const Person = z.strictObject({ name: z.string().min(1), url: z.string().optional() });

export const PackManifest = z
  .strictObject({
    /** Pack format version; `learncroc migrate` upgrades older files. */
    schema: z.literal(2),
    id: PackId,
    version: SemVer,
    /** "How LLMs work" */
    title: z.string().min(1),
    /** One line. */
    subtitle: z.string().optional(),
    /** Marketplace promise, ≤ 15 words. */
    tagline: z.string().optional(),
    /** "learncroc" for first-party. */
    publisher: z.string().min(1),
    authors: z.array(Person),
    /** Credited on the map legend; must match pack.lock.yaml reviews. */
    reviewers: z.array(Person.extend({ role: z.string() })).optional(),
    license: z.enum(["CC-BY-SA-4.0", "CC-BY-4.0", "CC0-1.0"]),
    /** BCP-47 of the learner-facing UI text, e.g. "en". */
    lang: z.string().min(2),
    /** Language packs: "es-ES". */
    targetLang: z.string().optional(),
    level: z.enum(["beginner", "intermediate", "advanced"]),
    /** Whole pack, playable part. */
    estMinutes: z.number().positive(),
    tags: z.array(z.string()),
    category: PackCategory,
    /** Semver range of the app, e.g. ">=0.1.0 <1.0.0". */
    engine: z.string().min(1),
    /** Widget id → major version used. */
    widgets: z.partialRecord(WidgetId, z.number().int().min(1)),
    /** Default "community"; publisher "learncroc" must be "curated" or "sampler". */
    profile: LintProfile,
    theme: PackTheme,
    entry: z.strictObject({
      /** Default: first root in topo order. */
      suggestedStart: NodeId.optional(),
    }),
    /** 3 "You'll be able to…" statements (marketplace). */
    outcomes: z.array(z.string()),
    ai: z.strictObject({ tutorNotes: z.string().optional() }).optional(),
    /** True for pocket maps; publish refuses. */
    private: z.boolean().optional(),
    /** Set for generated packs. */
    origin: PackOrigin.optional(),
    /** "reviewed" requires pack.lock.yaml reviews covering pack.yaml (L017). */
    status: z.enum(["draft", "reviewed"]),
    /** Renders a footer on every screen. */
    disclaimer: z.enum(["finance", "health", "legal"]).optional(),
  })
  .meta({
    title: "learncroc pack manifest",
    description: "pack.yaml: identity, theme and entry point of a learncroc pack.",
  });

/** pack.lock.yaml — written by tools (provenance) and by humans (reviews). Agents never write `reviews`. */
export const PackLock = z
  .strictObject({
    /** Pack-relative file path → how it was generated. */
    provenance: z.record(z.string(), Provenance).optional(),
    reviews: z
      .array(
        z.strictObject({
          /** A named human. */
          name: z.string().min(1),
          url: z.string().optional(),
          /** "subject expert", "native speaker", "editor". */
          role: z.string(),
          date: IsoDate,
          /** Pack-relative paths this sign-off covers; "*" = whole pack. */
          files: z.array(z.string()),
          note: z.string().optional(),
        }),
      )
      .optional(),
  })
  .meta({
    title: "learncroc pack lock",
    description: "pack.lock.yaml: AI provenance per file and human review sign-offs.",
  });

export type PackOrigin = z.infer<typeof PackOrigin>;
export type PackTheme = z.infer<typeof PackTheme>;
export type PackManifest = z.infer<typeof PackManifest>;
export type PackLock = z.infer<typeof PackLock>;
