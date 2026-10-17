/**
 * The building view's state, folded from the job's event stream (replayable: a reconnect resets
 * and replays every event). Pure, so it is tested without a browser.
 */

import { layoutMap } from "@learncroc/ai/layout";
import type { CompiledMap, JobEvent, JobStage, NodeId, PlanNode } from "@learncroc/core";

export type StopStatus = "found" | "ready" | "failed";

/** A card as the pipeline plans and writes it. */
export interface SurveyStop {
  id: NodeId;
  title: string;
  landmark?: string;
  requires: NodeId[];
  paras: string[];
  status: StopStatus;
  /** Arrival order (drives the stagger and the line colour). */
  order: number;
  /** 0-based section (cards before the same checkpoint). */
  section?: number;
  figures: { screenId: string; ok: boolean; reason?: string }[];
  message?: string;
  lint?: { errors: number; warnings: number };
  /** cardWords().total once written. */
  words?: number;
  /** What the quality checks did ("Close rewritten to answer the hook", "Left out: …"). */
  notes: string[];
}

export interface SurveyCheckpoint {
  id: NodeId;
  requires: NodeId[];
  covers: NodeId[];
  size: number;
}

export interface SurveyState {
  stages: Record<JobStage, "idle" | "active" | "done">;
  meta?: { title: string; site?: string; words: number; paragraphs: number; headings: string[] };
  stops: SurveyStop[];
  checkpoints: SurveyCheckpoint[];
  edges: { from: NodeId; to: NodeId }[];
  /** paragraph id → card id that came from it (the highlighter colour). */
  highlights: Record<string, NodeId>;
  /** The paragraph highlighted most recently (the reader scrolls to it). */
  lastHighlight?: { para: string; nodeId?: NodeId; seq: number };
  map?: CompiledMap;
  done?: Extract<JobEvent, { type: "done" }>;
  error?: Extract<JobEvent, { type: "error" }>;
  /** Events applied (for keys and replay checks). */
  seq: number;
}

export const STAGES: JobStage[] = ["fetch", "extract", "plan", "cards", "figures", "checkpoints", "write"];

export function initialSurvey(): SurveyState {
  return {
    stages: Object.fromEntries(STAGES.map((s) => [s, "idle"])) as SurveyState["stages"],
    stops: [],
    checkpoints: [],
    edges: [],
    highlights: {},
    seq: 0,
  };
}

function updateStop(s: SurveyState, id: NodeId, f: (st: SurveyStop) => SurveyStop): SurveyStop[] {
  return s.stops.map((st) => (st.id === id ? f(st) : st));
}

function stopFrom(node: PlanNode, order: number): SurveyStop {
  return {
    id: node.id,
    title: node.title,
    ...(node.landmark ? { landmark: node.landmark } : {}),
    requires: node.requires,
    paras: node.paras,
    status: "found",
    order,
    section: node.section,
    figures: [],
    notes: [],
  };
}

type CheckEvent = Extract<JobEvent, { type: "check" }>;

/** The note a quality check leaves on its card row (03 §4.8.2), or null when nothing changed. */
export function checkNote(check: CheckEvent["check"], action: CheckEvent["action"]): string | null {
  if (action === "kept") return null;
  if (action === "split") return "Split into two cards";
  if (action === "merged") return "Merged with a neighbouring card";
  if (action === "repaired") {
    return {
      "hook-close": "Close rewritten to answer the hook",
      grounded: "A claim rewritten to match the article",
      giveaway: "Title rewritten so it doesn't give the answer away",
      teaser: "Teaser rewritten to open the next card",
      words: "Trimmed to fit one card",
    }[check];
  }
  return {
    "hook-close": "Left out: the close didn't answer its question.",
    grounded: "Left out: the article didn't back it up.",
    giveaway: "Left out: the title gave the answer away.",
    teaser: "Left out: it didn't lead anywhere.",
    words: "Left out: too little to say on its own.",
  }[check];
}

