/**
 * The player's public surface: the card modal, the checkpoint modal and the card player (also used by
 * the marketplace embed). Prop interfaces are frozen after wave 0 (00 §5); the map mounts the modals
 * from its URL search (`?card=` / `?checkpoint=`) and turns `onSummary` into map moments.
 */
import type { NodeId, PackId, RunSummary } from "@learncroc/core";

export interface CardModalProps {
  packId: PackId;
  nodeId: NodeId;
  /** Revisit: the checkpoint to return to. */
  from?: NodeId;
  /** Pre-locked hook option id or "idk" (first-run question). */
  guess?: string;
  /** "Guess again" / Yesterday's question. */
  again?: boolean;
  onClose(): void;
  /** Replace-navigation. */
  onNavigate(to: { nodeId: NodeId; kind: "node" | "checkpoint"; from?: NodeId }): void;
  /** The map turns this into cardDone / unlock moments. */
  onSummary(summary: RunSummary): void;
}

export interface CheckpointModalProps {
  packId: PackId;
  checkpointId: NodeId;
  onClose(): void;
  onNavigate(to: { nodeId: NodeId; kind: "node" | "checkpoint"; from?: NodeId }): void;
  onSummary(summary: RunSummary): void;
  /** "Open the gate": close the modal, play gateOpen. */
  onOpenGate(summary: RunSummary): void;
}

export { CardModal } from "./card/CardModal";
export { CardPlayer, type CardPlayerProps, type CardPlayerStepInfo } from "./card/CardPlayer";
export { CheckpointModal } from "./checkpoint/CheckpointModal";
/** The close's Markdown renderer (`==mark==` → `<mark class="lm-sweep-mark">`) and the plain-text helpers. */
export { Md as CloseMarkdown, Md, plainText, stripMarks } from "./Markdown";
/** The RunState query key; Moss invalidates it after a hint-mode ask so the hint level stays shared. */
export { runQueryKey } from "./queries";
/** The one-time sound offer (after the first gate opens). */
export { SoundOffer } from "./SoundOffer";
