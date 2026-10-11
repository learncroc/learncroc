/**
 * Map layout at compile time: an elkjs layered layout snapped to a grid of cells (default
 * 168 × 112), in the theme's direction ("lr": prerequisites to the left; "bt": prerequisites below).
 *
 * Steps: elk orders the layers and ranks → snap layers to columns and positions to rows → pull each
 * stop onto its line's row when that cell is free (straight metro lines) → apply `pin`s → pixel
 * coordinates, edges (line / interchange / transfer) with a default polyline, and the stops of each
 * line in topological order. Deterministic: the same map always yields the same layout.
 */
import type { ElkNode } from "elkjs/lib/elk.bundled.js";
import type { CompiledMapNode, LineId, MapEdge, MapLayout, MapLine, NodeId } from "../schema/index";

export const DEFAULT_CELL = { w: 168, h: 112 } as const;

type Elk = { layout(graph: ElkNode): Promise<ElkNode> };
let elkInstance: Promise<Elk> | undefined;

/**
 * elk.bundled.js picks between "I am a Web Worker" and "export a fake worker" by sniffing
 * `self` and `document`. Bun and other non-DOM runtimes define `self` without `document`, which
 * sends it down the worker path. A placeholder `document` during construction selects the
 * in-process path; browsers already have a document and are unaffected.
 */
function elk(): Promise<Elk> {
  // Loaded on first use so app bundles that never lay out a map don't carry elkjs.
  elkInstance ??= import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => {
    const g = globalThis as { document?: unknown };
    const hadDocument = "document" in g;
    if (!hadDocument) g.document = {};
    try {
      return new ELK() as unknown as Elk;
    } finally {
      if (!hadDocument) delete g.document;
    }
  });
  return elkInstance;
}

export interface LayoutInput {
  /** Compiled map nodes in topological order. */
  nodes: readonly CompiledMapNode[];
  lines: readonly MapLine[];
  direction: "lr" | "bt";
  /** Layout hints from map.yaml, in final grid coordinates (col = x index, row = y index from the top). */
  pins?: Readonly<Record<NodeId, { col: number; row: number }>>;
  cell?: { w: number; h: number };
}

interface Slot {
  layer: number;
  rank: number;
}

