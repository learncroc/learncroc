/**
 * Typed client for every API route (one function per route).
 *
 * JSON routes resolve to the response type from ApiRoutes; errors throw ApiClientError carrying the
 * ApiError code and AI fallback hint. SSE routes return an async iterator of validated events; text
 * routes resolve to a string; asset routes resolve to a Blob (use assetUrl() for <img src>).
 *
 * With VITE_LM_MOCK=1, GET routes are answered from fixtures (api/mock.ts) and nothing hits the network.
 * With VITE_LM_STATIC=1 (the static demo), every route is answered in the browser by api/local: core
 * services over IndexedDB and the packs bundled with the site (Moss answers offline).
 *
 * Runs: `startRun` takes StartRunBody (card with `mode`/`from`, checkpoint, try), `advance` moves past a
 * read-only beat, `finishRun` sends an empty body. `health` also carries `dev` (true under --dev) so
 * the library can hide invalid packs outside dev.
 */
import {
  type ApiError,
  ApiError as ApiErrorSchema,
  AskEvent,
  fillPath,
  InstallEvent,
  JobEvent,
  parseSseStream,
  type RouteBody,
  type RouteKey,
  type RouteParams,
  type RouteQuery,
  type RouteRes,
  splitRoute,
} from "@learncroc/core";
import { ApiClientError } from "./errors";
import { mockResponse } from "./mock";

export const API_BASE = "/api";

export { ApiClientError };

const isMockMode = (): boolean => import.meta.env?.VITE_LM_MOCK === "1";
/** The static demo build: no server, everything runs in the browser. */
export const isStaticMode = (): boolean => import.meta.env?.VITE_LM_STATIC === "1";

async function local() {
  const { localApi } = await import("./local/index");
  return localApi();
}

interface CallArgs {
  params?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

function buildUrl(key: RouteKey, args: CallArgs): string {
  const { path } = splitRoute(key);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args.query ?? {})) if (v !== undefined) qs.set(k, String(v));
  const q = qs.toString();
  return `${API_BASE}${fillPath(path, args.params)}${q ? `?${q}` : ""}`;
}

async function send(key: RouteKey, args: CallArgs): Promise<Response> {
  const { method } = splitRoute(key);
  const res = await fetch(buildUrl(key, args), {
    method,
    credentials: "same-origin",
    headers:
      args.body === undefined
        ? { accept: "application/json" }
        : { "content-type": "application/json", accept: "application/json" },
    ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
    ...(args.signal ? { signal: args.signal } : {}),
  });
  if (!res.ok) {
    let body: ApiError = { error: "invalid", message: `${res.status} ${res.statusText}` };
    try {
      const parsed = ApiErrorSchema.safeParse(await res.json());
      if (parsed.success) body = parsed.data;
    } catch {
      /* not JSON */
    }
    throw new ApiClientError(res.status, body);
  }
  return res;
}

/** Call a JSON route. */
export async function call<K extends RouteKey>(key: K, args: CallArgs = {}): Promise<RouteRes<K>> {
  if (isMockMode() && key.startsWith("GET ")) return mockResponse(key, args.params ?? {}) as RouteRes<K>;
  if (isStaticMode()) return (await local()).handle(key, args);
  const res = await send(key, args);
  return (await res.json()) as RouteRes<K>;
}

async function callText(key: RouteKey, args: CallArgs = {}): Promise<string> {
  if (isStaticMode()) return String(await (await local()).handle(key, args));
  return (await send(key, args)).text();
}

async function* callSse<E extends { type: string }>(
  key: RouteKey,
  args: CallArgs,
  schema: import("zod").ZodType<E>,
): AsyncGenerator<E, void, undefined> {
  if (isStaticMode()) {
    // The demo answers Ask offline with the whole event list; installs and article-map jobs throw
    // a "not part of the demo" error from the adapter.
    const events: unknown = await (await local()).handle(key, args);
    if (Array.isArray(events)) for (const e of events) yield schema.parse(e);
    return;
  }
  const res = await send(key, args);
  if (!res.body) throw new ApiClientError(502, { error: "provider_error", message: "empty stream" });
  yield* parseSseStream(res.body, schema);
}

