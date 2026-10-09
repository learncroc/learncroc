/**
 * HTTP API data shapes. The route map itself is in src/api.ts.
 */
import { z } from "zod";
import { Provenance } from "./common";
import { CompiledPack } from "./compiled";
import { Item } from "./interactions";
import { AttemptRow, CardState, FieldNote, NodeProgress, ReviewLogRow, RunState } from "./learner";
import { PackTheme } from "./manifest";
import { IsoDate, LintProfile, Markdown, Millis, NodeId, PackCategory, PackId, RendererId, SemVer } from "./primitives";
import { Settings } from "./settings";

export const ApiErrorCode = z.enum([
  "not_found",
  "invalid",
  "forbidden",
  "conflict",
  "not_implemented",
  "engine_mismatch",
  "install_failed",
  "ai_not_configured",
  "rate_limited",
  "cap_reached",
  "provider_error",
  "refusal",
]);
export const AiFallback = z.enum(["authored-faq", "authored-hint", "item-bank", "self-check", "none"]);

/**
 * Status codes: 400 invalid, 403 forbidden, 404 not_found, 409 conflict | ai_not_configured,
 * 429 rate_limited | cap_reached, 502 provider_error | refusal, 501 not_implemented.
 */
export const ApiError = z.object({
  error: ApiErrorCode,
  message: z.string(),
  /** With ai_not_configured / cap_reached / provider_error. */
  fallback: AiFallback.optional(),
});

export const InstalledPackSummary = z.object({
  id: PackId,
  version: SemVer,
  title: z.string(),
  subtitle: z.string().optional(),
  category: PackCategory,
  theme: PackTheme,
  tier: z.enum(["official", "community", "local"]),
  kind: z.enum(["pack", "pocket"]),
  profile: LintProfile,
  /** draft → "AI-drafted, review pending" badge (official) / "AI-drafted from …" (pocket). */
  review: z.enum(["reviewed", "draft"]),
  /** Uses html interactives → "custom interactive" badge. */
  customInteractives: z.boolean(),
  nodes: z.number(),
  playable: z.number(),
  checkpoints: z.number(),
  done: z.number(),
  lit: z.number(),
  fading: z.number(),
  /** Every playable card lit and every checkpoint passed. */
  finished: z.boolean(),
  finishedAt: Millis.optional(),
  lastOpenedAt: Millis.optional(),
  next: z.object({ nodeId: NodeId, title: z.string() }).optional(),
  status: z.enum(["ok", "invalid", "building"]),
  statusMessage: z.string().optional(),
});

export const SearchHit = z.object({
  type: z.enum(["pack", "node", "card", "action", "setting"]),
  title: z.string(),
  subtitle: z.string().optional(),
  /** App route. */
  href: z.string(),
  packId: PackId.optional(),
  nodeId: NodeId.optional(),
});

/** feedback ≤ 30 words. */
export const ExplainGrade = z.object({
  hit: z.array(z.string()),
  missing: z.string().nullable(),
  correct: z.boolean(),
  feedback: Markdown,
  source: z.literal("ai"),
});

export const CardDraft = z.object({
  front: Markdown,
  back: Markdown,
  kind: z.enum(["qa", "cloze"]),
  nodeId: NodeId,
  reason: z.enum(["used-to-think", "misconception", "close"]),
});

export const CreateRequest = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("url"), url: z.string() }),
    z.object({ kind: z.literal("text"), text: z.string(), title: z.string() }),
  ]),
  /** Default "standard". The planner picks the exact card count within CREATE_SIZES[size]. */
  size: z.enum(["short", "standard", "thorough"]).optional(),
  familiarity: z.enum(["none", "some", "lots"]),
  /** Default sketchbook. */
  renderer: RendererId.optional(),
});

/** Card count range per create size (inclusive). */
export const CREATE_SIZES = {
  short: [3, 5],
  standard: [6, 8],
  thorough: [9, 12],
} as const satisfies Record<"short" | "standard" | "thorough", readonly [number, number]>;

export const StartRunBody = z.discriminatedUnion("kind", [
  /**
   * Resumes an open run of the same kind + target. Refused (409 conflict) when the target is locked, planned or building.
   * `mode` applies to done/lit/fading cards only (others always play): "replay" pins the earlier guess, "again" asks
   * the hook fresh; neither writes progress. `from` = the checkpoint a revisit returns to.
   */
  z.object({
    kind: z.literal("card"),
    packId: PackId,
    target: NodeId,
    mode: z.enum(["play", "replay", "again"]).optional(),
    from: NodeId.optional(),
  }),
  /** Refused when the gate is locked. A passed gate starts a practice run. A retry is just a new start. */
  z.object({ kind: z.literal("checkpoint"), packId: PackId, target: NodeId }),
  /** A card run over the registry TryBundle in a throwaway store; writes no progress. */
  z.object({ kind: z.literal("try"), registry: z.string(), packId: PackId }),
]);

/** Croc quick chips. Inside a checkpoint the server treats every intent as "hint". */
export const CrocIntent = z.enum(["ask", "explain-differently", "example", "deeper", "hint"]);

export const AskRequest = z.object({
  packId: PackId,
  /** Omitted on the library; set on a card's peek and in runs. */
  nodeId: NodeId.optional(),
  screenId: z.string().optional(),
  runId: z.string().optional(),
  /** ≤ 500 chars. */
  question: z.string().min(1).max(500),
  /** Continue a folded thread (the last 2 turns are sent). */
  threadId: z.string().optional(),
  /** Quick chips. Inside a checkpoint the server treats every intent as "hint". */
  intent: CrocIntent.optional(),
});

