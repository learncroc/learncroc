import type { NodeState } from "@learncroc/core";
import { cn } from "../cn";
import { StopGlyph } from "./StopGlyph";
import { type EntryKind, GATE_LABEL, STATE_LABEL, stateLabel } from "./states";

export { GATE_LABEL, STATE_LABEL, stateLabel };

export interface StatePillProps {
  state: NodeState | "durable";
  /** Card (default) or gate. A gate's lit state reads "Open". */
  kind?: EntryKind;
  /** Override the constant label (rare). */
  label?: string;
  /** Show the shape-coded glyph before the word (default true). */
  glyph?: boolean;
  className?: string;
}

const TONE: Record<NodeState | "durable", string> = {
  locked: "border-line-strong text-ink-2",
  ready: "border-sea bg-sea-soft text-sea-text",
  "in-progress": "border-sea bg-sea-soft text-sea-text",
  // Done is ink and line, never Lumen: light is earned at the checkpoint.
  done: "border-line-strong bg-surface-2 text-ink",
  lit: "border-lumen bg-lumen-soft text-lumen-text",
  durable: "border-lumen bg-lumen-soft text-lumen-text",
  fading: "border-ember bg-ember-soft text-ember-text",
  planned: "border-dashed border-line-strong text-ink-2",
  building: "border-iris bg-iris-soft text-ink",
};

/** A gate's tones: Locked is plain ink, Ready / In progress Sea, Open (lit, and its done/fading aliases) Lumen. */
const GATE_TONE: Partial<Record<NodeState | "durable", string>> = {
  locked: "border-line-strong bg-surface text-ink-2",
  done: TONE.lit,
  fading: TONE.lit,
  durable: TONE.lit,
};

/** Status pill (the only place the pill radius is used). Glyph + word, so colour is never the only signal. */
export function StatePill({ state, kind = "node", label, glyph = true, className }: StatePillProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-pill border pr-2.5 text-micro whitespace-nowrap",
        glyph ? "pl-1" : "pl-2.5",
        (kind === "checkpoint" ? GATE_TONE[state] : undefined) ?? TONE[state],
        className,
      )}
      data-state={state}
      data-kind={kind}
    >
      {glyph ? (
        <StopGlyph
          state={state === "durable" ? "lit" : state}
          kind={kind}
          durable={state === "durable"}
          size={16}
          decorative
        />
      ) : null}
      {label ?? stateLabel(kind, state)}
    </span>
  );
}