export async function layoutMap(input: LayoutInput): Promise<MapLayout> {
  const cell = input.cell ?? DEFAULT_CELL;
  const ids = input.nodes.map((n) => n.id);
  const known = new Set(ids);
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const lineOrder = new Map(input.lines.map((l, i) => [l.id, i]));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.randomSeed": "1",
      "elk.spacing.nodeNode": String(cell.h / 2),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(cell.w / 2),
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.layering.strategy": "LONGEST_PATH_SOURCE",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.semiInteractive": "false",
    },
    children: ids.map((id) => ({ id, width: cell.w / 2, height: cell.h / 2 })),
    edges: input.nodes.flatMap((n) =>
      n.requires
        .filter((r) => known.has(r))
        .map((r, i) => ({ id: `${r}->${n.id}#${i}`, sources: [r], targets: [n.id] })),
    ),
  };
  const result = ids.length ? await (await elk()).layout(graph) : { children: [] as ElkNode[] };

  // 1. Snap: distinct x positions → layers; y positions → ranks (one cell per rank).
  const pos = new Map(
    (result.children ?? []).map((c) => [
      c.id,
      { x: (c.x ?? 0) + (c.width ?? 0) / 2, y: (c.y ?? 0) + (c.height ?? 0) / 2 },
    ]),
  );
  const xs = [...new Set([...pos.values()].map((p) => Math.round(p.x)))].sort((a, b) => a - b);
  const minY = Math.min(0, ...[...pos.values()].map((p) => p.y));
  const slot = new Map<NodeId, Slot>();
  const taken = new Set<string>();
  const key = (s: Slot) => `${s.layer}:${s.rank}`;
  const place = (id: NodeId, s: Slot) => {
    let r = Math.max(0, s.rank);
    while (taken.has(key({ layer: s.layer, rank: r }))) r++;
    const fin = { layer: s.layer, rank: r };
    slot.set(id, fin);
    taken.add(key(fin));
  };

  // Pins first (converted to internal layer/rank), then everything else in topological order.
  const elkLayer = (id: NodeId) => xs.indexOf(Math.round(pos.get(id)?.x ?? 0));
  const maxElkLayer = Math.max(0, ...ids.map(elkLayer));
  const pins = input.pins ?? {};
  for (const id of ids) {
    const pin = pins[id];
    if (!pin) continue;
    const s =
      input.direction === "lr"
        ? { layer: pin.col, rank: pin.row }
        : { layer: Math.max(0, maxElkLayer - pin.row), rank: pin.col };
    place(id, s);
  }
  const ranked = ids
    .filter((id) => !pins[id])
    .map((id) => ({ id, layer: elkLayer(id), y: pos.get(id)?.y ?? 0 }))
    .sort((a, b) => a.layer - b.layer || a.y - b.y || ids.indexOf(a.id) - ids.indexOf(b.id));
  for (const { id, layer, y } of ranked) place(id, { layer, rank: Math.round((y - minY) / cell.h) });

  // 2. Line affinity: a stop moves onto the rank of its previous stop on the same line when free.
  const lineStops = new Map<LineId, NodeId[]>();
  for (const l of input.lines) lineStops.set(l.id, []);
  for (const id of ids) {
    const n = byId.get(id);
    if (n) lineStops.get(n.line)?.push(id) ?? lineStops.set(n.line, [id]);
  }
  for (const stops of lineStops.values()) {
    for (let i = 1; i < stops.length; i++) {
      const id = stops[i] as NodeId;
      if (pins[id]) continue;
      const prev = slot.get(stops[i - 1] as NodeId);
      const cur = slot.get(id);
      if (!prev || !cur || prev.rank === cur.rank || prev.layer >= cur.layer) continue;
      const target = { layer: cur.layer, rank: prev.rank };
      if (taken.has(key(target))) continue;
      taken.delete(key(cur));
      slot.set(id, target);
      taken.add(key(target));
    }
  }

  // 3. Compress empty ranks (only when nothing is pinned: pins are absolute).
  if (!Object.keys(pins).some((id) => known.has(id))) {
    const used = [...new Set([...slot.values()].map((s) => s.rank))].sort((a, b) => a - b);
    const remap = new Map(used.map((r, i) => [r, i]));
    for (const [id, s] of slot) slot.set(id, { layer: s.layer, rank: remap.get(s.rank) ?? s.rank });
  }

  // 4. Grid → pixels.
  const maxLayer = Math.max(0, ...[...slot.values()].map((s) => s.layer));
  const maxRank = Math.max(0, ...[...slot.values()].map((s) => s.rank));
  const nodes: MapLayout["nodes"] = {};
  for (const id of ids) {
    const s = slot.get(id) ?? { layer: 0, rank: 0 };
    const col = input.direction === "lr" ? s.layer : s.rank;
    const row = input.direction === "lr" ? s.rank : maxLayer - s.layer;
    nodes[id] = { x: col * cell.w + cell.w / 2, y: row * cell.h + cell.h / 2, col, row };
  }
  const cols = (input.direction === "lr" ? maxLayer : maxRank) + 1;
  const rows = (input.direction === "lr" ? maxRank : maxLayer) + 1;

  // 5. Edges.
  const edges: MapEdge[] = [];
  for (const n of input.nodes) {
    for (const r of n.requires) {
      const a = nodes[r];
      const b = nodes[n.id];
      const from = byId.get(r);
      if (!a || !b || !from) continue;
      const cross = input.direction === "lr" ? Math.abs(a.row - b.row) : Math.abs(a.col - b.col);
      const sameLine = from.line === n.line;
      const kind: MapEdge["kind"] = sameLine
        ? "line"
        : cross <= 1 || Math.abs((lineOrder.get(from.line) ?? 0) - (lineOrder.get(n.line) ?? 0)) <= 1
          ? "interchange"
          : "transfer";
      const points: [number, number][] = [[a.x, a.y]];
      if (input.direction === "lr" && a.y !== b.y) points.push([a.x + cell.w / 3, a.y]);
      if (input.direction === "bt" && a.x !== b.x) points.push([a.x, a.y - cell.h / 3]);
      points.push([b.x, b.y]);
      edges.push({ from: r, to: n.id, kind, points });
    }
  }

  const lines: MapLayout["lines"] = {};
  for (const [line, stops] of lineStops) lines[line] = stops;
  return {
    width: ids.length ? cols * cell.w : 0,
    height: ids.length ? rows * cell.h : 0,
    direction: input.direction,
    cell: { w: cell.w, h: cell.h },
    nodes,
    edges,
    lines,
  };
}
