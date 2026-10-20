/**
 * Moss's mode, decided on the server from run state, never by the client:
 * - no run (map, library) or a finished run: full;
 * - a card before the guess: hint (no answer, no close);
 * - a card's beats and close: full;
 * - a checkpoint or Relight question: hint, at the server-tracked hint level (cap 2).
 */
import type { AttemptRow, CompiledPack, Interaction, Item, NodeId, PackNode, RunState } from "@learncroc/core";

export type AskMode = "hint" | "full";

export interface GateDecision {
  mode: AskMode;
  /** The card the question is about. */
  node?: PackNode;
  /** The interaction the learner is on (for context and the leak check). */
  interaction?: Interaction | Item;
  interactionId?: string;
  /** Parametric instance numbers of the current item. */
  vars?: Record<string, number>;
  answered: boolean;
  /** 0–2 in hint mode; 3 in full mode. */
  hintLevel: 0 | 1 | 2 | 3;
  /** The beat index the context describes. */
  screenIndex?: number;
  /** A checkpoint question: hints are recorded and capped. */
  checkpoint?: boolean;
  /** Why this mode (for "What did I send?" and tests). */
  reason: string;
}

export interface GateInput {
  pack: CompiledPack;
  nodeId?: NodeId;
  screenId?: string;
  run?: RunState | null;
  /** Attempts in this run. */
  attempts: AttemptRow[];
  /** Is the card done, lit or fading? Used when there is no run. */
  nodeLit?: boolean;
}

function itemOf(pack: CompiledPack, nodeId: string, itemId: string): Item | undefined {
  return pack.nodes[nodeId]?.items.find((i) => i.id === itemId);
}

function hintLevel(run: RunState | null | undefined, id: string | undefined): 0 | 1 | 2 {
  if (!id) return 0;
  return Math.min(2, run?.hints[id] ?? 0) as 0 | 1 | 2;
}

export function decideAskMode(g: GateInput): GateDecision {
  const full = (reason: string, extra: Partial<GateDecision> = {}): GateDecision => ({
    mode: "full",
    answered: true,
    hintLevel: 3,
    reason,
    ...extra,
  });
  const run = g.run ?? undefined;
  const nodeId = g.nodeId ?? run?.target ?? run?.current?.ref.nodeId;
  const node = nodeId ? g.pack.nodes[nodeId] : undefined;
  const nodePart = node ? { node } : {};

  if (!run) return node ? full("no run", nodePart) : full("no card in scope");
  if (run.finishedAt !== undefined || run.cursor.phase === "done") return full("the run is finished", nodePart);
  switch (run.cursor.phase) {
    case "hook": {
      if (!node) return full("no card in scope");
      if (run.guess) return full("the guess is in", nodePart);
      return {
        ...nodePart,
        interaction: node.hook.interaction,
        interactionId: node.hook.interaction.id,
        mode: "hint",
        answered: false,
        hintLevel: 0,
        reason: "before the guess",
      };
    }
    case "screen": {
      if (!node) return full("no card in scope");
      const byId = g.screenId ? node.screens.findIndex((s) => s.id === g.screenId) : -1;
      const idx = byId >= 0 ? byId : (run.cursor.screen ?? 0);
      const screen = node.screens[idx];
      return full(`beat ${screen?.id ?? idx}`, {
        ...nodePart,
        ...(screen?.interaction ? { interaction: screen.interaction, interactionId: screen.interaction.id } : {}),
        screenIndex: idx,
      });
    }
    case "card": {
      if (!node) return full("no card in scope");
      const card = node.cards?.[run.cursor.card ?? 0];
      const ix = card && (card.type === "try" || card.type === "check") ? card.interaction : undefined;
      return full(`card ${card?.id ?? run.cursor.card ?? 0}`, {
        ...nodePart,
        ...(ix ? { interaction: ix, interactionId: ix.id } : {}),
      });
    }
    case "close":
      return full("the close", nodePart);
    case "checkpoint":
    case "relight": {
      const ref = run.current?.ref;
      if (!ref) return full("no current question", nodePart);
      const it = itemOf(g.pack, ref.nodeId, ref.itemId);
      const n = g.pack.nodes[ref.nodeId];
      return {
        ...(n ? { node: n } : nodePart),
        ...(it ? { interaction: it } : {}),
        interactionId: ref.itemId,
        ...(run.current?.vars ? { vars: run.current.vars } : {}),
        mode: "hint",
        answered: false,
        hintLevel: hintLevel(run, ref.itemId),
        checkpoint: run.cursor.phase === "checkpoint",
        reason: `${run.cursor.phase} question`,
      };
    }
  }
}
