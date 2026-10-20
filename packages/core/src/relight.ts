/**
 * Relight: fading or due node cards across all packs, mixed.
 *
 * - About 8 items (settings.learning.dailyRelight), at most 3 per node, most faded nodes first.
 * - Round-robin: no two consecutive items from the same node (whenever more than one node is due).
 * - Never an item from that node's most recent check when an unseen or parametric item exists;
 *   parametric items always get fresh numbers; a different format from last time where possible.
 * - Grade per node: all right → Good, one miss → Hard, majority wrong → Again.
 */
import { itemsFor } from "./adaptive";
import { DAY_MS, type FsrsOptions, isDue, LIT_THRESHOLD, retrievability } from "./fsrs";
import { deriveSeed, drawVars, shuffle } from "./params";
import type { CardState, Grade, Item, ItemId, ItemRef, Millis, NodeId, PackId, PackNode } from "./schema/index";

export const DEFAULT_RELIGHT_LIMIT = 8;
export const MAX_ITEMS_PER_NODE = 3;

/** Node cards to relight: fading now or due within `horizonMs` (default 24 h), most faded first. */
export function relightDue(
  cards: readonly CardState[],
  now: Millis,
  opts: FsrsOptions = {},
  horizonMs = DAY_MS,
): { card: CardState; retrievability: number }[] {
  return cards
    .filter((c) => c.kind === "node" && c.nodeId !== null && !c.suspended && c.state !== 0)
    .map((card) => ({ card, retrievability: retrievability(card, now, opts) }))
    .filter(({ card, retrievability: r }) => r < LIT_THRESHOLD || card.due <= now + horizonMs || isDue(card, now, opts))
    .sort(
      (a, b) => a.retrievability - b.retrievability || a.card.due - b.card.due || a.card.id.localeCompare(b.card.id),
    );
}

export interface RelightCandidate {
  packId: PackId;
  nodeId: NodeId;
  node: Pick<PackNode, "items">;
  /** Lower = more faded (asked first). */
  retrievability: number;
  /** Item ids asked in this node's most recent check (or relight). */
  lastCheck?: readonly ItemId[];
  /** Interaction kinds asked last time on this node. */
  lastKinds?: readonly Item["kind"][];
  /** Instances used last time, per parametric item id. */
  lastVars?: Readonly<Record<ItemId, Record<string, number>>>;
}

export interface RelightEntry {
  ref: ItemRef;
  vars?: Record<string, number>;
}

/** Choose a node's items in preference order (fresh first, new formats first, seeded variety). */
function rankItems(c: RelightCandidate, seed: number, allowExplain: boolean): { fresh: Item[]; repeats: Item[] } {
  const pool = itemsFor(c.node, "relight").filter((i) => allowExplain || i.kind !== "explain");
  const last = new Set(c.lastCheck ?? []);
  const lastKinds = new Set(c.lastKinds ?? []);
  const shuffled = shuffle(pool, deriveSeed(seed, "relight", c.packId, c.nodeId));
  const byFormat = (xs: Item[]) => [
    ...xs.filter((i) => !lastKinds.has(i.kind)),
    ...xs.filter((i) => lastKinds.has(i.kind)),
  ];
  // Parametric items are "fresh" even when asked last time: they come back with new numbers.
  const fresh = byFormat(shuffled.filter((i) => !last.has(i.id) || i.params !== undefined));
  const repeats = byFormat(shuffled.filter((i) => last.has(i.id) && i.params === undefined));
  return { fresh, repeats };
}

/**
 * Build the relight queue. Deterministic for a given seed. Candidates should already be ordered
 * by priority (relightDue does this); the `limit` most faded nodes are included.
 */
