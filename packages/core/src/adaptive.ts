/**
 * Adaptive item selection: Elo with P = σ(θ − d). Checkpoint plans pick, per card, the unseen item whose
 * P(correct) is closest to 0.80 (the 70–90% band). After a graded attempt θ += 0.4(y − P) and the local
 * item rating d −= 0.05(y − P). Hooks and teach beats are never part of tuning.
 */
import type { Item, ItemId, PackNode } from "./schema/index";

export const TARGET_P = 0.8;
export const K_THETA = 0.4;
export const K_ITEM = 0.05;

export type ItemUse = "checkpoint" | "relight";

/** Authored difficulty 1…5 → rating −1.0…+1.0. */
export function seedRating(difficulty: Item["difficulty"]): number {
  return (difficulty - 3) / 2;
}

/** P(correct) for ability θ and item rating d. */
export function pCorrect(theta: number, d: number): number {
  return 1 / (1 + Math.exp(-(theta - d)));
}

/** Elo update after an attempt scored y ∈ [0, 1]. */
export function updateElo(theta: number, d: number, y: number): { theta: number; d: number; p: number } {
  const p = pCorrect(theta, d);
  return { theta: theta + K_THETA * (y - p), d: d - K_ITEM * (y - p), p };
}

/** Items usable for a purpose (`use` defaults to both). Checkpoints further drop recall and explain items. */
export function itemsFor(node: Pick<PackNode, "items">, use: ItemUse): Item[] {
  return node.items.filter((i) => (i.use ?? ["checkpoint", "relight"]).includes(use));
}

/** The item's current rating: the learned local rating when present, else the authored seed. */
export function ratingOf(item: Item, ratings: Readonly<Record<ItemId, number>>): number {
  return Object.hasOwn(ratings, item.id) ? (ratings[item.id] as number) : seedRating(item.difficulty);
}

/**
 * Pick the next item: among `candidates` not in `seen`, the one with P(correct) closest to the
 * target. Ties keep bank order (deterministic). Returns undefined when nothing is left.
 */
export function pickNextItem(a: {
  candidates: readonly Item[];
  theta: number;
  ratings?: Readonly<Record<ItemId, number>>;
  seen?: ReadonlySet<ItemId>;
  target?: number;
}): Item | undefined {
  const target = a.target ?? TARGET_P;
  let best: Item | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const item of a.candidates) {
    if (a.seen?.has(item.id)) continue;
    const gap = Math.abs(pCorrect(a.theta, ratingOf(item, a.ratings ?? {})) - target);
    if (gap < bestGap - 1e-12) {
      best = item;
      bestGap = gap;
    }
  }
  return best;
}
