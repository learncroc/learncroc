/**
 * The run reducer. Pure. Used by the server (authoritative) and by the client to render server responses.
 * It never picks items: the server passes the next item in the `attempt` event and the reducer only moves
 * the cursor.
 *
 * Phase machines, by run kind:
 * - card (and try):  hook ──attempt──► screen[0] … screen[n-1] ──► close ──finish──► done.
 *                    A beat with an interaction advances when correct, or on any answer once the worked
 *                    solution was shown (hint level 3; the server applies it after the second miss).
 *                    A read-only beat advances only with `advance { screen }`.
 * - card with `cards`: card[0] … card[n-1] ──► close ──finish──► done (finish is also allowed on the last
 *                    card when it is read-only). intro/ask/teach/takeaway move on with `advance { card }`;
 *                    an ask card may instead take an attempt carrying the hunch (recorded as the guess,
 *                    never graded). try: beat rules. check: one shot, any answer moves on.
 * - checkpoint:      checkpoint (item 0..size-1, one shot each, any result moves on) ──► done ──finish──►.
 * - relight:         one item at a time while `next` is given, then done; finish allowed any time.
 */
import type {
  Card,
  CompiledPack,
  ItemRef,
  Millis,
  NodeId,
  PackNode,
  RunCursor,
  RunEvent,
  RunPhase,
  RunState,
} from "./schema/index";

export type RunErrorCode = "finished" | "phase" | "interaction" | "not_found";

/** An event that doesn't fit the run's state (the server answers 409 conflict). */
export class RunError extends Error {
  constructor(
    readonly code: RunErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RunError";
  }
}

/** The worked solution is shown at this hint level; any later answer moves on. */
export const SOLUTION_HINT_LEVEL = 3;

/** The card a run plays (card runs only). */
export function runNode(run: Pick<RunState, "kind" | "target">, pack: CompiledPack): PackNode | undefined {
  return run.kind === "card" && run.target ? pack.nodes[run.target] : undefined;
}

export interface CardAt {
  card: Card;
  index: number;
  total: number;
}

/** The typed card the cursor is on (phase "card" on a node with `cards`), or undefined. */
export function cardAt(run: Pick<RunState, "cursor">, node: Pick<PackNode, "cards"> | undefined): CardAt | undefined {
  if (run.cursor.phase !== "card" || !node?.cards) return undefined;
  const index = run.cursor.card ?? 0;
  const card = node.cards[index];
  return card ? { card, index, total: node.cards.length } : undefined;
}

/** Cards that move on with `advance { card }` (no graded action). */
export function isReadOnlyCard(card: Card): boolean {
  return card.type !== "try" && card.type !== "check";
}

export interface ExpectedInteraction {
  phase: Exclude<RunPhase, "close" | "done">;
  nodeId: NodeId;
  packId?: string;
  interactionId: string;
}

/** The interaction the run is waiting for, or null (close, done, a read-only beat, or nothing current). */
export function expectedInteraction(run: RunState, pack: CompiledPack | null): ExpectedInteraction | null {
  const { cursor } = run;
  switch (cursor.phase) {
    case "checkpoint":
    case "relight": {
      if (!run.current) return null;
      const { ref } = run.current;
      return { phase: cursor.phase, nodeId: ref.nodeId, packId: ref.packId, interactionId: ref.itemId };
    }
    case "hook": {
      const node = pack ? runNode(run, pack) : undefined;
      return node ? { phase: "hook", nodeId: node.id, interactionId: node.hook.interaction.id } : null;
    }
    case "screen": {
      const node = pack ? runNode(run, pack) : undefined;
      const ix = node?.screens[cursor.screen ?? -1]?.interaction;
      return node && ix ? { phase: "screen", nodeId: node.id, interactionId: ix.id } : null;
    }
    case "card": {
      const node = pack ? runNode(run, pack) : undefined;
      const at = cardAt(run, node);
      if (!node || !at) return null;
      const { card } = at;
      if (card.type === "try" || card.type === "check")
        return { phase: "card", nodeId: node.id, interactionId: card.interaction.id };
      if (card.type === "ask") return { phase: "card", nodeId: node.id, interactionId: card.id };
      return null;
    }
    default:
      return null;
  }
}

/** The interaction id being worked on now (hints and the croc attach to it). */
export function currentInteractionId(run: RunState, pack: CompiledPack | null): string | undefined {
  return expectedInteraction(run, pack)?.interactionId;
}

// ── construction

