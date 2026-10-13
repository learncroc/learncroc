/**
 * Accessible names for map entries (03 §6, 02 §1.4) and the polite change announcements.
 *
 * Cards: "Attention. Ready. Meaning line. Needs Embeddings (lit) and Next token (lit). Opens Transformer.
 * About 5 minutes." Gates: "Checkpoint: The guessing loop. Locked. Close Sampling and Context window to
 * open it. 4 questions, pass with 3." Shared by StopLayer and ListView. Every state word goes through
 * `stateLabel`, so a gate never reads "Lit".
 */
import type { CompiledMap, NodeId, NodeView } from "@learncroc/core";
import { announce, STATE_LABEL, stateLabel } from "@learncroc/ui";
import { gateCovers, gateSize, mapGraph, satisfies, viewFor } from "./graph";

/** "a", "a and b", "a, b and c" */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Ready, suggested". A gate's lit state reads "Open". */
export function stateWord(view: NodeView, gate: boolean): string {
  const base = stateLabel(gate ? "checkpoint" : "node", view.state);
  const extra = [
    view.durable && !gate ? STATE_LABEL.durable.toLowerCase() : "",
    view.revisit && !gate ? "worth a second look" : "",
    view.suggested ? "suggested" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return extra ? `${base}, ${extra}` : base;
}

export function lineTitle(map: CompiledMap, id: NodeId): string {
  const node = map.nodes[id];
  const line = map.lines.find((l) => l.id === node?.line);
  if (!line) return "";
  return /\bline$/i.test(line.title) ? line.title : `${line.title} line`;
}

const titleOf = (map: CompiledMap, id: NodeId) => map.nodes[id]?.title ?? id;

/** "Checkpoint: The guessing loop". */
export function gateName(map: CompiledMap, id: NodeId): string {
  return `Checkpoint: ${titleOf(map, id)}`;
}

/** The covered cards of a gate that are not Done yet (what to close to open it). */
export function gateMissing(map: CompiledMap, views: Record<NodeId, NodeView>, id: NodeId): NodeId[] {
  return gateCovers(map, id).filter((c) => !satisfies(viewFor(map, views, c).state));
}

/** "Close Sampling and Context window to open it." for a Locked gate. */
export function gateHint(map: CompiledMap, views: Record<NodeId, NodeView>, id: NodeId): string {
  const view = viewFor(map, views, id);
  if (view.state === "lit" || view.state === "done" || view.state === "fading") return "Open, passed.";
  if (view.state === "ready" || view.state === "in-progress") return "Ready to start.";
  const missing = gateMissing(map, views, id);
  if (missing.length === 0) return "Opens after the earlier checkpoint.";
  return `Close ${listJoin(missing.map((m) => titleOf(map, m)))} to open it.`;
}

export function describeStop(map: CompiledMap, views: Record<NodeId, NodeView>, id: NodeId): string {
  const node = map.nodes[id];
  if (!node) return id;
  const view = viewFor(map, views, id);
  if (node.kind === "checkpoint") {
    const parts = [gateName(map, id), stateWord(view, true)];
    if (node.status === "planned") return `${parts.join(". ")}. Planned.`;
    const hint = gateHint(map, views, id);
    if (view.state === "locked") parts.push(hint.replace(/\.$/, ""));
    const size = gateSize(map, id);
    parts.push(`${size} questions, pass with ${size - 1}`);
    return `${parts.join(". ")}.`;
  }
  const g = mapGraph(map);
  const parts: string[] = [node.title, stateWord(view, false)];
  const line = lineTitle(map, id);
  if (line) parts.push(line);
  const needs = g.prereqs.get(id) ?? [];
  if (needs.length)
    parts.push(
      `Needs ${listJoin(needs.map((n) => (map.nodes[n]?.kind === "checkpoint" ? gateName(map, n) : `${titleOf(map, n)} (${stateLabel(map.nodes[n]?.kind, viewFor(map, views, n).state).toLowerCase()})`)))}`,
    );
  const opens = g.dependents.get(id) ?? [];
  if (opens.length)
    parts.push(
      `Opens ${listJoin(opens.map((n) => (map.nodes[n]?.kind === "checkpoint" ? gateName(map, n) : titleOf(map, n))))}`,
    );
  if (view.fadingPrereqs.length) parts.push(`${listJoin(view.fadingPrereqs.map((n) => titleOf(map, n)))} fading`);
  if (node.estMinutes && node.status === "playable") parts.push(`About ${Math.round(node.estMinutes)} minutes`);
  return `${parts.join(". ")}.`;
}

/**
 * The sentence for state changes between two view snapshots, in map order:
 * "Checkpoint passed. Tokens and Embeddings are lit. Next token is ready." Cards that close say
 * "Tokens done." Empty when nothing changed.
 */
export function describeChanges(
  map: CompiledMap,
  before: Record<NodeId, NodeView>,
  after: Record<NodeId, NodeView>,
): string {
  const order = map.topo.length ? map.topo : Object.keys(map.nodes);
  const passed: NodeId[] = [];
  const lit: NodeId[] = [];
  const done: NodeId[] = [];
  const ready: NodeId[] = [];
  const fading: NodeId[] = [];
  for (const id of order) {
    const a = before[id]?.state;
    const b = after[id]?.state;
    if (!b || a === b || a === undefined) continue;
    const gate = map.nodes[id]?.kind === "checkpoint";
    if (gate) {
      if (b === "lit") passed.push(id);
      else if (b === "ready" && a === "locked") ready.push(id);
      continue;
    }
    if (b === "lit") lit.push(id);
    else if (b === "done") done.push(id);
    else if (b === "ready" && a === "locked") ready.push(id);
    else if (b === "fading") fading.push(id);
  }
  const t = (ids: NodeId[]) =>
    listJoin(ids.map((id) => (map.nodes[id]?.kind === "checkpoint" ? gateName(map, id) : titleOf(map, id))));
  const out: string[] = [];
  if (passed.length) out.push(passed.length === 1 ? "Checkpoint passed." : `${passed.length} checkpoints passed.`);
  if (lit.length) out.push(`${t(lit)} ${lit.length === 1 ? "is" : "are"} lit.`);
  if (done.length) out.push(`${t(done)} done.`);
  if (ready.length) out.push(`${t(ready)} ${ready.length === 1 ? "is" : "are"} ready.`);
  if (fading.length) out.push(`${t(fading)} ${fading.length === 1 ? "is" : "are"} fading.`);
  return out.join(" ");
}

/** Say a map change through the app's one shared polite live region. */
export function announceMap(text: string, key = "map"): void {
  if (text) announce(text, { key });
}
