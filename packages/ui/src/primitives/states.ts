import type { NodeState } from "@learncroc/core";

/** Map entry kind: a card (`node` in YAML) or a gate (`checkpoint`). */
export type EntryKind = "node" | "checkpoint";

/** UI words for each card state: constant across packs. Done is never gold; Lit is. */
export const STATE_LABEL: Record<NodeState | "durable", string> = {
  locked: "Later",
  ready: "Ready",
  "in-progress": "In progress",
  done: "Done",
  lit: "Lit",
  fading: "Fading",
  planned: "Planned",
  building: "Writing…",
  durable: "Durable",
};

/** UI words for a gate (checkpoint entry). A passed gate is `lit` in data and "Open" on screen, never "Lit". */
export const GATE_LABEL: Record<NodeState, string> = {
  locked: "Locked",
  ready: "Ready",
  "in-progress": "In progress",
  done: "Open",
  lit: "Open",
  fading: "Open",
  planned: "Later",
  building: "Writing…",
};

/** The one way to label a state on screen. Every label goes through here so a gate never reads "Lit". */
export function stateLabel(kind: EntryKind | undefined, state: NodeState | "durable"): string {
  if (kind === "checkpoint") return state === "durable" ? GATE_LABEL.lit : GATE_LABEL[state];
  return STATE_LABEL[state];
}
