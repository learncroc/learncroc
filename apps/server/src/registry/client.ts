/**
 * Registry client and installer.
 *
 * Registries: the literal "builtin" (registry/index.json and registry/dist/ shipped with the app,
 * or, when that hasn't been built, the bundled source packs) and https URLs (http to loopback only
 * in --dev). Remote indexes are fetched through the URL guard and cached in cache/registry/ with a
 * stale flag when a refresh fails. Installs are registry-only over HTTP: resolve, download with
 * progress, verify sha256, check the archive (traversal, links, bombs, allowlist, MANIFEST),
 * validate the pack (schema, engine, SVG, html), then stage and rename into place.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type CompiledPack,
  type InstallEvent,
  PACK_ID_RE,
  type RegistryIndex,
  RegistryIndex as RegistryIndexSchema,
  type RegistryPack,
  type RegistryView,
  SEMVER_RE,
  type TryBundle,
  TryBundle as TryBundleSchema,
} from "@learncroc/core";
import { compare as semverCompare, gt as semverGt } from "semver";
import { compilePackDir } from "../packs/compile";
import { discoverSourcePacks, REPO_PACKS_DIR, type SourcePackDir } from "../packs/discover";
import { PackStore } from "../packs/store";
import { PackValidationError } from "../packs/validate";
import {
  checkUrlSyntax,
  type GuardedFetchOptions,
  guardedFetch,
  HttpError,
  resolveRemoteUrl,
  UrlRefusedError,
} from "../security/url-guard";
import { readJson, writeJsonAtomic } from "../util/fs";
import { readLmpack, sha256Hex, UnsafeArchiveError } from "./archive";
import { registryEntry, tryBundle } from "./build";

/** registry/ at the repo root (the builtin registry output of `registry build`). */
export const REPO_REGISTRY_DIR = resolve(import.meta.dir, "../../../../registry");

export type InstallErrorCode = Extract<InstallEvent, { type: "error" }>["code"];

export class InstallError extends Error {
  constructor(
    readonly code: InstallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InstallError";
  }
}

export class RegistryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryNotFoundError";
  }
}

const INDEX_TTL_MS = 60 * 60 * 1000;
const INDEX_MAX_BYTES = 5 * 1024 * 1024;
const TRY_MAX_BYTES = 5 * 1024 * 1024;
const PACK_MAX_BYTES = 100 * 1024 * 1024;

export interface RegistryClientOptions {
  store: PackStore;
  dev?: boolean;
  /** Builtin registry folder (index.json + dist/). Default: the repo's registry/. */
  builtinDir?: string;
  /** Bundled source packs, used for "builtin" when builtinDir has no index.json. */
  sourceDirs?: () => SourcePackDir[];
  now?: () => number;
  /** Tests: fetch and DNS stand-ins. */
  fetchImpl?: typeof fetch;
  resolveHost?: (host: string) => Promise<string[]>;
}

interface LoadedIndex {
  registry: string;
  index: RegistryIndex;
  /** Base URL (remote) for resolving relative urls. */
  base?: string;
  fetchedAt: number;
  stale: boolean;
}

interface CacheFile {
  url: string;
  fetchedAt: number;
  index: unknown;
}

export class RegistryClient {
  private readonly builtinDir: string;
  private memo = new Map<string, LoadedIndex>();

