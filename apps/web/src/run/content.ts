/**
 * Pure helpers that turn a compiled pack plus a server-reduced RunState into what the player shows.
 * The client never advances the cursor itself: every function here only reads the state it is given.
 */

import type {
  AnswerValue,
  CheckCard,
  CompiledPack,
  FallbackInteraction,
  Interaction,
  Item,
  ItemRef,
  NodeId,
  PackNode,
  Screen,
  TryCard,
  Visual,
  VisualState,
} from "@learncroc/core";
import { answerText as coreAnswerText, sections } from "@learncroc/core";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";

// ── what can be asked

type WidgetInteraction = Extract<Interaction, { kind: "widget" }>;

/** A widget question whose built-in fallback is optional. */
export type WidgetAsk = Omit<WidgetInteraction, "fallback"> & { fallback?: FallbackInteraction };

/** Anything the player can ask: an authored interaction, a bank item or a fallback. */
export type Ask = Exclude<Interaction, { kind: "widget" }> | WidgetAsk | FallbackInteraction;

/** Where an attempt goes (AttemptInput.phase). */
export type AttemptPhase = "hook" | "screen" | "card" | "checkpoint" | "relight";

/** One question on screen: what to ask, where to send the attempt, and what the canvas shows around it. */
export interface Task {
  /** Stable React key; a new key means a new question. */
  key: string;
  packId: string;
  nodeId: NodeId;
  /** AttemptInput.interactionId (the hook's, a beat's or an item id). */
  interactionId: string;
  phase: AttemptPhase;
  ask: Ask;
  /** Canvas content when the ask itself isn't a widget or html interactive. */
  visual?: Visual;
  /** Parametric values chosen by the server. */
  vars?: Record<string, number>;
  /** Shown after a right answer; its visualState plays on the canvas. */
  reveal?: { text: string; speaker?: string; visualState?: VisualState };
  /** Ask "how sure?" before checking. */
  confidence?: boolean;
}

/** True when the ask is drawn on the canvas (widget or html interactive). */
export function isCanvasAsk(ask: Ask): ask is WidgetAsk | Extract<Interaction, { kind: "html" }> {
  return ask.kind === "widget" || ask.kind === "html";
}

// ── parametric prompts

/** Fill "{n}" placeholders from server-chosen vars. Unknown names are left as written. */
export function fillVars(text: string, vars?: Record<string, number>): string {
  if (!vars) return text;
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    const v = vars[name];
    return v === undefined ? whole : formatNumber(v);
  });
}

/** Numbers as people write them: up to 4 decimals, no trailing zeros, thin grouping for thousands. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Math.round(n * 10_000) / 10_000;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

// ── lookups

export function nodeOf(pack: CompiledPack, nodeId: NodeId | undefined): PackNode | undefined {
  return nodeId ? pack.nodes[nodeId] : undefined;
}

export function itemOf(pack: CompiledPack, ref: Pick<ItemRef, "nodeId" | "itemId">): Item | undefined {
  return pack.nodes[ref.nodeId]?.items.find((i) => i.id === ref.itemId);
}

/** The node's anchor widget: its own visual, else the first widget visual or widget question in its screens. */
export function anchorWidget(node: PackNode): Extract<Visual, { kind: "widget" }>["widget"] | undefined {
  if (node.toy) return node.toy.widget;
  if (node.visual?.kind === "widget") return node.visual.widget;
  for (const s of node.screens) {
    if (s.visual?.kind === "widget") return s.visual.widget;
    if (s.interaction?.kind === "widget") {
      const { goal: _goal, ...widget } = s.interaction.widget;
      return widget;
    }
  }
  return undefined;
}

// ── tasks

/** The hook as a task. It has no reveal: the close answers it. */
export function hookTask(pack: CompiledPack, node: PackNode): Task {
  const hook = node.hook;
  return {
    key: `${pack.manifest.id}/${node.id}/hook`,
    packId: pack.manifest.id,
    nodeId: node.id,
    interactionId: hook.interaction.id,
    phase: "hook",
    ask: hook.interaction,
    ...(hook.visual ? { visual: hook.visual } : {}),
    ...(hook.interaction.confidence ? { confidence: true } : {}),
  };
}

