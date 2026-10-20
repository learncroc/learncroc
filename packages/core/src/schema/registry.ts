/**
 * Registry index.json and install records.
 */
import { z } from "zod";
import { PackManifest, PackTheme } from "./manifest";
import { MapEdge } from "./map";
import { IsoDate, LineColor, LineId, LintProfile, Millis, NodeId, PackCategory, PackId, SemVer } from "./primitives";

export const RegistryPack = z.object({
  id: PackId,
  title: z.string(),
  subtitle: z.string().optional(),
  tagline: z.string().optional(),
  publisher: z.string(),
  tier: z.enum(["official", "community"]),
  category: PackCategory,
  tags: z.array(z.string()),
  lang: z.string(),
  profile: LintProfile,
  review: z.enum(["reviewed", "draft"]),
  reviewers: z.array(z.object({ name: z.string(), role: z.string() })).optional(),
  customInteractives: z.boolean(),
  theme: PackTheme.pick({
    renderer: true,
    world: true,
    mode: true,
    ground: true,
    texture: true,
    lines: true,
    token: true,
  }),
  outcomes: z.array(z.string()),
  /** Enough to draw a poster without downloading. */
  sketch: z.object({
    width: z.number(),
    height: z.number(),
    nodes: z.array(
      z.object({
        id: NodeId,
        x: z.number(),
        y: z.number(),
        line: LineId,
        kind: z.enum(["node", "checkpoint"]),
        status: z.enum(["playable", "planned"]),
      }),
    ),
    edges: z.array(z.object({ from: NodeId, to: NodeId, kind: MapEdge.shape.kind })),
    lines: z.array(z.object({ id: LineId, color: LineColor })),
  }),
  latest: SemVer,
  versions: z.array(
    z.object({
      version: SemVer,
      engine: z.string(),
      /** https, or relative to index.json; resolution keeps the index's scheme and origin. */
      url: z.string(),
      sha256: z.string(),
      /** Bytes. */
      size: z.number(),
      nodes: z.number(),
      playable: z.number(),
      estMinutes: z.number(),
      license: PackManifest.shape.license,
      published: IsoDate,
      /** TryBundle JSON; same URL rules. */
      tryUrl: z.string(),
    }),
  ),
});

export const RegistryIndex = z.object({
  registry: z.literal(1),
  /** "learncroc builtin" | "learncroc official" */
  name: z.string(),
  updated: IsoDate,
  packs: z.array(RegistryPack),
});

export const RegistryView = z.object({
  packs: z.array(
    RegistryPack.extend({ installed: SemVer.optional(), updateAvailable: z.boolean(), registry: z.string() }),
  ),
  stale: z.boolean(),
  fetchedAt: Millis.optional(),
  errors: z.array(z.object({ registry: z.string(), message: z.string() })),
});

export const InstalledRecord = z.object({
  sha256: z.string().optional(),
  registry: z.string().optional(),
  tier: z.enum(["official", "community", "local"]),
  /** "file" = installed in-process by the CLI. */
  source: z.enum(["registry", "builtin", "file", "dev", "create"]),
  installedAt: IsoDate,
  /** Open run ids keeping this version alive (GC skips it). */
  pinnedBy: z.array(z.string()).optional(),
});

/** ~/.learncroc/installed.json (written atomically: temp file + rename; one writer). */
export const InstalledFile = z.object({
  installed: z.literal(1),
  packs: z.record(PackId, z.object({ active: SemVer, versions: z.record(SemVer, InstalledRecord) })),
});

export type RegistryPack = z.infer<typeof RegistryPack>;
export type RegistryIndex = z.infer<typeof RegistryIndex>;
export type RegistryView = z.infer<typeof RegistryView>;
export type InstalledRecord = z.infer<typeof InstalledRecord>;
export type InstalledFile = z.infer<typeof InstalledFile>;