/** One zod schema per allowlisted table; unknown tables are rejected. */
export const ExportTables = z.strictObject({
  node_progress: z.array(NodeProgress.extend({ packId: PackId })),
  card: z.array(CardState),
  review_log: z.array(ReviewLogRow),
  attempt: z.array(AttemptRow),
  field_note: z.array(FieldNote),
  generated_item: z.array(
    z.object({ id: z.string(), packId: PackId, nodeId: NodeId, item: Item, provenance: Provenance }),
  ),
  run: z.array(RunState),
});

/** A median over local samples; null when there are none. */
const Median = z.object({ medianSec: z.number().nullable(), samples: z.number() });
const FirstTry = z.object({ attempted: z.number(), passedFirstTry: z.number() });

/**
 * GET /numbers: success metrics derived on this machine only (never sent anywhere).
 * Every top-level key except `now` is also a key of LOCAL_NUMBER_EXPLAIN (the one-line explanation).
 */
export const LocalNumbers = z.object({
  /** M1 Next-day explain: hook callbacks (re-asked ≥ 20 h after the card closed) answered right. */
  nextDayExplain: z.object({ asked: z.number(), right: z.number() }),
  /** M2 First-try checkpoint pass: of checkpoints attempted at least once, passed on the first finished attempt. */
  checkpointFirstTry: FirstTry.extend({ perPack: z.record(PackId, FirstTry) }),
  /** M3 Maps finished / maps started (started = ≥ 1 card closed; finished = badge). */
  maps: z.object({ started: z.number(), finished: z.number() }),
  /** M4 Came back within 7 days: active days followed by another active day within 7 days. */
  cameBack: z.object({ activeDays: z.number(), returned: z.number() }),
  /** M5 Link → first playable card, per "provider/model". */
  linkToFirstCard: Median.extend({ byModel: z.record(z.string(), Median) }),
  /** Card completion: card runs opened vs closed. */
  cardCompletion: z.object({ opened: z.number(), closed: z.number() }),
  /** Median minutes from hook to close. */
  cardMinutes: z.object({ median: z.number().nullable(), samples: z.number() }),
  /** Beat actions that needed the worked answer (hint level 3). */
  workedAnswers: z.object({ beats: z.number(), needed: z.number() }),
  /** Checkpoint questions most missed, by item (for authors). */
  mostMissed: z.array(
    z.object({ packId: PackId, nodeId: NodeId, itemId: z.string(), asked: z.number(), missed: z.number() }),
  ),
  /** Hints taken in checkpoint questions. */
  checkpointHints: z.object({ questions: z.number(), hinted: z.number() }),
  /** Moss: quick chips vs free text. */
  crocAsks: z.object({ chips: z.number(), freeText: z.number() }),
  /** Relight sessions per week (average over the weeks with any activity). */
  relightPerWeek: z.object({ sessions: z.number(), weeks: z.number() }),
  now: Millis,
});

/** One-line explanations for Settings → Data → Your numbers and `learncroc stats`. */
export const LOCAL_NUMBER_EXPLAIN: Record<Exclude<keyof z.infer<typeof LocalNumbers>, "now">, string> = {
  nextDayExplain: "Hook questions asked again a day later, answered right.",
  checkpointFirstTry: "Checkpoints passed on the first try. A healthy range is 70 to 90 percent.",
  maps: "Maps finished out of maps started.",
  cameBack: "Days you played that were followed by another within a week.",
  linkToFirstCard: "Seconds from pasting a link to the first playable card.",
  cardCompletion: "Cards closed out of cards opened.",
  cardMinutes: "Typical minutes from a card's question to its close.",
  workedAnswers: "Beat actions that needed the worked answer.",
  mostMissed: "Checkpoint questions missed most often.",
  checkpointHints: "Checkpoint questions where you took a hint.",
  crocAsks: "Questions to Moss from the buttons versus typed.",
  relightPerWeek: "Relight sessions per week.",
};

/** Version 2. Import accepts version 1 through the core learner-data migration. */
export const ExportFile = z.object({
  format: z.literal("learncroc-export"),
  version: z.literal(2),
  exportedAt: IsoDate,
  tables: ExportTables.partial(),
  settings: Settings.omit({ ai: true }).extend({
    ai: Settings.shape.ai.omit({ keyMasked: true, keySource: true }),
  }),
  /** Local numbers at export time. */
  numbers: LocalNumbers.optional(),
});

/** Response of POST /runs. */
export const StartRunResponse = z.object({
  run: RunState,
  resumed: z.boolean(),
  now: Millis,
  tryPack: CompiledPack.optional(),
});

export type ApiErrorCode = z.infer<typeof ApiErrorCode>;
export type AiFallback = z.infer<typeof AiFallback>;
export type ApiError = z.infer<typeof ApiError>;
export type InstalledPackSummary = z.infer<typeof InstalledPackSummary>;
export type SearchHit = z.infer<typeof SearchHit>;
export type ExplainGrade = z.infer<typeof ExplainGrade>;
export type CardDraft = z.infer<typeof CardDraft>;
export type CreateRequest = z.infer<typeof CreateRequest>;
export type CreateSize = NonNullable<CreateRequest["size"]>;
export type StartRunBody = z.infer<typeof StartRunBody>;
export type CrocIntent = z.infer<typeof CrocIntent>;
export type LocalNumbers = z.infer<typeof LocalNumbers>;
export type AskRequest = z.infer<typeof AskRequest>;
export type ExportTables = z.infer<typeof ExportTables>;
export type ExportFile = z.infer<typeof ExportFile>;
export type StartRunResponse = z.infer<typeof StartRunResponse>;
