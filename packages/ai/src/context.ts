/**
 * Bounded tutor context: the current screen, the stop's objectives, key points and
 * misconceptions, the learner's last answers on this stop, and prerequisite states. Answer keys of
 * unanswered interactions are withheld; the model never sees them, so it can't leak them.
 */

import type { AttemptRow, Block, CompiledPack, Interaction, Item, PackNode, SystemBlock } from "@learncroc/core";
import { CROC_NAME } from "@learncroc/core";
import type { GateDecision } from "./gate";
import { describeAnswer } from "./guards";

function blockText(b: Block): string {
  switch (b.type) {
    case "story":
    case "callout":
      return b.text;
    case "say":
      return `${CROC_NAME}: ${b.text}`;
    case "quote":
      return `"${b.text}" (${b.cite.title})`;
    case "math":
      return `$${b.tex}$`;
    case "code":
      return `[code]\n${b.source}`;
    case "audio":
      return `[audio] ${b.transcript}`;
  }
}

/** A neutral order that reveals nothing about the authored sequence. */
function unordered(xs: string[]): string[] {
  return [...xs].sort((a, b) => a.localeCompare(b));
}

/** Describe an interaction; the answer is included only when `withAnswer`. */
export function interactionText(it: Interaction | Item, withAnswer: boolean): string {
  const lines = [`Task (${it.kind}): ${it.prompt}`];
  switch (it.kind) {
    case "choice": {
      it.options.forEach((o, i) => {
        lines.push(`  ${String.fromCharCode(65 + i)}. ${o.text}`);
      });
      if (withAnswer) {
        const ids = Array.isArray(it.answer) ? it.answer : [it.answer];
        lines.push(`Correct: ${ids.map((id) => it.options.find((o) => o.id === id)?.text ?? id).join(", ")}`);
      }
      break;
    }
    case "order":
      // Authors often write the items in the correct order: without the answer, list them sorted.
      lines.push(`  Items: ${(withAnswer ? it.items : unordered(it.items)).join(" | ")}`);
      if (withAnswer) lines.push(`Correct order: ${it.answer.map((i) => it.items[i]).join(" → ")}`);
      break;
    case "match":
      lines.push(
        `  Left: ${it.left.join(" | ")}`,
        `  Right: ${(withAnswer ? it.right : unordered(it.right)).join(" | ")}`,
      );
      if (withAnswer)
        lines.push(
          `Correct pairs: ${it.answer.map(([l, r]) => `${it.left[l] ?? l} = ${it.right[r] ?? r}`).join("; ")}`,
        );
      break;
    case "numeric":
    case "estimate":
      if (withAnswer) lines.push(`Correct: ${it.answer}${"unit" in it && it.unit ? ` ${it.unit}` : ""}`);
      break;
    case "text":
      if (withAnswer) lines.push(`Accepted: ${it.accept.join(" / ")}`);
      break;
    case "cloze":
      lines.push(`  Text: ${it.text}`);
      break;
    case "widget":
      lines.push(`  Widget: ${it.widget.id}`);
      break;
    case "html":
      lines.push(`  Interactive: ${it.alt}`);
      break;
    case "explain":
      lines.push(`  Key points: ${it.keyPoints.map((k) => k.text).join("; ")}`);
      break;
  }
  return lines.join("\n");
}

