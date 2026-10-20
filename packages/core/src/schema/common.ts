/**
 * Small shapes shared by cards, items and the AI layer.
 */
import { z } from "zod";
import { IsoDate, ProviderId, WidgetId } from "./primitives";

/** A value that must be present (zod's `unknown` also accepts a missing key). */
export const requiredUnknown = (what: string) =>
  z.unknown().refine((v): boolean => v !== undefined, `${what} is required`);

/**
 * A configured built-in widget. Props are checked against the widget's own
 * zod schema by lint (L010) through the injected WidgetSpecRegistry, not by this schema.
 */
export const WidgetRef = z.strictObject({
  id: WidgetId,
  /** Major version (1 in v0.1). Props change only additively within a major. */
  v: z.number().int().min(1),
  props: z.record(z.string(), z.unknown()),
  /** Required when used as an interaction or item; omitted for visuals and explore mode. */
  goal: z.unknown().optional(),
});

export const VisualState = z.strictObject({
  /** Merged into the canvas widget's props (validated by its schema). */
  props: z.record(z.string(), z.unknown()).optional(),
  /** ≤ 8 words, drawn by WidgetHost as a label pinned on the canvas. */
  note: z.string().optional(),
});

export const KeyPoint = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1),
  /** Phrases/synonyms for offline highlight matching (case- and accent-insensitive). */
  keywords: z.array(z.string()).optional(),
});

/** How an AI- or script-generated file or value was made. */
export const Provenance = z.strictObject({
  feature: z.enum(["create", "build", "quiz", "cards", "figure", "toy", "precompute"]),
  /** "create-node@1" | "scripts/precompute@1" */
  prompt: z.string(),
  provider: z.union([ProviderId, z.literal("script")]),
  /** "claude-sonnet-5-5" | "gpt2" */
  model: z.string(),
  at: IsoDate,
  cacheKey: z.string().optional(),
});

export const Source = z.strictObject({
  /** "vaswani-2017" */
  id: z.string().min(1),
  title: z.string().min(1),
  by: z.string().optional(),
  year: z.number().int().optional(),
  url: z.string().optional(),
  /** For quoted/adapted text, e.g. "CC-BY-SA-4.0". */
  license: z.string().optional(),
  note: z.string().optional(),
});

/** Usage reported by a provider call. */
export const Usage = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
});

export type WidgetRef = z.infer<typeof WidgetRef>;
export type VisualState = z.infer<typeof VisualState>;
export type KeyPoint = z.infer<typeof KeyPoint>;
export type Provenance = z.infer<typeof Provenance>;
export type Source = z.infer<typeof Source>;
export type Usage = z.infer<typeof Usage>;
