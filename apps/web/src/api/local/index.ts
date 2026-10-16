/**
 * In-browser API adapter for the static demo (PLAN D24, D34): core's app services over an
 * IndexedDB Repo and the compiled packs bundled with the site, answering the same RouteKeys as the
 * server, so the whole card loop (card → checkpoint → gate) plays with no server.
 *
 * - Runs, progress, flashcards, relight, numbers and settings go through `createServices`, exactly
 *   like the server routes. The first card close sets `settings.firstRun` (the `/` redirect reads it).
 * - Export is version 2 (with the local numbers); import takes versions 1 and 2 (version 1 rows go
 *   through core's `migrateExportFile`). Data stored by an older demo is migrated once (`migrateLearnerRows`).
 * - `POST /ai/ask` answers Moss offline: the mode follows the run (a hint for an open checkpoint or
 *   relight question, recorded through `crocHint`; a nudge before the hook guess; otherwise full), and
 *   the reply is core's `offlineCrocReply`, returned as AskEvents (sent, delta, done) that the client
 *   yields like a stream.
 * - Installs, frames, the registry, article maps and AI keys are not part of the demo.
 */
import {
  type AiFallback,
  type ApiErrorCode,
  type AskEvent,
  AskRequest,
  type CompiledPack,
  CompiledPack as CompiledPackSchema,
  CROC_MAX_WORDS,
  type CrocContext,
  createServices,
  DEFAULT_SETTINGS,
  ExportFile,
  ExportTables,
  type InstalledPackSummary,
  LEARNCROC_VERSION,
  LEGACY_KV_PREFIXES,
  type LearnServices,
  type LocalNumbers,
  migrateExportFile,
  migrateLearnerRows,
  NODE_ID_RE,
  offlineCrocReply,
  PACK_ID_RE,
  type PackSource,
  type Repo,
  type RouteKey,
  type RouteRes,
  type RunState,
  type RunSummary,
  relightCalendar,
  type SearchHit,
  type Settings,
  type SettingsPatch,
  SettingsPatch as SettingsPatchSchema,
  Settings as SettingsSchema,
  StartRunBody,
  staticPackSource,
  words,
} from "@learncroc/core";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import { z } from "zod";
import { ApiClientError } from "../errors";

export interface LocalApi {
  /** Answer one route in the browser. SSE routes resolve to the list of events. */
  handle<K extends RouteKey>(
    key: K,
    args: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown },
  ): Promise<RouteRes<K>>;
  /** URL of a bundled pack asset. */
  assetUrl(packId: string, path: string): string;
}

export interface LocalApiDeps {
  repo: Repo & { resetPack?(packId: string): Promise<void> };
  packs: CompiledPack[];
  /** Base URL of the bundled pack folder ("static-packs/"). */
  packsBase?: string;
  now?: () => number;
  /** Run, card and thread ids (tests pin them). */
  newId?: () => string;
}

const SETTINGS_KEY = "settings";
/** kv key holding the learner-data revision of this browser's store (3 = the card loop). */
export const LEARNER_REV_KEY = "learner-rev";
export const LEARNER_REV = 3;

/** Free text with no FAQ match, no AI (§3.3, the demo wording: there is no key to add here). */
export const OFFLINE_FREE_TEXT =
  "Without AI I can only use what's written for this card. Try a button above, or ask about the map.";

const fail = (status: number, error: ApiErrorCode, message: string, fallback?: AiFallback): never => {
  throw new ApiClientError(status, fallback ? { error, message, fallback } : { error, message });
};

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (Array.isArray(base) || typeof base !== "object" || base === null) return patch as T;
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out as T;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Search packs and cards (the demo has no user flashcards in the palette). */
function search(packs: CompiledPack[], q: string): SearchHit[] {
  const query = fold(q.trim());
  if (!query) return [];
  const hits: SearchHit[] = [];
  for (const p of packs) {
    const m = p.manifest;
    if (fold(m.title).includes(query))
      hits.push({
        type: "pack",
        title: m.title,
        ...(m.subtitle ? { subtitle: m.subtitle } : {}),
        href: `/p/${m.id}`,
        packId: m.id,
      });
    for (const id of p.map.topo) {
      const n = p.map.nodes[id];
      if (!n || n.status === "planned" || !fold(n.title).includes(query)) continue;
      hits.push({
        type: "node",
        title: n.title,
        subtitle: m.title,
        href: n.kind === "checkpoint" ? `/p/${m.id}?checkpoint=${id}` : `/p/${m.id}?card=${id}`,
        packId: m.id,
        nodeId: id,
      });
    }
  }
  return hits.slice(0, 30);
}

