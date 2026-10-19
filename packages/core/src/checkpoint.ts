/**
 * Checkpoints: the gates between sections.
 *
 * Sections are encoded in the DAG. A checkpoint is a map entry `kind: checkpoint` whose `requires` are
 * its section's cards; the next section's first cards require the checkpoint. Gate wiring (covers,
 * sections, sizes) comes only from this file, for compile, lint, maps and the AI pipeline.
 * Pure and browser-safe.
 */
import { itemsFor, pickNextItem, TARGET_P } from "./adaptive";
import { revisitScreen } from "./card";
import { plainText } from "./compile/text";
import { ancestors, dagOf, topoSort } from "./dag";
import { deriveSeed, drawVars, instantiateItem, shuffle } from "./params";
import { checkpointCredit } from "./pass";
import type { AttemptRow, CompiledPack, Item, ItemId, ItemRef, NodeId, PackNode, RevisitTarget } from "./schema/index";

/** Croc + hint button, per question. */
export const CHECKPOINT_HINT_CAP = 2;
/** A question answered right after hint level 1 still counts as right. */
export const CHECKPOINT_RIGHT_MAX_HINT = 1;
/** Questions per attempt. */
export const CHECKPOINT_MIN_SIZE = 3;
export const CHECKPOINT_MAX_SIZE = 5;

/** Minimal graph view usable before and after compile (map.yaml entries or the compiled map). */
export interface GateGraph {
  nodes: Readonly<
    Record<
      NodeId,
      {
        requires: readonly NodeId[];
        kind?: "node" | "checkpoint";
        status?: "playable" | "planned" | "building";
        covers?: readonly NodeId[];
      }
    >
  >;
  /** Reading order (topological, YAML key order breaks ties). */
  topo: readonly NodeId[];
}

/** A GateGraph over uncompiled entries (map.yaml), with topo computed the way compile does. */
export function gateGraph(nodes: GateGraph["nodes"]): GateGraph {
  return { nodes, topo: topoSort(dagOf(nodes)).order };
}

const isCheckpoint = (g: GateGraph, id: NodeId) => g.nodes[id]?.kind === "checkpoint";
const isPlanned = (g: GateGraph, id: NodeId) => g.nodes[id]?.status === "planned";
const isCard = (g: GateGraph, id: NodeId) => {
  const n = g.nodes[id];
  return !!n && n.kind !== "checkpoint";
};

function topoIndex(g: GateGraph): Map<NodeId, number> {
  return new Map(g.topo.map((id, i) => [id, i]));
}