/** A beat's action as a task, or null for a read-only beat (it moves on with `advance`). */
export function screenTask(pack: CompiledPack, node: PackNode, screen: Screen): Task | null {
  if (!screen.interaction) return null;
  return {
    key: `${pack.manifest.id}/${node.id}/${screen.id}`,
    packId: pack.manifest.id,
    nodeId: node.id,
    interactionId: screen.interaction.id,
    phase: "screen",
    ask: screen.interaction,
    ...((screen.visual ?? node.visual) ? { visual: screen.visual ?? node.visual } : {}),
    ...(screen.reveal
      ? {
          reveal: {
            text: screen.reveal.text,
            ...((screen.reveal.speaker ?? screen.speaker) ? { speaker: screen.reveal.speaker ?? screen.speaker } : {}),
            ...(screen.reveal.visualState ? { visualState: screen.reveal.visualState } : {}),
          },
        }
      : {}),
    ...(screen.interaction.confidence ? { confidence: true } : {}),
  };
}

/** A typed try/check card's action as a task (phase "card"). */
export function cardTask(pack: CompiledPack, node: PackNode, card: TryCard | CheckCard, index: number): Task {
  const visual = card.type === "try" ? card.visual : undefined;
  return {
    key: `${pack.manifest.id}/${node.id}/card-${index}-${card.id}`,
    packId: pack.manifest.id,
    nodeId: node.id,
    interactionId: card.interaction.id,
    phase: "card",
    ask: card.interaction,
    ...(visual ? { visual } : {}),
    ...(card.reveal
      ? {
          reveal: {
            text: card.reveal.text,
            ...(card.reveal.speaker ? { speaker: card.reveal.speaker } : {}),
            ...(card.reveal.visualState ? { visualState: card.reveal.visualState } : {}),
          },
        }
      : {}),
    ...(card.interaction.confidence ? { confidence: true } : {}),
  };
}

export function itemTask(
  packId: string,
  nodeId: NodeId,
  item: Item,
  phase: AttemptPhase,
  vars?: Record<string, number>,
  keySuffix = "",
): Task {
  return {
    key: `${packId}/${nodeId}/${item.id}${vars ? `/${JSON.stringify(vars)}` : ""}${keySuffix}`,
    packId,
    nodeId,
    interactionId: item.id,
    phase,
    ask: item,
    ...(vars ? { vars } : {}),
    ...(item.why ? { reveal: { text: item.why } } : {}),
    ...(item.confidence ? { confidence: true } : {}),
  };
}

// ── typed cards

/** What one card in the path does. A map stop (one node run) plays as several of these. */
export type CardType = "intro" | "ask" | "teach" | "try" | "check" | "takeaway";

export const CARD_TYPE_LABEL: Record<CardType, string> = {
  intro: "Intro",
  ask: "Ask",
  teach: "Teach",
  try: "Try",
  check: "Check",
  takeaway: "Takeaway",
};

/** The node id an article map gives its intro card. */
export const INTRO_NODE_ID = "intro";

export interface TypedCard {
  type: CardType;
  /** Stable within the node: "intro", "ask", "teach-<i>", "act-<i>", "takeaway". */
  key: string;
  /** Screen index (teach, try, check). */
  screen?: number;
  /** Index into node.cards (nodes with authored typed cards; key "card-<i>"). */
  index?: number;
}

export function isIntroNode(node: Pick<PackNode, "id">): boolean {
  return node.id === INTRO_NODE_ID;
}

/** A beat shows a Teach card when it has words, or a picture and nothing to do. */
export function hasTeach(screen: Screen): boolean {
  return screen.blocks.length > 0 || (!screen.interaction && Boolean(screen.visual));
}