const ImportEnvelope = z.object({
  format: z.literal("learncroc-export"),
  version: z.union([z.literal(1), z.literal(2)]),
  tables: z.record(z.string(), z.array(z.unknown())),
  settings: z.unknown(),
});

const EXPORT_TABLE_NAMES = Object.keys(ExportTables.shape);

/** Split a reply into a few deltas so the croc's bubble fills in like a stream. */
function chunks(text: string): string[] {
  const parts = text.match(/\S+\s*/g) ?? [text];
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 6) out.push(parts.slice(i, i + 6).join(""));
  return out;
}

export function createLocalApi(deps: LocalApiDeps): LocalApi {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const clock = { now };
  const source: PackSource = staticPackSource(deps.packs, "official");
  const settings = async (): Promise<Settings> => {
    const stored = await deps.repo.kv<unknown>(SETTINGS_KEY);
    const parsed = SettingsSchema.safeParse(deepMerge(DEFAULT_SETTINGS, stored));
    return parsed.success
      ? { ...parsed.data, ai: { ...parsed.data.ai, provider: "none", keySource: "none" } }
      : DEFAULT_SETTINGS;
  };
  const saveSettings = async (s: Settings) => {
    const { keySource: _k, keyMasked: _m, ...ai } = s.ai;
    await deps.repo.setKv(SETTINGS_KEY, { ...s, ai });
  };
  const learn: LearnServices = createServices({
    repo: deps.repo,
    packs: source,
    clock,
    widgets: widgetSpecRegistry,
    settings,
    newId,
  });
  const base = deps.packsBase ?? "static-packs/";
  const packById = (id: string) => deps.packs.find((p) => p.manifest.id === id);
  let messageId = 0;

  const summaries = async (): Promise<InstalledPackSummary[]> => {
    const out: InstalledPackSummary[] = [];
    for (const s of await source.list()) {
      const pack = packById(s.id);
      try {
        const p = await learn.packProgress(s.id);
        const views = Object.values(p.views);
        const isCard = (id: string) => pack?.map.nodes[id]?.kind !== "checkpoint";
        const next = views.find((v) => v.suggested)?.id;
        out.push({
          ...s,
          playable: Math.max(0, s.playable - s.checkpoints),
          done: views.filter((v) => v.state === "done" && isCard(v.id)).length,
          lit: views.filter((v) => v.state === "lit" && isCard(v.id)).length,
          fading: views.filter((v) => v.state === "fading").length,
          finished: p.finished,
          ...(p.finishedAt !== undefined ? { finishedAt: p.finishedAt } : {}),
          ...(p.lastOpenedAt !== undefined ? { lastOpenedAt: p.lastOpenedAt } : {}),
          ...(next && pack ? { next: { nodeId: next, title: pack.map.nodes[next]?.title ?? next } } : {}),
        });
      } catch (e) {
        out.push({ ...s, status: "invalid", statusMessage: (e as Error).message.slice(0, 300) });
      }
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  };

  const notInDemo = (what: string) =>
    fail(409, "conflict", `${what} isn't part of the demo. Run Learncroc on your computer for the full app.`);
  const noAi = () => fail(409, "ai_not_configured", "AI is off in the demo.", "none");

  const checkPack = (id: string): CompiledPack => {
    if (!PACK_ID_RE.test(id)) return fail(400, "invalid", "invalid pack id");
    return packById(id) ?? fail(404, "not_found", `pack "${id}" is not in the demo`);
  };

  /** POST /runs: ids and kinds are checked before any run work, like the server route. */
  const startRun = async (raw: unknown): Promise<RouteRes<"POST /runs">> => {
    const parsed = StartRunBody.safeParse(raw);
    if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "invalid body");
    const body = parsed.data;
    if (body.kind === "try") return notInDemo("Try-runs");
    const pack = checkPack(body.packId);
    if (!NODE_ID_RE.test(body.target)) return fail(400, "invalid", "invalid target");
    const entry = pack.map.nodes[body.target];
    if (!entry) return fail(404, "not_found", `no "${body.target}" in ${body.packId}`);
    if (entry.kind !== (body.kind === "card" ? "node" : "checkpoint"))
      return fail(400, "invalid", `"${body.target}" is not a ${body.kind}`);
    return learn.startRun(body);
  };

  /** POST /runs/:runId/finish; the first card close marks the first run complete. */
  const finish = async (runId: string): Promise<RunSummary> => {
    const summary = await learn.finish(runId);
    if (summary.kind === "card" && summary.doneNow.length > 0) {
      const s = await settings();
      if (!s.firstRun.completed) await saveSettings({ ...s, firstRun: { completed: true, completedAt: summary.now } });
    }
    return summary;
  };

  /** POST /ai/ask, offline: decide the mode from the run, record checkpoint hints, reply from the card. */
  const ask = async (raw: unknown): Promise<AskEvent[]> => {
    const parsed = AskRequest.safeParse(raw);
    if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "invalid question");
    const req = parsed.data;
    const pack = checkPack(req.packId);
    if (req.nodeId && !pack.nodes[req.nodeId]) return fail(400, "invalid", `card "${req.nodeId}" is not playable`);
    let run: RunState | null = req.runId ? await deps.repo.run(req.runId) : null;
    if (run && run.packId !== req.packId && run.packId !== "*") run = null;
    const open = run !== null && run.finishedAt === undefined;
    const intent = req.intent ?? "ask";
    await learn.noteCrocAsk({ chip: req.intent !== undefined && req.intent !== "ask" });

    let ctx: CrocContext;
    let hintLevel: 0 | 1 | 2 | undefined;
    if (open && run && (run.kind === "checkpoint" || run.kind === "relight") && run.current) {
      // Every intent inside a checkpoint or relight question is a hint, and it counts (cap 2).
      const { level } = await learn.crocHint(run.id);
      hintLevel = level;
      const ref = run.current.ref;
      const itemPack = packById(ref.packId) ?? pack;
      const item = itemPack.nodes[ref.nodeId]?.items.find((i) => i.id === ref.itemId);
      ctx = {
        pack: itemPack,
        nodeId: ref.nodeId,
        mode: "hint",
        intent: "hint",
        ...(item
          ? { item: { ref, item, ...(run.current.vars ? { vars: run.current.vars } : {}), hintLevel: level } }
          : {}),
        question: req.question,
      };
    } else {
      const nodeId = req.nodeId ?? (run?.kind === "card" ? run.target : undefined);
      const beforeGuess = open && run?.kind === "card" && run.cursor.phase === "hook" && !run.guess;
      ctx = {
        pack,
        ...(nodeId ? { nodeId } : {}),
        ...(req.screenId ? { screenId: req.screenId } : {}),
        mode: beforeGuess ? "hint" : "full",
        intent: beforeGuess ? "hint" : intent,
        question: req.question,
      };
    }
    const reply = offlineCrocReply(ctx);
    const freeTextMiss = ctx.mode === "full" && intent === "ask" && ctx.nodeId !== undefined && reply.basis !== "faq";
    const text = freeTextMiss ? OFFLINE_FREE_TEXT : reply.text;
    const lastAnswers = run ? (await deps.repo.attempts({ runId: run.id })).length : 0;
    const node = ctx.nodeId ? ctx.pack.nodes[ctx.nodeId] : undefined;
    messageId += 1;
    return [
      {
        type: "sent",
        mode: ctx.mode,
        source: "offline",
        ...(hintLevel !== undefined ? { hintLevel } : {}),
        payloadSummary: {
          ...(node ? { node: node.title } : {}),
          ...(req.screenId ? { screen: req.screenId } : {}),
          lastAnswers,
          prereqs: 0,
          tokensApprox: 0,
        },
      },
      ...chunks(text).map((t): AskEvent => ({ type: "delta", text: t })),
      {
        type: "done",
        threadId: req.threadId ?? newId(),
        messageId,
        words: Math.min(words(text), CROC_MAX_WORDS),
      },
    ];
  };

  const numbersOrNull = async (): Promise<LocalNumbers | undefined> => {
    try {
      return await learn.numbers();
    } catch {
      return undefined;
    }
  };

  type Handler = (a: {
    params: Record<string, string>;
    query: Record<string, unknown>;
    body: unknown;
  }) => Promise<unknown> | unknown;
  const p = (a: { params: Record<string, string> }, k: string) => a.params[k] ?? "";
  const q = (a: { query: Record<string, unknown> }, k: string) => {
    const v = a.query[k];
    return v === undefined || v === "" ? undefined : String(v);
  };
  const packQ = (a: { query: Record<string, unknown> }) => {
    const v = q(a, "packId");
    if (v !== undefined && !PACK_ID_RE.test(v)) fail(400, "invalid", "invalid packId");
    return v;
  };

  const handlers: Record<RouteKey, Handler> = {
    "GET /health": async () => ({
      ok: true,
      version: LEARNCROC_VERSION,
      home: "(this browser)",
      aiConfigured: false,
      packs: deps.packs.length,
      dev: false,
    }),
    "GET /search": (a) => search(deps.packs, (q(a, "q") ?? "").slice(0, 200)),
    "GET /export": async () => {
      const s = await settings();
      const { keySource: _k, keyMasked: _m, ...ai } = s.ai;
      const numbers = await numbersOrNull();
      return {
        format: "learncroc-export",
        version: 2,
        exportedAt: new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z"),
        tables: await deps.repo.exportTables(),
        settings: { ...s, ai },
        ...(numbers ? { numbers } : {}),
      };
    },
    "POST /import": async (a) => {
      const env = ImportEnvelope.safeParse(a.body);
      if (!env.success) return fail(400, "invalid", env.error.issues[0]?.message ?? "invalid export file");
      const unknown = Object.keys(env.data.tables).find((t) => !EXPORT_TABLE_NAMES.includes(t));
      if (unknown) return fail(400, "invalid", `tables.${unknown}: unknown table`);
      const migrated = migrateExportFile(a.body) as { tables: unknown; settings: unknown };
      const tables = ExportTables.partial().safeParse(migrated.tables);
      if (!tables.success) return fail(400, "invalid", tables.error.issues[0]?.message ?? "invalid rows");
      // Defaults under the file's values, so a version-1 file (no croc, no sound.offered) still parses.
      const set = ExportFile.shape.settings.safeParse(deepMerge(DEFAULT_SETTINGS, migrated.settings));
      if (!set.success) return fail(400, "invalid", set.error.issues[0]?.message ?? "invalid settings");
      const t = tables.data;
      const counts = await deps.repo.importTables({
        node_progress: t.node_progress ?? [],
        card: t.card ?? [],
        review_log: t.review_log ?? [],
        attempt: t.attempt ?? [],
        field_note: t.field_note ?? [],
        generated_item: t.generated_item ?? [],
        run: t.run ?? [],
      });
      await deps.repo.setKv(SETTINGS_KEY, set.data);
      const legacy = deps.repo as Partial<MigratableRepo>;
      await legacy.deleteKvPrefixes?.(LEGACY_KV_PREFIXES);
      return { ok: true, counts };
    },
    "POST /reset/:packId": async (a) => {
      const id = p(a, "packId");
      checkPack(id);
      if ((a.body as { confirm?: string } | undefined)?.confirm !== id)
        return fail(400, "invalid", "confirm must equal the pack id");
      await deps.repo.resetPack?.(id);
      return { ok: true };
    },
    "GET /packs": () => summaries(),
    "GET /packs/:id": (a) => checkPack(p(a, "id")),
    "GET /packs/:id/assets/*": () => notInDemo("Fetching assets through the API"),
    "POST /packs/:id/opened": (a) => learn.markOpened(checkPack(p(a, "id")).manifest.id),
    "DELETE /packs/:id": () => notInDemo("Removing maps"),
    "POST /packs/install": () => notInDemo("Installing maps"),
    "POST /frames": () => notInDemo("Custom interactives"),
    "GET /registry": () => ({ packs: [], stale: false, errors: [] }),
    "GET /registry/:id/try": () => notInDemo("The marketplace"),
    "GET /progress": () => learn.progressSummary(),
    "GET /progress/:packId": (a) => learn.packProgress(checkPack(p(a, "packId")).manifest.id),
    "GET /logbook": (a) => {
      const packId = packQ(a);
      return learn.logbook(packId ? { packId } : {});
    },
    "GET /notes": (a) => {
      const packId = packQ(a);
      return learn.fieldNotes(packId ? { packId } : {});
    },
    "GET /numbers": () => learn.numbers(),
    "POST /runs": (a) => startRun(a.body),
    "GET /runs/:runId": (a) => learn.getRun(p(a, "runId")),
    "PATCH /runs/:runId": (a) =>
      learn.patchScratch(p(a, "runId"), (a.body as { scratch: Record<string, unknown> }).scratch),
    "POST /runs/:runId/attempts": (a) => learn.attempt(p(a, "runId"), a.body as never),
    "POST /runs/:runId/hint": (a) => learn.hint(p(a, "runId"), a.body as never),
    "POST /runs/:runId/advance": (a) => {
      const screen = (a.body as { screen?: unknown } | undefined)?.screen;
      if (typeof screen !== "number" || !Number.isInteger(screen) || screen < 0 || screen > 2)
        return fail(400, "invalid", "screen must be 0, 1 or 2");
      return learn.advance(p(a, "runId"), { screen });
    },
    "POST /runs/:runId/finish": (a) => finish(p(a, "runId")),
    "POST /runs/:runId/abandon": (a) => learn.abandon(p(a, "runId")),
    "POST /relight": (a) => learn.relight((a.body ?? {}) as never),
    "GET /relight/calendar.ics": async (a) =>
      relightCalendar(q(a, "time") ?? (await settings()).learning.reminder.time, now()),
    "GET /cards": (a) => {
      const packId = packQ(a);
      return learn.listCards({
        ...(packId ? { packId } : {}),
        ...(q(a, "kind") ? { kind: q(a, "kind") as "node" | "flashcard" | "user" } : {}),
      });
    },
    "GET /cards/due": (a) => {
      const packId = packQ(a);
      return learn.dueCards({
        ...(packId ? { packId } : {}),
        ...(q(a, "limit") ? { limit: Number(q(a, "limit")) } : {}),
      });
    },
    "POST /cards": (a) => learn.createCard(a.body as never),
    "PATCH /cards/:id": (a) => learn.patchCard(p(a, "id"), a.body as never),
    "DELETE /cards/:id": (a) => learn.deleteCard(p(a, "id")),
    "POST /cards/:id/review": (a) => learn.reviewCard(p(a, "id"), a.body as never),
    "GET /cards/export": (a) => {
      const format = q(a, "format");
      if (format !== "csv" && format !== "md") return fail(400, "invalid", "format must be csv or md");
      const packId = packQ(a);
      return learn.exportCards({ format, ...(packId ? { packId } : {}) });
    },
    "GET /settings": () => settings(),
    "PATCH /settings": async (a) => {
      const patch = SettingsPatchSchema.safeParse(a.body);
      if (!patch.success) return fail(400, "invalid", patch.error.issues[0]?.message ?? "invalid settings");
      const { ai: _ai, registries: _r, ...rest }: SettingsPatch = patch.data;
      const next = deepMerge(await settings(), rest);
      const valid = SettingsSchema.safeParse(next);
      if (!valid.success) return fail(400, "invalid", valid.error.issues[0]?.message ?? "invalid settings");
      await saveSettings(valid.data);
      return settings();
    },
    "PUT /settings/ai-key": () => noAi(),
    "DELETE /settings/ai-key": () => ({ ok: true }),
    "GET /ai/status": () => ({
      configured: false,
      provider: "none",
      keySource: "none",
      ollamaDetected: false,
      capReached: false,
    }),
    "POST /ai/test": () => noAi(),
    "GET /ai/models": () => ({ models: [], source: "preset" }),
    "GET /ai/usage": () => noAi(),
    "GET /ai/last-sent": () => null,
    "POST /ai/ask": (a) => ask(a.body),
    "POST /ai/cards": () => noAi(),
    "POST /ai/estimate": () => noAi(),
    "POST /create": () => notInDemo("Making article maps"),
    "GET /jobs/:jobId/events": () => notInDemo("Making article maps"),
    "DELETE /jobs/:jobId": () => notInDemo("Making article maps"),
    "POST /_test/clock": () => fail(404, "not_found", "not found"),
  };

  return {
    async handle(key, args) {
      const h = handlers[key];
      try {
        return (await h({ params: args.params ?? {}, query: args.query ?? {}, body: args.body })) as RouteRes<
          typeof key
        >;
      } catch (e) {
        if (e instanceof ApiClientError) throw e;
        const err = e as Error & { code?: ApiErrorCode };
        if (err.name === "ServiceError" && err.code) {
          const status =
            err.code === "not_found" ? 404 : err.code === "invalid" ? 400 : err.code === "forbidden" ? 403 : 409;
          throw new ApiClientError(status, { error: err.code, message: err.message });
        }
        if (err.name === "RunError") throw new ApiClientError(409, { error: "conflict", message: err.message });
        throw e;
      }
    },
    assetUrl(packId, path) {
      return `${base}${encodeURIComponent(packId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    },
  };
}

/** What the learner-data migration of a browser store needs from its repo. */
export interface MigratableRepo extends Repo {
  rawTables(): Promise<Record<string, unknown[]>>;
  replaceTables(t: ExportTables): Promise<Record<string, number>>;
  deleteKvPrefixes(prefixes: readonly string[]): Promise<number>;
}

/**
 * Bring data stored by an older demo up to revision 3, once per browser: sparked → done, cut run
 * kinds dropped, legacy attempt phases, dropped kv keys (core's migrateLearnerRows, the same mapping
 * as the server's SQLite migration #2). An empty store is simply stamped. Returns whether it ran.
 */
export async function migrateBrowserStore(repo: MigratableRepo): Promise<boolean> {
  if ((await repo.kv<number>(LEARNER_REV_KEY)) === LEARNER_REV) return false;
  const raw = await repo.rawTables();
  const hasRows = Object.values(raw).some((rows) => rows.length > 0);
  if (hasRows) {
    const migrated = ExportTables.partial().parse(migrateLearnerRows(raw));
    await repo.replaceTables({
      node_progress: migrated.node_progress ?? [],
      card: migrated.card ?? [],
      review_log: migrated.review_log ?? [],
      attempt: migrated.attempt ?? [],
      field_note: migrated.field_note ?? [],
      generated_item: migrated.generated_item ?? [],
      run: migrated.run ?? [],
    });
  }
  await repo.deleteKvPrefixes(LEGACY_KV_PREFIXES);
  await repo.setKv(LEARNER_REV_KEY, LEARNER_REV);
  return hasRows;
}

/** The bundled packs listed in `<base>index.json` (written by build-static). */
export async function loadBundledPacks(
  base = "static-packs/",
  fetchImpl: typeof fetch = fetch,
): Promise<CompiledPack[]> {
  const index = (await (await fetchImpl(`${base}index.json`)).json()) as { packs: string[] };
  const packs: CompiledPack[] = [];
  for (const id of index.packs) {
    const res = await fetchImpl(`${base}${encodeURIComponent(id)}.json`);
    if (!res.ok) continue;
    const parsed = CompiledPackSchema.safeParse(await res.json());
    if (parsed.success && parsed.data.format === 2) packs.push(parsed.data);
  }
  return packs;
}

let shared: Promise<LocalApi> | undefined;

/** The demo's adapter: IndexedDB repo + bundled packs, created once per page. */
export function localApi(): Promise<LocalApi> {
  shared ??= (async () => {
    const { IdbRepo } = await import("./idb-repo");
    const base = `${import.meta.env.BASE_URL ?? "/"}static-packs/`;
    const [repo, packs] = await Promise.all([IdbRepo.open(), loadBundledPacks(base)]);
    try {
      await migrateBrowserStore(repo);
    } catch (e) {
      // Older data stays as it is until the migration can read it; the demo still plays.
      console.warn("[learncroc] stored progress could not be migrated yet:", e);
    }
    return createLocalApi({ repo, packs, packsBase: base });
  })();
  return shared;
}
