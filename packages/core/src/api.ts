/**
 * The HTTP route map. Base: http://127.0.0.1:4747/api. JSON bodies.
 *
 * Response markers: "binary" (asset bytes), "text" (CSV/Markdown/ICS), "sse:<Event>" (an SSE
 * stream of that event union, read with parseSseStream() from ./sse).
 */
import type {
  AiFeature,
  AnswerValue,
  AskRequest,
  AssetPath,
  AttemptInput,
  AttemptResult,
  CardDraft,
  CardState,
  CompiledPack,
  CreateRequest,
  ExportFile,
  FieldNote,
  Grade,
  InstalledPackSummary,
  Item,
  ItemId,
  ItemRef,
  LocalNumbers,
  Logbook,
  Markdown,
  Millis,
  NodeId,
  PackId,
  PackProgress,
  ProviderId,
  RegistryView,
  RunState,
  RunSummary,
  SearchHit,
  SemVer,
  Settings,
  SettingsPatch,
  StartRunBody,
  TryBundle,
  UsageSummary,
} from "./schema/index";

type CardWithText = CardState & { front: Markdown; back: Markdown };

/** Every route: request (params/query/body) → response. */
export interface ApiRoutes {
  // ── system
  "GET /health": {
    res: { ok: true; version: SemVer; home: string; aiConfigured: boolean; packs: number; dev: boolean };
  };
  "GET /search": { query: { q: string }; res: SearchHit[] };
  /** Content-Disposition: attachment. */
  "GET /export": { res: ExportFile };
  /** Per-table zod, parameterised writes. */
  "POST /import": { body: ExportFile; res: { ok: true; counts: Record<string, number> } };
  "POST /reset/:packId": { params: { packId: PackId }; body: { confirm: PackId }; res: { ok: true } };

  // ── packs
  "GET /packs": { res: InstalledPackSummary[] };
  "GET /packs/:id": { params: { id: PackId }; query: { version?: SemVer }; res: CompiledPack };
  /** Regex + realpath check, MIME allowlist, CSP sandbox; .html → 404 (sandbox origin only). */
  "GET /packs/:id/assets/*": { params: { id: PackId; "*": AssetPath }; res: "binary" };
  "POST /packs/:id/opened": { params: { id: PackId }; res: { ok: true } };
  /** Progress kept. */
  "DELETE /packs/:id": { params: { id: PackId }; query: { version?: SemVer }; res: { ok: true } };
  /** Registries only; local files via the CLI. */
  "POST /packs/install": { body: { id: PackId; version?: SemVer; registry?: string }; res: "sse:InstallEvent" };
  /**
   * asset = a pack html interactive; generated = the node's generated-html toy (pocket maps).
   * Returns http://127.0.0.1:<port+1>/frame/<token>.
   */
  "POST /frames": {
    body: { packId: PackId; asset?: AssetPath; nodeId?: NodeId; generated?: boolean };
    res: { url: string; expiresAt: Millis };
  };

  // ── registry
  "GET /registry": { query: { refresh?: "1" }; res: RegistryView };
  "GET /registry/:id/try": { params: { id: PackId }; query: { registry?: string }; res: TryBundle };

  // ── progress
  "GET /progress": {
    res: {
      now: Millis;
      packs: Record<
        PackId,
        { done: number; lit: number; fading: number; playable: number; due: number; finished: boolean }
      >;
    };
  };
  "GET /progress/:packId": { params: { packId: PackId }; res: PackProgress };
  "GET /logbook": { query: { packId?: PackId }; res: Logbook };
  "GET /notes": { query: { packId?: PackId }; res: FieldNote[] };
  /** Local success metrics; nothing leaves the machine. */
  "GET /numbers": { res: LocalNumbers };

  // ── runs (the server is authoritative; responses carry the reduced RunState)
  /** Resumes an open run of the same kind+target. 409 when the target is locked, planned or building. */
  "POST /runs": { body: StartRunBody; res: { run: RunState; resumed: boolean; now: Millis; tryPack?: CompiledPack } };
  "GET /runs/:runId": { params: { runId: string }; res: { run: RunState; now: Millis } };
  /** Scratch only. */
  "PATCH /runs/:runId": { params: { runId: string }; body: { scratch: Record<string, unknown> }; res: { ok: true } };
  /** The ONLY grading path. */
  "POST /runs/:runId/attempts": { params: { runId: string }; body: AttemptInput; res: AttemptResult };
  /** Past a read-only beat (`screen`) or card (`card`). 409 unless the cursor is on it. */
  "POST /runs/:runId/advance": {
    params: { runId: string };
    body: { screen?: number; card?: number };
    res: { run: RunState; now: Millis };
  };
  /** Checkpoint and relight runs cap at level 2 and never show a solution. */
  "POST /runs/:runId/hint": {
    params: { runId: string };
    body: { interactionId: ItemId; answer?: AnswerValue };
    res: { hint: Markdown; level: 1 | 2 | 3; source: "authored" | "ai"; run: RunState };
  };
  /** Card: from `close` → done. Checkpoint: from `done` → pass/miss. Relight: any time. */
  "POST /runs/:runId/finish": { params: { runId: string }; body: Record<string, never>; res: RunSummary };
  "POST /runs/:runId/abandon": { params: { runId: string }; res: { ok: true } };

