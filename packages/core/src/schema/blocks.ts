/**
 * Blocks, visuals and the sandbox bridge (CONTRACTS §5).
 */
import { z } from "zod";
import { Provenance, WidgetRef } from "./common";
import { AssetPath, Markdown } from "./primitives";

/** Counts toward the word cap. */
export const StoryBlock = z.strictObject({ type: z.literal("story"), text: Markdown, speaker: z.string().optional() });
/** KaTeX display math; doesn't count toward the word cap. */
export const MathBlock = z.strictObject({ type: z.literal("math"), tex: z.string(), caption: z.string().optional() });
/** Display only; doesn't count toward the word cap. */
export const CodeBlock = z.strictObject({
  type: z.literal("code"),
  lang: z.enum(["python", "javascript", "text"]),
  source: z.string(),
  highlight: z.array(z.number().int()).optional(),
});
/** `src` is filled by the compiler from `packs:audio` renders. */
export const AudioBlock = z.strictObject({
  type: z.literal("audio"),
  tts: z.strictObject({ text: z.string(), lang: z.string(), rate: z.number().optional() }).optional(),
  src: AssetPath.optional(),
  transcript: z.string(),
});
/** ≤ 40 words; counts toward the word cap. */
export const QuoteBlock = z.strictObject({
  type: z.literal("quote"),
  text: z.string(),
  cite: z.strictObject({ title: z.string(), url: z.string().optional(), para: z.string().optional() }),
});
/** Counts toward the word cap. */
export const CalloutBlock = z.strictObject({
  type: z.literal("callout"),
  tone: z.enum(["note", "caution", "illustrative"]),
  text: Markdown,
});

/** One line from Moss, the guide (≤ 35 words, lint). `outside`: the line goes beyond the source article. */
export const SayBlock = z.strictObject({
  type: z.literal("say"),
  text: Markdown,
  mood: z.enum(["idle", "curious", "happy"]).optional(),
  outside: z.boolean().optional(),
});

export const Block = z.discriminatedUnion("type", [
  SayBlock,
  StoryBlock,
  MathBlock,
  CodeBlock,
  AudioBlock,
  QuoteBlock,
  CalloutBlock,
]);

/** Rendered in mode "explore". */
export const WidgetVisual = z.strictObject({ kind: z.literal("widget"), widget: WidgetRef, alt: z.string() });
/** SVG must be DOMPurify-stable. */
export const FigureVisual = z.strictObject({
  kind: z.literal("figure"),
  asset: AssetPath,
  alt: z.string(),
  caption: z.string().optional(),
});
/** assets/interactive/*.html, sandbox origin, ≤ 64 KB. */
export const HtmlVisual = z.strictObject({
  kind: z.literal("html"),
  asset: AssetPath,
  height: z.number(),
  alt: z.string(),
});
/** Pocket maps only, local only, sandbox origin, ≤ 64 KB, validated before use. */
export const GeneratedHtmlVisual = z.strictObject({
  kind: z.literal("generated-html"),
  html: z.string(),
  height: z.number(),
  alt: z.string(),
  provenance: Provenance,
});

export const Visual = z.discriminatedUnion("kind", [WidgetVisual, FigureVisual, HtmlVisual, GeneratedHtmlVisual]);

/**
 * Sandbox bridge: frame → host. The host accepts a message only when
 * event.source === iframe.contentWindow, then validates it with this schema.
 */
export const FrameToHost = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), v: z.literal(1) }),
  /** ≤ 4 KB serialised; the host grades, never the frame. */
  z.object({
    type: z.literal("report"),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  }),
  /** Clamped 120..900 by the host. */
  z.object({ type: z.literal("resize"), height: z.number() }),
  /** ≤ 120 chars → host aria-live. */
  z.object({ type: z.literal("announce"), text: z.string() }),
  /** The bridge fired the first input and saw the DOM change. */
  z.object({ type: z.literal("selftest"), ok: z.boolean() }),
]);

/** Sandbox bridge: host → frame. */
export const HostToFrame = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("init"),
    mode: z.enum(["explore", "answer", "review"]),
    theme: z.enum(["light", "dark"]),
    reducedMotion: z.boolean(),
    tokens: z.record(z.string(), z.string()),
    value: z.unknown().optional(),
    solution: z.unknown().optional(),
  }),
  z.object({ type: z.literal("selftest") }),
  z.object({ type: z.literal("reveal"), solution: z.unknown().optional() }),
]);

export type StoryBlock = z.infer<typeof StoryBlock>;
export type MathBlock = z.infer<typeof MathBlock>;
export type CodeBlock = z.infer<typeof CodeBlock>;
export type AudioBlock = z.infer<typeof AudioBlock>;
export type QuoteBlock = z.infer<typeof QuoteBlock>;
export type CalloutBlock = z.infer<typeof CalloutBlock>;
export type SayBlock = z.infer<typeof SayBlock>;
export type Block = z.infer<typeof Block>;
export type WidgetVisual = z.infer<typeof WidgetVisual>;
export type FigureVisual = z.infer<typeof FigureVisual>;
export type HtmlVisual = z.infer<typeof HtmlVisual>;
export type GeneratedHtmlVisual = z.infer<typeof GeneratedHtmlVisual>;
export type Visual = z.infer<typeof Visual>;
export type FrameToHost = z.infer<typeof FrameToHost>;
export type HostToFrame = z.infer<typeof HostToFrame>;
