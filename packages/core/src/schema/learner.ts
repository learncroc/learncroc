/**
 * Learner model, runs and view contracts (RunEvent for the reducer, rows for storage).
 *
 * All times are epoch milliseconds. Every learner-state response carries `now` (server time,
 * test-clock aware); clients never use Date.now() for learner state.
 */
import { z } from "zod";
import { AnswerValue, GradeResult } from "./interactions";
import { Confidence, Grade, ItemId, LineId, Markdown, Millis, NodeId, PackId, SelfRating, SemVer } from "./primitives";

/**
 * Card states: locked (UI "Later") → ready → in-progress → done (closed, no Lumen) → lit (checkpoint passed) → fading.
 * A passed checkpoint is `lit` (UI label "Open"; labels go through `stateLabel(kind, state)`).
 */
export const NodeState = z.enum(["locked", "ready", "in-progress", "done", "lit", "fading", "planned", "building"]);

export const NodeView = z.object({
  id: NodeId,
  state: NodeState,
  /** done 0 (no Lumen before the checkpoint), lit 1, fading = retrievability, others 0. */
  brightness: z.number(),
  /** For lit/fading. */
  retrievability: z.number().optional(),
  /** ≥ 1 successful relight on a later day. */
  durable: z.boolean(),
  /** The one "Suggested" ready card or checkpoint. */
  suggested: z.boolean(),
  /** Unmet requires (locked), including an unmet gate. */
  missing: z.array(NodeId),
  /** Ready/in-progress entries whose prerequisite is fading (nudge). */
  fadingPrereqs: z.array(NodeId),
  /** Card: a missed checkpoint question points here and it hasn't been reopened since. */
  revisit: z.boolean().optional(),
  /** Checkpoint: failed attempts so far (no lockout; for copy only). */
  tries: z.number().int().optional(),
});

export const NodeProgress = z.object({
  nodeId: NodeId,
  /** Cards: started (hook answered) → done (closed) → lit (checkpoint passed). Checkpoints: lit only. */
  status: z.enum(["started", "done", "lit"]),
  source: z.enum(["run", "checkpoint", "import"]),
  doneAt: Millis.optional(),
  litAt: Millis.optional(),
  /** Elo ability. */
  theta: z.number(),
  bestScore: z.number().optional(),
  relightsOk: z.number().int(),
});

export const CardState = z.object({
  /** "node:<pack>:<node>" | "card:<pack>:<node>:<flashcardId>" | "user:<uuid>" */
  id: z.string(),
  packId: PackId,
  nodeId: NodeId.nullable(),
  kind: z.enum(["node", "flashcard", "user"]),
  /** User flashcards only. */
  front: Markdown.optional(),
  back: Markdown.optional(),
  due: Millis,
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  reps: z.number(),
  lapses: z.number(),
  /** ts-fsrs State: New | Learning | Review | Relearning. */
  state: z.literal([0, 1, 2, 3]),
  lastReview: Millis.optional(),
  suspended: z.boolean(),
});

/** Legacy notes only (parked); nothing writes them in revision 3. */
export const FieldNote = z.object({
  id: z.string(),
  packId: PackId,
  nodeId: NodeId,
  /** Card title. */
  title: z.string(),
  /** The learner's own sentence (parked). */
  myWords: z.string().optional(),
  /** Text of their wrong hook guess (if wrong). */
  usedToThink: z.string().optional(),
  litAt: Millis,
  durable: z.boolean(),
});

/** `try` is a StartRunBody variant that creates a `card` run in the try sandbox. */
export const RunKind = z.enum(["card", "checkpoint", "relight"]);
export const RunPhase = z.enum(["hook", "screen", "card", "close", "checkpoint", "relight", "done"]);
/** Attempt rows written before revision 3 carry phase "legacy". */
export const AttemptPhase = z.union([RunPhase, z.literal("legacy")]);

export const ItemRef = z.object({ packId: PackId, nodeId: NodeId, itemId: ItemId });

export const RunCursor = z.object({
  phase: RunPhase,
  /** Index into node.screens (phase "screen"). */
  screen: z.number().int().optional(),
  /** Index into node.cards (phase "card"). */
  card: z.number().int().optional(),
  /** Questions answered so far (checkpoint, relight). */
  item: z.number().int().optional(),
  /** Per-interaction partial widget state (the ONLY client-writable field). */
  scratch: z.record(z.string(), z.unknown()).optional(),
});

export const HintLevel = z.literal([0, 1, 2, 3]);
export const Vars = z.record(z.string(), z.number());