/** A beat's action is the stop's Check when it is a choice on the last beat; any other action is a Try. */
export function actionType(node: PackNode, index: number): "try" | "check" {
  const s = node.screens[index];
  return index === node.screens.length - 1 && s?.interaction?.kind === "choice" ? "check" : "try";
}

/** The typed cards one node plays as, in order. */
export function nodeCards(node: PackNode): TypedCard[] {
  if (node.cards?.length) return node.cards.map((c, i) => ({ type: c.type, key: `card-${i}`, index: i }));
  if (isIntroNode(node)) return [{ type: "intro", key: "intro" }];
  const out: TypedCard[] = [{ type: "ask", key: "ask" }];
  node.screens.forEach((s, i) => {
    if (hasTeach(s)) out.push({ type: "teach", key: `teach-${i}`, screen: i });
    if (s.interaction) out.push({ type: actionType(node, i), key: `act-${i}`, screen: i });
  });
  out.push({ type: "takeaway", key: "takeaway" });
  return out;
}

export interface DeckCard {
  type: CardType;
  /** The node or checkpoint this card belongs to. */
  nodeId: NodeId;
  /** TypedCard.key, or "checkpoint". */
  key: string;
}

/** Every typed card on the map in reading order: each playable stop's cards, then each checkpoint as a Check. */
export function mapDeck(pack: Pick<CompiledPack, "map" | "nodes">): DeckCard[] {
  const out: DeckCard[] = [];
  for (const id of pack.map.topo) {
    const e = pack.map.nodes[id];
    if (!e || e.status === "planned") continue;
    if (e.kind === "checkpoint") {
      out.push({ type: "check", nodeId: id, key: "checkpoint" });
      continue;
    }
    const node = pack.nodes[id];
    // A card still being written: a typical stop, until it lands.
    const cards: TypedCard[] = node
      ? nodeCards(node)
      : [
          { type: "ask", key: "ask" },
          { type: "teach", key: "teach-0" },
          { type: "teach", key: "teach-1" },
          { type: "takeaway", key: "takeaway" },
        ];
    for (const c of cards) out.push({ type: c.type, nodeId: id, key: c.key });
  }
  return out;
}

/** The hook as a headline: its setup blocks' words aren't part of it, only the question. */
export function askHeadline(node: PackNode): string {
  const ask = node.cards?.find((c) => c.type === "ask");
  return ask?.type === "ask" ? ask.prompt : node.hook.interaction.prompt;
}

// ── answers as words

/** A learner's answer in words (pinned guess, "I used to think"). */
export function answerText(ask: Ask | undefined, answer: AnswerValue): string {
  switch (answer.kind) {
    case "idk":
      return "No idea yet";
    case "choice": {
      const ids = Array.isArray(answer.selected) ? answer.selected : [answer.selected];
      if (ask?.kind === "choice") {
        return ids.map((id) => ask.options.find((o) => o.id === id)?.text ?? id).join(", ");
      }
      return ids.join(", ");
    }
    case "numeric":
      return `${formatNumber(answer.value)}${ask?.kind === "numeric" && ask.unit ? ` ${ask.unit}` : ""}`;
    case "estimate":
      return `about ${formatNumber(answer.value)}${ask?.kind === "estimate" && ask.scale.unit ? ` ${ask.scale.unit}` : ""}`;
    case "text":
      return answer.value;
    case "order":
      if (ask?.kind === "order") return answer.order.map((i) => ask.items[i] ?? "?").join(" → ");
      return answer.order.join(", ");
    case "match":
      if (ask?.kind === "match") {
        return answer.pairs.map(([l, r]) => `${ask.left[l] ?? "?"} = ${ask.right[r] ?? "?"}`).join("; ");
      }
      return `${answer.pairs.length} pairs`;
    case "cloze":
      return Object.values(answer.values).join(" … ");
    case "explain":
      return answer.text ?? answer.tiles?.join(" ") ?? answer.choice ?? "";
    case "html":
      return Array.isArray(answer.value) ? answer.value.join(", ") : String(answer.value);
    case "widget": {
      // The widget's own words for the answer (bars, a ranking, a slider value), when it has them.
      let text = "";
      if (ask?.kind === "widget") {
        try {
          // Only the widget ref is read; the fallback is never touched on this path.
          text = coreAnswerText(ask as WidgetInteraction, answer, { widgets: widgetSpecRegistry });
        } catch {
          text = "";
        }
      }
      return shortReading(text) ?? "your setting on the canvas";
    }
  }
}

