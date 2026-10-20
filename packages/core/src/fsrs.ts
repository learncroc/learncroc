/**
 * Spaced repetition over ts-fsrs: node cards (one per lit card), pack flashcards and user flashcards. FSRS is a scheduler, not a proven intervention.
 *
 * - request_retention from settings (default 0.90), maximum_interval 365, fuzz on. Short-term
 *   learning steps are off: a card lit at a checkpoint goes straight to review with a stability of a
 *   few days, so it starts fading within days.
 * - A card is lit while retrievability ≥ 0.85, fading below. Done cards get no node card until a
 *   checkpoint lights them.
 * - Credit flows down (experimental, off by default): depth ≤ 3, weight 0.3·0.5^(d−1).
 */
import {
  type Card,
  createEmptyCard,
  type FSRS,
  type Grade as FsrsGrade,
  fsrs,
  generatorParameters,
  type State,
} from "ts-fsrs";
import { ancestorDepths, type Dag } from "./dag";
import type { CardState, Grade, Millis, NodeId, PackId, ReviewLogRow } from "./schema/index";

export const LIT_THRESHOLD = 0.85;
export const DEFAULT_RETENTION = 0.9;
export const MAXIMUM_INTERVAL = 365;
export const DAY_MS = 86_400_000;
export const CREDIT_MAX_DEPTH = 3;

export interface FsrsOptions {
  /** request_retention, 0.85..0.95 (settings.learning.targetRetention). */
  retention?: number;
  /** Interval fuzz (default on; tests may turn it off). */
  fuzz?: boolean;
}

const schedulers = new Map<string, FSRS>();
function scheduler(opts: FsrsOptions = {}): FSRS {
  const retention = Math.min(0.95, Math.max(0.85, opts.retention ?? DEFAULT_RETENTION));
  const fuzz = opts.fuzz ?? true;
  const key = `${retention}:${fuzz}`;
  let f = schedulers.get(key);
  if (!f) {
    f = fsrs(
      generatorParameters({
        request_retention: retention,
        maximum_interval: MAXIMUM_INTERVAL,
        enable_fuzz: fuzz,
        enable_short_term: false,
      }),
    );
    schedulers.set(key, f);
  }
  return f;
}

export const nodeCardId = (packId: PackId, nodeId: NodeId) => `node:${packId}:${nodeId}`;
export const flashcardId = (packId: PackId, nodeId: NodeId, cardId: string) => `card:${packId}:${nodeId}:${cardId}`;
export const userCardId = (uuid: string) => `user:${uuid}`;

function toFsrs(c: CardState): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsedDays,
    scheduled_days: c.scheduledDays,
    reps: c.reps,
    lapses: c.lapses,
    learning_steps: 0,
    state: c.state as State,
    ...(c.lastReview !== undefined ? { last_review: new Date(c.lastReview) } : {}),
  };
}

function fromFsrs(card: Card, base: CardState): CardState {
  const out: CardState = {
    ...base,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as CardState["state"],
  };
  if (card.last_review) out.lastReview = card.last_review.getTime();
  return out;
}

/** A never-reviewed card, due now. */
export function newCard(a: {
  id: string;
  packId: PackId;
  nodeId: NodeId | null;
  kind: CardState["kind"];
  now: Millis;
  front?: string;
  back?: string;
}): CardState {
  const empty = createEmptyCard(new Date(a.now));
  return fromFsrs(empty, {
    id: a.id,
    packId: a.packId,
    nodeId: a.nodeId,
    kind: a.kind,
    ...(a.front !== undefined ? { front: a.front } : {}),
    ...(a.back !== undefined ? { back: a.back } : {}),
    due: a.now,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    suspended: false,
  });
}

/** Review a card. Returns the new state and the log row (without its `source`). */
export function reviewCard(
  card: CardState,
  grade: Grade,
  now: Millis,
  opts: FsrsOptions = {},
): { card: CardState; log: Omit<ReviewLogRow, "source"> } {
  const r = scheduler(opts).next(toFsrs(card), new Date(now), grade as FsrsGrade);
  const next = fromFsrs(r.card, card);
  return {
    card: next,
    log: {
      cardId: card.id,
      grade,
      at: now,
      elapsedDays: r.log.elapsed_days,
      scheduledDays: next.scheduledDays,
      stability: next.stability,
      difficulty: next.difficulty,
    },
  };
}