export const RunState = z.object({
  id: z.string(),
  kind: RunKind,
  /** relight: "*" for cross-pack. */
  packId: z.union([PackId, z.literal("*")]),
  /** Pinned: this version is kept installed until the run ends. */
  packVersion: z.union([SemVer, z.literal("*")]),
  /** Card id (card), checkpoint id (checkpoint). */
  target: NodeId.optional(),
  cursor: RunCursor,
  /** The item being asked now, picked by the server. */
  current: z.object({ ref: ItemRef, vars: Vars.optional() }).optional(),
  /** History of items asked, in order. */
  queue: z.array(ItemRef),
  guess: z
    .object({
      interactionId: ItemId,
      answer: AnswerValue,
      confidence: Confidence.optional(),
      correct: z.boolean(),
    })
    .optional(),
  /** Server-tracked hint level per interaction (checkpoint: hint button and croc share it, cap 2). */
  hints: z.record(z.string(), HintLevel),
  /** Reserved; nothing sets it in revision 3 (credit follows the hint level). */
  assisted: z.array(ItemId),
  /** Checkpoint: questions in this attempt (= plan length). */
  size: z.number().int().optional(),
  /** Checkpoint: a practice re-run of a passed gate (no progress or FSRS writes). */
  practice: z.boolean().optional(),
  /** Card: a replay of a done/lit/fading card (no progress writes at finish except clearing the revisit flag). */
  replay: z.boolean().optional(),
  /** Card: the checkpoint a revisit returns to ("Back to the checkpoint"). */
  from: NodeId.optional(),
  /** Parametric item instances. */
  seed: z.number(),
  startedAt: Millis,
  finishedAt: Millis.optional(),
});

export const AttemptInput = z.object({
  /** Required for cross-pack relight; default run.packId. */
  packId: PackId.optional(),
  nodeId: NodeId,
  /** An item id (checkpoint, relight), the hook's interaction id, a beat's interaction id, or (phase "card") a try/check card's interaction id or an ask card's id. */
  interactionId: z.string().min(1),
  phase: RunPhase.exclude(["close", "done"]),
  answer: AnswerValue,
  confidence: Confidence.optional(),
  ms: z.number(),
  // no hintLevel / aiAssisted: the server derives both from the run
});

export const AttemptResult = GradeResult.extend({
  attemptId: z.number(),
  /** True only for checkpoint questions. */
  counted: z.boolean(),
  /** Checkpoint: 1 = counts as right for the gate, else 0. Relight: creditedScore(). Others: score. */
  creditedScore: z.number(),
  attemptsOnInteraction: z.number(),
  /** Hook: confident (3) and wrong. */
  plotTwist: z.boolean().optional(),
  /** The server-reduced state; the client renders from this. */
  run: RunState,
  now: Millis,
});

/** A card to reopen after a missed checkpoint question. */
export const RevisitTarget = z.object({
  nodeId: NodeId,
  title: z.string(),
  estMinutes: z.number(),
  /** Plain-text prompt of the missed item, never its answer. */
  prompt: z.string().optional(),
});

export const CheckpointOutcome = z.object({
  checkpointId: NodeId,
  passed: z.boolean(),
  size: z.number(),
  right: z.number(),
  /** size − 1 (all but one). */
  needed: z.number(),
  /** Every question right with no hints. */
  perfect: z.boolean(),
  /** Missed → cards to reopen, covered cards first, in topo order. */
  revisit: z.array(RevisitTarget),
  /** Failed attempts including this one (0 when passed). */
  tries: z.number(),
  practice: z.boolean(),
});

export const RunSummary = z.object({
  runId: z.string(),
  kind: RunKind,
  /** Card: true. Checkpoint: the pass rule. Relight: true. */
  passed: z.boolean(),
  /** 0..1 over counted attempts. */
  score: z.number(),
  counted: z.number(),
  /** Card run: [target] the first time it closes, else []. */
  doneNow: z.array(NodeId),
  /** Checkpoint pass: covers + the checkpoint id. */
  litNow: z.array(NodeId),
  /** Ids that went locked → ready (cards and checkpoints). */
  unlocked: z.array(NodeId),
  /** What the "Next" button opens: nextAfter(). */
  next: z.object({ nodeId: NodeId, kind: z.enum(["node", "checkpoint"]) }).optional(),
  checkpoint: CheckpointOutcome.optional(),
  missed: z.array(z.object({ misconception: z.string(), label: z.string(), upstream: NodeId.optional() })),
  cardsScheduled: z.number(),
  nextFadeAt: Millis.optional(),
  /** Relight. */
  relit: z.array(z.object({ packId: PackId, nodeId: NodeId, grade: Grade })).optional(),
  /** Every playable card lit and every checkpoint passed, as of this run (badge moment). */
  mapFinished: z.boolean().optional(),
  now: Millis,
});

