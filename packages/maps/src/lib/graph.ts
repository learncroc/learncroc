/**
 * Graph helpers over a compiled map: neighbours, default views, fog of curiosity, edge states,
 * arrow-key navigation and token paths. Pure functions; cached per compiled map object.
 */

import type { CompiledMap, MapEdge, NodeId, NodeState, NodeView } from "@learncroc/core";
import { defaultCheckpointSize, type Section, sections } from "@learncroc/core";

export interface MapGraph {
  ids: NodeId[];
  /** Prerequisites in map order. */
  prereqs: Map<NodeId, NodeId[]>;
  /** Stops that list this one in `requires`. */
  dependents: Map<NodeId, NodeId[]>;
  /** Line id → index into map.lines (0-based, also the line's band order). */
  lineIndex: Map<string, number>;
  /** Node → its line's colour index 0..4. */
  colorIndex: Map<NodeId, number>;
  /** Node ids with kind "checkpoint" (gates). */
  gates: Set<NodeId>;
  /** Stops with a prerequisite on another line (drawn as interchanges). */
  interchanges: Set<NodeId>;
}

const graphCache = new WeakMap<CompiledMap, MapGraph>();

export function mapGraph(map: CompiledMap): MapGraph {
  const hit = graphCache.get(map);
  if (hit) return hit;
  const ids = Object.keys(map.layout.nodes).filter((id) => map.nodes[id]);
  for (const id of map.topo) if (!ids.includes(id) && map.nodes[id]) ids.push(id);
  const prereqs = new Map<NodeId, NodeId[]>();
  const dependents = new Map<NodeId, NodeId[]>();
  for (const id of ids) {
    prereqs.set(id, []);
    dependents.set(id, []);
  }
  for (const id of ids) {
    for (const r of map.nodes[id]?.requires ?? []) {
      if (!prereqs.has(r)) continue;
      prereqs.get(id)?.push(r);
      dependents.get(r)?.push(id);
    }
  }
  const lineIndex = new Map(map.lines.map((l, i) => [l.id, i] as const));
  const colorIndex = new Map<NodeId, number>();
  const gates = new Set<NodeId>();
  const interchanges = new Set<NodeId>();
  for (const id of ids) {
    const node = map.nodes[id];
    if (!node) continue;
    const line = map.lines.find((l) => l.id === node.line);
    colorIndex.set(id, Math.max(0, Math.min(4, (line?.color ?? 1) - 1)));
    if (node.kind === "checkpoint") gates.add(id);
    if (node.requires.some((r) => map.nodes[r] && map.nodes[r]?.line !== node.line)) interchanges.add(id);
  }
  const g: MapGraph = { ids, prereqs, dependents, lineIndex, colorIndex, gates, interchanges };
  graphCache.set(map, g);
  return g;
}

/** A view for every node, filling gaps (posters with partial progress, building pocket maps). */
export function viewFor(map: CompiledMap, views: Record<NodeId, NodeView>, id: NodeId): NodeView {
  const v = views[id];
  if (v) return v;
  const node = map.nodes[id];
  const status = node?.status ?? "playable";
  const requires = node?.requires ?? [];
  const missing = requires.filter((r) => !satisfies(views[r]?.state));
  const state: NodeState =
    status === "planned" ? "planned" : status === "building" ? "building" : missing.length === 0 ? "ready" : "locked";
  return { id, state, brightness: 0, durable: false, suggested: false, missing, fadingPrereqs: [] };
}

/** Lit or fading: the card has been mastered at a checkpoint (fading never re-locks children). */
export const isLitLike = (s: NodeState | undefined): boolean => s === "lit" || s === "fading";

/** Done, lit or fading: the entry satisfies its dependants (Done unlocks inside the section, never re-locks). */
export const satisfies = (s: NodeState | undefined): boolean => s === "done" || s === "lit" || s === "fading";