/** URL for a pack asset (for <img src>, <audio src>). */
export function assetUrl(packId: string, path: string): string {
  if (isStaticMode())
    return `${import.meta.env.BASE_URL ?? "/"}static-packs/${encodeURIComponent(packId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  return buildUrl("GET /packs/:id/assets/*", { params: { id: packId, "*": path } });
}

/** GET /health as served: the route map's response plus `dev` (absent from servers older than revision 3). */
export type HealthRes = RouteRes<"GET /health"> & { dev?: boolean };

type P<K extends RouteKey> = RouteParams<K>;
type Q<K extends RouteKey> = RouteQuery<K>;
type B<K extends RouteKey> = RouteBody<K>;
type Opts = { signal?: AbortSignal };

/** One function per route, named after what it does. */
export const api = {
  /** GET /health (plus `dev`: the server runs with --dev; false in the static demo). */
  health: (opts: Opts = {}) => call("GET /health", { ...opts }) as Promise<HealthRes>,
  /** GET /search */
  search: (query: Q<"GET /search">, opts: Opts = {}) =>
    call("GET /search", { query: query as CallArgs["query"], ...opts }),
  /** GET /export */
  exportData: (opts: Opts = {}) => call("GET /export", { ...opts }),
  /** POST /import */
  importData: (body: B<"POST /import">, opts: Opts = {}) => call("POST /import", { body, ...opts }),
  /** POST /reset/:packId */
  resetPack: (params: P<"POST /reset/:packId">, body: B<"POST /reset/:packId">, opts: Opts = {}) =>
    call("POST /reset/:packId", { params: params as Record<string, string>, body, ...opts }),
  /** GET /packs */
  listPacks: (opts: Opts = {}) => call("GET /packs", { ...opts }),
  /** GET /packs/:id */
  getPack: (params: P<"GET /packs/:id">, query?: Q<"GET /packs/:id">, opts: Opts = {}) =>
    call("GET /packs/:id", { params: params as Record<string, string>, query: query as CallArgs["query"], ...opts }),
  /** GET /packs/:id/assets/* */
  getAsset: async (params: P<"GET /packs/:id/assets/*">, opts: Opts = {}): Promise<Blob> =>
    isStaticMode()
      ? (await fetch(assetUrl(params.id, params["*"]), opts.signal ? { signal: opts.signal } : {})).blob()
      : (await send("GET /packs/:id/assets/*", { params: params as Record<string, string>, ...opts })).blob(),
  /** POST /packs/:id/opened */
  markPackOpened: (params: P<"POST /packs/:id/opened">, opts: Opts = {}) =>
    call("POST /packs/:id/opened", { params: params as Record<string, string>, ...opts }),
  /** DELETE /packs/:id */
  removePack: (params: P<"DELETE /packs/:id">, query?: Q<"DELETE /packs/:id">, opts: Opts = {}) =>
    call("DELETE /packs/:id", { params: params as Record<string, string>, query: query as CallArgs["query"], ...opts }),
  /** POST /packs/install (SSE) */
  installPack: (body: B<"POST /packs/install">, opts: Opts = {}) =>
    callSse("POST /packs/install", { body, ...opts }, InstallEvent),
  /** POST /frames */
  registerFrame: (body: B<"POST /frames">, opts: Opts = {}) => call("POST /frames", { body, ...opts }),
  /** GET /registry */
  getRegistry: (query?: Q<"GET /registry">, opts: Opts = {}) =>
    call("GET /registry", { query: query as CallArgs["query"], ...opts }),
  /** GET /registry/:id/try */
  getTryBundle: (params: P<"GET /registry/:id/try">, query?: Q<"GET /registry/:id/try">, opts: Opts = {}) =>
    call("GET /registry/:id/try", {
      params: params as Record<string, string>,
      query: query as CallArgs["query"],
      ...opts,
    }),
  /** GET /progress */
  getProgress: (opts: Opts = {}) => call("GET /progress", { ...opts }),
  /** GET /progress/:packId */
  getPackProgress: (params: P<"GET /progress/:packId">, opts: Opts = {}) =>
    call("GET /progress/:packId", { params: params as Record<string, string>, ...opts }),
  /** GET /logbook */
  getLogbook: (query?: Q<"GET /logbook">, opts: Opts = {}) =>
    call("GET /logbook", { query: query as CallArgs["query"], ...opts }),
  /** GET /notes */
  getNotes: (query?: Q<"GET /notes">, opts: Opts = {}) =>
    call("GET /notes", { query: query as CallArgs["query"], ...opts }),
  /** GET /numbers */
  numbers: (opts: Opts = {}) => call("GET /numbers", { ...opts }),
  /** POST /runs */
  startRun: (body: B<"POST /runs">, opts: Opts = {}) => call("POST /runs", { body, ...opts }),
  /** GET /runs/:runId */
  getRun: (params: P<"GET /runs/:runId">, opts: Opts = {}) =>
    call("GET /runs/:runId", { params: params as Record<string, string>, ...opts }),
  /** PATCH /runs/:runId */
  patchRunScratch: (params: P<"PATCH /runs/:runId">, body: B<"PATCH /runs/:runId">, opts: Opts = {}) =>
    call("PATCH /runs/:runId", { params: params as Record<string, string>, body, ...opts }),
  /** POST /runs/:runId/attempts */
  submitAttempt: (params: P<"POST /runs/:runId/attempts">, body: B<"POST /runs/:runId/attempts">, opts: Opts = {}) =>
    call("POST /runs/:runId/attempts", { params: params as Record<string, string>, body, ...opts }),
  /** POST /runs/:runId/advance */
  advance: (params: P<"POST /runs/:runId/advance">, body: B<"POST /runs/:runId/advance">, opts: Opts = {}) =>
    call("POST /runs/:runId/advance", { params: params as Record<string, string>, body, ...opts }),
  /** POST /runs/:runId/hint */
  requestHint: (params: P<"POST /runs/:runId/hint">, body: B<"POST /runs/:runId/hint">, opts: Opts = {}) =>
    call("POST /runs/:runId/hint", { params: params as Record<string, string>, body, ...opts }),
  /** POST /runs/:runId/finish */
  finishRun: (params: P<"POST /runs/:runId/finish">, opts: Opts = {}) =>
    call("POST /runs/:runId/finish", { params: params as Record<string, string>, body: {}, ...opts }),
  /** POST /runs/:runId/abandon */
  abandonRun: (params: P<"POST /runs/:runId/abandon">, opts: Opts = {}) =>
    call("POST /runs/:runId/abandon", { params: params as Record<string, string>, ...opts }),
  /** POST /relight */
  startRelight: (body: B<"POST /relight">, opts: Opts = {}) => call("POST /relight", { body, ...opts }),
  /** GET /relight/calendar.ics */
  getRelightCalendar: (query?: Q<"GET /relight/calendar.ics">, opts: Opts = {}): Promise<string> =>
    callText("GET /relight/calendar.ics", { query: query as CallArgs["query"], ...opts }),
  /** GET /cards */
  listCards: (query?: Q<"GET /cards">, opts: Opts = {}) =>
    call("GET /cards", { query: query as CallArgs["query"], ...opts }),
  /** GET /cards/due */
  listDueCards: (query?: Q<"GET /cards/due">, opts: Opts = {}) =>
    call("GET /cards/due", { query: query as CallArgs["query"], ...opts }),
  /** POST /cards */
  createCard: (body: B<"POST /cards">, opts: Opts = {}) => call("POST /cards", { body, ...opts }),
  /** PATCH /cards/:id */
  updateCard: (params: P<"PATCH /cards/:id">, body: B<"PATCH /cards/:id">, opts: Opts = {}) =>
    call("PATCH /cards/:id", { params: params as Record<string, string>, body, ...opts }),
  /** DELETE /cards/:id */
  deleteCard: (params: P<"DELETE /cards/:id">, opts: Opts = {}) =>
    call("DELETE /cards/:id", { params: params as Record<string, string>, ...opts }),
  /** POST /cards/:id/review */
  reviewCard: (params: P<"POST /cards/:id/review">, body: B<"POST /cards/:id/review">, opts: Opts = {}) =>
    call("POST /cards/:id/review", { params: params as Record<string, string>, body, ...opts }),
  /** GET /cards/export */
  exportCards: (query: Q<"GET /cards/export">, opts: Opts = {}): Promise<string> =>
    callText("GET /cards/export", { query: query as CallArgs["query"], ...opts }),
  /** GET /settings */
  getSettings: (opts: Opts = {}) => call("GET /settings", { ...opts }),
  /** PATCH /settings */
  patchSettings: (body: B<"PATCH /settings">, opts: Opts = {}) => call("PATCH /settings", { body, ...opts }),
  /** PUT /settings/ai-key */
  setAiKey: (body: B<"PUT /settings/ai-key">, opts: Opts = {}) => call("PUT /settings/ai-key", { body, ...opts }),
  /** DELETE /settings/ai-key */
  clearAiKey: (opts: Opts = {}) => call("DELETE /settings/ai-key", { ...opts }),
  /** GET /ai/status */
  getAiStatus: (opts: Opts = {}) => call("GET /ai/status", { ...opts }),
  /** POST /ai/test */
  testAi: (opts: Opts = {}) => call("POST /ai/test", { ...opts }),
  /** GET /ai/models */
  listAiModels: (opts: Opts = {}) => call("GET /ai/models", { ...opts }),
  /** GET /ai/usage */
  getAiUsage: (opts: Opts = {}) => call("GET /ai/usage", { ...opts }),
  /** GET /ai/last-sent */
  getAiLastSent: (query?: Q<"GET /ai/last-sent">, opts: Opts = {}) =>
    call("GET /ai/last-sent", { query: query as CallArgs["query"], ...opts }),
  /** POST /ai/ask (SSE) */
  ask: (body: B<"POST /ai/ask">, opts: Opts = {}) => callSse("POST /ai/ask", { body, ...opts }, AskEvent),
  /** POST /ai/cards */
  draftCards: (body: B<"POST /ai/cards">, opts: Opts = {}) => call("POST /ai/cards", { body, ...opts }),
  /** POST /ai/estimate */
  estimateCreate: (body: B<"POST /ai/estimate">, opts: Opts = {}) => call("POST /ai/estimate", { body, ...opts }),
  /** POST /create */
  createPocketMap: (body: B<"POST /create">, opts: Opts = {}) => call("POST /create", { body, ...opts }),
  /** GET /jobs/:jobId/events (SSE) */
  jobEvents: (params: P<"GET /jobs/:jobId/events">, opts: Opts = {}) =>
    callSse("GET /jobs/:jobId/events", { params: params as Record<string, string>, ...opts }, JobEvent),
  /** DELETE /jobs/:jobId */
  cancelJob: (params: P<"DELETE /jobs/:jobId">, opts: Opts = {}) =>
    call("DELETE /jobs/:jobId", { params: params as Record<string, string>, ...opts }),
  /** POST /_test/clock */
  setTestClock: (body: B<"POST /_test/clock">, opts: Opts = {}) => call("POST /_test/clock", { body, ...opts }),
} as const;

/** Compile-time check: one client function per contract route. */
type ClientRoutes = (typeof API_ROUTE_FUNCTIONS)[number];
const API_ROUTE_FUNCTIONS = [
  "GET /health",
  "GET /search",
  "GET /export",
  "POST /import",
  "POST /reset/:packId",
  "GET /packs",
  "GET /packs/:id",
  "GET /packs/:id/assets/*",
  "POST /packs/:id/opened",
  "DELETE /packs/:id",
  "POST /packs/install",
  "POST /frames",
  "GET /registry",
  "GET /registry/:id/try",
  "GET /progress",
  "GET /progress/:packId",
  "GET /logbook",
  "GET /notes",
  "GET /numbers",
  "POST /runs",
  "GET /runs/:runId",
  "PATCH /runs/:runId",
  "POST /runs/:runId/attempts",
  "POST /runs/:runId/advance",
  "POST /runs/:runId/hint",
  "POST /runs/:runId/finish",
  "POST /runs/:runId/abandon",
  "POST /relight",
  "GET /relight/calendar.ics",
  "GET /cards",
  "GET /cards/due",
  "POST /cards",
  "PATCH /cards/:id",
  "DELETE /cards/:id",
  "POST /cards/:id/review",
  "GET /cards/export",
  "GET /settings",
  "PATCH /settings",
  "PUT /settings/ai-key",
  "DELETE /settings/ai-key",
  "GET /ai/status",
  "POST /ai/test",
  "GET /ai/models",
  "GET /ai/usage",
  "GET /ai/last-sent",
  "POST /ai/ask",
  "POST /ai/cards",
  "POST /ai/estimate",
  "POST /create",
  "GET /jobs/:jobId/events",
  "DELETE /jobs/:jobId",
  "POST /_test/clock",
] as const satisfies readonly RouteKey[];
type MissingClientRoutes = Exclude<RouteKey, ClientRoutes>;
const _everyRouteHasAFunction: [MissingClientRoutes] extends [never] ? true : MissingClientRoutes = true;
void _everyRouteHasAFunction;
