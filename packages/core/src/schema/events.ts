/**
 * SSE event shapes. Wire format: `event: <type>\ndata: <JSON>\n\n`.
 * The `type` inside the JSON equals the SSE event name. Streams end with a terminal event
 * (`done` or `error`), then the server closes the connection.
 */
import { z } from "zod";
import { AiFallback, ApiErrorCode } from "./api";
import { Usage, WidgetRef } from "./common";
import { CompiledMap } from "./compiled";
import { NodeId, PackId, SemVer } from "./primitives";

export const InstallEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("resolving"), id: PackId }),
  z.object({ type: z.literal("downloading"), received: z.number(), total: z.number() }),
  /** sha256, then archive and SVG checks. */
  z.object({ type: z.literal("verifying") }),
  z.object({ type: z.literal("extracting") }),
  z.object({ type: z.literal("done"), id: PackId, version: SemVer }),
  z.object({
    type: z.literal("error"),
    code: z.enum([
      "hash_mismatch",
      "engine",
      "unsafe_archive",
      "unsafe_asset",
      "invalid_pack",
      "network",
      "not_found",
      "url_refused",
    ]),
    message: z.string(),
  }),
]);

export const AskEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sent"),
    /** hint: no answer, no close (before a guess, in a checkpoint or Relight question). */
    mode: z.enum(["hint", "full"]),
    /** offline: built from the card's authored content by core `offlineCrocReply` (no key, or AI off). */
    source: z.enum(["ai", "offline"]),
    /** Checkpoint/relight: the item's hint level after this message (0–2). */
    hintLevel: z.literal([0, 1, 2]).optional(),
    payloadSummary: z.object({
      node: z.string().optional(),
      screen: z.string().optional(),
      lastAnswers: z.number(),
      prereqs: z.number(),
      tokensApprox: z.number(),
    }),
  }),
  /** The model is thinking; no text yet. */
  z.object({ type: z.literal("thinking") }),
  z.object({ type: z.literal("delta"), text: z.string() }),
  /** "Show me" (validated; full mode only). */
  z.object({ type: z.literal("widget"), widget: WidgetRef, prompt: z.string() }),
  z.object({ type: z.literal("check"), prompt: z.string(), options: z.array(z.string()), answer: z.number() }),
  z.object({
    type: z.literal("done"),
    threadId: z.string(),
    messageId: z.number(),
    words: z.number(),
    usage: Usage.optional(),
    costUsd: z.number().optional(),
  }),
  z.object({ type: z.literal("error"), code: ApiErrorCode, message: z.string(), fallback: AiFallback.optional() }),
]);

export const JobStage = z.enum(["fetch", "extract", "plan", "cards", "figures", "checkpoints", "write"]);

/** A planned card as streamed by the create pipeline (`plan-node`, `plan-update`). */
export const PlanNode = z.object({
  id: NodeId,
  title: z.string(),
  landmark: z.string().optional(),
  requires: z.array(NodeId),
  paras: z.array(z.string()),
  /** 0-based section index (sectionSizes over the cards planned so far). */
  section: z.number().int(),
  hookIdea: z.string(),
});

export const JobEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage"), stage: JobStage, status: z.enum(["start", "done"]) }),
  z.object({
    type: z.literal("meta"),
    title: z.string(),
    site: z.string().optional(),
    words: z.number(),
    paragraphs: z.number(),
    headings: z.array(z.string()),
  }),
  /** Drives the highlighter sweep. */
  z.object({ type: z.literal("highlight"), paras: z.array(z.string()), nodeId: NodeId.optional() }),
  z.object({ type: z.literal("plan-node"), node: PlanNode }),
  z.object({
    type: z.literal("plan-checkpoint"),
    checkpoint: z.object({ id: NodeId, requires: z.array(NodeId), covers: z.array(NodeId), size: z.number().int() }),
  }),
  /** After a split or merge, or when sections are re-derived at the end of the plan stream. */
  z.object({ type: z.literal("plan-update"), removed: z.array(NodeId), added: z.array(PlanNode) }),
  z.object({ type: z.literal("plan-edge"), from: NodeId, to: NodeId }),
  /** The provisional pack is now servable (cards "building"). */
  z.object({ type: z.literal("layout"), map: CompiledMap }),
  z.object({
    type: z.literal("card-ready"),
    nodeId: NodeId,
    /** cardWords().total */
    words: z.number(),
    lint: z.object({ errors: z.number(), warnings: z.number() }),
  }),
  z.object({ type: z.literal("card-failed"), nodeId: NodeId, message: z.string(), retryable: z.boolean() }),
  /** A per-card quality check and what the pipeline did about it. */
  z.object({
    type: z.literal("check"),
    nodeId: NodeId,
    check: z.enum(["hook-close", "grounded", "giveaway", "teaser", "words"]),
    ok: z.boolean(),
    action: z.enum(["kept", "repaired", "split", "merged", "dropped"]),
  }),
  /** Generated SVG accepted or dropped ("screenId" = beat id). */
  z.object({
    type: z.literal("figure"),
    nodeId: NodeId,
    screenId: z.string(),
    ok: z.boolean(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("done"),
    packId: PackId,
    version: SemVer,
    cards: z.number(),
    usage: Usage,
    costUsd: z.number(),
    ms: z.number(),
  }),
  z.object({
    type: z.literal("error"),
    stage: JobStage,
    code: z.union([ApiErrorCode, z.enum(["too_short", "too_long", "fetch_failed"])]),
    message: z.string(),
  }),
]);

export type InstallEvent = z.infer<typeof InstallEvent>;
export type AskEvent = z.infer<typeof AskEvent>;
export type JobStage = z.infer<typeof JobStage>;
export type PlanNode = z.infer<typeof PlanNode>;
export type JobEvent = z.infer<typeof JobEvent>;