export interface CreateRunInput {
  id: string;
  kind: RunState["kind"];
  /** null for cross-pack relight. */
  pack: CompiledPack | null;
  packId?: RunState["packId"];
  packVersion?: RunState["packVersion"];
  target?: NodeId;
  now: Millis;
  seed: number;
  /** First item (checkpoint, relight). */
  current?: RunState["current"];
  /** Checkpoint: questions in this attempt. */
  size?: number;
  /** Checkpoint: practice re-run of a passed gate. */
  practice?: boolean;
  /** Card: replay of a done/lit/fading card (the guess pinned from an earlier run). */
  replay?: boolean;
  /** Card: a pinned guess (replay, or a guess locked before the card opened); starts at beat 0. */
  guess?: RunState["guess"];
  /** Card: the checkpoint a revisit returns to. */
  from?: NodeId;
  /** Card with a pinned guess: the beat to open at (a revisit opens at the beat behind the missed question). */
  startScreen?: number;
}

/** A new run positioned at its first step (the server persists it; the reducer takes it from here). */
export function createRun(a: CreateRunInput): RunState {
  const run: RunState = {
    id: a.id,
    kind: a.kind,
    packId: a.packId ?? a.pack?.manifest.id ?? "*",
    packVersion: a.packVersion ?? a.pack?.manifest.version ?? "*",
    cursor: { phase: "done" },
    queue: [],
    hints: {},
    assisted: [],
    seed: a.seed >>> 0,
    startedAt: a.now,
  };
  if (a.target !== undefined) run.target = a.target;
  switch (a.kind) {
    case "relight":
      return a.current
        ? { ...run, cursor: { phase: "relight", item: 0 }, current: a.current, queue: [a.current.ref] }
        : run;
    case "checkpoint": {
      if (!a.current || a.size === undefined)
        throw new RunError("not_found", "a checkpoint run needs its first question and size");
      return {
        ...run,
        cursor: { phase: "checkpoint", item: 0 },
        current: a.current,
        queue: [a.current.ref],
        size: a.size,
        ...(a.practice ? { practice: true } : {}),
      };
    }
    case "card": {
      const node = a.pack && a.target ? a.pack.nodes[a.target] : undefined;
      if (!node) throw new RunError("not_found", `no playable card "${a.target}"`);
      if (a.replay) run.replay = true;
      if (a.from !== undefined) run.from = a.from;
      if (node.cards?.length)
        return { ...run, ...(a.guess ? { guess: a.guess } : {}), cursor: { phase: "card", card: 0 } };
      if (a.guess) {
        const start = Math.max(0, Math.min(a.startScreen ?? 0, node.screens.length - 1));
        return { ...run, guess: a.guess, cursor: afterScreen(node, start - 1) };
      }
      return { ...run, cursor: { phase: "hook" } };
    }
  }
}

// ── cursor helpers

/** The cursor after beat `index` (-1 = after the hook): the next beat, or the close. */
function afterScreen(node: PackNode, index: number): RunCursor {
  return index + 1 < node.screens.length ? { phase: "screen", screen: index + 1 } : { phase: "close" };
}

/** The cursor after card `index`: the next card, or the close. */
function afterCard(node: PackNode, index: number): RunCursor {
  return index + 1 < (node.cards?.length ?? 0) ? { phase: "card", card: index + 1 } : { phase: "close" };
}

/** Keep the client's widget scratch across cursor moves. */
function withScratch(run: RunState, cursor: RunCursor): RunCursor {
  return run.cursor.scratch ? { ...cursor, scratch: run.cursor.scratch } : cursor;
}

/**
 * Move to the next checkpoint or Relight question. Hints and assists are keyed by item id, and item
 * ids repeat across cards (`i4` on two cards), so the new question starts with a clean count.
 */
function pushCurrent(run: RunState, next: { ref: ItemRef; vars?: Record<string, number> }): RunState {
  const id = next.ref.itemId;
  const { [id]: _old, ...hints } = run.hints;
  const assisted = run.assisted.filter((a) => a !== id);
  return { ...run, hints, assisted, current: next, queue: [...run.queue, next.ref] };
}

function assertOpen(run: RunState): void {
  if (run.finishedAt !== undefined) throw new RunError("finished", `run ${run.id} is finished`);
}

const hintOf = (run: RunState, id: string) => run.hints[id] ?? 0;

// ── the reducer

