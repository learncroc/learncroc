/**
 * Where a widget's numbers come from. Every LLM widget names its source: "computed with GPT-2" for
 * precomputed data, an "illustrative" tag otherwise. No React.
 */
import { z } from "zod";

/** `"illustrative"` or `"precomputed:<model>"` (CONTRACTS §7.2). */
export const DataSource = z.union([z.literal("illustrative"), z.templateLiteral(["precomputed:", z.string()])]);
export type DataSource = z.infer<typeof DataSource>;

const MODEL_NAMES: Record<string, string> = {
  gpt2: "GPT-2",
  "gpt2-medium": "GPT-2 Medium",
  "gpt2-large": "GPT-2 Large",
  "gpt2-xl": "GPT-2 XL",
  distilgpt2: "DistilGPT-2",
  "bert-base": "BERT base",
  glove: "GloVe",
  word2vec: "word2vec",
};

/** Human model name for a source id ("gpt2" → "GPT-2"); unknown ids are shown as written. */
export function modelName(id: string): string {
  return MODEL_NAMES[id.toLowerCase()] ?? id;
}

/** The caption a widget shows for its data source. */
export function sourceCaption(source: string): string {
  if (source.startsWith("precomputed:")) {
    const model = source.slice("precomputed:".length).trim();
    return model ? `computed with ${modelName(model)}` : "precomputed";
  }
  return "illustrative numbers";
}

/** Validation for a source string (the schema already checks the shape). */
export function validateSource(source: string): string[] {
  if (source.startsWith("precomputed:") && source.slice("precomputed:".length).trim() === "") {
    return ['source "precomputed:" needs a model id, e.g. "precomputed:gpt2"'];
  }
  return [];
}