export function surveyReducer(s: SurveyState, e: JobEvent): SurveyState {
  const next: SurveyState = { ...s, seq: s.seq + 1 };
  switch (e.type) {
    case "stage":
      next.stages = { ...s.stages, [e.stage]: e.status === "start" ? "active" : "done" };
      return next;
    case "meta":
      next.meta = {
        title: e.title,
        ...(e.site ? { site: e.site } : {}),
        words: e.words,
        paragraphs: e.paragraphs,
        headings: e.headings,
      };
      return next;
    case "highlight": {
      const h = { ...s.highlights };
      for (const p of e.paras) if (e.nodeId && !h[p]) h[p] = e.nodeId;
      next.highlights = h;
      const first = e.paras[0];
      if (first) next.lastHighlight = { para: first, ...(e.nodeId ? { nodeId: e.nodeId } : {}), seq: next.seq };
      return next;
    }
    case "plan-node":
      if (s.stops.some((st) => st.id === e.node.id)) return next;
      next.stops = [...s.stops, stopFrom(e.node, s.stops.length)];
      return next;
    case "plan-update": {
      const removed = new Set(e.removed);
      const kept = s.stops.filter((st) => !removed.has(st.id));
      const updated = new Map(e.added.map((n) => [n.id, n]));
      // Re-derived sections update existing cards in place; new ids are appended.
      const merged = kept.map((st) => {
        const n = updated.get(st.id);
        return n ? { ...st, title: n.title, requires: n.requires, paras: n.paras, section: n.section } : st;
      });
      let order = s.stops.length;
      for (const n of e.added) if (!merged.some((st) => st.id === n.id)) merged.push(stopFrom(n, order++));
      next.stops = merged;
      next.edges = s.edges.filter((x) => !removed.has(x.from) && !removed.has(x.to));
      return next;
    }
    case "plan-checkpoint": {
      const cp = e.checkpoint;
      next.checkpoints = [...s.checkpoints.filter((c) => c.id !== cp.id), cp];
      return next;
    }
    case "plan-edge":
      if (s.edges.some((x) => x.from === e.from && x.to === e.to)) return next;
      next.edges = [...s.edges, { from: e.from, to: e.to }];
      next.stops = updateStop(s, e.to, (st) =>
        st.requires.includes(e.from) ? st : { ...st, requires: [...st.requires, e.from] },
      );
      return next;
    case "layout":
      next.map = e.map;
      return next;
    case "card-ready":
      next.stops = updateStop(s, e.nodeId, (st) => ({ ...st, status: "ready", lint: e.lint, words: e.words }));
      return next;
    case "card-failed":
      next.stops = updateStop(s, e.nodeId, (st) => ({ ...st, status: "failed", message: e.message }));
      return next;
    case "check": {
      const note = e.ok ? null : checkNote(e.check, e.action);
      if (!note) return next;
      next.stops = updateStop(s, e.nodeId, (st) =>
        st.notes.includes(note) ? st : { ...st, notes: [...st.notes, note] },
      );
      return next;
    }
    case "figure":
      next.stops = updateStop(s, e.nodeId, (st) => ({
        ...st,
        figures: [
          ...st.figures.filter((f) => f.screenId !== e.screenId),
          { screenId: e.screenId, ok: e.ok, ...(e.reason ? { reason: e.reason } : {}) },
        ],
      }));
      return next;
    case "done":
      next.done = e;
      return next;
    case "error":
      next.error = e;
      return next;
  }
}

