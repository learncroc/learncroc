/**
 * Compiled pack, try bundle and lint report.
 */
import { z } from "zod";
import { PackManifest } from "./manifest";
import { CompiledMapNode, MapLayout, MapLine } from "./map";
import { PackNode } from "./node";
import { IsoDate, LintProfile, NodeId, PackId, SemVer } from "./primitives";

/** `topo` is the reading order (a stable Kahn sort; YAML key order breaks ties). */
export const CompiledMap = z.object({
  lines: z.array(MapLine),
  nodes: z.record(NodeId, CompiledMapNode),
  topo: z.array(NodeId),
  layout: MapLayout,
});

/** pack.json inside a .lmpack. The app only reads compiled packs. */
export const CompiledPack = z
  .object({
    format: z.literal(2),
    manifest: PackManifest,
    map: CompiledMap,
    /** Playable cards only (building cards appear when ready); flashcards and audio src filled in. Checkpoints have no node. */
    nodes: z.record(NodeId, PackNode),
    stats: z.object({
      nodes: z.number(),
      playable: z.number(),
      planned: z.number(),
      checkpoints: z.number(),
      screens: z.number(),
      items: z.number(),
      flashcards: z.number(),
      /** Σ cardWords().total over playable cards. */
      words: z.number(),
    }),
    compiledWith: z.object({ learncroc: SemVer, at: IsoDate }),
    /** sha256 of canonical pack.json without this field. */
    contentHash: z.string(),
    /** True while a pocket map is still building (the hash changes as nodes land). */
    provisional: z.boolean().optional(),
  })
  .meta({ title: "learncroc compiled pack", description: "pack.json: the compiled form of a pack." });

/** Served from the registry for "Try the first card"; played via POST /runs { kind: "try" }. */
export const TryBundle = z.object({
  manifest: PackManifest,
  map: CompiledMap,
  /** manifest.entry.suggestedStart */
  node: PackNode,
});

/** learncroc lint --json */
export const LintIssue = z.object({
  /** "L001" */
  rule: z.string(),
  severity: z.enum(["error", "warn"]),
  file: z.string(),
  /** JSON pointer. */
  path: z.string(),
  message: z.string(),
  /** One line: why the rule exists. */
  why: z.string(),
  /** One-line fix example. */
  example: z.string().optional(),
  /** `learncroc lint --fix` can fix it. */
  fixable: z.boolean(),
});

export const LintReport = z.object({
  packId: PackId,
  profile: LintProfile,
  errors: z.number(),
  warnings: z.number(),
  suppressed: z.array(z.object({ rule: z.string(), file: z.string(), path: z.string(), reason: z.string() })),
  issues: z.array(LintIssue),
});

export type CompiledMap = z.infer<typeof CompiledMap>;
export type CompiledPack = z.infer<typeof CompiledPack>;
export type TryBundle = z.infer<typeof TryBundle>;
export type LintIssue = z.infer<typeof LintIssue>;
export type LintReport = z.infer<typeof LintReport>;
