/**
 * Prerequisite-graph helpers. A graph is a record from node id to the ids it
 * requires; insertion order is meaningful (it breaks ties in topological order, so authors control
 * the reading order of the map).
 */
import type { NodeId } from "./schema/index";

/** node id → prerequisite ids. */
export type Dag = Readonly<Record<NodeId, readonly NodeId[]>>;

/** Build a Dag from anything with `requires` (map.yaml entries, compiled map nodes). */
export function dagOf(nodes: Readonly<Record<NodeId, { readonly requires: readonly NodeId[] }>>): Dag {
  const out: Record<NodeId, readonly NodeId[]> = {};
  for (const [id, n] of Object.entries(nodes)) out[id] = n.requires;
  return out;
}

/** Requirements that point at ids missing from the graph. */
export function missingRequires(dag: Dag): { node: NodeId; requires: NodeId }[] {
  const out: { node: NodeId; requires: NodeId }[] = [];
  for (const [id, reqs] of Object.entries(dag)) {
    for (const r of reqs) if (!Object.hasOwn(dag, r)) out.push({ node: id, requires: r });
  }
  return out;
}

/** id → ids that require it (children), in graph order. Unknown requirements are ignored. */
export function childrenOf(dag: Dag): Record<NodeId, NodeId[]> {
  const out: Record<NodeId, NodeId[]> = {};
  for (const id of Object.keys(dag)) out[id] = [];
  for (const [id, reqs] of Object.entries(dag)) {
    for (const r of reqs) out[r]?.push(id);
  }
  return out;
}

/**
 * Kahn's algorithm with ties broken by graph order. Returns every node when acyclic; when a cycle
 * exists, `order` holds the nodes that could be sorted and `cycle` one offending cycle.
 * Requirements on unknown ids are ignored here (see missingRequires).
 */
export function topoSort(dag: Dag): { order: NodeId[]; cycle?: NodeId[] } {
  const ids = Object.keys(dag);
  const rank = new Map(ids.map((id, i) => [id, i]));
  const indeg = new Map<NodeId, number>();
  for (const id of ids) indeg.set(id, (dag[id] ?? []).filter((r) => rank.has(r)).length);
  const kids = childrenOf(dag);
  // A tiny sorted frontier keeps the result stable: always take the earliest ready node.
  const ready = ids.filter((id) => indeg.get(id) === 0);
  const order: NodeId[] = [];
  while (ready.length) {
    ready.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    const id = ready.shift() as NodeId;
    order.push(id);
    for (const k of kids[id] ?? []) {
      const d = (indeg.get(k) ?? 0) - 1;
      indeg.set(k, d);
      if (d === 0) ready.push(k);
    }
  }
  if (order.length === ids.length) return { order };
  return { order, cycle: findCycle(dag) ?? [] };
}

