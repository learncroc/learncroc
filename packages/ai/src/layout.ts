/**
 * Provisional map layout for pocket maps (pure; also used by the surveying view in the browser).
 * Longest-path layering into columns, barycentre ordering within a column, snapped to the
 * compiler's grid (168 × 112 cells). Lines: each root starts a line (≤ 5); a stop joins the line of
 * its first prerequisite.
 */
import type { MapEdge, MapLayout, NodeId } from "@learncroc/core";

export const CELL = { w: 168, h: 112 } as const;

/** Default ink colours for pocket maps on cream paper (each ≥ 3:1 against #F7F4EE). */
export const POCKET_INKS = ["#2F5D8A", "#9C4A2F", "#3E7A4F", "#7A4E8C", "#8A6A1F"] as const;
export const POCKET_PAPER = "#F7F4EE";

export interface LayoutInput {
  id: NodeId;
  requires: NodeId[];
}

export interface LayoutResult {
  layout: MapLayout;
  /** node id → line id ("l1"…"l5"). */
  lineOf: Record<NodeId, string>;
  /** Topological order (input order, with any forward references fixed). */
  topo: NodeId[];
}

/** Kahn's algorithm, stable by input order. Edges to unknown nodes are ignored; cycles are broken. */
export function topoOrder(nodes: LayoutInput[]): NodeId[] {
  const ids = new Set(nodes.map((n) => n.id));
  const indeg = new Map(nodes.map((n) => [n.id, n.requires.filter((r) => ids.has(r) && r !== n.id).length]));
  const out: NodeId[] = [];
  const done = new Set<NodeId>();
  while (out.length < nodes.length) {
    const next =
      nodes.find((n) => !done.has(n.id) && (indeg.get(n.id) ?? 0) === 0) ?? nodes.find((n) => !done.has(n.id));
    if (!next) break;
    out.push(next.id);
    done.add(next.id);
    for (const n of nodes)
      if (n.requires.includes(next.id) && !done.has(n.id)) indeg.set(n.id, (indeg.get(n.id) ?? 1) - 1);
  }
  return out;
}

/** True when adding from → to would create a cycle in the current requires graph. */
export function wouldCycle(nodes: Map<NodeId, NodeId[]>, from: NodeId, to: NodeId): boolean {
  if (from === to) return true;
  const stack = [from];
  const seen = new Set<NodeId>();
  while (stack.length > 0) {
    const cur = stack.pop() as NodeId;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const r of nodes.get(cur) ?? []) stack.push(r);
  }
  return false;
}

export function layoutMap(input: LayoutInput[]): LayoutResult {
  const ids = new Set(input.map((n) => n.id));
  const req = new Map(input.map((n) => [n.id, n.requires.filter((r) => ids.has(r) && r !== n.id)]));
  const topo = topoOrder(input.map((n) => ({ id: n.id, requires: req.get(n.id) ?? [] })));
  const col = new Map<NodeId, number>();
  for (const id of topo) col.set(id, Math.max(-1, ...(req.get(id) ?? []).map((r) => col.get(r) ?? 0)) + 1);

  const lineOf: Record<NodeId, string> = {};
  let roots = 0;
  for (const id of topo) {
    const first = (req.get(id) ?? [])[0];
    lineOf[id] = first && lineOf[first] ? (lineOf[first] as string) : `l${(roots++ % 5) + 1}`;
  }

  const columns = new Map<number, NodeId[]>();
  for (const id of topo) {
    const c = col.get(id) ?? 0;
    columns.set(c, [...(columns.get(c) ?? []), id]);
  }
  const row = new Map<NodeId, number>();
  const ncols = Math.max(0, ...columns.keys()) + 1;
  for (let c = 0; c < ncols; c++) {
    const list = columns.get(c) ?? [];
    const scored = list.map((id, i) => {
      const parents = (req.get(id) ?? []).map((r) => row.get(r) ?? 0);
      const bary = parents.length > 0 ? parents.reduce((a, b) => a + b, 0) / parents.length : i;
      return { id, bary, i };
    });
    scored.sort((a, b) => a.bary - b.bary || a.i - b.i);
    const used = new Set<number>();
    for (const s of scored) {
      let r = Math.max(0, Math.round(s.bary));
      while (used.has(r)) r++;
      used.add(r);
      row.set(s.id, r);
    }
  }
  const nrows = Math.max(0, ...row.values()) + 1;
  const pos = (id: NodeId) => {
    const c = col.get(id) ?? 0;
    const r = row.get(id) ?? 0;
    return { x: c * CELL.w + CELL.w / 2, y: r * CELL.h + CELL.h / 2, col: c, row: r };
  };
  const nodes: MapLayout["nodes"] = {};
  for (const id of topo) nodes[id] = pos(id);
  const edges: MapEdge[] = [];
  for (const id of topo) {
    for (const r of req.get(id) ?? []) {
      const a = nodes[r];
      const b = nodes[id];
      if (!a || !b) continue;
      const sameLine = lineOf[r] === lineOf[id];
      const kind: MapEdge["kind"] = sameLine ? "line" : b.col - a.col <= 1 ? "interchange" : "transfer";
      const points: [number, number][] =
        a.row === b.row
          ? [
              [a.x, a.y],
              [b.x, b.y],
            ]
          : [
              [a.x, a.y],
              [(a.x + b.x) / 2, a.y],
              [(a.x + b.x) / 2, b.y],
              [b.x, b.y],
            ];
      edges.push({ from: r, to: id, kind, points });
    }
  }
  const lines: Record<string, NodeId[]> = {};
  for (const id of topo) {
    const l = lineOf[id] as string;
    lines[l] = [...(lines[l] ?? []), id];
  }
  return {
    layout: { width: ncols * CELL.w, height: nrows * CELL.h, direction: "lr", cell: { ...CELL }, nodes, edges, lines },
    lineOf,
    topo,
  };
}
