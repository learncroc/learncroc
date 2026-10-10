/**
 * Map states. Server-computed; clients render `PackProgress.views`.
 *
 * Cards: locked ("Later") → ready → in-progress → done (closed; no Lumen) → lit (its checkpoint passed)
 * → fading (node-card retrievability below LIT_THRESHOLD). A done card satisfies other cards' `requires`
 * and never re-locks.
 * Checkpoints: locked until every id in `requires ∪ covers` is met → ready → in-progress → lit (passed;
 * UI label "Open", never fades). A checkpoint is also met when every card it covers is already lit (the
 * legacy and import rule), so earlier learners are never re-gated.
 * planned / building come from the compiled map.
 */
import { nextCardInOrder } from "./card";
import { LIT_THRESHOLD, retrievability } from "./fsrs";
import type {
  CardState,
  CompiledMap,
  CompiledPack,
  Millis,
  NodeId,
  NodeProgress,
  NodeState,
  NodeView,
} from "./schema/index";

/** kv `checkpoint:<pack>:<cp>`: what a gate remembers between attempts (deleted on pass). */
export interface CheckpointRecord {
  /** Failed attempts. */
  tries: number;
  /** "nodeId/itemId" across attempts. */
  asked: string[];
  /** "nodeId/itemId" → vars used (parametric freshness). */
  vars: Record<string, Record<string, number>[]>;
  /** Last attempt's missed cards (plan priority). */
  missed: NodeId[];
  /** Still to reopen; a finished card run removes its id. */
  revisit: NodeId[];
  lastRunId: string;
  at: Millis;
}

export interface NodeViewsInput {
  pack: Pick<CompiledPack, "map" | "manifest">;
  progress: Readonly<Record<NodeId, NodeProgress>>;
  /** Node cards keyed by node id. */
  nodeCards: Readonly<Record<NodeId, CardState>>;
  now: Millis;
  /** settings.learning.targetRetention (affects the FSRS curve only marginally). */
  retention?: number;
  /** Open, engaged runs: card runs with a guess, checkpoint runs with cursor.item ≥ 1. */
  openTargets?: readonly NodeId[];
  /** Checkpoint records keyed by checkpoint id. */
  checkpoints?: Readonly<Record<NodeId, CheckpointRecord>>;
}

/** Is `id` satisfied as a prerequisite? Sticky: never re-locks. */
export function isMet(
  map: Pick<CompiledMap, "nodes">,
  progress: Readonly<Record<NodeId, NodeProgress>>,
  id: NodeId,
): boolean {
  const entry = map.nodes[id];
  const status = progress[id]?.status;
  if (entry?.kind === "checkpoint") {
    if (status === "lit") return true;
    const covers = entry.covers ?? [];
    return covers.length > 0 && covers.every((c) => progress[c]?.status === "lit");
  }
  return status === "done" || status === "lit";
}

/** Every entry's view, keyed by id, in topological order. */
export function nodeViews(input: NodeViewsInput): Record<NodeId, NodeView> {
  const { pack, progress, nodeCards, now } = input;
  const map = pack.map;
  const opts = { retention: input.retention };
  const open = new Set(input.openTargets ?? []);
  const records = input.checkpoints ?? {};
  const revisit = new Set(Object.values(records).flatMap((r) => r.revisit));
  const views: Record<NodeId, NodeView> = {};
  const order = map.topo.length ? map.topo : Object.keys(map.nodes);

  for (const id of order) {
    const node = map.nodes[id];
    if (!node) continue;
    const p = progress[id];
    const view: NodeView = {
      id,
      state: "locked",
      brightness: 0,
      durable: (p?.relightsOk ?? 0) >= 1,
      suggested: false,
      missing: [],
      fadingPrereqs: [],
    };
    if (node.status === "planned" || node.status === "building") {
      view.state = node.status;
      views[id] = view;
      continue;
    }
    if (node.kind === "checkpoint") {
      const missing = [...new Set([...node.requires, ...(node.covers ?? [])])].filter((r) => !isMet(map, progress, r));
      if (isMet(map, progress, id)) {
        view.state = "lit";
        view.brightness = 1;
      } else if (missing.length) {
        view.missing = missing;
      } else {
        view.state = open.has(id) ? "in-progress" : "ready";
        view.tries = records[id]?.tries ?? 0;
      }
      views[id] = view;
      continue;
    }
    const missing = node.requires.filter((r) => !isMet(map, progress, r));
    if (p?.status === "lit") {
      const card = nodeCards[id];
      if (!card) {
        view.state = "lit";
        view.brightness = 1;
      } else {
        const r = retrievability(card, now, opts);
        view.retrievability = r;
        if (r >= LIT_THRESHOLD) {
          view.state = "lit";
          view.brightness = 1;
        } else {
          view.state = "fading";
          view.brightness = r;
        }
      }
    } else if (p?.status === "done") {
      view.state = "done";
    } else if (missing.length) {
      view.missing = missing;
    } else {
      view.state = p?.status === "started" || open.has(id) ? "in-progress" : "ready";
    }
    if ((view.state === "done" || view.state === "lit" || view.state === "fading") && revisit.has(id))
      view.revisit = true;
    views[id] = view;
  }

  // Nudges: a ready entry whose prerequisite is fading ("relight it first?").
  for (const view of Object.values(views)) {
    if (view.state !== "ready" && view.state !== "in-progress") continue;
    const node = map.nodes[view.id];
    view.fadingPrereqs = (node?.requires ?? []).filter((r) => views[r]?.state === "fading");
  }

  const suggested = suggestedStop(views, order, pack.manifest.entry.suggestedStart, pack);
  if (suggested) (views[suggested] as NodeView).suggested = true;
  return views;
}

