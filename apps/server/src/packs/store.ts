/**
 * PackStore: the server's PackSource. Installed compiled packs live in ~/.learncroc/packs/<id>@<ver>/
 * (pocket maps under packs/local/), recorded in installed.json (atomic writes). In --dev, source
 * folders under packs/ are compiled on the fly and override installed copies with the same id.
 *
 * Installs go through one path: validate the file set, write it to .staging/, then rename into
 * place. Versions stay installed while an open run pins them; `gc()` removes unpinned, inactive ones.
 */
import {
  existsSync,
  type FSWatcher,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import {
  ASSET_PATH_RE,
  type CompiledPack,
  CompiledPack as CompiledPackSchema,
  type InstalledFile,
  InstalledFile as InstalledFileSchema,
  type InstalledPackSummary,
  type InstalledRecord,
  PACK_ID_RE,
  type PackSource,
  SEMVER_RE,
  SERVABLE_ASSET_RE,
} from "@learncroc/core";
import { compare as semverCompare } from "semver";
import { ensureHome, type homePaths } from "../home";
import { readJson, writeJsonAtomic } from "../util/fs";
import { compilePackDir } from "./compile";
import type { SourcePackDir } from "./discover";
import { usesCustomInteractives, validatePackFiles } from "./validate";

export class PackNotFoundError extends Error {
  constructor(
    readonly packId: string,
    readonly version?: string,
  ) {
    super(`pack "${packId}"${version ? ` version ${version}` : ""} is not installed`);
    this.name = "PackNotFoundError";
  }
}

/** Library copy for a compiled pack made by an older version of the app (pack format other than 2). */
export const OLD_FORMAT_MESSAGE = {
  pocket: "Built with an older version. Rebuild this map.",
  pack: "Made for an older version of Learncroc.",
} as const;

/** An installed pack.json whose `format` this version can't play. */
export class PackFormatError extends Error {
  constructor(
    readonly packId: string,
    readonly format: unknown,
    readonly pocket: boolean,
    readonly title: string,
  ) {
    super(pocket ? OLD_FORMAT_MESSAGE.pocket : OLD_FORMAT_MESSAGE.pack);
    this.name = "PackFormatError";
  }
}

function rawManifest(raw: unknown): { title?: unknown; private?: unknown; profile?: unknown } {
  if (typeof raw !== "object" || raw === null) return {};
  const m = (raw as { manifest?: unknown }).manifest;
  return typeof m === "object" && m !== null ? (m as { title?: unknown; private?: unknown; profile?: unknown }) : {};
}

export interface PackStoreOptions {
  home: string;
  /** Source folders compiled on the fly (--dev, `learncroc play`). */
  devDirs?: SourcePackDir[];
  /** Watch dev folders and recompile on change. */
  watch?: boolean;
}

interface DevEntry {
  dir: SourcePackDir;
  pack?: CompiledPack;
  error?: string;
  stamp?: string;
}

function isPocket(pack: CompiledPack): boolean {
  return pack.manifest.private === true || pack.manifest.profile === "pocket";
}

/** A cheap change stamp for a source folder: newest mtime and file count. */
function dirStamp(dir: string): string {
  let newest = 0;
  let count = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith(".")) continue;
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        count++;
        newest = Math.max(newest, st.mtimeMs);
      }
    }
  };
  walk(dir);
  return `${count}:${newest}`;
}

export class PackStore implements PackSource {
  readonly paths: ReturnType<typeof homePaths>;
  private readonly cache = new Map<string, CompiledPack>();
  private readonly dev = new Map<string, DevEntry>();
  private watchers: FSWatcher[] = [];
  private listeners = new Set<(packId: string) => void>();

  constructor(private readonly opts: PackStoreOptions) {
    this.paths = ensureHome(opts.home);
    for (const d of opts.devDirs ?? []) this.addDevDir(d);
  }

  // ── installed.json

  readInstalled(): InstalledFile {
    try {
      const parsed = InstalledFileSchema.safeParse(readJson(this.paths.installed));
      if (parsed.success) return parsed.data;
    } catch {
      /* corrupt file: treat as empty, it is rewritten on the next install */
    }
    return { installed: 1, packs: {} };
  }

  private writeInstalled(f: InstalledFile): void {
    writeJsonAtomic(this.paths.installed, f);
  }

  /** True when nothing has ever been installed (first run). */
  isFresh(): boolean {
    return !existsSync(this.paths.installed);
  }

