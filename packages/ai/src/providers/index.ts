/**
 * Provider construction from settings + key. The default provider is "none" (no provider): every
 * AI feature then takes its offline path.
 */
import type { Settings } from "@learncroc/core";
import { DEFAULT_OLLAMA_URL, modelFor } from "../models";
import type { AIProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { type FakeOptions, FakeProvider } from "./fake";
import { OllamaProvider } from "./ollama";
import { OpenAiCompatibleProvider } from "./openai-compatible";

export { AnthropicProvider } from "./anthropic";
export { defaultFakeObject, type FakeOptions, FakeProvider } from "./fake";
export { detectOllama, listOllamaModels, OllamaProvider } from "./ollama";
export { chatUrl, OpenAiCompatibleProvider } from "./openai-compatible";
export type { ProviderConfig } from "./shared";

export interface CreateProviderOptions {
  settings: Settings["ai"];
  apiKey?: string;
  fake?: boolean | FakeOptions;
  fetch?: typeof fetch;
}

/** The configured provider, or null when AI is off (provider "none", or a cloud provider with no key). */
export function createProvider(o: CreateProviderOptions): AIProvider | null {
  if (o.fake) return new FakeProvider(typeof o.fake === "object" ? o.fake : {});
  const s = o.settings;
  const models = { fast: modelFor(s, "fast"), smart: modelFor(s, "smart"), deep: modelFor(s, "deep") };
  const base = { models, ...(o.fetch ? { fetch: o.fetch } : {}) };
  switch (s.provider) {
    case "anthropic":
      return o.apiKey ? new AnthropicProvider({ ...base, apiKey: o.apiKey }) : null;
    case "openai-compatible":
      return s.baseUrl && models.smart
        ? new OpenAiCompatibleProvider({ ...base, baseUrl: s.baseUrl, ...(o.apiKey ? { apiKey: o.apiKey } : {}) })
        : null;
    case "ollama":
      return models.smart ? new OllamaProvider({ ...base, baseUrl: s.baseUrl || DEFAULT_OLLAMA_URL }) : null;
    default:
      return null;
  }
}