/** Probability of recall now (0 for a never-reviewed card). */
export function retrievability(card: CardState, now: Millis, opts: FsrsOptions = {}): number {
  if (card.state === 0 || card.stability <= 0 || card.lastReview === undefined) return 0;
  const r = scheduler(opts).get_retrievability(toFsrs(card), new Date(Math.max(now, card.lastReview)), false);
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
}

/** The first moment retrievability drops below `threshold` (binary search over the forgetting curve). */
export function fadeAt(card: CardState, threshold = LIT_THRESHOLD, opts: FsrsOptions = {}): Millis | undefined {
  if (card.lastReview === undefined || card.stability <= 0) return undefined;
  const start = card.lastReview;
  if (retrievability(card, start, opts) < threshold) return start;
  let lo = start;
  let hi = start + DAY_MS;
  for (let i = 0; i < 40 && retrievability(card, hi, opts) >= threshold; i++) hi = start + (hi - start) * 2;
  for (let i = 0; i < 48 && hi - lo > 60_000; i++) {
    const mid = lo + (hi - lo) / 2;
    if (retrievability(card, mid, opts) >= threshold) lo = mid;
    else hi = mid;
  }
  return Math.round(hi);
}

/** The node card of a card lit at a checkpoint pass, with its per-card grade (Hard, Good or Easy). */
export function lightNodeCard(
  packId: PackId,
  nodeId: NodeId,
  now: Millis,
  grade: 2 | 3 | 4,
  opts: FsrsOptions = {},
): { card: CardState; log: Omit<ReviewLogRow, "source"> } {
  const fresh = newCard({ id: nodeCardId(packId, nodeId), packId, nodeId, kind: "node", now });
  return reviewCard(fresh, grade, now, opts);
}

/**
 * Experimental: move a card's stability a fraction `w` of the way toward what a Good review
 * now would give, and reschedule from its last review.
 */
export function partialReview(card: CardState, w: number, now: Millis, opts: FsrsOptions = {}): CardState {
  if (card.state === 0 || card.lastReview === undefined) return card;
  const good = reviewCard(card, 3, now, { ...opts, fuzz: false }).card;
  const stability = card.stability + w * (good.stability - card.stability);
  if (!(stability > card.stability)) return card;
  const f = scheduler({ ...opts, fuzz: false });
  const scheduledDays = f.next_interval(stability, 0);
  return { ...card, stability, scheduledDays, due: card.lastReview + scheduledDays * DAY_MS };
}

/**
 * Credit flows down: after a node review graded ≥ Good, refresh its ancestors' node cards
 * (depth ≤ 3, weight 0.3·0.5^(d−1)). Returns only the cards that changed, with their depth.
 */
export function creditFlowsDown(
  dag: Dag,
  nodeId: NodeId,
  grade: Grade,
  cards: ReadonlyMap<NodeId, CardState>,
  now: Millis,
  opts: FsrsOptions = {},
): { card: CardState; depth: number; weight: number }[] {
  if (grade < 3) return [];
  const out: { card: CardState; depth: number; weight: number }[] = [];
  for (const [id, depth] of ancestorDepths(dag, nodeId)) {
    if (depth > CREDIT_MAX_DEPTH) continue;
    const card = cards.get(id);
    if (!card || card.suspended) continue;
    const weight = 0.3 * 0.5 ** (depth - 1);
    const next = partialReview(card, weight, now, opts);
    if (next !== card) out.push({ card: next, depth, weight });
  }
  return out;
}

/** Due for review now (node cards: also fading ones). */
export function isDue(card: CardState, now: Millis, opts: FsrsOptions = {}): boolean {
  if (card.suspended) return false;
  if (card.kind === "node") return card.due <= now || retrievability(card, now, opts) < LIT_THRESHOLD;
  return card.due <= now;
}