  versionDir(id: string, version: string, pocket: boolean): string {
    if (!PACK_ID_RE.test(id) || !SEMVER_RE.test(version)) throw new PackNotFoundError(id, version);
    return join(pocket ? this.paths.localPacks : this.paths.packs, `${id}@${version}`);
  }

  private installedDir(id: string, version: string): string | null {
    for (const pocket of [false, true]) {
      const d = this.versionDir(id, version, pocket);
      if (existsSync(join(d, "pack.json"))) return d;
    }
    return null;
  }

  // ── dev packs

  addDevDir(d: SourcePackDir): void {
    this.dev.set(d.name, { dir: d });
    if (this.opts.watch) {
      try {
        const w = watch(d.dir, { recursive: true }, () => {
          const entry = this.dev.get(d.name);
          if (entry) entry.stamp = undefined;
          for (const l of this.listeners) l(entry?.pack?.manifest.id ?? d.name);
        });
        this.watchers.push(w);
      } catch {
        /* recursive watch unsupported: the stamp check still picks up changes */
      }
    }
  }

  /** Subscribe to dev-pack changes (dev reload). */
  onChange(fn: (packId: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async devEntries(): Promise<DevEntry[]> {
    const out: DevEntry[] = [];
    for (const e of this.dev.values()) {
      let stamp: string;
      try {
        stamp = dirStamp(e.dir.dir);
      } catch {
        continue;
      }
      if (e.stamp !== stamp) {
        e.stamp = stamp;
        try {
          e.pack = await compilePackDir(e.dir.dir);
          e.error = undefined;
        } catch (err) {
          e.pack = undefined;
          e.error = (err as Error).message;
        }
      }
      out.push(e);
    }
    return out;
  }

  private async devPack(id: string): Promise<DevEntry | undefined> {
    return (await this.devEntries()).find((e) => (e.pack?.manifest.id ?? e.dir.name) === id);
  }

  // ── PackSource

  async list(): Promise<InstalledPackSummary[]> {
    const out = new Map<string, InstalledPackSummary>();
    const installed = this.readInstalled();
    for (const [id, entry] of Object.entries(installed.packs)) {
      const rec = entry.versions[entry.active];
      if (!rec) continue;
      try {
        const pack = await this.loadInstalled(id, entry.active);
        out.set(id, this.summary(pack, rec.tier));
      } catch (e) {
        if (e instanceof PackFormatError)
          out.set(id, {
            ...this.invalidSummary(id, entry.active, rec.tier, e.message),
            title: e.title,
            kind: e.pocket ? "pocket" : "pack",
            ...(e.pocket ? { profile: "pocket" as const } : {}),
          });
        else out.set(id, this.invalidSummary(id, entry.active, rec.tier, (e as Error).message));
      }
    }
    for (const e of await this.devEntries()) {
      if (e.pack) out.set(e.pack.manifest.id, this.summary(e.pack, "local"));
      else out.set(e.dir.name, this.invalidSummary(e.dir.name, "0.0.0", "local", e.error ?? "does not compile"));
    }
    return [...out.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  async get(id: string, version?: string): Promise<CompiledPack> {
    if (!PACK_ID_RE.test(id) || (version !== undefined && !SEMVER_RE.test(version)))
      throw new PackNotFoundError(id, version);
    const dev = await this.devPack(id);
    if (dev?.pack && (version === undefined || version === dev.pack.manifest.version)) return dev.pack;
    const installed = this.readInstalled().packs[id];
    const v = version ?? installed?.active;
    if (!installed || !v || !installed.versions[v]) throw new PackNotFoundError(id, version);
    return this.loadInstalled(id, v);
  }

  private async loadInstalled(id: string, version: string): Promise<CompiledPack> {
    const key = `${id}@${version}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const dir = this.installedDir(id, version);
    if (!dir) throw new PackNotFoundError(id, version);
    const raw: unknown = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
    const format = typeof raw === "object" && raw !== null ? (raw as { format?: unknown }).format : undefined;
    if (format !== 2) {
      const m = rawManifest(raw);
      const pocket = m.private === true || m.profile === "pocket" || dir.startsWith(this.paths.localPacks);
      throw new PackFormatError(id, format, pocket, typeof m.title === "string" ? m.title.slice(0, 200) : id);
    }
    const pack = CompiledPackSchema.parse(raw);
    this.cache.set(key, pack);
    return pack;
  }

  summary(pack: CompiledPack, tier: InstalledPackSummary["tier"]): InstalledPackSummary {
    const { manifest, map, stats } = pack;
    const start = manifest.entry.suggestedStart ?? map.topo.find((n) => map.nodes[n]?.status === "playable");
    return {
      id: manifest.id,
      version: manifest.version,
      title: manifest.title,
      ...(manifest.subtitle ? { subtitle: manifest.subtitle } : {}),
      category: manifest.category,
      theme: manifest.theme,
      tier,
      kind: isPocket(pack) ? "pocket" : "pack",
      profile: manifest.profile,
      review: manifest.status,
      customInteractives: usesCustomInteractives(pack),
      nodes: stats.nodes,
      playable: stats.playable - stats.checkpoints,
      checkpoints: stats.checkpoints,
      done: 0,
      lit: 0,
      fading: 0,
      finished: false,
      ...(start ? { next: { nodeId: start, title: map.nodes[start]?.title ?? start } } : {}),
      status: pack.provisional ? "building" : "ok",
    };
  }

  private invalidSummary(
    id: string,
    version: string,
    tier: InstalledPackSummary["tier"],
    message: string,
  ): InstalledPackSummary {
    return {
      id: PACK_ID_RE.test(id) ? id : "invalid-pack",
      version: SEMVER_RE.test(version) ? version : "0.0.0",
      title: id,
      category: "practical",
      theme: {
        renderer: "metro",
        world: id,
        mode: "dark",
        direction: "lr",
        ground: "#0F1430",
        texture: "none",
        lines: ["#7FB2FF", "#C792F2", "#F07DA6", "#9AD07A", "#E6E1D3"],
        token: "train",
      },
      tier,
      kind: "pack",
      profile: "community",
      review: "draft",
      customInteractives: false,
      nodes: 0,
      playable: 0,
      checkpoints: 0,
      done: 0,
      lit: 0,
      fading: 0,
      finished: false,
      status: "invalid",
      statusMessage: message.slice(0, 500),
    };
  }

  // ── assets

  /**
   * Absolute path of a servable asset (svg/png/webp/mp3/ogg), or null. Checks the regex, rejects
   * `..`, resolves the real path and requires it to stay under the pack root.
   */
  async assetFile(
    id: string,
    asset: string,
    opts: { version?: string; allowHtml?: boolean } = {},
  ): Promise<string | null> {
    const re = opts.allowHtml ? ASSET_PATH_RE : SERVABLE_ASSET_RE;
    if (!re.test(asset) || asset.split("/").includes("..")) return null;
    if (asset.endsWith(".html") && !asset.startsWith("assets/interactive/")) return null;
    let root: string | null = null;
    const dev = await this.devPack(id);
    if (dev?.pack && (opts.version === undefined || opts.version === dev.pack.manifest.version)) root = dev.dir.dir;
    else {
      const installed = this.readInstalled().packs[id];
      const v = opts.version ?? installed?.active;
      if (installed && v && installed.versions[v] && PACK_ID_RE.test(id)) root = this.installedDir(id, v);
    }
    if (!root) return null;
    const candidate = join(root, asset);
    if (!existsSync(candidate)) return null;
    let real: string;
    let realRoot: string;
    try {
      real = realpathSync(candidate);
      realRoot = realpathSync(root);
    } catch {
      return null;
    }
    if (!real.startsWith(realRoot + sep)) return null;
    if (!statSync(real).isFile()) return null;
    return real;
  }

  // ── installs

  /**
   * Validate and install a compiled file set (pack.json + assets + LICENSE/README/MANIFEST).
   * Atomic: staged, then renamed into place. The new version becomes active.
   */
  install(
    files: Map<string, Uint8Array>,
    rec: Omit<InstalledRecord, "installedAt"> & { installedAt?: string },
    opts: { expectId?: string } = {},
  ): CompiledPack {
    const pack = validatePackFiles(files, opts);
    const { id, version } = pack.manifest;
    const target = this.versionDir(id, version, isPocket(pack));
    const staging = join(this.paths.staging, `${id}@${version}.${crypto.randomUUID().slice(0, 8)}`);
    rmSync(staging, { recursive: true, force: true });
    try {
      for (const [path, data] of files) {
        mkdirSync(dirname(join(staging, path)), { recursive: true });
        writeFileSync(join(staging, path), data);
      }
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      renameSync(staging, target);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    const installed = this.readInstalled();
    const entry = installed.packs[id] ?? { active: version, versions: {} };
    const prev = entry.versions[version];
    entry.versions[version] = {
      ...rec,
      installedAt: rec.installedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      ...(prev?.pinnedBy?.length ? { pinnedBy: prev.pinnedBy } : {}),
    };
    entry.active = version;
    installed.packs[id] = entry;
    this.writeInstalled(installed);
    this.cache.delete(`${id}@${version}`);
    this.gc();
    for (const l of this.listeners) l(id);
    return pack;
  }

  /** Build the installable file set for a compiled pack whose assets live in a source folder. */
  static filesFromSource(pack: CompiledPack, sourceDir: string): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    files.set("pack.json", new TextEncoder().encode(JSON.stringify(pack)));
    for (const name of ["LICENSE", "README.md"]) {
      const p = join(sourceDir, name);
      if (existsSync(p)) files.set(name, new Uint8Array(readFileSync(p)));
    }
    const assets = join(sourceDir, "assets");
    const walk = (d: string, rel: string) => {
      for (const name of readdirSync(d).sort()) {
        if (name.startsWith(".")) continue;
        const p = join(d, name);
        const r = `${rel}/${name}`;
        const st = statSync(p);
        if (st.isDirectory()) walk(p, r);
        else if (st.isFile() && ASSET_PATH_RE.test(r)) files.set(r, new Uint8Array(readFileSync(p)));
      }
    };
    if (existsSync(assets)) walk(assets, "assets");
    return files;
  }

  /** Remove a pack (all versions, or one). Learner progress lives in the database and is kept. */
  uninstall(id: string, version?: string): boolean {
    const installed = this.readInstalled();
    const entry = installed.packs[id];
    if (!entry) return false;
    const versions = version ? [version] : Object.keys(entry.versions);
    let removed = false;
    for (const v of versions) {
      if (!entry.versions[v]) continue;
      delete entry.versions[v];
      this.cache.delete(`${id}@${v}`);
      for (const pocket of [false, true]) rmSync(this.versionDir(id, v, pocket), { recursive: true, force: true });
      removed = true;
    }
    const left = Object.keys(entry.versions).sort(semverCompare);
    if (left.length === 0) delete installed.packs[id];
    else if (!entry.versions[entry.active]) entry.active = left[left.length - 1] as string;
    this.writeInstalled(installed);
    for (const l of this.listeners) l(id);
    return removed;
  }

  /** Keep a version installed while a run is open on it. */
  pin(id: string, version: string, runId: string): void {
    const installed = this.readInstalled();
    const rec = installed.packs[id]?.versions[version];
    if (!rec) return;
    const pins = new Set(rec.pinnedBy ?? []);
    if (pins.has(runId)) return;
    pins.add(runId);
    rec.pinnedBy = [...pins];
    this.writeInstalled(installed);
  }

  unpin(runId: string): void {
    const installed = this.readInstalled();
    let changed = false;
    for (const entry of Object.values(installed.packs))
      for (const rec of Object.values(entry.versions))
        if (rec.pinnedBy?.includes(runId)) {
          rec.pinnedBy = rec.pinnedBy.filter((r) => r !== runId);
          if (rec.pinnedBy.length === 0) delete rec.pinnedBy;
          changed = true;
        }
    if (changed) {
      this.writeInstalled(installed);
      this.gc();
    }
  }

  /** Delete inactive versions no open run pins. Returns the removed "id@version" keys. */
  gc(): string[] {
    const installed = this.readInstalled();
    const removed: string[] = [];
    for (const [id, entry] of Object.entries(installed.packs)) {
      for (const [v, rec] of Object.entries(entry.versions)) {
        if (v === entry.active || rec.pinnedBy?.length) continue;
        delete entry.versions[v];
        this.cache.delete(`${id}@${v}`);
        for (const pocket of [false, true]) rmSync(this.versionDir(id, v, pocket), { recursive: true, force: true });
        removed.push(`${id}@${v}`);
      }
    }
    if (removed.length) this.writeInstalled(installed);
    return removed;
  }

  /** Drop cached compiled packs (e.g. a pocket map was rewritten while building). */
  invalidate(id?: string): void {
    if (!id) this.cache.clear();
    else for (const k of [...this.cache.keys()]) if (k.startsWith(`${id}@`)) this.cache.delete(k);
    for (const l of this.listeners) l(id ?? "*");
  }

  close(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}