/** An entry the learner can act on now. */
export const isOpen = (s: NodeState): boolean => s === "ready" || s === "in-progress";

/** Every playable card is lit or fading and every playable gate is open (the finished map, the dawn shift). */
export function everythingLit(map: CompiledMap, views: Record<NodeId, NodeView>): boolean {
  const playable = Object.values(map.nodes).filter((n) => n.status === "playable");
  return (
    playable.length > 0 &&
    playable.every((n) => (n.kind === "checkpoint" ? views[n.id]?.state === "lit" : isLitLike(views[n.id]?.state)))
  );
}

const sectionCache = new WeakMap<CompiledMap, Section[]>();

/** Playable checkpoints in topo order with the cards they cover (wraps core `sections`). */
export function sectionsOf(map: CompiledMap): Section[] {
  const hit = sectionCache.get(map);
  if (hit) return hit;
  const out = sections(map);
  sectionCache.set(map, out);
  return out;
}

/** The first playable gate (topo order) that is not open yet, if any. */
export function nextGate(map: CompiledMap, views: Record<NodeId, NodeView>): NodeId | undefined {
  return sectionsOf(map).find((s) => viewFor(map, views, s.checkpoint).state !== "lit")?.checkpoint;
}

/** The last playable gate in topo order (drawn 1.8× with the world's landmark). */
export function finalGate(map: CompiledMap): NodeId | undefined {
  const secs = sectionsOf(map);
  return secs[secs.length - 1]?.checkpoint;
}

/** Questions per attempt at a gate: its resolved size, else the default for its covers. */
export function gateSize(map: CompiledMap, id: NodeId): number {
  const n = map.nodes[id];
  return (
    n?.size ??
    defaultCheckpointSize(n?.covers?.length ?? sectionsOf(map).find((s) => s.checkpoint === id)?.cards.length ?? 2)
  );
}

/** The cards a gate covers (its section), in topo order. */
export function gateCovers(map: CompiledMap, id: NodeId): NodeId[] {
  const n = map.nodes[id];
  return n?.covers?.length ? n.covers : (sectionsOf(map).find((s) => s.checkpoint === id)?.cards ?? []);
}

/** The gate whose pass lights a card (the first gate covering it), if any. */
export function gateOf(map: CompiledMap, id: NodeId): NodeId | undefined {
  const n = map.nodes[id];
  if (n?.gate) return n.gate;
  return sectionsOf(map).find((s) => s.cards.includes(id))?.checkpoint;
}

const sectionIndexCache = new WeakMap<CompiledMap, Map<NodeId, number>>();

/** Section index of every entry: covered cards and their gate share an index; uncovered entries sit past the last. */
export function sectionIndex(map: CompiledMap): Map<NodeId, number> {
  const hit = sectionIndexCache.get(map);
  if (hit) return hit;
  const out = computeSectionIndex(map);
  sectionIndexCache.set(map, out);
  return out;
}

function computeSectionIndex(map: CompiledMap): Map<NodeId, number> {
  const secs = sectionsOf(map);
  const out = new Map<NodeId, number>();
  for (const s of secs) {
    out.set(s.checkpoint, s.index);
    for (const c of s.cards) if (!out.has(c)) out.set(c, s.index);
  }
  // Uncovered entries (planned, beyond the final gate, or checkpoint-less pocket maps): place them after
  // the latest section among their prerequisites.
  for (const id of map.topo) {
    if (out.has(id)) continue;
    let idx = 0;
    for (const r of map.nodes[id]?.requires ?? []) {
      const ri = out.get(r);
      if (ri === undefined) continue;
      idx = Math.max(idx, map.nodes[r]?.kind === "checkpoint" ? ri + 1 : ri);
    }
    out.set(id, idx);
  }
  return out;
}

export type FogLevel = 0 | 1 | 2;