/**
 * A widget's reading, short enough for a chip. Multi-line readings put a legend first ("Parts: e = card E,
 * four = card 4") and the learner's state last ("Tapped: four"): keep the last line, with ids named.
 */
function shortReading(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 1) return t.length <= 80 ? t : undefined;
  const names = new Map<string, string>();
  for (const l of lines.slice(0, -1)) {
    const body = l.includes(":") ? l.slice(l.indexOf(":") + 1) : l;
    for (const pair of body.split(",")) {
      const m = /^\s*([\w-]+)\s*=\s*(.+?)\s*$/.exec(pair);
      if (m?.[1] && m[2]) names.set(m[1], m[2]);
    }
  }
  const last = lines[lines.length - 1] ?? "";
  const named = last.replace(/[\w-]+/g, (w) => names.get(w) ?? w);
  return named.length <= 80 ? named : undefined;
}

/** The option lots of people pick, in words ("Lots of people guess …"). */
export function lotsGuessText(node: PackNode): string | undefined {
  const hook = node.hook;
  if (!hook.lotsGuess || hook.interaction.kind !== "choice") return undefined;
  return hook.interaction.options.find((o) => o.id === hook.lotsGuess)?.text;
}

// ── maps

/** Title for any id in the pack (playable card, planned card or checkpoint). */
export function titleOf(pack: Pick<CompiledPack, "map" | "nodes">, id: NodeId): string {
  return pack.nodes[id]?.title ?? pack.map.nodes[id]?.title ?? id;
}

/** "Checkpoint: {section}" for a gate (titles that already say "Checkpoint…" are used as they are). */
export function checkpointLabel(pack: Pick<CompiledPack, "map" | "nodes">, cpId: NodeId): string {
  const title = titleOf(pack, cpId);
  return /^checkpoint\b/i.test(title) ? title : `Checkpoint: ${title}`;
}

/** The section name a gate opens onto, for copy ("Text in"): the gate title without "Checkpoint". */
export function sectionName(pack: Pick<CompiledPack, "map" | "nodes">, cpId: NodeId): string {
  return titleOf(pack, cpId).replace(/^checkpoint\s*[:·-]?\s*/i, "") || titleOf(pack, cpId);
}

/** A card's place on the map: n of m playable cards in reading order. */
export function cardPosition(pack: Pick<CompiledPack, "map">, nodeId: NodeId): { n: number; of: number } {
  const cards = pack.map.topo.filter((id) => {
    const e = pack.map.nodes[id];
    return e?.kind === "node" && e.status !== "planned";
  });
  return { n: Math.max(1, cards.indexOf(nodeId) + 1), of: cards.length };
}

/** The section a card belongs to (the gate that covers it and that gate's cards), if any. */
export function sectionOf(
  pack: Pick<CompiledPack, "map">,
  nodeId: NodeId,
): { checkpoint: NodeId; cards: NodeId[]; index: number } | undefined {
  const s = sections(pack.map).find((x) => x.cards.includes(nodeId));
  return s ? { checkpoint: s.checkpoint, cards: s.cards, index: s.index } : undefined;
}

/** Parse a misconception `upstream`: an ancestor node id or `in-node:<screenId>`. */
export function parseUpstream(upstream: string): { node: NodeId } | { screen: string } {
  return upstream.startsWith("in-node:") ? { screen: upstream.slice("in-node:".length) } : { node: upstream };
}
