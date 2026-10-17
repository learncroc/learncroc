/**
 * Pure helpers for the map screen: header counts (C20), what a click opens (C5), the peek's copy
 * (03 §4.3.3, §9), the Route panel's sections, the article-map build bar, the moment a run summary
 * plays, and local-day keys for once-a-day things. States always come from `PackProgress.views`;
 * nothing here re-derives them.
 */
import type { CompiledPack, NodeId, NodeView, RunSummary } from "@learncroc/core";
import { sectionsOf, unmetAncestors, viewFor } from "@learncroc/maps";
import { gateName, joinTitles } from "../../croc/mapChips";

export type MapPack = Pick<CompiledPack, "manifest" | "map">;

export { gateName, joinTitles };

const DONE_LIKE = new Set(["done", "lit", "fading"]);
export const isDoneLike = (s: string | undefined) => (s ? DONE_LIKE.has(s) : false);

export interface MapCounts {
  /** Playable cards (checkpoints are counted apart). */
  playable: number;
  done: number;
  lit: number;
  fading: number;
  gates: number;
  open: number;
  /** Planned cards (samplers: beyond the terminus). */
  planned: number;
  allLit: boolean;
}

export function mapCounts(pack: MapPack, views: Record<NodeId, NodeView>): MapCounts {
  const all = Object.values(pack.map.nodes);
  const nodes = all.filter((n) => n.status === "playable");
  const cards = nodes.filter((n) => n.kind !== "checkpoint");
  const gates = nodes.filter((n) => n.kind === "checkpoint");
  const lit = cards.filter((n) => views[n.id]?.state === "lit").length;
  const fading = cards.filter((n) => views[n.id]?.state === "fading").length;
  // Lit and Fading cards were closed first, so they count as done too.
  const done = cards.filter((n) => {
    const st = views[n.id]?.state;
    return st === "done" || st === "lit" || st === "fading";
  }).length;
  const open = gates.filter((n) => views[n.id]?.state === "lit").length;
  return {
    playable: cards.length,
    done,
    lit,
    fading,
    gates: gates.length,
    open,
    planned: all.filter((n) => n.kind === "node" && n.status === "planned").length,
    allLit: cards.length > 0 && lit + fading === cards.length && open === gates.length,
  };
}

/** C20: "{lit} of {total} cards lit · {done} done" (fading cards still count as lit). */
export function countsLine(c: MapCounts): string {
  return `${c.lit + c.fading} of ${c.playable} cards lit · ${c.done} done`;
}

/** The share caption for an unfinished map: "6 of 11 cards lit". */
export function partialCaption(c: MapCounts): string {
  return `${c.lit + c.fading} of ${c.playable} cards lit`;
}

/** Relight takes about 40 s a card, 2 minutes minimum (a hint, not a timer). */
export function relightMinutes(fading: number, due: number): number {
  return Math.max(2, Math.round((Math.max(fading, due) * 40) / 60));
}

export type OpenTarget = "card" | "checkpoint" | "peek";

/**
 * What a click on an entry opens (C5): Ready / In progress / Done / Lit / Fading cards open the card
 * modal (play or replay); Later / Planned / Writing… cards and Locked gates open a peek; Ready and In
 * progress gates open the checkpoint; an Open gate opens a peek with "Practise again".
 */
export function openTarget(pack: MapPack, views: Record<NodeId, NodeView>, id: NodeId): OpenTarget {
  const node = pack.map.nodes[id];
  const state = viewFor(pack.map, views, id).state;
  if (node?.status !== "playable") return "peek";
  if (node.kind === "checkpoint") return state === "ready" || state === "in-progress" ? "checkpoint" : "peek";
  return state === "locked" || state === "planned" || state === "building" ? "peek" : "card";
}

/** The gate a Later card waits behind (the first unmet checkpoint on its way), if any. */
export function blockingGate(pack: MapPack, views: Record<NodeId, NodeView>, id: NodeId): NodeId | undefined {
  const view = viewFor(pack.map, views, id);
  const isGate = (g: NodeId) => pack.map.nodes[g]?.kind === "checkpoint";
  const direct = view.missing.find(isGate);
  if (direct) return direct;
  // The nearest unopened gate upstream: the one this card's section waits behind.
  return unmetAncestors(pack.map, views, id).find(isGate);
}

