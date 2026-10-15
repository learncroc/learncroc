/**
 * Tier → model resolution. Each provider preset declares its own three models (Anthropic) or the
 * user picks them from GET /ai/models (Ollama, OpenAI-compatible). Recommendations for local
 * models live in docs/ai/local-models.md.
 */
import { type ModelTier, PROVIDER_PRESETS, type ProviderId, type Settings } from "@learncroc/core";

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/** The model for a tier: the user's choice when set, else the preset, else the nearest set tier. */
export function modelFor(settings: Settings["ai"], tier: ModelTier): string {
  const chosen = settings.models[tier];
  if (chosen) return chosen;
  const preset = PROVIDER_PRESETS.find((p) => p.id === settings.provider)?.models;
  if (preset) return preset[tier];
  const order: ModelTier[] = tier === "fast" ? ["fast", "smart", "deep"] : ["smart", "deep", "fast"];
  for (const t of order) if (settings.models[t]) return settings.models[t];
  return "";
}

/** Models from the preset, for GET /ai/models when the provider can't list its own. */
export function presetModels(provider: ProviderId): string[] {
  const m = PROVIDER_PRESETS.find((p) => p.id === provider)?.models;
  return m ? [m.fast, m.smart, m.deep] : [];
}

export function capApplies(provider: ProviderId | "fake"): boolean {
  if (provider === "fake" || provider === "none") return false;
  return PROVIDER_PRESETS.find((p) => p.id === provider)?.capApplies ?? false;
}

/** Recommended local models (docs/ai/local-models.md), matched by prefix against /api/tags. */
export const RECOMMENDED_LOCAL: Record<ModelTier, string[]> = {
  fast: ["qwen3:8b", "llama3.1:8b", "gemma3:12b"],
  smart: ["qwen3:14b", "gemma3:27b", "mistral-small3.2"],
  deep: ["qwen3:32b", "llama3.3:70b"],
};

/** Pick a default per tier from the installed list (first recommendation that is installed). */
export function suggestLocalModels(installed: string[]): Record<ModelTier, string> {
  const pick = (tier: ModelTier) =>
    RECOMMENDED_LOCAL[tier].find((r) => installed.some((m) => m === r || m.startsWith(`${r}-`))) ?? "";
  const fast = pick("fast") || installed[0] || "";
  const smart = pick("smart") || fast;
  const deep = pick("deep") || smart;
  return { fast, smart, deep };
}
