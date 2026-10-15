/**
 * AI layer internals (CONTRACTS §14). Serialisable shapes (SystemBlock, ChatTurn, MinimapSkeleton…)
 * are zod schemas in @learncroc/core; these interfaces carry functions, so they live here.
 */
import type { AiFeature, ChatTurn, Effort, ModelTier, ProviderId, SystemBlock, Usage } from "@learncroc/core";
import type { ZodType } from "zod";

export interface AIProvider {
  id: Exclude<ProviderId, "none"> | "fake";
  capabilities: { structuredOutput: boolean; caching: boolean; streaming: boolean; maxContext: number };
  /** Resolves usage via onUsage. */
  streamText(req: TextRequest, signal?: AbortSignal): AsyncIterable<{ text: string } | { thinking: true }>;
  generateObject<T>(req: ObjectRequest<T>, signal?: AbortSignal): Promise<{ value: T; usage: Usage }>;
  /** Create skeleton. */
  streamObject?<T>(req: ObjectRequest<T>, signal?: AbortSignal): AsyncIterable<{ partialJson: string }>;
  listModels?(): Promise<string[]>;
}

export interface TextRequest {
  feature: AiFeature;
  /** Resolved to a model through the active provider preset / user choice. */
  tier: ModelTier;
  /** Used by providers that support it; ignored otherwise. */
  effort: Effort;
  /** Stable → volatile (cache order). */
  system: SystemBlock[];
  messages: ChatTurn[];
  maxTokens: number;
  onUsage?: (u: Usage) => void;
}

export interface ObjectRequest<T> extends TextRequest {
  schema: ZodType<T>;
  schemaName: string;
}