/** A Locked gate's line: "Close Sampling and Context window to open it" / "Close 3 cards to open it". */
export function gateMissingLine(
  pack: MapPack,
  views: Record<NodeId, NodeView>,
  gateId: NodeId,
  tail = "to open it",
): string | undefined {
  const covers = pack.map.nodes[gateId]?.covers ?? [];
  const missing = covers.filter((c) => !isDoneLike(viewFor(pack.map, views, c).state));
  if (missing.length === 0) return undefined;
  const who =
    missing.length <= 2 ? joinTitles(missing.map((m) => pack.map.nodes[m]?.title ?? m)) : `${missing.length} cards`;
  return `Close ${who} ${tail}`.trim();
}

export interface PeekCopy {
  /** Small line above the title ("Checkpoint"). */
  eyebrow?: string;
  /** The question or tagline under the title, if it may be shown. */
  teaser?: string;
  /** Plain lines. */
  lines: string[];
  minutes?: number;
  /** "route": Show the route. "practise": Practise again (Open gate). */
  actions: ("route" | "practise")[];
}

/** The peek popover's copy (03 §4.3.3, §9; UX §1.8). Later cards never show their hook. */
export function peekCopy(pack: MapPack, views: Record<NodeId, NodeView>, id: NodeId): PeekCopy {
  const node = pack.map.nodes[id];
  if (!node) return { lines: [], actions: [] };
  const view = viewFor(pack.map, views, id);
  const minutes = node.estMinutes;
  const teaser = node.teaser ? { teaser: node.teaser } : {};
  if (node.status === "planned") return { ...teaser, lines: ["Coming later."], actions: [] };
  if (node.status === "building" || view.state === "building")
    return { lines: ["Being written. Usually under a minute."], actions: [] };

  if (node.kind === "checkpoint") {
    const covers = node.covers ?? [];
    const size = node.size ?? Math.min(5, Math.max(3, covers.length + 1));
    const coverTitles = joinTitles(covers.map((c) => pack.map.nodes[c]?.title ?? c));
    const earlier = size > covers.length ? ", plus one from earlier" : "";
    const about = `${size} questions on ${coverTitles || "this section"}${earlier}.`;
    if (view.state === "lit")
      return {
        eyebrow: "Checkpoint",
        lines: ["Open. You passed this one.", "Practice runs change nothing on the map."],
        actions: ["practise"],
      };
    const missing = gateMissingLine(pack, views, id, "first.");
    return {
      eyebrow: "Checkpoint",
      lines: [
        about,
        ...(missing ? [missing] : view.missing.length ? ["Opens when the cards before it are done."] : []),
      ],
      actions: ["route"],
    };
  }

  if (view.state === "done") {
    const gate = node.gate ?? blockingGate(pack, views, id);
    return {
      ...teaser,
      lines: [gate ? `Done. It lights when you pass ${gateName(pack, gate)}.` : "Done."],
      actions: [],
    };
  }
  if (view.state === "locked") {
    const gate = blockingGate(pack, views, id);
    const cards = view.missing.filter((m) => pack.map.nodes[m]?.kind !== "checkpoint");
    const line = gate
      ? `Opens after ${gateName(pack, gate)}`
      : cards.length
        ? `Opens after ${joinTitles(cards.map((m) => pack.map.nodes[m]?.title ?? m))}`
        : "Opens a little later";
    return {
      lines: [line],
      ...(minutes ? { minutes } : {}),
      actions: ["route"],
    };
  }
  return { ...teaser, lines: [], ...(minutes ? { minutes } : {}), actions: [] };
}

export interface RouteRow {
  id: NodeId;
  kind: "node" | "checkpoint";
  title: string;
  state: NodeView["state"];
  revisit: boolean;
  suggested: boolean;
}

export interface RouteSection {
  index: number;
  title: string;
  gate?: NodeId;
  rows: RouteRow[];
  /** "open": every card lit and the gate open. "current": the first section with a closed gate. */
  status: "open" | "current" | "later";
  /** Locked gate: what is missing. */
  missing?: string;
}