function inTopo(g: GateGraph, ids: Iterable<NodeId>): NodeId[] {
  const rank = topoIndex(g);
  return [...new Set(ids)].filter((id) => rank.has(id)).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

/** Checkpoint ids in topo order, planned ones included. */
export function checkpointIds(g: GateGraph): NodeId[] {
  return g.topo.filter((id) => isCheckpoint(g, id));
}

/**
 * The cards a checkpoint tests, in topo order. Explicit `covers` when given; otherwise the non-planned
 * card ancestors of the checkpoint that are not ancestors of an earlier checkpoint (one that is itself an
 * ancestor of this one). Planned checkpoints cover nothing.
 */
export function checkpointCovers(g: GateGraph, cpId: NodeId): NodeId[] {
  const cp = g.nodes[cpId];
  if (cp?.kind !== "checkpoint" || cp.status === "planned") return [];
  if (cp.covers?.length) return inTopo(g, cp.covers);
  const dag = dagOf(g.nodes);
  const up = ancestors(dag, cpId);
  const behind = new Set<NodeId>();
  for (const a of up) {
    if (!isCheckpoint(g, a)) continue;
    for (const b of ancestors(dag, a)) behind.add(b);
  }
  return inTopo(
    g,
    [...up].filter((id) => isCard(g, id) && !isPlanned(g, id) && !behind.has(id)),
  );
}

/** Non-planned card ancestors of a checkpoint minus its covers (cards behind earlier gates), topo order. */
export function earlierCards(g: GateGraph, cpId: NodeId): NodeId[] {
  const covers = new Set(checkpointCovers(g, cpId));
  const up = ancestors(dagOf(g.nodes), cpId);
  return inTopo(
    g,
    [...up].filter((id) => isCard(g, id) && !isPlanned(g, id) && !covers.has(id)),
  );
}

/** Questions per attempt by default: clamp(nCovers + 1, 3, 5). */
export function defaultCheckpointSize(nCovers: number): number {
  return Math.min(CHECKPOINT_MAX_SIZE, Math.max(CHECKPOINT_MIN_SIZE, nCovers + 1));
}

export interface Section {
  /** 0-based, in topo order. */
  index: number;
  checkpoint: NodeId;
  cards: NodeId[];
}

/** Playable checkpoints in topo order with their covers; maps draw sections from this. */
export function sections(g: GateGraph): Section[] {
  return checkpointIds(g)
    .filter((id) => !isPlanned(g, id))
    .map((checkpoint, index) => ({ index, checkpoint, cards: checkpointCovers(g, checkpoint) }));
}

/**
 * Card counts per section for n cards, balanced, ≥ 1 section (AI pipeline and lint).
 * k = max(1, ceil(n / max)); n split into k near-equal parts (larger parts first); n < min → [n].
 */
export function sectionSizes(n: number, every: readonly [number, number]): number[] {
  const [min, max] = every;
  if (n < min) return [n];
  const k = Math.max(1, Math.ceil(n / Math.max(1, max)));
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

export interface PlanEntry {
  ref: ItemRef;
  vars?: Record<string, number>;
}

export interface CheckpointPlanInput {
  pack: CompiledPack;
  cpId: NodeId;
  /** Earlier cards with their node-card retrievability (lit cards only; missing card → 1). */
  earlier: readonly { nodeId: NodeId; retrievability: number }[];
  theta: Readonly<Record<NodeId, number>>;
  ratings: Readonly<Record<NodeId, Readonly<Record<ItemId, number>>>>;
  /** "nodeId/itemId" already asked in earlier attempts at this gate. */
  avoid: ReadonlySet<string>;
  /** Vars used before per "nodeId/itemId" (parametric freshness). */
  avoidVars?: Readonly<Record<string, readonly Record<string, number>[]>>;
  /** Cards missed last attempt (asked first). */
  missedLast: readonly NodeId[];
  seed: number;
}

/** "nodeId/itemId": how checkpoint records key asked items and their vars. */
export const itemKey = (ref: Pick<ItemRef, "nodeId" | "itemId">) => `${ref.nodeId}/${ref.itemId}`;

/** Items a checkpoint may ask from a card: checkpoint use, apply or transfer level, never explain. */
export function checkpointPool(node: Pick<PackNode, "items">): Item[] {
  return itemsFor(node, "checkpoint").filter((i) => i.kind !== "explain" && i.level !== "recall");
}

interface CardPool {
  nodeId: NodeId;
  /** Never asked at this gate, or parametric (redrawn with fresh vars). Transfer first, then apply. */
  fresh: Item[];
  /** Asked before, least recently asked first (refill when nothing fresh is left). */
  repeats: Item[];
}

function poolFor(
  pack: CompiledPack,
  nodeId: NodeId,
  avoid: ReadonlySet<string>,
  order: ReadonlyMap<string, number>,
): CardPool {
  const node = pack.nodes[nodeId];
  const items = node ? checkpointPool(node) : [];
  const byLevel = (xs: Item[]) => [
    ...xs.filter((i) => i.level === "transfer"),
    ...xs.filter((i) => i.level !== "transfer"),
  ];
  const asked = (i: Item) => avoid.has(itemKey({ nodeId, itemId: i.id }));
  return {
    nodeId,
    fresh: byLevel(items.filter((i) => !asked(i) || i.params !== undefined)),
    repeats: items
      .filter((i) => asked(i) && i.params === undefined)
      .sort(
        (a, b) =>
          (order.get(itemKey({ nodeId, itemId: a.id })) ?? 0) - (order.get(itemKey({ nodeId, itemId: b.id })) ?? 0),
      ),
  };
}

/**
 * The fixed question plan for one checkpoint attempt (deterministic per input):
 * 1. covers and size from the compiled map entry;
 * 2. one slot for the earlier card with the lowest retrievability (when there is one);
 * 3. the other slots round-robin over covers, last attempt's missed cards first, then topo order;
 * 4. per card: apply/transfer items only (never recall or explain), transfer first, items asked at this
 *    gate skipped unless parametric (redrawn with fresh vars); only when no card has anything fresh left
 *    are repeats used, least recently asked first; within a level the Elo pick closest to P = 0.8;
 *    at most one `callback` item, preferred as the first card's first question;
 * 5. a seeded shuffle with repair: a callback item first, the earlier-section item never first, and the
 *    same card never twice in a row when avoidable.
 */
export function buildCheckpointPlan(i: CheckpointPlanInput): PlanEntry[] {
  const { pack, cpId, seed } = i;
  const packId = pack.manifest.id;
  const entry = pack.map.nodes[cpId];
  if (entry?.kind !== "checkpoint") return [];
  const covers = (entry.covers ?? checkpointCovers(pack.map, cpId)).filter((id) => pack.nodes[id]);
  const size = entry.size ?? defaultCheckpointSize(covers.length);
  const order = new Map([...i.avoid].map((k, n) => [k, n] as const));
  const used = new Set<string>();
  const out: (PlanEntry & { earlier?: boolean; callback?: boolean })[] = [];
  let callbackTaken = false;

  const draw = (nodeId: NodeId, item: Item): PlanEntry & { callback?: boolean } => {
    const ref: ItemRef = { packId, nodeId, itemId: item.id };
    const e: PlanEntry & { callback?: boolean } = { ref };
    if (item.params) {
      const k = itemKey(ref);
      e.vars = drawVars(item.params, deriveSeed(seed, "cp", k), item.id, i.avoidVars?.[k] ?? []);
    }
    if (item.callback) e.callback = true;
    return e;
  };

  /** One item from a card's pool: Elo pick within transfer, then apply; callbacks only when wanted. */
  const pickFrom = (pool: CardPool, allowRepeats: boolean, wantCallback: boolean): Item | undefined => {
    const left = (xs: Item[]) => xs.filter((x) => !used.has(itemKey({ nodeId: pool.nodeId, itemId: x.id })));
    const fresh = left(pool.fresh);
    const pick = (cands: Item[]) =>
      pickNextItem({
        candidates: cands,
        theta: i.theta[pool.nodeId] ?? 0,
        ratings: i.ratings[pool.nodeId] ?? {},
        target: TARGET_P,
      });
    if (wantCallback && !callbackTaken) {
      const cb = fresh.find((x) => x.callback);
      if (cb) return cb;
    }
    const noCb = (xs: Item[]) => (callbackTaken || !wantCallback ? xs.filter((x) => !x.callback) : xs);
    for (const xs of [noCb(fresh), fresh]) {
      const t = pick(xs.filter((x) => x.level === "transfer"));
      if (t) return t;
      const a = pick(xs);
      if (a) return a;
    }
    if (!allowRepeats) return undefined;
    return left(pool.repeats)[0];
  };

  const take = (pool: CardPool, allowRepeats: boolean, wantCallback: boolean, earlier = false): boolean => {
    const item = pickFrom(pool, allowRepeats, wantCallback);
    if (!item) return false;
    used.add(itemKey({ nodeId: pool.nodeId, itemId: item.id }));
    const e = draw(pool.nodeId, item);
    if (e.callback) {
      if (callbackTaken || earlier) delete e.callback;
      else callbackTaken = true;
    }
    out.push(earlier ? { ...e, earlier: true } : e);
    return true;
  };

  // 2. The earlier-section slot: lowest retrievability, ties in topo order.
  const rank = new Map(pack.map.topo.map((id, n) => [id, n] as const));
  const earlier = [...i.earlier]
    .filter((e) => pack.nodes[e.nodeId] && !covers.includes(e.nodeId))
    .sort((a, b) => a.retrievability - b.retrievability || (rank.get(a.nodeId) ?? 0) - (rank.get(b.nodeId) ?? 0));
  for (const e of earlier) {
    if (size <= 1) break;
    const pool = poolFor(pack, e.nodeId, i.avoid, order);
    if (take(pool, false, false, true) || take(pool, true, false, true)) break;
  }

  // 3–4. Round-robin over covers, missed cards first; fresh items everywhere before any repeat.
  const missed = covers.filter((c) => i.missedLast.includes(c));
  const fill = [...missed, ...covers.filter((c) => !missed.includes(c))];
  const pools = fill.map((c) => poolFor(pack, c, i.avoid, order));
  const firstCard = covers[0];
  for (const allowRepeats of [false, true]) {
    let progress = true;
    while (out.length < size && progress) {
      progress = false;
      for (const pool of pools) {
        if (out.length >= size) break;
        const wantCallback =
          pool.nodeId === firstCard || !pools.some((p) => p.fresh.some((x) => x.callback) && p.nodeId === firstCard);
        if (take(pool, allowRepeats, wantCallback)) progress = true;
      }
    }
  }

  // 5. Order: seeded shuffle, then repair.
  const shuffled = shuffle(out, deriveSeed(seed, "checkpoint", cpId));
  const left = [...shuffled];
  const result: typeof out = [];
  const countOf = (node: NodeId) => left.filter((e) => e.ref.nodeId === node).length;
  // First: the callback item; else the non-earlier entry whose card has the most entries (keeps the
  // no-repeat order possible), ties in shuffled order.
  let firstIdx = left.findIndex((e) => e.callback);
  if (firstIdx < 0) {
    for (let n = 0; n < left.length; n++) {
      const e = left[n] as (typeof out)[number];
      if (e.earlier && left.some((x) => !x.earlier)) continue;
      if (firstIdx < 0 || countOf(e.ref.nodeId) > countOf((left[firstIdx] as (typeof out)[number]).ref.nodeId))
        firstIdx = n;
    }
  }
  const first = left.splice(Math.max(0, firstIdx), 1)[0];
  if (first) result.push(first);
  while (left.length) {
    const prev = result[result.length - 1]?.ref.nodeId;
    const counts = new Map<NodeId, number>();
    for (const e of left) counts.set(e.ref.nodeId, (counts.get(e.ref.nodeId) ?? 0) + 1);
    let pick = -1;
    for (let n = 0; n < left.length; n++) {
      const node = left[n]?.ref.nodeId as NodeId;
      if (node === prev) continue;
      if (pick < 0 || (counts.get(node) ?? 0) > (counts.get(left[pick]?.ref.nodeId as NodeId) ?? 0)) pick = n;
    }
    result.push(left.splice(pick < 0 ? 0 : pick, 1)[0] as (typeof out)[number]);
  }
  return result.map(({ ref, vars }) => (vars ? { ref, vars } : { ref }));
}

export interface CheckpointResult {
  passed: boolean;
  right: number;
  /** max(1, size − 1): all but one. */
  needed: number;
  perfect: boolean;
  /** Questions not counted as right (wrong, or right after hint 2), with their vars. */
  missed: (ItemRef & { vars?: Record<string, number> })[];
  perCard: Record<NodeId, { asked: number; right: number; hinted: boolean }>;
}

/**
 * The outcome of one attempt. attempts = this run's rows (rows of other phases are ignored);
 * right = correct && hintLevel ≤ 1 && !assisted; passed = right ≥ max(1, size − 1);
 * perfect = right === size && every hintLevel === 0.
 */
export function checkpointResult(attempts: readonly AttemptRow[], size: number): CheckpointResult {
  const rows = attempts.filter((a) => a.phase === "checkpoint");
  const needed = Math.max(1, size - 1);
  const perCard: CheckpointResult["perCard"] = {};
  const missed: CheckpointResult["missed"] = [];
  let right = 0;
  let hinted = false;
  for (const a of rows) {
    const ok = checkpointCredit(a.correct, a.hintLevel, a.assisted) === 1;
    const c = perCard[a.nodeId] ?? { asked: 0, right: 0, hinted: false };
    c.asked++;
    if (ok) {
      c.right++;
      right++;
    } else
      missed.push({ packId: a.packId, nodeId: a.nodeId, itemId: a.interactionId, ...(a.vars ? { vars: a.vars } : {}) });
    if (a.hintLevel > 0) {
      c.hinted = true;
      hinted = true;
    }
    perCard[a.nodeId] = c;
  }
  return { passed: right >= needed, right, needed, perfect: right === size && !hinted, missed, perCard };
}

/** Minutes a revisit takes: the share of the card from the revisit beat on, at least 1. */
function revisitMinutes(node: PackNode | undefined, start: number, est: number): number {
  if (!node) return Math.max(1, Math.round(est / 2));
  const beats = node.screens.length;
  return Math.max(1, Math.round((est * (beats - start + 1)) / (beats + 2)));
}

/**
 * Distinct missed cards to reopen: covered cards first, then earlier ones, each in topo order, with
 * title, an honest estimate in minutes (from the revisit beat on) and the plain-text prompt of the
 * first missed question on that card (never its answer).
 */
export function revisitTargets(
  pack: CompiledPack,
  cpId: NodeId,
  missed: readonly (ItemRef & { vars?: Record<string, number> })[],
): RevisitTarget[] {
  const covers = new Set(pack.map.nodes[cpId]?.covers ?? checkpointCovers(pack.map, cpId));
  const rank = new Map(pack.map.topo.map((id, n) => [id, n] as const));
  const ids = [...new Set(missed.map((m) => m.nodeId))].filter((id) => pack.map.nodes[id]);
  ids.sort((a, b) => Number(!covers.has(a)) - Number(!covers.has(b)) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  return ids.map((nodeId) => {
    const node = pack.nodes[nodeId];
    const entry = pack.map.nodes[nodeId];
    const mine = missed.filter((m) => m.nodeId === nodeId);
    const first = mine[0];
    const item = first ? node?.items.find((x) => x.id === first.itemId) : undefined;
    const start = node
      ? revisitScreen(
          node,
          mine.map((m) => m.itemId),
        )
      : 0;
    const est = node?.estMinutes ?? entry?.estMinutes ?? 2;
    const t: RevisitTarget = {
      nodeId,
      title: node?.title ?? entry?.title ?? nodeId,
      estMinutes: revisitMinutes(node, start, est),
    };
    if (item) {
      const prompt = plainText(instantiateItem(item, first?.vars).prompt).replace(/\s+/g, " ").trim();
      if (prompt) t.prompt = prompt;
    }
    return t;
  });
}