export function reduceRun(run: RunState, pack: CompiledPack | null, event: RunEvent, now: Millis): RunState {
  switch (event.type) {
    case "scratch":
      assertOpen(run);
      return { ...run, cursor: { ...run.cursor, scratch: { ...run.cursor.scratch, ...event.scratch } } };
    case "hint": {
      assertOpen(run);
      const level = Math.max(hintOf(run, event.interactionId), event.level) as 0 | 1 | 2 | 3;
      return { ...run, hints: { ...run.hints, [event.interactionId]: level } };
    }
    case "assist":
      assertOpen(run);
      return run.assisted.includes(event.interactionId)
        ? run
        : { ...run, assisted: [...run.assisted, event.interactionId] };
    case "advance": {
      assertOpen(run);
      const node = pack ? runNode(run, pack) : undefined;
      if (event.card !== undefined) {
        const at = cardAt(run, node);
        if (!node || !at || at.index !== event.card || !isReadOnlyCard(at.card))
          throw new RunError("phase", `run ${run.id} isn't on read-only card ${event.card}`);
        return { ...run, cursor: withScratch(run, afterCard(node, at.index)) };
      }
      const index = run.cursor.screen;
      if (
        !node ||
        run.cursor.phase !== "screen" ||
        index === undefined ||
        index !== event.screen ||
        node.screens[index]?.interaction
      )
        throw new RunError("phase", `run ${run.id} isn't on read-only beat ${event.screen}`);
      return { ...run, cursor: withScratch(run, afterScreen(node, index)) };
    }
    case "abandon":
      assertOpen(run);
      return close(run, now);
    case "finish": {
      assertOpen(run);
      const ok =
        run.kind === "relight" ||
        (run.kind === "card" && run.cursor.phase === "close") ||
        (run.kind === "card" && onLastReadOnlyCard(run, pack)) ||
        (run.kind === "checkpoint" && run.cursor.phase === "done");
      if (!ok) throw new RunError("phase", `run ${run.id} can't finish during "${run.cursor.phase}"`);
      return close(run, now);
    }
    case "attempt":
      assertOpen(run);
      return reduceAttempt(run, pack, event);
  }
}

function onLastReadOnlyCard(run: RunState, pack: CompiledPack | null): boolean {
  const at = cardAt(run, pack ? runNode(run, pack) : undefined);
  return !!at && at.index === at.total - 1 && isReadOnlyCard(at.card);
}

function close(run: RunState, now: Millis): RunState {
  const { current: _current, ...rest } = run;
  return { ...rest, cursor: { phase: "done" }, finishedAt: now };
}

function reduceAttempt(
  run: RunState,
  pack: CompiledPack | null,
  event: Extract<RunEvent, { type: "attempt" }>,
): RunState {
  const expected = expectedInteraction(run, pack);
  const { input, grade, next } = event;
  if (!expected || expected.phase !== input.phase)
    throw new RunError("phase", `run ${run.id} is in "${run.cursor.phase}", not "${input.phase}"`);
  if (expected.interactionId !== input.interactionId || expected.nodeId !== input.nodeId)
    throw new RunError(
      "interaction",
      `run ${run.id} expects ${expected.nodeId}/${expected.interactionId}, got ${input.nodeId}/${input.interactionId}`,
    );
  const id = input.interactionId;

  switch (expected.phase) {
    case "hook": {
      const node = pack ? runNode(run, pack) : undefined;
      if (!node) throw new RunError("not_found", "the run's card is missing");
      const guess: NonNullable<RunState["guess"]> = { interactionId: id, answer: input.answer, correct: grade.correct };
      if (input.confidence !== undefined) guess.confidence = input.confidence;
      return { ...run, guess, cursor: withScratch(run, afterScreen(node, -1)) };
    }
    case "screen": {
      const node = pack ? runNode(run, pack) : undefined;
      if (!node) throw new RunError("not_found", "the run's card is missing");
      if (!grade.correct && hintOf(run, id) < SOLUTION_HINT_LEVEL) return run;
      return { ...run, cursor: withScratch(run, afterScreen(node, run.cursor.screen ?? -1)) };
    }
    case "card": {
      const node = pack ? runNode(run, pack) : undefined;
      const at = cardAt(run, node);
      if (!node || !at) throw new RunError("not_found", "the run's card is missing");
      const moved = withScratch(run, afterCard(node, at.index));
      switch (at.card.type) {
        case "ask": {
          const guess: NonNullable<RunState["guess"]> = { interactionId: id, answer: input.answer, correct: false };
          if (input.confidence !== undefined) guess.confidence = input.confidence;
          return { ...run, guess, cursor: moved };
        }
        case "try":
          if (!grade.correct && hintOf(run, id) < SOLUTION_HINT_LEVEL) return run;
          return { ...run, cursor: moved };
        default:
          return { ...run, cursor: moved };
      }
    }
    case "checkpoint":
    case "relight": {
      const item = (run.cursor.item ?? 0) + 1;
      if (next) return pushCurrent({ ...run, cursor: withScratch(run, { phase: expected.phase, item }) }, next);
      const { current: _current, ...rest } = run;
      return { ...rest, cursor: withScratch(run, { phase: "done", item }) };
    }
  }
}