/** The stable pack block (cached for 1 hour on Anthropic: it is the same for every question). */
export function packBlock(pack: CompiledPack): string {
  const m = pack.manifest;
  const stops = pack.map.topo
    .map((id) => pack.map.nodes[id])
    .filter((n): n is NonNullable<typeof n> => n !== undefined && n.status !== "planned")
    .map(
      (n) =>
        `- ${n.title}${n.requires.length ? ` (after ${n.requires.map((r) => pack.map.nodes[r]?.title ?? r).join(", ")})` : ""}`,
    )
    .join("\n");
  return [
    `PACK: "${m.title}"${m.subtitle ? ` — ${m.subtitle}` : ""}. World: ${m.theme.world}.`,
    `Companion: ${CROC_NAME}, an old, patient river croc with a small lantern. Dry, warm, never in a hurry.`,
    m.ai?.tutorNotes ? `Notes for the tutor: ${m.ai.tutorNotes}` : "",
    `Cards on the map:\n${stops}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function nodeBlock(node: PackNode): string {
  const mis = Object.entries(node.misconceptions)
    .map(([id, m]) => `- ${id}: ${m.label}`)
    .join("\n");
  return [
    `CARD: "${node.title}". Big idea: ${node.bigIdea}`,
    `Objectives: ${node.objectives.join("; ")}`,
    `Key points: ${node.screens.flatMap((s) => (s.newIdea ? [s.newIdea] : [])).join("; ") || node.bigIdea}`,
    `Known misconceptions:\n${mis}`,
  ].join("\n");
}

export interface AskContext {
  system: SystemBlock[];
  /** The per-turn context message (volatile; after the cached blocks). */
  context: string;
  summary: { node?: string; screen?: string; lastAnswers: number; prereqs: number; tokensApprox: number };
}

export function buildAskContext(a: {
  pack: CompiledPack;
  decision: GateDecision;
  attempts: AttemptRow[];
  prereqStates: Record<string, string>;
  promptText: string;
}): AskContext {
  const { pack, decision } = a;
  const node = decision.node;
  const parts: string[] = [];
  let screenId: string | undefined;
  if (node) {
    parts.push(nodeBlock(node));
    const screen = decision.screenIndex !== undefined ? node.screens[decision.screenIndex] : undefined;
    if (screen) {
      screenId = screen.id;
      const setup = screen.blocks.map(blockText).join(" ");
      parts.push(
        `NOW: beat ${decision.screenIndex !== undefined ? decision.screenIndex + 1 : "?"} of ${node.screens.length}. Setup: ${setup || "(none)"}`,
      );
      if (decision.answered && screen.reveal) parts.push(`Reveal shown to the learner: ${screen.reveal.text}`);
    }
    if (decision.interaction) parts.push(interactionText(decision.interaction, decision.answered));
    parts.push(`Answered: ${decision.answered ? "yes" : "no"}. HINT LEVEL ALLOWED: ${decision.hintLevel}`);
  }
  const last = a.attempts
    .filter((x) => !node || x.nodeId === node.id)
    .slice(-3)
    .map((x) => {
      const it = node ? findInteraction(node, x.interactionId) : undefined;
      return `- ${x.interactionId}: "${describeAnswer(x.answer, it)}" (${x.correct ? "right" : "not right"})`;
    });
  if (last.length > 0) parts.push(`Their last answers on this stop:\n${last.join("\n")}`);
  const prereqs = Object.entries(a.prereqStates);
  if (prereqs.length > 0) {
    parts.push(`Prerequisites: ${prereqs.map(([id, st]) => `${pack.map.nodes[id]?.title ?? id} (${st})`).join(", ")}`);
  }
  const context = parts.join("\n\n");
  const system: SystemBlock[] = [
    { text: a.promptText, cache: "1h" },
    { text: packBlock(pack), cache: "1h" },
  ];
  const tokensApprox = Math.ceil((system.map((s) => s.text).join("").length + context.length) / 4);
  return {
    system,
    context,
    summary: {
      ...(node ? { node: node.title } : {}),
      ...(screenId ? { screen: screenId } : {}),
      lastAnswers: last.length,
      prereqs: prereqs.length,
      tokensApprox,
    },
  };
}

/** Find an interaction anywhere in a card (hook, beats, items). */
export function findInteraction(node: PackNode, id: string): Interaction | Item | undefined {
  if (node.hook.interaction.id === id) return node.hook.interaction;
  for (const s of node.screens) if (s.interaction?.id === id) return s.interaction;
  return node.items.find((i) => i.id === id);
}
