/**
 * Map (map.yaml) and the compiled layout. Sections are encoded in the DAG: a checkpoint is a map entry
 * `kind: checkpoint` whose `requires` are its section's cards; the next section's first cards require it.
 */
import { z } from "zod";
import { LineColor, LineId, NodeId } from "./primitives";

export const MapLine = z.strictObject({
  id: LineId,
  /** "Inside the Machine" */
  title: z.string().min(1),
  color: LineColor,
  /** Logbook "You can now…", e.g. "Explain why a model makes things up". */
  outcome: z.string(),
});

export const MapNodeEntry = z.strictObject({
  /** Prerequisites (cards or checkpoints). Cards of section n+1 require section n's checkpoint. */
  requires: z.array(NodeId),
  line: LineId,
  /** Default "node". */
  kind: z.enum(["node", "checkpoint"]).optional(),
  /** Default "playable". Planned: no node file (samplers: only beyond the final checkpoint). */
  status: z.enum(["playable", "planned"]).optional(),
  /** Required for planned entries. Checkpoint default: theme.gateName ?? "Checkpoint <n>". */
  title: z.string().optional(),
  /** Required for planned entries. Optional for checkpoints (shown on the gate's peek). */
  teaser: z.string().optional(),
  /** Checkpoint only: the cards it tests. Default: its section (checkpointCovers). */
  covers: z.array(NodeId).min(1).optional(),
  /** Checkpoint only: questions per attempt, 3–5. Default: defaultCheckpointSize. */
  size: z.number().int().min(3).max(5).optional(),
  /** Optional layout hint. */
  pin: z.strictObject({ col: z.number().int(), row: z.number().int() }).optional(),
});

export const MapFile = z
  .strictObject({
    /** 1–5. */
    lines: z.array(MapLine).min(1).max(5),
    nodes: z.record(NodeId, MapNodeEntry),
  })
  .meta({
    title: "learncroc map",
    description:
      "map.yaml: the lines and the prerequisite graph (DAG) of a pack: cards, checkpoints and planned cards.",
  });

export const MapEdge = z.object({
  from: NodeId,
  to: NodeId,
  /** Same line / adjacent cross-line / distant cross-line (dotted). */
  kind: z.enum(["line", "interchange", "transfer"]),
  /** Default polyline; renderers may re-route. */
  points: z.array(z.tuple([z.number(), z.number()])),
});

/** Computed at compile time (packages/core/src/compile/layout.ts). */
export const MapLayout = z.object({
  /** px in layout space. */
  width: z.number(),
  height: z.number(),
  direction: z.enum(["lr", "bt"]),
  /** Default 168 x 112. */
  cell: z.object({ w: z.number(), h: z.number() }),
  nodes: z.record(NodeId, z.object({ x: z.number(), y: z.number(), col: z.number(), row: z.number() })),
  edges: z.array(MapEdge),
  /** Stops in order along each line. */
  lines: z.record(LineId, z.array(NodeId)),
});

export const CompiledMapNode = z.object({
  id: NodeId,
  requires: z.array(NodeId),
  line: LineId,
  kind: z.enum(["node", "checkpoint"]),
  /** building = pocket card still being generated. */
  status: z.enum(["playable", "planned", "building"]),
  title: z.string(),
  /** Card: the hook prompt (plain text). Checkpoint/planned: the authored teaser or "". */
  teaser: z.string(),
  estMinutes: z.number().optional(),
  /** Checkpoint: resolved covers (topo order). */
  covers: z.array(NodeId).optional(),
  /** Checkpoint: resolved size. */
  size: z.number().int().optional(),
  /** Card: the checkpoint whose pass lights it (first covering checkpoint in topo order). */
  gate: NodeId.optional(),
});

export type MapLine = z.infer<typeof MapLine>;
export type MapNodeEntry = z.infer<typeof MapNodeEntry>;
export type MapFile = z.infer<typeof MapFile>;
export type MapEdge = z.infer<typeof MapEdge>;
export type MapLayout = z.infer<typeof MapLayout>;
export type CompiledMapNode = z.infer<typeof CompiledMapNode>;