export const PackProgress = z.object({
  packId: PackId,
  nodes: z.record(NodeId, NodeProgress),
  /** Server-computed; the client does not recompute. */
  views: z.record(NodeId, NodeView),
  nodeCards: z.record(NodeId, CardState),
  due: z.object({ relight: z.number(), flashcards: z.number() }),
  openRun: z.object({ runId: z.string(), kind: RunKind, target: NodeId.optional() }).optional(),
  lastOpenedAt: Millis.optional(),
  /** "Yesterday's question": a card closed 20–72 h ago, offered once per local day. */
  callback: NodeId.optional(),
  /** Every playable card lit/fading and every playable checkpoint lit. */
  finished: z.boolean(),
  finishedAt: Millis.optional(),
  now: Millis,
});

export const Logbook = z.object({
  canNow: z.array(z.object({ packId: PackId, lineId: LineId, text: z.string() })),
  fieldNotes: z.array(FieldNote),
  usedToThink: z.array(z.object({ packId: PackId, nodeId: NodeId, guess: z.string(), now: z.string() })),
  /** date: "2026-10-20" */
  activity: z.array(z.object({ date: z.string(), count: z.number() })),
  /** Finished maps (derived, never revoked). */
  badges: z.array(
    z.object({ packId: PackId, title: z.string(), world: z.string(), cards: z.number(), finishedAt: Millis }),
  ),
  now: Millis,
});

/** Events for the pure run reducer `reduceRun(run, pack, event, now)` in packages/core/src/run.ts. */
export const RunEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("attempt"),
    input: AttemptInput,
    grade: GradeResult,
    counted: z.boolean(),
    credited: z.number(),
    /** Next item, picked by the server before reducing. */
    next: z.object({ ref: ItemRef, vars: Vars.optional() }).optional(),
  }),
  z.object({ type: z.literal("hint"), interactionId: ItemId, level: z.literal([1, 2, 3]) }),
  z.object({ type: z.literal("assist"), interactionId: ItemId }),
  z.object({ type: z.literal("scratch"), scratch: z.record(z.string(), z.unknown()) }),
  /** Past a read-only beat or card; `screen` / `card` must equal the cursor's (idempotency guard). */
  z.object({ type: z.literal("advance"), screen: z.number().int().optional(), card: z.number().int().optional() }),
  z.object({ type: z.literal("finish") }),
  z.object({ type: z.literal("abandon") }),
]);

export const AttemptRow = z.object({
  id: z.number().optional(),
  runId: z.string(),
  packId: PackId,
  nodeId: NodeId,
  interactionId: z.string(),
  phase: AttemptPhase,
  answer: AnswerValue,
  correct: z.boolean(),
  score: z.number(),
  creditedScore: z.number(),
  counted: z.boolean(),
  confidence: Confidence.optional(),
  hintLevel: HintLevel,
  assisted: z.boolean(),
  vars: Vars.optional(),
  selfRating: SelfRating.optional(),
  ms: z.number(),
  at: Millis,
});

export const ReviewLogRow = z.object({
  cardId: z.string(),
  grade: Grade,
  at: Millis,
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  stability: z.number(),
  difficulty: z.number(),
  source: z.enum(["run", "checkpoint", "relight", "cards", "cli", "legacy"]),
});

export type NodeState = z.infer<typeof NodeState>;
export type NodeView = z.infer<typeof NodeView>;
export type NodeProgress = z.infer<typeof NodeProgress>;
export type CardState = z.infer<typeof CardState>;
export type FieldNote = z.infer<typeof FieldNote>;
export type RunKind = z.infer<typeof RunKind>;
export type RunPhase = z.infer<typeof RunPhase>;
export type AttemptPhase = z.infer<typeof AttemptPhase>;
export type ItemRef = z.infer<typeof ItemRef>;
export type RunCursor = z.infer<typeof RunCursor>;
export type HintLevel = z.infer<typeof HintLevel>;
export type Vars = z.infer<typeof Vars>;
export type RunState = z.infer<typeof RunState>;
export type AttemptInput = z.infer<typeof AttemptInput>;
export type AttemptResult = z.infer<typeof AttemptResult>;
export type RevisitTarget = z.infer<typeof RevisitTarget>;
export type CheckpointOutcome = z.infer<typeof CheckpointOutcome>;
export type RunSummary = z.infer<typeof RunSummary>;
export type PackProgress = z.infer<typeof PackProgress>;
export type Logbook = z.infer<typeof Logbook>;
export type RunEvent = z.infer<typeof RunEvent>;
export type AttemptRow = z.infer<typeof AttemptRow>;
export type ReviewLogRow = z.infer<typeof ReviewLogRow>;
