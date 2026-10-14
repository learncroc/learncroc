/**
 * Settings and the AI key (PLAN D20, §15.1): ~/.learncroc/config.json, written atomically with mode
 * 0600. Environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, LEARNCROC_AI_BASE_URL) win over
 * the file. The key itself never leaves this module except through `aiKey()` (server-side only);
 * GET /settings carries `keySource` and a masked key.
 */
import { chmodSync, existsSync } from "node:fs";
import {
  DEFAULT_SETTINGS,
  type ProviderId,
  type Settings,
  type SettingsPatch,
  Settings as SettingsSchema,
} from "@learncroc/core";
import { z } from "zod";
import { homePaths } from "../home";
import { readJson, writeJsonAtomic } from "../util/fs";

const StoredKey = z.object({
  provider: z.enum(["anthropic", "openai-compatible", "ollama"]),
  key: z.string().min(1),
  baseUrl: z.string().optional(),
});
type StoredKey = z.infer<typeof StoredKey>;

const ConfigFile = z.object({
  settings: z.unknown().optional(),
  key: StoredKey.optional(),
});

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

/** "sk-ant-api03-…3f2a" → "sk-ant-…3f2a". Short keys are fully masked. */
export function maskKey(key: string): string {
  if (key.length < 12) return "…";
  const dash = key.indexOf("-", 3);
  const prefix = dash > 0 && dash <= 7 ? key.slice(0, dash + 1) : key.slice(0, 3);
  return `${prefix}…${key.slice(-4)}`;
}

const ENV_KEY: Record<Exclude<ProviderId, "none">, string | null> = {
  anthropic: "ANTHROPIC_API_KEY",
  "openai-compatible": "OPENAI_API_KEY",
  ollama: null,
};

type Stored = Omit<Settings, "ai"> & { ai: Omit<Settings["ai"], "keySource" | "keyMasked"> };

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (Array.isArray(base) || typeof base !== "object" || base === null) return patch as T;
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out as T;
}

export interface SettingsStoreOptions {
  home: string;
  env?: Record<string, string | undefined>;
  /** Validates registry URLs; throws on a refused URL. */
  checkRegistry?: (url: string) => void;
}

export class SettingsStore {
  private readonly file: string;
  private readonly env: Record<string, string | undefined>;
  private cache: { settings: Stored; key?: StoredKey } | undefined;

  constructor(private readonly opts: SettingsStoreOptions) {
    this.file = homePaths(opts.home).config;
    this.env = opts.env ?? process.env;
  }

  private load(): { settings: Stored; key?: StoredKey } {
    if (this.cache) return this.cache;
    let raw: z.infer<typeof ConfigFile> = {};
    try {
      raw = ConfigFile.parse(readJson(this.file) ?? {});
    } catch {
      raw = {};
    }
    const merged = deepMerge(DEFAULT_SETTINGS, raw.settings);
    const parsed = SettingsSchema.safeParse({ ...merged, ai: { ...merged.ai, keySource: "none" } });
    const settings = parsed.success ? parsed.data : DEFAULT_SETTINGS;
    const { keySource: _s, keyMasked: _m, ...ai } = settings.ai;
    this.cache = { settings: { ...settings, ai }, ...(raw.key ? { key: raw.key } : {}) };
    if (existsSync(this.file)) {
      try {
        chmodSync(this.file, 0o600);
      } catch {
        /* best effort on filesystems without modes */
      }
    }
    return this.cache;
  }

  private save(next: { settings: Stored; key?: StoredKey }): void {
    writeJsonAtomic(this.file, next, 0o600);
    this.cache = next;
  }

  private envKey(provider: ProviderId): string | undefined {
    if (provider === "none") return undefined;
    const name = ENV_KEY[provider];
    const v = name ? this.env[name] : undefined;
    return v?.trim() ? v.trim() : undefined;
  }

  /** The provider's key (env first, then the file). Server-side only: never put this in a response. */
  aiKey(): { provider: ProviderId; key: string; source: "env" | "file" } | null {
    const { settings, key } = this.load();
    const provider = settings.ai.provider;
    const env = this.envKey(provider);
    if (env) return { provider, key: env, source: "env" };
    if (key && key.provider === provider) return { provider, key: key.key, source: "file" };
    return null;
  }

  /** Effective base URL: LEARNCROC_AI_BASE_URL beats the stored value. */
  aiBaseUrl(): string | undefined {
    return this.env.LEARNCROC_AI_BASE_URL?.trim() || this.load().settings.ai.baseUrl;
  }

  get(): Settings {
    const { settings } = this.load();
    const k = this.aiKey();
    const baseUrl = this.aiBaseUrl();
    return {
      ...settings,
      ai: {
        ...settings.ai,
        ...(baseUrl ? { baseUrl } : {}),
        keySource: k ? k.source : "none",
        ...(k ? { keyMasked: maskKey(k.key) } : {}),
      },
    };
  }

  /** The persisted settings without key fields (for export files). */
  stored(): Stored {
    return structuredClone(this.load().settings);
  }

  patch(patch: SettingsPatch): Settings {
    const cur = this.load();
    if (patch.registries) {
      for (const r of patch.registries) if (r !== "builtin") this.opts.checkRegistry?.(r);
    }
    const next = deepMerge(cur.settings, patch);
    const parsed = SettingsSchema.safeParse({ ...next, ai: { ...next.ai, keySource: "none" } });
    if (!parsed.success) throw new SettingsError(parsed.error.issues[0]?.message ?? "invalid settings");
    const { keySource: _s, keyMasked: _m, ...ai } = parsed.data.ai;
    let key = cur.key;
    // Changing the base URL clears the stored key (PLAN §15.1).
    if (patch.ai?.baseUrl !== undefined && patch.ai.baseUrl !== cur.settings.ai.baseUrl) key = undefined;
    this.save({ settings: { ...parsed.data, ai }, ...(key ? { key } : {}) });
    return this.get();
  }

  /** Replace every stored setting (import). The key is kept. */
  replace(settings: Stored): Settings {
    const cur = this.load();
    const parsed = SettingsSchema.safeParse({ ...settings, ai: { ...settings.ai, keySource: "none" } });
    if (!parsed.success) throw new SettingsError(parsed.error.issues[0]?.message ?? "invalid settings");
    const { keySource: _s, keyMasked: _m, ...ai } = parsed.data.ai;
    this.save({ settings: { ...parsed.data, ai }, ...(cur.key ? { key: cur.key } : {}) });
    return this.get();
  }

  /** The first card close: `firstRun` turns completed once and stays that way (the `/` redirect reads it). */
  markFirstRun(now: number): void {
    const cur = this.load();
    if (cur.settings.firstRun.completed) return;
    this.save({
      settings: { ...cur.settings, firstRun: { completed: true, completedAt: now } },
      ...(cur.key ? { key: cur.key } : {}),
    });
  }

  setKey(input: { provider: Exclude<ProviderId, "none">; key: string; baseUrl?: string }): { keyMasked: string } {
    const key = input.key.trim();
    if (!key || key.length > 512 || /\s/.test(key)) throw new SettingsError("invalid key");
    const cur = this.load();
    const settings: Stored = {
      ...cur.settings,
      ai: {
        ...cur.settings.ai,
        provider: input.provider,
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      },
    };
    this.save({
      settings,
      key: { provider: input.provider, key, ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}) },
    });
    return { keyMasked: maskKey(key) };
  }

  clearKey(): void {
    const cur = this.load();
    this.save({ settings: cur.settings });
  }

  /** Drop the in-memory copy (another process wrote the file). */
  invalidate(): void {
    this.cache = undefined;
  }
}
