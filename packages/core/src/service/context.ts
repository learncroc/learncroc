/**
 * What every service function receives, plus shared lookups (packs, items, node cards, views).
 */

import { checkpointIds } from "../checkpoint";
import { type FsrsOptions, nodeCardId } from "../fsrs";
import { type AiPorts, offlineAiPorts, type WidgetSpecRegistry } from "../ports";
import type { Clock, PackSource, Repo } from "../repo";
import { runNode } from "../run";
import {
  type ApiErrorCode,
  type CardState,
  type CompiledPack,
  DEFAULT_SETTINGS,
  type Item,
  type ItemRef,
  type Millis,
  NODE_ID_RE,
  type NodeId,
  PACK_ID_RE,
  type PackId,
  type PackNode,
  type RunState,
  type Settings,
} from "../schema/index";
import { type CheckpointRecord, nodeViews } from "../state";

export type { CheckpointRecord } from "../state";

/** A service failure with the API error code the HTTP layer maps to a status. */
export class ServiceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** HTTP status for an API error code. */
export function statusOf(code: ApiErrorCode): number {
  switch (code) {
    case "invalid":
      return 400;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
    case "ai_not_configured":
    case "engine_mismatch":
      return 409;
    case "rate_limited":
    case "cap_reached":
      return 429;
    case "provider_error":
    case "refusal":
      return 502;
    case "not_implemented":
      return 501;
    case "install_failed":
      return 500;
  }
}

export interface ServiceDeps {
  repo: Repo;
  packs: PackSource;
  clock: Clock;
  widgets: WidgetSpecRegistry;
  /** Default: offlineAiPorts (every AI path falls back to authored content). */
  ai?: AiPorts;
  /** Current settings (retention, relight size, experiments). Default: DEFAULT_SETTINGS. */
  settings?: () => Settings | Promise<Settings>;
  /** Run, card and note ids. Default: crypto.randomUUID(). */
  newId?: () => string;
  /** Interval fuzz for FSRS (default on; tests turn it off for exact dates). */
  fuzz?: boolean;
}

export interface Ctx {
  repo: Repo;
  packs: PackSource;
  clock: Clock;
  widgets: WidgetSpecRegistry;
  ai: AiPorts;
  settings: () => Promise<Settings>;
  newId: () => string;
  fuzz: boolean;
  /** Packs fetched during one call (pinned versions included). */
  packCache: Map<string, CompiledPack>;
}

export function makeCtx(d: ServiceDeps): Ctx {
  const settings = d.settings;
  return {
    repo: d.repo,
    packs: d.packs,
    clock: d.clock,
    widgets: d.widgets,
    ai: d.ai ?? offlineAiPorts,
    settings: async () => (settings ? await settings() : DEFAULT_SETTINGS),
    newId: d.newId ?? (() => crypto.randomUUID()),
    fuzz: d.fuzz ?? true,
    packCache: new Map(),
  };
}

export function checkPackId(id: string): PackId {
  if (!PACK_ID_RE.test(id)) throw new ServiceError("invalid", `bad pack id "${id}"`);
  return id;
}

export function checkNodeId(id: string): NodeId {
  if (!NODE_ID_RE.test(id)) throw new ServiceError("invalid", `bad node id "${id}"`);
  return id;
}

/** Load a pack (pinned version when given). */
export async function getPack(ctx: Ctx, id: PackId, version?: string): Promise<CompiledPack> {
  checkPackId(id);
  const key = `${id}@${version ?? "*"}`;
  const hit = ctx.packCache.get(key);
  if (hit) return hit;
  let pack: CompiledPack;
  try {
    pack = await ctx.packs.get(id, version && version !== "*" ? version : undefined);
  } catch (e) {
    throw new ServiceError(
      "not_found",
      `pack "${id}"${version ? `@${version}` : ""} isn't installed (${(e as Error).message})`,
    );
  }
  ctx.packCache.set(key, pack);
  return pack;
}

/** The pack a run plays (null for cross-pack relight). */
export async function runPack(ctx: Ctx, run: RunState): Promise<CompiledPack | null> {
  if (run.packId === "*") return null;
  return getPack(ctx, run.packId, run.packVersion === "*" ? undefined : run.packVersion);
}