/** One cycle as a closed walk [a, b, …, a] following `requires` edges, or null when acyclic. */
export function findCycle(dag: Dag): NodeId[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<NodeId, number>();
  const stack: NodeId[] = [];
  const visit = (id: NodeId): NodeId[] | null => {
    color.set(id, GREY);
    stack.push(id);
    for (const r of dag[id] ?? []) {
      if (!Object.hasOwn(dag, r)) continue;
      const c = color.get(r) ?? WHITE;
      if (c === GREY) return [...stack.slice(stack.indexOf(r)), r];
      if (c === WHITE) {
        const found = visit(r);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  };
  for (const id of Object.keys(dag)) {
    if ((color.get(id) ?? WHITE) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}

/** Every node reachable by following `requires` (prerequisites, transitively), with its shortest depth. */
export function ancestorDepths(dag: Dag, id: NodeId): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  let frontier = [...(dag[id] ?? [])];
  let depth = 1;
  while (frontier.length) {
    const next: NodeId[] = [];
    for (const n of frontier) {
      if (out.has(n) || n === id || !Object.hasOwn(dag, n)) continue;
      out.set(n, depth);
      next.push(...(dag[n] ?? []));
    }
    frontier = next;
    depth++;
  }
  return out;
}

/** Prerequisites of `id`, transitively. */
export function ancestors(dag: Dag, id: NodeId): Set<NodeId> {
  return new Set(ancestorDepths(dag, id).keys());
}

/** Nodes that depend on `id`, transitively. */
export function descendants(dag: Dag, id: NodeId): Set<NodeId> {
  const kids = childrenOf(dag);
  const out = new Set<NodeId>();
  const stack = [...(kids[id] ?? [])];
  while (stack.length) {
    const n = stack.pop() as NodeId;
    if (out.has(n) || n === id) continue;
    out.add(n);
    stack.push(...(kids[n] ?? []));
  }
  return out;
}

/**
 * Shortest walk from `from` up the prerequisite edges to `to`, inclusive ([from, …, to]).
 * Null when `to` is not an ancestor of `from` (or equal to it).
 */
export function upstreamPath(dag: Dag, from: NodeId, to: NodeId): NodeId[] | null {
  if (from === to) return [from];
  const prev = new Map<NodeId, NodeId>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const n = queue.shift() as NodeId;
    for (const r of dag[n] ?? []) {
      if (seen.has(r) || !Object.hasOwn(dag, r)) continue;
      seen.add(r);
      prev.set(r, n);
      if (r === to) {
        const path = [to];
        let cur = to;
        while (cur !== from) {
          cur = prev.get(cur) as NodeId;
          path.push(cur);
        }
        return path.reverse();
      }
      queue.push(r);
    }
  }
  return null;
}

/** True when every member's prerequisites (within the graph) are members too. */
export function isDownset(dag: Dag, set: ReadonlySet<NodeId>): boolean {
  for (const id of set) {
    for (const r of dag[id] ?? []) if (Object.hasOwn(dag, r) && !set.has(r)) return false;
  }
  return true;
}

/** Restrict a graph to `keep`, preserving reachability (requirements through removed nodes are bridged). */
export function induced(dag: Dag, keep: ReadonlySet<NodeId>): Dag {
  const out: Record<NodeId, NodeId[]> = {};
  for (const id of Object.keys(dag)) {
    if (!keep.has(id)) continue;
    const reqs = new Set<NodeId>();
    const stack = [...(dag[id] ?? [])];
    const seen = new Set<NodeId>();
    while (stack.length) {
      const r = stack.pop() as NodeId;
      if (seen.has(r) || !Object.hasOwn(dag, r)) continue;
      seen.add(r);
      if (keep.has(r)) reqs.add(r);
      else stack.push(...(dag[r] ?? []));
    }
    out[id] = [...reqs];
  }
  return out;
}

/**
 * Every downward-closed set (knowledge state, Knowledge Space Theory) of an acyclic graph, as
 * arrays in topological order. Returns null when there would be more than `limit` states, so
 * callers can fall back to a per-node model on wide graphs.
 */
export function downsets(dag: Dag, limit = 50_000): NodeId[][] | null {
  const { order, cycle } = topoSort(dag);
  if (cycle) throw new Error(`downsets: the graph has a cycle (${cycle.join(" → ")})`);
  const out: NodeId[][] = [];
  // Depth-first over the topological order: a node may join only if all its prerequisites did.
  const chosen = new Set<NodeId>();
  let overflow = false;
  const walk = (i: number): void => {
    if (overflow) return;
    if (i === order.length) {
      out.push(order.filter((id) => chosen.has(id)));
      if (out.length > limit) overflow = true;
      return;
    }
    const id = order[i] as NodeId;
    walk(i + 1);
    if ((dag[id] ?? []).every((r) => !Object.hasOwn(dag, r) || chosen.has(r))) {
      chosen.add(id);
      walk(i + 1);
      chosen.delete(id);
    }
  };
  walk(0);
  return overflow ? null : out;
}
