/**
 * A provisional, dependency-free layered layout in the compiled-layout shape (MapLayout). The compiler
 * computes real layouts with elkjs at build time; this one serves the /dev/maps gallery, previews of
 * pocket maps mid-build and tests. Each line gets its own horizontal band (metro-style), columns are
 * longest-path depth, and nodes sit at cell centres (the same convention as the compiler).
 */
import type { CompiledMapNode, MapEdge, MapLayout, MapLine, NodeId } from "@learncroc/core";

export interface LayoutInput {
  lines: Pick<MapLine, "id">[];
  nodes: Record<NodeId, Pick<CompiledMapNode, "id" | "requires" | "line"> & { pin?: { col: number; row: number } }>;
  direction?: "lr" | "bt";
  cell?: { w: number; h: number };
}

export function provisionalLayout(input: LayoutInput): MapLayout {
  const cell = input.cell ?? { w: 168, h: 112 };
  const direction = input.direction ?? "lr";
  const ids = Object.keys(input.nodes);
  const col = new Map<NodeId, number>();
  const visiting = new Set<NodeId>();
  const depth = (id: NodeId): number => {
    const known = col.get(id);
    if (known !== undefined) return known;
    const n = input.nodes[id];
    if (!n || visiting.has(id)) return 0;
    visiting.add(id);
    const reqs = n.requires.filter((r) => input.nodes[r]);
    const d = n.pin?.col ?? (reqs.length ? 1 + Math.max(...reqs.map(depth)) : 0);
    visiting.delete(id);
    col.set(id, d);
    return d;
  };
  for (const id of ids) depth(id);

  // Bands: one per line, as tall as the line's busiest column.
  const lineOrder = input.lines.map((l) => l.id);
  for (const id of ids) {
    const line = input.nodes[id]?.line;
    if (line && !lineOrder.includes(line)) lineOrder.push(line);
  }
  const row = new Map<NodeId, number>();
  let bandStart = 0;
  const lines: Record<string, NodeId[]> = {};
  for (const line of lineOrder) {
    const members = ids
      .filter((id) => input.nodes[id]?.line === line)
      .sort((a, b) => (col.get(a) ?? 0) - (col.get(b) ?? 0) || ids.indexOf(a) - ids.indexOf(b));
    if (!members.length) continue;
    lines[line] = members;
    const used = new Map<number, number>();
    let height = 1;
    for (const id of members) {
      const c = col.get(id) ?? 0;
      const k = used.get(c) ?? 0;
      used.set(c, k + 1);
      height = Math.max(height, k + 1);
      row.set(id, input.nodes[id]?.pin?.row ?? bandStart + k);
    }
    bandStart += height;
  }
  const cols = Math.max(0, ...[...col.values()]) + 1;
  const rows = Math.max(1, bandStart, ...[...row.values()].map((r) => r + 1));

  const nodes: MapLayout["nodes"] = {};
  for (const id of ids) {
    const c = col.get(id) ?? 0;
    const r = row.get(id) ?? 0;
    nodes[id] =
      direction === "lr"
        ? { x: c * cell.w + cell.w / 2, y: r * cell.h + cell.h / 2, col: c, row: r }
        : { x: r * cell.w + cell.w / 2, y: (cols - 1 - c) * cell.h + cell.h / 2, col: c, row: r };
  }

  const bandOf = (id: NodeId) => lineOrder.indexOf(input.nodes[id]?.line ?? "");
  const edges: MapEdge[] = [];
  for (const id of ids) {
    for (const r of input.nodes[id]?.requires ?? []) {
      const a = nodes[r];
      const b = nodes[id];
      if (!a || !b) continue;
      const sameLine = input.nodes[r]?.line === input.nodes[id]?.line;
      const kind: MapEdge["kind"] = sameLine
        ? "line"
        : Math.abs(bandOf(r) - bandOf(id)) <= 1
          ? "interchange"
          : "transfer";
      edges.push({
        from: r,
        to: id,
        kind,
        points: [
          [a.x, a.y],
          [b.x, b.y],
        ],
      });
    }
  }
  return {
    width: direction === "lr" ? cols * cell.w : rows * cell.w,
    height: direction === "lr" ? rows * cell.h : cols * cell.h,
    direction,
    cell,
    nodes,
    edges,
    lines,
  };
}

/** Topological order (Kahn), stable by input order. */
export function topoOrder(nodes: Record<NodeId, { requires: NodeId[] }>): NodeId[] {
  const ids = Object.keys(nodes);
  const indeg = new Map(ids.map((id) => [id, (nodes[id]?.requires ?? []).filter((r) => nodes[r]).length] as const));
  const out: NodeId[] = [];
  const ready = ids.filter((id) => indeg.get(id) === 0);
  while (ready.length) {
    const id = ready.shift() as NodeId;
    out.push(id);
    for (const other of ids) {
      if (nodes[other]?.requires.includes(id)) {
        const d = (indeg.get(other) ?? 0) - 1;
        indeg.set(other, d);
        if (d === 0) ready.push(other);
      }
    }
  }
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}
