/**
 * Moss's map chips, answered on the client from pack data: no AI, no network.
 * Every reply stays short and ends with something to try. A peeked Later card gets no spoilers of its
 * close: only its title, what it needs first and the line it belongs to.
 */
import { type CompiledPack, CROC_MAX_WORDS, type NodeId, type NodeView } from "@learncroc/core";
import type { CrocChip } from "./CrocChat";

type MapPack = Pick<CompiledPack, "manifest" | "map">;

const titleOf = (pack: MapPack, id: NodeId) => pack.map.nodes[id]?.title ?? id;

/** "A", "A and B", "A, B and C". */
export function joinTitles(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}

/** "Checkpoint: Text in" (a title that already says so stays as it is). */
export function gateName(pack: MapPack, id: NodeId): string {
  const t = titleOf(pack, id);
  return /^checkpoint\b/i.test(t) ? t : `Checkpoint: ${t}`;
}

function cap(text: string): string {
  const parts = text.split(/\s+/);
  return parts.length <= CROC_MAX_WORDS ? text : `${parts.slice(0, CROC_MAX_WORDS).join(" ")}…`;
}

const isDoneLike = (s: string | undefined) => s === "done" || s === "lit" || s === "fading";

/** The card or gate Moss would open next: the server's suggestion, then the first Ready card. */
export function suggestedEntry(pack: MapPack, views: Record<NodeId, NodeView>): NodeId | undefined {
  const order = pack.map.topo.filter((id) => pack.map.nodes[id]?.status === "playable");
  return (
    order.find((id) => views[id]?.suggested) ??
    order.find((id) => views[id]?.state === "in-progress") ??
    order.find((id) => views[id]?.revisit) ??
    order.find((id) => pack.map.nodes[id]?.kind === "checkpoint" && views[id]?.state === "ready") ??
    order.find((id) => views[id]?.state === "ready")
  );
}

export function mapChips(
  pack: MapPack | undefined,
  views: Record<NodeId, NodeView> | undefined,
  selected?: NodeId,
): CrocChip[] {
  if (!pack) return [];
  const v = views ?? {};
  const node = selected ? pack.map.nodes[selected] : undefined;
  if (selected && node) return peekChips(pack, v, selected);

  const cards = pack.map.topo.filter(
    (id) => pack.map.nodes[id]?.kind === "node" && pack.map.nodes[id]?.status === "playable",
  );
  const gates = pack.map.topo.filter(
    (id) => pack.map.nodes[id]?.kind === "checkpoint" && pack.map.nodes[id]?.status === "playable",
  );
  const suggested = suggestedEntry(pack, v) ?? cards[0];
  const next = gates.find((id) => v[id]?.state !== "lit");
  return [
    {
      label: "Where should I start?",
      intent: "ask",
      local: () => {
        if (!suggested)
          return "Everything here is open to you. Try this: pick the card whose question you can't answer.";
        const n = pack.map.nodes[suggested];
        if (n?.kind === "checkpoint")
          return cap(
            `${gateName(pack, suggested)}. Its cards are done, so the gate is ready. Try this: open it and see how many you get without a hint.`,
          );
        const started = v[suggested]?.state === "in-progress";
        return cap(
          `${titleOf(pack, suggested)}. ${started ? "You've started it, and it picks up where you left off." : "It's ready, and the cards after it build on it."} Try this: open it and make a guess before you read anything.`,
        );
      },
    },
    {
      label: "What's behind the next gate?",
      intent: "ask",
      local: () => {
        if (!next) return "Every gate on this map is open. Try this: relight a card that's fading, or share your map.";
        const covers = pack.map.nodes[next]?.covers ?? [];
        const missing = covers.filter((id) => !isDoneLike(v[id]?.state));
        const beyond = pack.map.topo.filter(
          (id) => pack.map.nodes[id]?.requires.includes(next) && pack.map.nodes[id]?.status === "playable",
        );
        const planned = pack.map.topo.some((id) => pack.map.nodes[id]?.status === "planned");
        const opens = beyond.length
          ? `${joinTitles(beyond.slice(0, 3).map((id) => titleOf(pack, id)))} ${beyond.length === 1 ? "opens" : "open"} after it`
          : planned
            ? "the rest of the map, still being written, sits beyond it"
            : "that's the end of the map";
        const todo =
          missing.length === 0
            ? "its cards are done, so open it now."
            : missing.length <= 2
              ? `close ${joinTitles(missing.map((id) => titleOf(pack, id)))} first.`
              : `close its ${missing.length} cards first, starting with ${titleOf(pack, missing[0] as NodeId)}.`;
        return cap(
          `${gateName(pack, next)} asks about ${joinTitles(covers.map((id) => titleOf(pack, id))) || "this section"}. Pass it and those cards light up, and ${opens}. Try this: ${todo}`,
        );
      },
    },
    {
      label: "Explain this map in a minute",
      intent: "ask",
      local: () => {
        const outcomes = pack.map.lines
          .map((l) => l.outcome?.trim())
          .filter((o): o is string => Boolean(o))
          .slice(0, 3)
          .map((o) => o.replace(/\.$/, ""));
        const sections = Math.max(1, gates.length);
        const can = outcomes.length
          ? ` By the end you can ${joinTitles(outcomes.map((o) => o.charAt(0).toLowerCase() + o.slice(1)))}.`
          : "";
        return cap(
          `${pack.manifest.title}: ${cards.length} card${cards.length === 1 ? "" : "s"} in ${sections} section${sections === 1 ? "" : "s"}. Each card starts with a guess and ends by showing why. A checkpoint closes each section.${can} Try this: open ${suggested ? titleOf(pack, suggested) : "the first card"} and guess.`,
        );
      },
    },
  ];
}