/**
 * Locked-visible fog by section: 0 = here (the sections up to and including the next unopened gate, plus
 * anything already Done or Lit), 1 = the section behind the next gate, 2 = two or more gates away.
 * Nothing is hidden: levels only mute (titles stay readable on hover or focus).
 */
const fogCache = new WeakMap<Record<NodeId, NodeView>, WeakMap<CompiledMap, Map<NodeId, FogLevel>>>();

export function fogLevels(map: CompiledMap, views: Record<NodeId, NodeView>): Map<NodeId, FogLevel> {
  let perViews = fogCache.get(views);
  if (!perViews) {
    perViews = new WeakMap();
    fogCache.set(views, perViews);
  }
  const hit = perViews.get(map);
  if (hit) return hit;
  const out = computeFog(map, views);
  perViews.set(map, out);
  return out;
}

function computeFog(map: CompiledMap, views: Record<NodeId, NodeView>): Map<NodeId, FogLevel> {
  const g = mapGraph(map);
  const idx = sectionIndex(map);
  const next = nextGate(map, views);
  const here = next === undefined ? Number.POSITIVE_INFINITY : (idx.get(next) ?? 0);
  const out = new Map<NodeId, FogLevel>();
  for (const id of g.ids) {
    const s = viewFor(map, views, id).state;
    const i = idx.get(id) ?? 0;
    const level: FogLevel = satisfies(s) || i <= here ? 0 : i === here + 1 ? 1 : 2;
    out.set(id, level);
  }
  return out;
}

export type EdgeState = "lit" | "dim" | "done" | "open" | "locked" | "planned" | "unbuilt";

/**
 * lit: both ends mastered (ambient runs); dim: mastered but one end fading (reduced service);
 * done: both ends done or better (laid track); open: from a satisfied entry into an open one;
 * locked: not yet; planned: into a planned entry; unbuilt: through or beyond a locked gate.
 */
export function edgeState(
  map: CompiledMap,
  views: Record<NodeId, NodeView>,
  e: Pick<MapEdge, "from" | "to">,
): EdgeState {
  const to = viewFor(map, views, e.to).state;
  const from = viewFor(map, views, e.from).state;
  if (to === "planned" || from === "planned" || to === "building") return "planned";
  if (isLitLike(from) && isLitLike(to)) return from === "fading" || to === "fading" ? "dim" : "lit";
  if (satisfies(from) && satisfies(to)) return "done";
  if (satisfies(from) && isOpen(to)) return "open";
  const g = mapGraph(map);
  if (g.gates.has(e.from) && !satisfies(from)) return "unbuilt";
  if ((fogLevels(map, views).get(e.from) ?? 0) > 0) return "unbuilt";
  return "locked";
}

/** Ancestors of `id` that are not mastered, nearest first (the opens-after path overlay). */
export function unmetAncestors(map: CompiledMap, views: Record<NodeId, NodeView>, id: NodeId): NodeId[] {
  const g = mapGraph(map);
  const out: NodeId[] = [];
  const seen = new Set<NodeId>([id]);
  const queue = [...(g.prereqs.get(id) ?? [])];
  while (queue.length) {
    const p = queue.shift() as NodeId;
    if (seen.has(p)) continue;
    seen.add(p);
    if (satisfies(viewFor(map, views, p).state)) continue;
    out.push(p);
    queue.push(...(g.prereqs.get(p) ?? []));
  }
  return out;
}

/**
 * Shortest path between two stops over edges in either direction, preferring mastered stops (the token
 * travels along lit track where it can). Returns the node sequence including both ends.
 */