  // ── relight
  "POST /relight": {
    body: { packId?: PackId; limit?: number };
    res: {
      run: RunState;
      items: { ref: ItemRef; interaction: Item; vars?: Record<string, number>; nodeTitle: string; packTitle: string }[];
      nothingDue: boolean;
      nextDueAt?: Millis;
      now: Millis;
    };
  };
  /** A daily recurring "Relight (5 min)" event, no counts. */
  "GET /relight/calendar.ics": { query: { time?: string }; res: "text" };

  // ── flashcards (the HTTP paths keep "cards")
  "GET /cards": { query: { packId?: PackId; kind?: CardState["kind"] }; res: CardWithText[] };
  "GET /cards/due": { query: { packId?: PackId; limit?: number }; res: { now: Millis; cards: CardWithText[] } };
  "POST /cards": {
    body: { packId: PackId; nodeId?: NodeId; front: Markdown; back: Markdown; source: "session" | "manual" };
    res: CardState;
  };
  "PATCH /cards/:id": {
    params: { id: string };
    body: { front?: Markdown; back?: Markdown; suspended?: boolean };
    res: CardState;
  };
  "DELETE /cards/:id": { params: { id: string }; res: { ok: true } };
  "POST /cards/:id/review": {
    params: { id: string };
    body: { grade?: Grade; correct?: boolean; ms?: number };
    res: CardState;
  };
  "GET /cards/export": { query: { format: "csv" | "md"; packId?: PackId }; res: "text" };

  // ── settings
  "GET /settings": { res: Settings };
  "PATCH /settings": { body: SettingsPatch; res: Settings };
  "PUT /settings/ai-key": {
    body: { provider: Exclude<ProviderId, "none">; key: string; baseUrl?: string };
    res: { ok: true; keyMasked: string };
  };
  "DELETE /settings/ai-key": { res: { ok: true } };

  // ── ai
  "GET /ai/status": {
    res: {
      configured: boolean;
      provider: ProviderId;
      keySource: Settings["ai"]["keySource"];
      ollamaDetected: boolean;
      capReached: boolean;
    };
  };
  "POST /ai/test": { res: { ok: boolean; provider: ProviderId; model: string; latencyMs: number; error?: string } };
  "GET /ai/models": { res: { models: string[]; source: "provider" | "preset" } };
  "GET /ai/usage": { res: UsageSummary };
  "GET /ai/last-sent": {
    query: { feature?: AiFeature };
    res: { feature: AiFeature; at: Millis; payload: unknown } | null;
  };
  /** Mode decided by the server from run state. Streams offline replies when AI is off (never 409). */
  "POST /ai/ask": { body: AskRequest; res: "sse:AskEvent" };
  "POST /ai/cards": { body: { runId: string }; res: { cards: CardDraft[] } };
  "POST /ai/estimate": { body: CreateRequest; res: { tokens: number; usd: number; model: string; overCap: boolean } };

  // ── create (pocket maps)
  /** packId generated ("pm-…"). */
  "POST /create": { body: CreateRequest; res: { jobId: string; packId: PackId } };
  /** Replays past events on reconnect. */
  "GET /jobs/:jobId/events": { params: { jobId: string }; res: "sse:JobEvent" };
  "DELETE /jobs/:jobId": { params: { jobId: string }; res: { ok: true } };

  // ── test only (LEARNCROC_TEST=1)
  "POST /_test/clock": { body: { now: Millis | null }; res: { ok: true } };
}

export type RouteKey = keyof ApiRoutes;
export type RouteMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type Field<K extends RouteKey, F extends string> = ApiRoutes[K] extends Record<F, infer T> ? T : never;
export type RouteRes<K extends RouteKey> = ApiRoutes[K]["res"];
export type RouteBody<K extends RouteKey> = Field<K, "body">;
export type RouteParams<K extends RouteKey> = Field<K, "params">;
export type RouteQuery<K extends RouteKey> = Field<K, "query">;
/** Routes whose response is a JSON value (not binary, text or SSE). */
export type JsonRouteKey = {
  [K in RouteKey]: RouteRes<K> extends "binary" | "text" | `sse:${string}` ? never : K;
}[RouteKey];

/** Every route key at runtime. A compile-time check keeps it in sync with ApiRoutes; the server's mounted routes must equal it. */
export const API_ROUTES = [
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

/** Alias of API_ROUTES (the name the design docs use). */
export const ROUTE_KEYS = API_ROUTES;

/** Compile-time check that API_ROUTES lists every key of ApiRoutes. */
type MissingRoutes = Exclude<RouteKey, (typeof API_ROUTES)[number]>;
const _allRoutesListed: [MissingRoutes] extends [never] ? true : MissingRoutes = true;
void _allRoutesListed;

/** Split "POST /runs/:runId/attempts" into method and path. */
export function splitRoute(key: RouteKey): { method: RouteMethod; path: string } {
  const i = key.indexOf(" ");
  return { method: key.slice(0, i) as RouteMethod, path: key.slice(i + 1) };
}

/** Fill ":param" and "*" segments of a route path. Values are URI-encoded except "*" (asset paths keep slashes). */
export function fillPath(path: string, params: Record<string, string> = {}): string {
  return path
    .replace(/:([A-Za-z]+)/g, (_, name: string) => {
      const v = params[name];
      if (v === undefined) throw new Error(`missing route param :${name}`);
      return encodeURIComponent(v);
    })
    .replace(/\*$/, () => {
      const v = params["*"];
      if (v === undefined) throw new Error("missing route param *");
      return v.split("/").map(encodeURIComponent).join("/");
    });
}
