/**
 * Dispatches a built-in ask to its input. Canvas asks (widget, html) render their controls here and
 * their body on the canvas; explain renders the typed-first field.
 */
import type { AnswerValue } from "@learncroc/core";
import type { Ask } from "../content";
import { ClozeInput, MatchInput, OrderInput } from "./Arrange";
import { ChoiceInput } from "./Choice";
import { EstimateInput } from "./Estimate";
import { ExplainField, type ExplainResult } from "./Explain";
import { NumericInput, TextInput } from "./Typed";
import type { InputProps } from "./types";

export interface BuiltInInputProps extends InputProps {
  aiConfigured: boolean;
  explainResult?: ExplainResult;
  packId: string;
  /** Explain: "I'm stuck" swaps in the offline built-in. */
  onStuckFallback?: () => void;
}

/** Inputs for every non-canvas ask kind. Returns null for widget/html (handled by the caller). */
export function BuiltInInput(p: BuiltInInputProps) {
  const { ask } = p;
  switch (ask.kind) {
    case "choice":
      return <ChoiceInput {...p} ask={ask} />;
    case "numeric":
      return <NumericInput {...p} ask={ask} />;
    case "estimate":
      return <EstimateInput {...p} ask={ask} />;
    case "text":
      return <TextInput {...p} ask={ask} />;
    case "order":
      return <OrderInput {...p} ask={ask} />;
    case "match":
      return <MatchInput {...p} ask={ask} />;
    case "cloze":
      return <ClozeInput {...p} ask={ask} />;
    case "explain":
      return (
        <ExplainField
          promptId={p.promptId}
          keyPoints={ask.keyPoints}
          exemplar={ask.exemplar}
          aiConfigured={p.aiConfigured}
          locked={p.locked}
          draft={typeof p.draft === "string" ? p.draft : undefined}
          onDraft={p.onDraft}
          onSubmit={(a: AnswerValue) => p.onSubmit(a)}
          result={p.explainResult}
          keysActive={p.keysActive}
          seed={p.seed}
          packId={p.packId}
          onStuck={p.onStuckFallback}
        />
      );
    default:
      return null;
  }
}

/** Is this ask answered on the canvas? */
export function askOnCanvas(ask: Ask): boolean {
  return ask.kind === "widget" || ask.kind === "html";
}