export function buildRelightQueue(
  candidates: readonly RelightCandidate[],
  opts: {
    limit?: number;
    seed: number;
    /**
     * Explain items (AI-graded) per session: 0 without AI (they can't be graded offline), at most 1
     * with it. Default 0. Only the most faded node that has one keeps it.
     */
    explain?: 0 | 1;
  },
): RelightEntry[] {
  const limit = Math.max(1, opts.limit ?? DEFAULT_RELIGHT_LIMIT);
  let explainLeft = opts.explain ?? 0;
  const ranked = [...candidates]
    .sort((a, b) => a.retrievability - b.retrievability)
    .map((c) => {
      const r = rankItems(c, opts.seed, explainLeft > 0);
      // One explain item for the whole session: the first node that has one keeps only its first.
      let kept = false;
      const keep = (xs: Item[]) => {
        return xs.filter((i) => {
          if (i.kind !== "explain") return true;
          if (kept || explainLeft <= 0) return false;
          kept = true;
          return true;
        });
      };
      const fresh = keep(r.fresh);
      const repeats = keep(r.repeats);
      if ([...fresh, ...repeats].some((i) => i.kind === "explain")) explainLeft--;
      return { c, fresh, repeats };
    })
    .filter((x) => x.fresh.length + x.repeats.length > 0)
    .slice(0, limit);
  if (!ranked.length) return [];

  // Quotas: spread the limit over the nodes (≤ 3 each), using repeats only when nothing fresh exists.
  const quota: number[] = ranked.map((x) => (x.fresh.length ? 0 : 1));
  const cap = ranked.map((x) => (x.fresh.length ? Math.min(MAX_ITEMS_PER_NODE, x.fresh.length) : 1));
  let total = quota.reduce((s, q) => s + q, 0);
  for (let round = 0; total < limit && round < MAX_ITEMS_PER_NODE; round++) {
    for (let i = 0; i < ranked.length && total < limit; i++) {
      if ((quota[i] as number) < (cap[i] as number) && (quota[i] as number) === round) {
        quota[i] = (quota[i] as number) + 1;
        total++;
      }
    }
  }
  // Keep the round-robin feasible: no node may hold more than half the queue (rounded up).
  if (ranked.length > 1) {
    for (;;) {
      const sum = quota.reduce((s, q) => s + q, 0);
      const maxQ = Math.max(...quota);
      if (maxQ <= Math.ceil(sum / 2) || maxQ <= 1) break;
      const i = quota.indexOf(maxQ);
      quota[i] = maxQ - 1;
    }
  }

  const queues = ranked.map((x, i) =>
    (x.fresh.length ? x.fresh : x.repeats).slice(0, quota[i]).map((item) => ({ x, item })),
  );
  // Greedy interleave: the node with the most items left that isn't the previous one.
  const out: RelightEntry[] = [];
  let prev = -1;
  for (;;) {
    let pick = -1;
    for (let i = 0; i < queues.length; i++) {
      const len = queues[i]?.length ?? 0;
      if (!len || i === prev) continue;
      if (pick < 0 || len > (queues[pick]?.length ?? 0)) pick = i;
    }
    if (pick < 0) pick = queues.findIndex((q) => q.length > 0);
    if (pick < 0) break;
    const next = queues[pick]?.shift();
    if (!next) break;
    const { x, item } = next;
    const entry: RelightEntry = { ref: { packId: x.c.packId, nodeId: x.c.nodeId, itemId: item.id } };
    if (item.params) {
      const avoid = x.c.lastVars?.[item.id];
      entry.vars = drawVars(item.params, deriveSeed(opts.seed, x.c.packId, x.c.nodeId), item.id, avoid ? [avoid] : []);
    }
    out.push(entry);
    prev = pick;
  }
  return out;
}

/** Per-node grade from that node's results: all right → Good, one miss → Hard, majority wrong → Again. */
export function relightGrade(results: readonly boolean[]): Grade {
  const misses = results.filter((r) => !r).length;
  if (results.length === 0 || misses === 0) return 3;
  if (misses * 2 > results.length) return 1;
  return 2;
}