/** Suggested: in-progress (topo) → revisit card → ready checkpoint → suggestedStart if ready → first ready card. */
export function suggestedStop(
  views: Readonly<Record<NodeId, NodeView>>,
  order: readonly NodeId[],
  suggestedStart: NodeId | undefined,
  pack: Pick<CompiledPack, "map">,
): NodeId | undefined {
  const isGate = (id: NodeId) => pack.map.nodes[id]?.kind === "checkpoint";
  const inState = (s: NodeState) => order.filter((id) => views[id]?.state === s);
  const inProgress = inState("in-progress");
  if (inProgress[0]) return inProgress[0];
  const revisit = order.find((id) => views[id]?.revisit && !isGate(id));
  if (revisit) return revisit;
  const ready = inState("ready");
  const gate = ready.find(isGate);
  if (gate) return gate;
  if (suggestedStart && views[suggestedStart]?.state === "ready") return suggestedStart;
  return ready.find((id) => !isGate(id));
}

/** Locked → ready transitions (cards and checkpoints), for RunSummary.unlocked and the map light-up. */
export function newlyUnlocked(
  before: Readonly<Record<NodeId, NodeView>>,
  after: Readonly<Record<NodeId, NodeView>>,
): NodeId[] {
  return Object.keys(after).filter((id) => before[id]?.state === "locked" && after[id]?.state === "ready");
}

const OPENABLE = new Set<NodeState>(["ready", "in-progress"]);

/**
 * After closing or passing `from`: the next card in reading order if it is ready or in progress; else the
 * ready checkpoint that gates it (or that covers `from`); else the suggested stop.
 */
export function nextAfter(
  pack: Pick<CompiledPack, "map" | "manifest">,
  views: Readonly<Record<NodeId, NodeView>>,
  from: NodeId,
): { nodeId: NodeId; kind: "node" | "checkpoint" } | undefined {
  const map = pack.map;
  const kindOf = (id: NodeId): "node" | "checkpoint" => (map.nodes[id]?.kind === "checkpoint" ? "checkpoint" : "node");
  const next = nextCardInOrder(map, from);
  if (next && OPENABLE.has(views[next]?.state as NodeState)) return { nodeId: next, kind: "node" };
  const gates = [
    ...(next ? (views[next]?.missing ?? []) : []),
    ...map.topo.filter((id) => map.nodes[id]?.kind === "checkpoint" && map.nodes[id]?.covers?.includes(from)),
  ];
  const gate = gates.find((id) => kindOf(id) === "checkpoint" && OPENABLE.has(views[id]?.state as NodeState));
  if (gate) return { nodeId: gate, kind: "checkpoint" };
  const s = suggestedStop(views, map.topo, pack.manifest.entry.suggestedStart, pack);
  return s && s !== from ? { nodeId: s, kind: kindOf(s) } : undefined;
}

/** Every playable card lit/fading and every playable checkpoint lit (false for an empty map). */
export function isMapFinished(pack: Pick<CompiledPack, "map">, views: Readonly<Record<NodeId, NodeView>>): boolean {
  let cards = 0;
  for (const [id, node] of Object.entries(pack.map.nodes)) {
    if (node.status !== "playable") continue;
    const state = views[id]?.state;
    if (node.kind === "checkpoint") {
      if (state !== "lit") return false;
    } else {
      cards++;
      if (state !== "lit" && state !== "fading") return false;
    }
  }
  return cards > 0;
}