/** The Route panel: sections in map order, each with its cards and gate (C21). */
export function routeSections(pack: MapPack, views: Record<NodeId, NodeView>): RouteSection[] {
  const map = pack.map;
  const row = (id: NodeId): RouteRow => {
    const n = map.nodes[id];
    const v = viewFor(map, views, id);
    return {
      id,
      kind: n?.kind ?? "node",
      title: n?.title ?? id,
      state: v.state,
      revisit: Boolean(v.revisit),
      suggested: v.suggested,
    };
  };
  const secs = sectionsOf(map);
  const placed = new Set<NodeId>();
  const out: RouteSection[] = [];
  let currentSeen = false;
  for (const s of secs) {
    const cards = s.cards.filter((c) => map.nodes[c] && map.nodes[c]?.status !== "planned");
    for (const c of cards) placed.add(c);
    placed.add(s.checkpoint);
    const gateState = viewFor(map, views, s.checkpoint).state;
    const open = gateState === "lit";
    const status: RouteSection["status"] = open ? "open" : currentSeen ? "later" : "current";
    if (!open) currentSeen = true;
    const missing = gateState === "locked" ? gateMissingLine(pack, views, s.checkpoint) : undefined;
    out.push({
      index: out.length + 1,
      title: map.nodes[s.checkpoint]?.title ?? `Section ${out.length + 1}`,
      gate: s.checkpoint,
      rows: [...cards.map(row), row(s.checkpoint)],
      status,
      ...(missing ? { missing } : {}),
    });
  }
  // Cards no checkpoint covers (an article map still building, a map with no gates).
  const rest = map.topo.filter(
    (id) => !placed.has(id) && map.nodes[id]?.status !== "planned" && map.nodes[id]?.kind === "node",
  );
  if (rest.length) {
    const status: RouteSection["status"] = currentSeen ? "later" : "current";
    out.push({ index: out.length + 1, title: secs.length ? "More cards" : "Cards", rows: rest.map(row), status });
  }
  return out;
}

/**
 * The article-map build bar (03 §4.3.5): "Writing card 4 of 8 · Checkpoint questions next".
 * Undefined once nothing is building.
 */
export function buildingLine(pack: MapPack & { provisional?: boolean }): string | undefined {
  const cards = Object.values(pack.map.nodes).filter((n) => n.kind === "node" && n.status !== "planned");
  const building = cards.filter((n) => n.status === "building");
  const gatesBuilding = Object.values(pack.map.nodes).some((n) => n.kind === "checkpoint" && n.status === "building");
  if (building.length === 0) return pack.provisional || gatesBuilding ? "Writing the checkpoint questions" : undefined;
  const writing = cards.length - building.length + 1;
  const last = building.length === 1;
  return `Writing card ${writing} of ${cards.length}${last ? " · Checkpoint questions next" : ""}`;
}

export type MapMoment =
  | { kind: "cardDone"; node: NodeId; next?: NodeId; key: number; behind?: boolean; summary: RunSummary }
  | { kind: "gateOpen"; gate: NodeId; lit: NodeId[]; unlocked: NodeId[]; key: number; summary: RunSummary }
  | { kind: "revisit"; from: NodeId; to: NodeId[]; key: number; route?: boolean }
  | { kind: "dawn"; key: number };

let momentSeq = 0;
export const nextMomentKey = () => ++momentSeq;

/** The moment a run summary plays on the map (none for replays and practice). */
export function momentFromSummary(s: RunSummary): MapMoment | null {
  if (s.kind === "card" && s.doneNow[0]) {
    return {
      kind: "cardDone",
      node: s.doneNow[0],
      ...(s.next?.kind === "node" ? { next: s.next.nodeId } : {}),
      key: nextMomentKey(),
      summary: s,
    };
  }
  if (s.kind === "checkpoint" && s.checkpoint) {
    if (s.checkpoint.passed && !s.checkpoint.practice) {
      return {
        kind: "gateOpen",
        gate: s.checkpoint.checkpointId,
        lit: s.litNow.filter((id) => id !== s.checkpoint?.checkpointId),
        unlocked: s.unlocked,
        key: nextMomentKey(),
        summary: s,
      };
    }
    if (!s.checkpoint.passed && s.checkpoint.revisit.length > 0) {
      return {
        kind: "revisit",
        from: s.checkpoint.checkpointId,
        to: s.checkpoint.revisit.map((r) => r.nodeId),
        key: nextMomentKey(),
      };
    }
  }
  return null;
}

/** "2026-10-20" in the learner's local time zone, from server time (`now`). */
export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Small localStorage helpers that never throw (private mode). */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
};