function peekChips(pack: MapPack, v: Record<NodeId, NodeView>, id: NodeId): CrocChip[] {
  const node = pack.map.nodes[id];
  if (!node) return [];
  const title = node.title;
  const state = v[id]?.state ?? "locked";
  const line = pack.map.lines.find((l) => l.id === node.line);
  const missing = (v[id]?.missing ?? node.requires).filter((r) => pack.map.nodes[r]);
  if (node.kind === "checkpoint") {
    const covers = node.covers ?? [];
    return [
      {
        label: "What's this checkpoint about?",
        intent: "ask",
        local: () =>
          cap(
            `${gateName(pack, id)} has ${node.size ?? Math.min(5, covers.length + 1)} questions on ${joinTitles(covers.map((c) => titleOf(pack, c))) || "this section"}. They're new situations, not lines from the cards. Get all but one right and the section lights up. Try this: say each card's big idea out loud first.`,
          ),
      },
      {
        label: "What do I need first?",
        intent: "ask",
        local: () => {
          const todo = covers.filter((c) => !isDoneLike(v[c]?.state));
          return todo.length
            ? cap(
                `Close ${joinTitles(todo.map((c) => titleOf(pack, c)))} first. Try this: start with ${titleOf(pack, todo[0] as NodeId)}.`,
              )
            : "Nothing. Every card it covers is done. Try this: open it now, while the cards are fresh.";
        },
      },
    ];
  }
  return [
    {
      label: "What's this card about?",
      intent: "ask",
      local: () => {
        if (state === "planned")
          return cap(`${title} is planned, not written yet. ${node.teaser} Try this: finish what's open first.`);
        if (state === "building")
          return `${title} is being written right now. Try this: open a card that's ready while it builds.`;
        if (state === "locked")
          return cap(
            `${title} is on the ${line?.title ?? "map"} line. I'll keep its question for when it opens, so the guess stays yours. Try this: close what it needs first.`,
          );
        return cap(
          `${title} starts with this: ${node.teaser || "a question to guess at"} Try this: guess before you open it.`,
        );
      },
    },
    {
      label: "What do I need first?",
      intent: "ask",
      local: () =>
        missing.length
          ? cap(
              `${joinTitles(missing.map((m) => (pack.map.nodes[m]?.kind === "checkpoint" ? gateName(pack, m) : titleOf(pack, m))))}. Try this: open the first of those.`,
            )
          : `Nothing. ${title} is open to you. Try this: open it and make a guess.`,
    },
  ];
}