/** Positions for the cards and checkpoints known so far: the final layout once it exists, else a provisional one. */
export function surveyLayout(s: SurveyState): {
  width: number;
  height: number;
  nodes: Record<NodeId, { x: number; y: number }>;
  lineIndex: Record<NodeId, number>;
} {
  const input = [
    ...s.stops.map((st) => ({ id: st.id, requires: st.requires })),
    ...s.checkpoints.map((c) => ({ id: c.id, requires: c.requires })),
  ];
  const r = layoutMap(input);
  const lineIndex: Record<NodeId, number> = {};
  for (const [id, line] of Object.entries(r.lineOf)) lineIndex[id] = (Number(line.slice(1)) - 1) % 5;
  const source = s.map?.layout ?? r.layout;
  // The building map is drawn roomier than the compiled grid (labels, figure previews), and never
  // smaller than a 4 × 3 sheet, so the first cards don't fill the paper and then shrink.
  const SX = 1.15;
  const SY = 1.45;
  const nodes: Record<NodeId, { x: number; y: number }> = {};
  for (const { id } of input) {
    const p = source.nodes[id] ?? r.layout.nodes[id];
    if (p) nodes[id] = { x: p.x * SX, y: p.y * SY };
  }
  const width = Math.max(source.width * SX, 168 * SX * 3);
  const height = Math.max(source.height * SY, 112 * SY * 2.5);
  const dx = (width - source.width * SX) / 2;
  const dy = (height - source.height * SY) / 2;
  for (const id of Object.keys(nodes)) {
    const n = nodes[id] as { x: number; y: number };
    nodes[id] = { x: n.x + dx, y: n.y + dy };
  }
  return { width, height, nodes, lineIndex };
}

export interface StageLine {
  key: "read" | "plan" | "cards" | "figures" | "checkpoints" | "write";
  label: string;
  detail?: string;
  status: "idle" | "active" | "done";
}

const merge = (a: "idle" | "active" | "done", b: "idle" | "active" | "done") =>
  a === "active" || b === "active"
    ? "active"
    : a === "done" && b === "done"
      ? "done"
      : a === "done" || b === "done"
        ? "active"
        : "idle";

/** The checklist on the right (03 §4.8.2): Read, Plan, Write the cards, Pictures, Checkpoint questions, Save. */
export function stageLines(s: SurveyState): StageLine[] {
  const figs = s.stops.reduce((n, x) => n + x.figures.filter((f) => f.ok).length, 0);
  const cards = s.stops.length;
  const cps = s.checkpoints.length;
  const read: StageLine["status"] = s.stages.extract === "done" ? "done" : merge(s.stages.fetch, s.stages.extract);
  return [
    {
      key: "read",
      label: "Read the article",
      ...(s.meta ? { detail: `${s.meta.words.toLocaleString("en")} words` } : {}),
      status: read,
    },
    {
      key: "plan",
      label: "Plan the map",
      ...(cards
        ? {
            detail: `${cards} ${cards === 1 ? "card" : "cards"}${cps ? `, ${cps} ${cps === 1 ? "checkpoint" : "checkpoints"}` : ""}`,
          }
        : {}),
      status: s.stages.plan,
    },
    { key: "cards", label: "Write the cards", status: s.stages.cards },
    {
      key: "figures",
      label: "Pictures for each beat",
      ...(figs ? { detail: `${figs} drawn` } : {}),
      status: s.stages.figures,
    },
    { key: "checkpoints", label: "Checkpoint questions", status: s.stages.checkpoints },
    { key: "write", label: "Save", status: s.stages.write },
  ];
}

/** Cards in map order (the final topo once the layout exists, else arrival order). */
export function cardsInOrder(s: SurveyState): SurveyStop[] {
  const order = s.map?.topo ?? s.stops.map((x) => x.id);
  const byId = new Map(s.stops.map((x) => [x.id, x]));
  const out: SurveyStop[] = [];
  for (const id of order) {
    const st = byId.get(id);
    if (st) out.push(st);
  }
  for (const st of s.stops) if (!out.includes(st)) out.push(st);
  return out;
}

/** The first playable card in map order. */
export function firstPlayable(s: SurveyState): SurveyStop | undefined {
  return cardsInOrder(s).find((st) => st.status === "ready");
}