  constructor(private readonly opts: RegistryClientOptions) {
    this.builtinDir = opts.builtinDir ?? REPO_REGISTRY_DIR;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private guard(): GuardedFetchOptions {
    return {
      dev: this.opts.dev ?? false,
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      ...(this.opts.resolveHost ? { resolve: this.opts.resolveHost } : {}),
    };
  }

  /** Throws UrlRefusedError for anything but "builtin" and an allowed URL. */
  checkRegistryUrl(registry: string): void {
    if (registry === "builtin") return;
    checkUrlSyntax(registry, { dev: this.opts.dev ?? false });
  }

  // ── builtin

  private builtinHasIndex(): boolean {
    return existsSync(join(this.builtinDir, "index.json"));
  }

  private sources(): SourcePackDir[] {
    return (this.opts.sourceDirs ?? (() => discoverSourcePacks(REPO_PACKS_DIR)))().filter((d) => d.kind === "pack");
  }

  private async builtinIndex(): Promise<RegistryIndex> {
    if (this.builtinHasIndex()) return RegistryIndexSchema.parse(readJson(join(this.builtinDir, "index.json")));
    const now = new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
    const packs: RegistryPack[] = [];
    for (const d of this.sources()) {
      try {
        const pack = await compilePackDir(d.dir);
        if (pack.manifest.private) continue;
        packs.push(
          registryEntry(pack, {
            version: pack.manifest.version,
            engine: pack.manifest.engine,
            url: `source:${d.name}`,
            sha256: pack.contentHash,
            size: 0,
            nodes: pack.stats.nodes,
            playable: pack.stats.playable,
            estMinutes: pack.manifest.estMinutes,
            license: pack.manifest.license,
            published: now,
            tryUrl: `source:${d.name}`,
          }),
        );
      } catch {
        /* a broken source pack is simply not listed */
      }
    }
    return { registry: 1, name: "learncroc builtin", updated: now, packs };
  }

  /**
   * The bundled source folder behind a builtin entry: `source:<folder>` urls (derived index), or a
   * built index whose archive isn't present (fresh clones commit index.json, not dist/).
   */
  private builtinSourceDir(url: string, packId: string): string | undefined {
    if (url.startsWith("source:")) return this.sources().find((d) => d.name === url.slice("source:".length))?.dir;
    try {
      if (existsSync(this.builtinFile(url))) return undefined;
    } catch {
      return undefined;
    }
    return this.sources().find((d) => d.name === packId)?.dir;
  }

  /** Resolve a builtin-registry relative path, refusing anything outside the registry folder. */
  private builtinFile(rel: string): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith("/") || rel.includes("\\") || rel.split("/").includes(".."))
      throw new InstallError("url_refused", `builtin registry path ${rel} is not allowed`);
    return join(this.builtinDir, rel);
  }

  // ── index loading

  private cacheFile(url: string): string {
    return join(this.opts.store.paths.registryCache, `${sha256Hex(url).slice(0, 24)}.json`);
  }

  async loadIndex(registry: string, refresh = false): Promise<LoadedIndex> {
    if (registry === "builtin") {
      const hit = this.memo.get(registry);
      if (hit && !refresh) return hit;
      const loaded: LoadedIndex = { registry, index: await this.builtinIndex(), fetchedAt: this.now(), stale: false };
      this.memo.set(registry, loaded);
      return loaded;
    }
    this.checkRegistryUrl(registry);
    const hit = this.memo.get(registry);
    if (hit && !refresh && this.now() - hit.fetchedAt < INDEX_TTL_MS) return hit;
    const cached = (() => {
      try {
        const c = readJson(this.cacheFile(registry)) as CacheFile | undefined;
        const parsed = c && c.url === registry ? RegistryIndexSchema.safeParse(c.index) : undefined;
        return parsed?.success && c ? { index: parsed.data, fetchedAt: c.fetchedAt } : undefined;
      } catch {
        return undefined;
      }
    })();
    if (cached && !refresh && this.now() - cached.fetchedAt < INDEX_TTL_MS) {
      const loaded = { registry, index: cached.index, base: registry, fetchedAt: cached.fetchedAt, stale: false };
      this.memo.set(registry, loaded);
      return loaded;
    }
    try {
      const { url, bytes } = await guardedFetch(registry, {
        ...this.guard(),
        maxBytes: INDEX_MAX_BYTES,
        timeoutMs: 15_000,
      });
      const index = RegistryIndexSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      const fetchedAt = this.now();
      writeJsonAtomic(this.cacheFile(registry), { url: registry, fetchedAt, index } satisfies CacheFile);
      const loaded = { registry, index, base: url, fetchedAt, stale: false };
      this.memo.set(registry, loaded);
      return loaded;
    } catch (e) {
      if (cached) {
        const loaded = { registry, index: cached.index, base: registry, fetchedAt: cached.fetchedAt, stale: true };
        this.memo.set(registry, loaded);
        return loaded;
      }
      throw e;
    }
  }

  /** GET /registry: every configured registry merged, with installed versions and update flags. */
  async view(registries: string[], refresh = false): Promise<RegistryView> {
    const installed = this.opts.store.readInstalled().packs;
    const out: RegistryView = { packs: [], stale: false, errors: [] };
    const seen = new Set<string>();
    let fetchedAt: number | undefined;
    for (const registry of registries) {
      try {
        const loaded = await this.loadIndex(registry, refresh);
        out.stale ||= loaded.stale;
        fetchedAt = Math.max(fetchedAt ?? 0, loaded.fetchedAt);
        for (const p of loaded.index.packs) {
          if (seen.has(p.id)) continue; // first registry listing a pack wins
          seen.add(p.id);
          const inst = installed[p.id]?.active;
          out.packs.push({
            ...p,
            ...(inst ? { installed: inst } : {}),
            updateAvailable: !!inst && SEMVER_RE.test(p.latest) && semverGt(p.latest, inst),
            registry,
          });
        }
      } catch (e) {
        out.errors.push({ registry, message: (e as Error).message });
      }
    }
    if (fetchedAt !== undefined) out.fetchedAt = fetchedAt;
    return out;
  }

  private async findPack(id: string, registry?: string): Promise<{ loaded: LoadedIndex; pack: RegistryPack }> {
    if (!PACK_ID_RE.test(id)) throw new RegistryNotFoundError(`invalid pack id ${id}`);
    const candidates = registry ? [registry] : ["builtin"];
    for (const r of candidates) {
      const loaded = await this.loadIndex(r);
      const pack = loaded.index.packs.find((p) => p.id === id);
      if (pack) return { loaded, pack };
    }
    throw new RegistryNotFoundError(`pack ${id} is not in ${registry ?? "the builtin registry"}`);
  }

  /** GET /registry/:id/try */
  async tryBundle(id: string, registry?: string): Promise<TryBundle> {
    const { loaded, pack } = await this.findPack(id, registry);
    const v = pack.versions.find((x) => x.version === pack.latest) ?? pack.versions[0];
    if (!v) throw new RegistryNotFoundError(`pack ${id} lists no versions`);
    let raw: unknown;
    if (loaded.registry === "builtin") {
      const src = this.builtinSourceDir(v.tryUrl, id);
      if (src) return tryBundle(await compilePackDir(src));
      raw = JSON.parse(readFileSync(this.builtinFile(v.tryUrl), "utf8"));
    } else {
      const url = resolveRemoteUrl(v.tryUrl, loaded.base ?? loaded.registry, { dev: this.opts.dev ?? false });
      const { bytes } = await guardedFetch(url, { ...this.guard(), maxBytes: TRY_MAX_BYTES, timeoutMs: 15_000 });
      raw = JSON.parse(new TextDecoder().decode(bytes));
    }
    const bundle = TryBundleSchema.parse(raw);
    if (bundle.manifest.id !== id) throw new RegistryNotFoundError(`try bundle for ${id} names ${bundle.manifest.id}`);
    return bundle;
  }

  /**
   * Install a pack from a registry, reporting progress. Resolves with the installed pack; on
   * failure, emits a terminal `error` event and rejects with InstallError.
   */
  async install(
    req: { id: string; version?: string; registry?: string },
    emit: (e: InstallEvent) => void = () => {},
  ): Promise<CompiledPack> {
    try {
      if (req.version !== undefined && !SEMVER_RE.test(req.version))
        throw new InstallError("not_found", "invalid version");
      emit({ type: "resolving", id: req.id });
      let found: { loaded: LoadedIndex; pack: RegistryPack };
      try {
        found = await this.findPack(req.id, req.registry);
      } catch (e) {
        if (e instanceof UrlRefusedError) throw new InstallError("url_refused", e.message);
        if (e instanceof RegistryNotFoundError) throw new InstallError("not_found", e.message);
        throw new InstallError("network", (e as Error).message);
      }
      const { loaded, pack } = found;
      const want = req.version ?? pack.latest;
      const v = pack.versions.find((x) => x.version === want);
      if (!v) throw new InstallError("not_found", `pack ${req.id} has no version ${want}`);
      const record = {
        registry: loaded.registry,
        tier: pack.tier,
        source: loaded.registry === "builtin" ? ("builtin" as const) : ("registry" as const),
      };
      const src = loaded.registry === "builtin" ? this.builtinSourceDir(v.url, req.id) : undefined;
      if (src) {
        emit({ type: "downloading", received: 0, total: 0 });
        emit({ type: "verifying" });
        const compiled = await compilePackDir(src);
        emit({ type: "extracting" });
        const installed = this.opts.store.install(
          PackStore.filesFromSource(compiled, src),
          { ...record, sha256: compiled.contentHash },
          { expectId: req.id },
        );
        emit({ type: "done", id: installed.manifest.id, version: installed.manifest.version });
        return installed;
      }
      let bytes: Uint8Array;
      if (loaded.registry === "builtin") {
        const file = this.builtinFile(v.url);
        if (!existsSync(file)) throw new InstallError("not_found", `${v.url} is missing from the builtin registry`);
        bytes = new Uint8Array(readFileSync(file));
        emit({ type: "downloading", received: bytes.byteLength, total: bytes.byteLength });
      } else {
        let url: string;
        try {
          url = resolveRemoteUrl(v.url, loaded.base ?? loaded.registry, { dev: this.opts.dev ?? false });
        } catch (e) {
          throw new InstallError("url_refused", (e as Error).message);
        }
        let last = 0;
        try {
          ({ bytes } = await guardedFetch(url, {
            ...this.guard(),
            maxBytes: PACK_MAX_BYTES,
            timeoutMs: 120_000,
            onProgress: (received, total) => {
              if (received - last >= 64 * 1024 || received === total) {
                last = received;
                emit({ type: "downloading", received, total: total || v.size });
              }
            },
          }));
        } catch (e) {
          if (e instanceof UrlRefusedError) throw new InstallError("url_refused", e.message);
          if (e instanceof HttpError && e.status === 404) throw new InstallError("not_found", e.message);
          throw new InstallError("network", (e as Error).message);
        }
      }
      emit({ type: "verifying" });
      const sha = sha256Hex(bytes);
      if (sha !== v.sha256) throw new InstallError("hash_mismatch", `sha256 mismatch for ${req.id}@${want}`);
      const files = readLmpack(bytes);
      const peek = (() => {
        try {
          return JSON.parse(new TextDecoder().decode(files.get("pack.json"))) as { manifest?: { version?: unknown } };
        } catch {
          return {};
        }
      })();
      if (peek.manifest?.version !== want)
        throw new InstallError(
          "invalid_pack",
          `archive is version ${String(peek.manifest?.version)}, expected ${want}`,
        );
      emit({ type: "extracting" });
      const installed = this.opts.store.install(files, { ...record, sha256: sha }, { expectId: req.id });
      emit({ type: "done", id: installed.manifest.id, version: installed.manifest.version });
      return installed;
    } catch (e) {
      const err = toInstallError(e);
      emit({ type: "error", code: err.code, message: err.message });
      throw err;
    }
  }
}

export function toInstallError(e: unknown): InstallError {
  if (e instanceof InstallError) return e;
  if (e instanceof UnsafeArchiveError) return new InstallError("unsafe_archive", e.message);
  if (e instanceof PackValidationError)
    return new InstallError(e.code === "unsafe_archive" ? "unsafe_archive" : e.code, e.message);
  if (e instanceof UrlRefusedError) return new InstallError("url_refused", e.message);
  return new InstallError("invalid_pack", (e as Error).message);
}

/** `learncroc install ./x.lmpack`: in-process install of a local archive (never via HTTP). */
export function installLocalFile(store: PackStore, file: string): CompiledPack {
  const bytes = new Uint8Array(readFileSync(file));
  try {
    const files = readLmpack(bytes);
    return store.install(files, { source: "file", tier: "local", sha256: sha256Hex(bytes) });
  } catch (e) {
    throw toInstallError(e);
  }
}

/** Newest first. */
export const sortVersions = (vs: string[]) => [...vs].sort((a, b) => semverCompare(b, a));
