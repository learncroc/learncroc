/**
 * Settings and provider config (CONTRACTS §10).
 */
import { z } from "zod";
import { AiFeature, Millis, ModelTier, ProviderId } from "./primitives";

export const ProviderPreset = z.object({
  id: ProviderId.exclude(["none"]),
  label: z.string(),
  /** null = the user picks from GET /ai/models (recommendations in docs/ai/local-models.md). */
  models: z.record(ModelTier, z.string()).nullable(),
  /** Monthly $ cap applies (cloud providers). */
  capApplies: z.boolean(),
});
export type ProviderPreset = z.infer<typeof ProviderPreset>;

/** Alphabetical; the UI presents them side by side without ranking. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    models: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5", deep: "claude-opus-5-5" },
    capApplies: true,
  },
  { id: "ollama", label: "Ollama", models: null, capApplies: false },
  { id: "openai-compatible", label: "OpenAI-compatible", models: null, capApplies: true },
];

const SettingsAi = z.object({
  /** Default "none". */
  provider: ProviderId,
  /** openai-compatible / ollama (default http://127.0.0.1:11434); changing it clears the stored key. */
  baseUrl: z.string().optional(),
  models: z.record(ModelTier, z.string()),
  keySource: z.enum(["env", "file", "none"]),
  /** "sk-ant-…3f2a" — never the key. */
  keyMasked: z.string().optional(),
  /** Default "smart". */
  tutorTier: z.enum(["fast", "smart"]),
  /** Default 5. */
  monthlyCapUsd: z.number().min(0),
});

const SettingsLearning = z.object({
  /** Default 8. */
  dailyRelight: z.literal([5, 8, 12]),
  /** 0.85..0.95, default 0.90. */
  targetRetention: z.number().min(0.85).max(0.95),
  /** Default { enabled: false, time: "19:00" }; local OS notification, no counts. */
  reminder: z.object({ enabled: z.boolean(), time: z.string().regex(/^\d{2}:\d{2}$/) }),
});

const SettingsAppearance = z.object({
  theme: z.enum(["system", "light", "dark"]),
  font: z.enum(["recursive", "atkinson"]),
  /** 0.9..1.5 */
  textScale: z.number().min(0.9).max(1.5),
  reducedMotion: z.enum(["system", "on", "off"]),
  contrast: z.enum(["normal", "more"]),
  mapLabels: z.enum(["always", "zoom"]),
});

/** Default enabled false, volume 0.6, offered false (the one-time offer after the first gate opens). */
const SettingsSound = z.object({ enabled: z.boolean(), volume: z.number().min(0).max(1), offered: z.boolean() });
/** Moss. "quiet" keeps animations and chat, drops unsolicited bubbles. Default "chatty". */
const SettingsCroc = z.object({ reactions: z.enum(["chatty", "quiet"]) });
/** Default false. */
const SettingsExperiments = z.object({ creditFlowsDown: z.boolean() });

export const Settings = z.object({
  ai: SettingsAi,
  learning: SettingsLearning,
  appearance: SettingsAppearance,
  sound: SettingsSound,
  croc: SettingsCroc,
  experiments: SettingsExperiments,
  /**
   * Default ["builtin", "https://learncroc.github.io/registry/index.json"].
   * Only "builtin" is local; every other entry must be https (http loopback only with --dev).
   */
  registries: z.array(z.string()),
  /** `completed` turns true at the first card close. */
  firstRun: z.object({ completed: z.boolean(), completedAt: Millis.optional() }),
});

export const SettingsPatch = z.object({
  ai: SettingsAi.omit({ keySource: true, keyMasked: true }).partial().optional(),
  learning: SettingsLearning.partial().optional(),
  appearance: SettingsAppearance.partial().optional(),
  sound: SettingsSound.partial().optional(),
  croc: SettingsCroc.partial().optional(),
  experiments: SettingsExperiments.partial().optional(),
  /** Validated by the URL guard; "file:" and private addresses rejected. */
  registries: z.array(z.string()).optional(),
});

export const DEFAULT_REGISTRIES = ["builtin", "https://learncroc.github.io/registry/index.json"];

/** Defaults from CONTRACTS §10. */
export const DEFAULT_SETTINGS: z.infer<typeof Settings> = {
  ai: {
    provider: "none",
    models: { fast: "", smart: "", deep: "" },
    keySource: "none",
    tutorTier: "smart",
    monthlyCapUsd: 5,
  },
  learning: { dailyRelight: 8, targetRetention: 0.9, reminder: { enabled: false, time: "19:00" } },
  appearance: {
    theme: "system",
    font: "recursive",
    textScale: 1,
    reducedMotion: "system",
    contrast: "normal",
    mapLabels: "zoom",
  },
  sound: { enabled: false, volume: 0.6, offered: false },
  croc: { reactions: "chatty" },
  experiments: { creditFlowsDown: false },
  registries: DEFAULT_REGISTRIES,
  firstRun: { completed: false },
};

export const UsageSummary = z.object({
  /** "2026-10" */
  month: z.string(),
  /** Estimated from tokens × packages/ai/prices.json. */
  spentUsd: z.number(),
  capUsd: z.number(),
  byFeature: z.record(AiFeature, z.object({ calls: z.number(), usd: z.number() })),
});

export type Settings = z.infer<typeof Settings>;
export type SettingsPatch = z.infer<typeof SettingsPatch>;
export type UsageSummary = z.infer<typeof UsageSummary>;
