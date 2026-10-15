/**
 * Where the AI layer gets its settings and key. Environment variables beat the file
 * (ANTHROPIC_API_KEY, OPENAI_API_KEY, LEARNCROC_AI_BASE_URL); the file is <home>/config.json,
 * mode 0600, written atomically. Keys are only ever read here, never logged or returned.
 *
 * File shape (the same file the settings routes write):
 *   { "settings": <Settings without ai.keySource/keyMasked>, "key": { "provider", "key", "baseUrl"? } }
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_SETTINGS, type ProviderId, type Settings } from "@learncroc/core";

export type KeyedProvider = Exclude<ProviderId, "none">;

export interface AiConfigSource {
  /** Current settings, with keySource/keyMasked filled in. */
  settings(): Settings;
  /** The key for the active provider (never leaves the server). */
  key(): string | undefined;
}

interface ConfigFile {
  settings?: Partial<Omit<Settings, "ai">> & { ai?: Partial<Settings["ai"]> };
  key?: { provider: KeyedProvider; key: string; baseUrl?: string };
}

/** "sk-ant-api03-abcdef…3f2a" → "sk-ant-…3f2a". */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "…";
  const prefix = /^(sk-ant-|sk-or-|sk-)/.exec(k)?.[0] ?? k.slice(0, 3);
  return `${prefix}…${k.slice(-4)}`;
}

const ENV_KEYS: Record<KeyedProvider, string | undefined> = {
  anthropic: "ANTHROPIC_API_KEY",
  "openai-compatible": "OPENAI_API_KEY",
  ollama: undefined,
};

function merge(base: Settings, over: ConfigFile["settings"]): Settings {
  if (!over) return structuredClone(base);
  return {
    ...base,
    ...over,
    ai: { ...base.ai, ...over.ai, models: { ...base.ai.models, ...over.ai?.models } },
    learning: { ...base.learning, ...over.learning },
    appearance: { ...base.appearance, ...over.appearance },
    sound: { ...base.sound, ...over.sound },
    experiments: { ...base.experiments, ...over.experiments },
    firstRun: { ...base.firstRun, ...over.firstRun },
  } as Settings;
}

export class FileAiConfig implements AiConfigSource {
  private cached: { mtime: number; file: ConfigFile } | undefined;
  readonly path: string;

  constructor(
    home: string,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {
    this.path = join(home, "config.json");
  }

  private read(): ConfigFile {
    let mtime = -1;
    try {
      mtime = statSync(this.path).mtimeMs;
    } catch {
      return {};
    }
    if (this.cached && this.cached.mtime === mtime) return this.cached.file;
    try {
      const file = JSON.parse(readFileSync(this.path, "utf8")) as ConfigFile;
      this.cached = { mtime, file };
      return file;
    } catch {
      return {};
    }
  }

  settings(): Settings {
    const file = this.read();
    const s = merge(DEFAULT_SETTINGS, file.settings);
    // A key in the environment selects its provider when none is chosen yet.
    if (s.ai.provider === "none") {
      if (this.env.ANTHROPIC_API_KEY) s.ai.provider = "anthropic";
      else if (this.env.OPENAI_API_KEY && this.env.LEARNCROC_AI_BASE_URL) s.ai.provider = "openai-compatible";
    }
    if (this.env.LEARNCROC_AI_BASE_URL && s.ai.provider === "openai-compatible")
      s.ai.baseUrl = this.env.LEARNCROC_AI_BASE_URL;
    const { key, source } = this.keyWithSource(s.ai.provider, file);
    s.ai.keySource = source;
    if (key) s.ai.keyMasked = maskKey(key);
    else delete s.ai.keyMasked;
    return s;
  }

  key(): string | undefined {
    const file = this.read();
    return this.keyWithSource(this.settings().ai.provider, file).key;
  }

  private keyWithSource(provider: ProviderId, file: ConfigFile): { key?: string; source: Settings["ai"]["keySource"] } {
    if (provider === "none") return { source: "none" };
    const envName = ENV_KEYS[provider];
    const fromEnv = envName ? this.env[envName] : undefined;
    if (fromEnv) return { key: fromEnv, source: "env" };
    const fromFile = file.key?.provider === provider ? file.key.key : undefined;
    if (fromFile) return { key: fromFile, source: "file" };
    return { source: "none" };
  }

  /** Atomic write with mode 0600 (used by tests and by the settings routes). */
  write(next: ConfigFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
    try {
      chmodSync(this.path, 0o600);
    } catch {
      /* Windows */
    }
    this.cached = undefined;
  }

  /** Store a key (tests and the CLI; the server's settings routes write the same shape). */
  setKey(provider: KeyedProvider, key: string, baseUrl?: string): string {
    const file = this.read();
    const ai = { ...file.settings?.ai, provider, ...(baseUrl ? { baseUrl } : {}) };
    this.write({
      ...file,
      settings: { ...file.settings, ai },
      key: { provider, key: key.trim(), ...(baseUrl ? { baseUrl } : {}) },
    });
    return maskKey(key);
  }

  clearKey(): void {
    const { key: _drop, ...rest } = this.read();
    this.write(rest);
  }
}

/** Settings and key supplied directly (tests, the CLI). */
export class StaticAiConfig implements AiConfigSource {
  constructor(
    private s: Settings,
    private k?: string,
  ) {}
  settings(): Settings {
    return this.s;
  }
  key(): string | undefined {
    return this.k;
  }
  set(s: Settings, k?: string): void {
    this.s = s;
    this.k = k;
  }
}