export function tokenPath(map: CompiledMap, views: Record<NodeId, NodeView>, from: NodeId, to: NodeId): NodeId[] {
  if (from === to) return [from];
  const g = mapGraph(map);
  if (!g.prereqs.has(from) || !g.prereqs.has(to)) return [from, to];
  // Dijkstra with cheap weights: lit-like hops cost 1, others 3.
  const cost = new Map<NodeId, number>([[from, 0]]);
  const prev = new Map<NodeId, NodeId>();
  const open = new Set<NodeId>([from]);
  while (open.size) {
    let best: NodeId | undefined;
    for (const id of open) if (best === undefined || (cost.get(id) ?? 0) < (cost.get(best) ?? 0)) best = id;
    if (best === undefined) break;
    open.delete(best);
    if (best === to) break;
    const neighbours = [...(g.prereqs.get(best) ?? []), ...(g.dependents.get(best) ?? [])];
    for (const n of neighbours) {
      const w = isLitLike(viewFor(map, views, n).state) || n === to ? 1 : 3;
      const c = (cost.get(best) ?? 0) + w;
      if (c < (cost.get(n) ?? Number.POSITIVE_INFINITY)) {
        cost.set(n, c);
        prev.set(n, best);
        open.add(n);
      }
    }
  }
  if (!prev.has(to)) return [from, to];
  const path: NodeId[] = [to];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (p === undefined) break;
    path.unshift(p);
    cur = p;
  }
  return path;
}

export type NavKey = "ArrowRight" | "ArrowLeft" | "ArrowUp" | "ArrowDown";

/**
 * Arrow-key navigation along the graph. In `lr` maps → goes to a dependent, ← to a prerequisite and
 * ↑/↓ to the nearest stop on the line above or below. `bt` maps turn the same rules a quarter: ↑ is a
 * dependent, ↓ a prerequisite, ←/→ the neighbouring line. Same-line neighbours win ties.
 */
export function navigate(map: CompiledMap, from: NodeId, key: NavKey): NodeId | undefined {
  const g = mapGraph(map);
  const pos = map.layout.nodes;
  const p = pos[from];
  const node = map.nodes[from];
  if (!p || !node) return undefined;
  const bt = map.layout.direction === "bt";
  const forward = bt ? "ArrowUp" : "ArrowRight";
  const backward = bt ? "ArrowDown" : "ArrowLeft";
  const pick = (cands: NodeId[]): NodeId | undefined => {
    let best: NodeId | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const c of cands) {
      const q = pos[c];
      if (!q) continue;
      const sameLine = map.nodes[c]?.line === node.line ? 0 : 1;
      const cross = bt ? Math.abs(q.x - p.x) : Math.abs(q.y - p.y);
      const along = bt ? Math.abs(q.y - p.y) : Math.abs(q.x - p.x);
      const score = sameLine * 10_000 + cross * 4 + along;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  };
  if (key === forward) return pick(g.dependents.get(from) ?? []);
  if (key === backward) return pick(g.prereqs.get(from) ?? []);
  // Neighbouring line: the nearest stop strictly above/below (lr) or left/right (bt).
  const sign = bt ? (key === "ArrowRight" ? 1 : -1) : key === "ArrowDown" ? 1 : -1;
  let best: NodeId | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const id of g.ids) {
    if (id === from) continue;
    const q = pos[id];
    if (!q) continue;
    const cross = bt ? q.x - p.x : q.y - p.y;
    if (cross * sign <= 1) continue;
    const along = bt ? Math.abs(q.y - p.y) : Math.abs(q.x - p.x);
    const score = Math.abs(cross) * 1.5 + along;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/** Stops in reading order: line by line (map.lines order), each line in its layout order. */
export function readingOrder(map: CompiledMap): NodeId[] {
  const seen = new Set<NodeId>();
  const out: NodeId[] = [];
  for (const line of map.lines) {
    const along = map.layout.lines[line.id] ?? [];
    const rest = map.topo.filter((id) => map.nodes[id]?.line === line.id && !along.includes(id));
    for (const id of [...along, ...rest]) {
      if (!seen.has(id) && map.nodes[id]) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  for (const id of map.topo) if (!seen.has(id) && map.nodes[id]) out.push(id);
  return out;
}
