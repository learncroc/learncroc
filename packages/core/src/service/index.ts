/**
 * App services over the injected seams (D34): Repo (storage), AiPorts (AI), WidgetSpecRegistry,
 * PackSource and Clock. The server wraps them in HTTP routes (one method per route, same names
 * as the route map); the static demo wraps them over IndexedDB; "Try the first card" runs them
 * over a MemoryRepo and a one-pack source.
 */
import type { PackSource } from "../repo";
import type { CompiledPack, InstalledPackSummary, PackId, TryBundle } from "../schema/index";
import { LEARNCROC_VERSION } from "../version";
import { type Ctx, makeCtx, type ServiceDeps } from "./context";
import * as learner from "./learner";
import { MemoryRepo } from "./memory-repo";
import * as runs from "./runs";

export {
  type CheckpointRecord,
  type CreateNumbers,
  checkpointKey,
  createNumbersKey,
  crocAsksKey,
  planKey,
  type ServiceDeps,
  ServiceError,
  statusOf,
} from "./context";
export type { CardWithText, RelightResponse } from "./learner";
export { CALLBACK_MAX_MS, CALLBACK_MIN_MS, relightCalendar } from "./learner";
export { MemoryRepo } from "./memory-repo";
export { LATER_DAY_MS, MAX_SCRATCH_BYTES, passGrade } from "./runs";

type Tail<F> = F extends (ctx: Ctx, ...args: infer A) => infer R ? (...args: A) => R : never;

function bind<T extends Record<string, (ctx: Ctx, ...args: never[]) => unknown>>(
  ctx: Ctx,
  fns: T,
): { [K in keyof T]: Tail<T[K]> } {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(fns)) {
    out[k] = (...args: unknown[]) => {
      // A fresh pack cache per call: packs may be updated between calls.
      ctx.packCache.clear();
      return (f as (c: Ctx, ...a: unknown[]) => unknown)(ctx, ...args);
    };
  }
  return out as { [K in keyof T]: Tail<T[K]> };
}

/** Create the app services. Every method maps to one HTTP route. */
export function createServices(deps: ServiceDeps) {
  const ctx = makeCtx(deps);
  return bind(ctx, {
    // runs
    startRun: runs.startRun, // POST /runs
    getRun: runs.getRun, // GET /runs/:runId
    patchScratch: runs.patchScratch, // PATCH /runs/:runId
    attempt: runs.attempt, // POST /runs/:runId/attempts
    advance: runs.advance, // POST /runs/:runId/advance
    hint: runs.hint, // POST /runs/:runId/hint
    crocHint: runs.crocHint, // called by POST /ai/ask before a hint-mode reply in a checkpoint or relight
    finish: runs.finish, // POST /runs/:runId/finish
    abandon: runs.abandon, // POST /runs/:runId/abandon
    // relight
    relight: learner.relight, // POST /relight
    // progress
    packProgress: learner.packProgress, // GET /progress/:packId
    progressSummary: learner.progressSummary, // GET /progress
    markOpened: learner.markOpened, // POST /packs/:id/opened
    logbook: learner.logbook, // GET /logbook
    fieldNotes: learner.fieldNotes, // GET /notes
    numbers: learner.numbers, // GET /numbers
    noteCrocAsk: learner.noteCrocAsk, // called by POST /ai/ask (chip or typed), for the local numbers
    // flashcards
    listCards: learner.listCards, // GET /cards
    dueCards: learner.dueCards, // GET /cards/due
    createCard: learner.createCard, // POST /cards
    patchCard: learner.patchCard, // PATCH /cards/:id
    deleteCard: learner.deleteCard, // DELETE /cards/:id
    reviewCard: learner.reviewFlashcard, // POST /cards/:id/review
    exportCards: learner.exportCards, // GET /cards/export
    previewGrade: learner.previewGrade,
    planItems: learner.planItems, // items served by a checkpoint or relight run
  });
}

export type LearnServices = ReturnType<typeof createServices>;

/** A PackSource serving fixed compiled packs (try-runs, tests, the static demo's built-in packs). */
export function staticPackSource(
  packs: readonly CompiledPack[],
  tier: InstalledPackSummary["tier"] = "official",
): PackSource {
  const byId = new Map(packs.map((p) => [p.manifest.id, p]));
  return {
    async list() {
      return packs.map((p) => ({
        id: p.manifest.id,
        version: p.manifest.version,
        title: p.manifest.title,
        ...(p.manifest.subtitle ? { subtitle: p.manifest.subtitle } : {}),
        category: p.manifest.category,
        theme: p.manifest.theme,
        tier,
        kind: p.manifest.private ? "pocket" : "pack",
        profile: p.manifest.profile,
        review: p.manifest.status,
        customInteractives: JSON.stringify(p.nodes).includes('"kind":"html"'),
        nodes: p.stats.nodes,
        playable: p.stats.playable,
        checkpoints: p.stats.checkpoints,
        done: 0,
        lit: 0,
        fading: 0,
        finished: false,
        status: p.provisional ? "building" : "ok",
      }));
    },
    async get(id: PackId, version?: string) {
      const p = byId.get(id);
      if (!p || (version && version !== p.manifest.version))
        throw new Error(`pack ${id}${version ? `@${version}` : ""} not found`);
      return p;
    },
  };
}

/** A playable compiled pack from a registry TryBundle (only the suggested start is playable). */
export function tryBundleToPack(bundle: TryBundle, at = "1970-01-01T00:00:00Z"): CompiledPack {
  const node = bundle.node;
  return {
    format: 2,
    manifest: bundle.manifest,
    map: bundle.map,
    nodes: { [node.id]: node },
    stats: {
      nodes: Object.keys(bundle.map.nodes).length,
      playable: 1,
      planned: Object.values(bundle.map.nodes).filter((n) => n.status === "planned").length,
      checkpoints: Object.values(bundle.map.nodes).filter((n) => n.kind === "checkpoint").length,
      screens: node.screens.length,
      items: node.items.length,
      flashcards: node.flashcards?.length ?? 0,
      words: 0,
    },
    compiledWith: { learncroc: LEARNCROC_VERSION, at },
    contentHash: "",
  };
}

/**
 * Services for "Try the first card": a throwaway MemoryRepo and the bundle's pack. Nothing touches
 * the learner's real progress; start with `startRun({ kind: "try", registry, packId })`.
 */
export function createTryServices(bundle: TryBundle, deps: Omit<ServiceDeps, "repo" | "packs">) {
  const pack = tryBundleToPack(bundle);
  return createServices({ ...deps, repo: new MemoryRepo(), packs: staticPackSource([pack], "community") });
}