export async function fsrsOpts(ctx: Ctx): Promise<FsrsOptions> {
  const s = await ctx.settings();
  return { retention: s.learning.targetRetention, fuzz: ctx.fuzz };
}

export function nodeOf(pack: CompiledPack, nodeId: NodeId): PackNode {
  const node = pack.nodes[nodeId];
  if (!node) throw new ServiceError("not_found", `no playable card "${nodeId}" in ${pack.manifest.id}`);
  return node;
}

/*
 * kv keys:
 * - `plan:<runId>`              Plan: the fixed questions of a checkpoint or relight run.
 * - `checkpoint:<pack>:<cp>`    CheckpointRecord: tries, asked items, vars, missed and revisit cards (deleted on pass).
 * - `opened:<pack>`             Millis: last time the map was opened.
 * - `numbers:create:<jobId>`    { provider, model, msToFirstCard, at }: written by the AI create route at the
 *                               first `card-ready` (M5 in LocalNumbers).
 * - `numbers:croc`              { chips, freeText }: questions to Moss, counted by the ask route (noteCrocAsk).
 * Croc hints are not stored in kv: they raise RunState.hints[itemId], the counter the hint button uses.
 */
export const planKey = (runId: string) => `plan:${runId}`;
export const checkpointKey = (packId: PackId, cpId: NodeId) => `checkpoint:${packId}:${cpId}`;
export const openedKey = (packId: PackId) => `opened:${packId}`;
export const createNumbersKey = (jobId: string) => `numbers:create:${jobId}`;
export const crocAsksKey = "numbers:croc";

/** kv `numbers:create:<jobId>`. */
export interface CreateNumbers {
  provider: string;
  model: string;
  msToFirstCard: number;
  at: Millis;
}

export interface Plan {
  entries: { ref: ItemRef; vars?: Record<string, number> }[];
}

/** Find a bank item. */
export async function findItem(_ctx: Ctx, _run: RunState, pack: CompiledPack, ref: ItemRef): Promise<Item> {
  const item = pack.nodes[ref.nodeId]?.items.find((i) => i.id === ref.itemId);
  if (item) return item;
  throw new ServiceError("not_found", `no item ${ref.nodeId}/${ref.itemId} in ${pack.manifest.id}`);
}

/** Node cards of a pack keyed by node id. */
export async function nodeCardsOf(ctx: Ctx, packId: PackId): Promise<Record<NodeId, CardState>> {
  const out: Record<NodeId, CardState> = {};
  for (const c of await ctx.repo.cards({ packId, kind: "node" })) if (c.nodeId !== null) out[c.nodeId] = c;
  return out;
}

/** Current map views for a pack. */
export async function viewsOf(ctx: Ctx, pack: CompiledPack, now: Millis) {
  const packId = pack.manifest.id;
  const [progress, nodeCards, open, opts] = await Promise.all([
    ctx.repo.progress(packId),
    nodeCardsOf(ctx, packId),
    ctx.repo.openRuns({ packId }),
    fsrsOpts(ctx),
  ]);
  const checkpoints: Record<NodeId, CheckpointRecord> = {};
  for (const id of checkpointIds(pack.map)) {
    const rec = await ctx.repo.kv<CheckpointRecord>(checkpointKey(packId, id));
    if (rec) checkpoints[id] = rec;
  }
  // Engaged open runs only: a card run with a guess, a checkpoint run past its first question.
  const openTargets = open
    .filter(
      (r) => r.target && ((r.kind === "card" && r.guess) || (r.kind === "checkpoint" && (r.cursor.item ?? 0) >= 1)),
    )
    .map((r) => r.target as NodeId);
  const views = nodeViews({
    pack,
    progress,
    nodeCards,
    now,
    openTargets,
    checkpoints,
    ...(opts.retention !== undefined ? { retention: opts.retention } : {}),
  });
  return { views, progress, nodeCards };
}

/** The node a run plays, or a 404. */
export function runNodeOrThrow(run: RunState, pack: CompiledPack): PackNode {
  const node = runNode(run, pack);
  if (!node) throw new ServiceError("not_found", `run ${run.id} has no playable card`);
  return node;
}

export { nodeCardId };
