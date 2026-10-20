/**
 * `learncroc registry build` / `bun run registry:build`: compile every pack source folder into an
 * .lmpack, write a TryBundle per version, and write index.json with poster sketches.
 * The same output is the local `builtin` registry (registry/) and the published official registry.
 *
 * URLs in index.json are relative ("dist/<id>-<version>.lmpack") so the folder works from disk, from
 * a loopback dev server and from GitHub Pages alike. Version entries from an existing index.json
 * are kept when their archive is still present, so publishing never drops old versions; files in dist/
 * that no version references any more (packs that stopped compiling, older formats) are removed.
 * Try bundles hold the suggested start card only, in card shape (pack format 2).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CompiledPack,
  type RegistryIndex,
  RegistryIndex as RegistryIndexSchema,
  type RegistryPack,
  type TryBundle,
} from "@learncroc/core";
import { compare as semverCompare } from "semver";
import { compilePackDir } from "../packs/compile";
import type { SourcePackDir } from "../packs/discover";
import { PackStore } from "../packs/store";
import { usesCustomInteractives, validatePackFiles } from "../packs/validate";
import { writeFileAtomic, writeJsonAtomic } from "../util/fs";
import { buildLmpack, sha256Hex } from "./archive";

export interface RegistryBuildOptions {
  dirs: SourcePackDir[];
  outDir: string;
  name?: string;
  /** ISO timestamp for `updated`/`published` (default now). */
  now?: string;
  /** Include pocket maps (private packs are never published). Default false. */
  includePrivate?: boolean;
}

export interface RegistryBuildReport {
  index: RegistryIndex;
  built: { id: string; version: string; file: string; sha256: string; size: number }[];
  errors: { dir: string; message: string }[];
}

export function suggestedStart(pack: Pick<CompiledPack, "manifest" | "map">): string | undefined {
  const s = pack.manifest.entry.suggestedStart;
  if (s && pack.map.nodes[s]?.status === "playable" && pack.map.nodes[s]?.kind === "node") return s;
  return pack.map.topo.find((id) => {
    const n = pack.map.nodes[id];
    return n?.status === "playable" && n.kind === "node" && n.requires.length === 0;
  });
}

export function tryBundle(pack: CompiledPack): TryBundle {
  const start = suggestedStart(pack);
  const node = start ? pack.nodes[start] : undefined;
  if (!node) throw new Error(`pack ${pack.manifest.id} has no playable first card`);
  return { manifest: pack.manifest, map: pack.map, node };
}

export function sketchOf(pack: CompiledPack): RegistryPack["sketch"] {
  const { layout, nodes, lines } = pack.map;
  return {
    width: layout.width,
    height: layout.height,
    nodes: pack.map.topo.map((id) => {
      const n = nodes[id];
      const p = layout.nodes[id] ?? { x: 0, y: 0 };
      return {
        id,
        x: p.x,
        y: p.y,
        line: n?.line ?? lines[0]?.id ?? "main",
        kind: n?.kind ?? "node",
        status: n?.status === "planned" ? ("planned" as const) : ("playable" as const),
      };
    }),
    edges: layout.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    lines: lines.map((l) => ({ id: l.id, color: l.color })),
  };
}

export function registryEntry(
  pack: CompiledPack,
  version: RegistryPack["versions"][number],
  previous: RegistryPack["versions"] = [],
): RegistryPack {
  const m = pack.manifest;
  const versions = [version, ...previous.filter((v) => v.version !== version.version)].sort((a, b) =>
    semverCompare(b.version, a.version),
  );
  return {
    id: m.id,
    title: m.title,
    ...(m.subtitle ? { subtitle: m.subtitle } : {}),
    ...(m.tagline ? { tagline: m.tagline } : {}),
    publisher: m.publisher,
    tier: m.publisher === "learncroc" ? "official" : "community",
    category: m.category,
    tags: m.tags,
    lang: m.lang,
    profile: m.profile,
    review: m.status,
    ...(m.reviewers?.length ? { reviewers: m.reviewers.map((r) => ({ name: r.name, role: r.role })) } : {}),
    customInteractives: usesCustomInteractives(pack),
    theme: {
      renderer: m.theme.renderer,
      world: m.theme.world,
      mode: m.theme.mode,
      ground: m.theme.ground,
      texture: m.theme.texture,
      lines: m.theme.lines,
      token: m.theme.token,
    },
    outcomes: m.outcomes,
    sketch: sketchOf(pack),
    latest: versions[0]?.version ?? m.version,
    versions,
  };
}

function readExisting(outDir: string): RegistryIndex | undefined {
  const f = join(outDir, "index.json");
  if (!existsSync(f)) return undefined;
  const parsed = RegistryIndexSchema.safeParse(JSON.parse(readFileSync(f, "utf8")));
  return parsed.success ? parsed.data : undefined;
}

export async function buildRegistry(opts: RegistryBuildOptions): Promise<RegistryBuildReport> {
  const now = opts.now ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const dist = join(opts.outDir, "dist");
  mkdirSync(dist, { recursive: true });
  const existing = readExisting(opts.outDir);
  const report: RegistryBuildReport = {
    index: { registry: 1, name: opts.name ?? "learncroc builtin", updated: now, packs: [] },
    built: [],
    errors: [],
  };
  const seen = new Set<string>();
  for (const d of opts.dirs) {
    try {
      const first = await compilePackDir(d.dir, { at: now });
      const m = first.manifest;
      if (m.private && !opts.includePrivate) continue;
      if (seen.has(m.id)) throw new Error(`duplicate pack id ${m.id}`);
      seen.add(m.id);
      const prevVersion = existing?.packs.find((p) => p.id === m.id)?.versions.find((v) => v.version === m.version);
      // Rebuilding unchanged content reproduces the same archive (and sha256) as last time.
      const archive = (pack: CompiledPack) => {
        const files = PackStore.filesFromSource(pack, d.dir);
        validatePackFiles(files);
        return buildLmpack([...files].map(([path, data]) => ({ path, data })));
      };
      let pack = first;
      let bytes = archive(first);
      let published = now;
      if (prevVersion) {
        const again = await compilePackDir(d.dir, { at: prevVersion.published });
        const againBytes = archive(again);
        if (sha256Hex(againBytes) === prevVersion.sha256) {
          pack = again;
          bytes = againBytes;
          published = prevVersion.published;
        }
      }
      const base = `${m.id}-${m.version}`;
      const sha256 = sha256Hex(bytes);
      writeFileAtomic(join(dist, `${base}.lmpack`), bytes);
      writeJsonAtomic(join(dist, `${base}.try.json`), tryBundle(pack));
      const version: RegistryPack["versions"][number] = {
        version: m.version,
        engine: m.engine,
        url: `dist/${base}.lmpack`,
        sha256,
        size: bytes.byteLength,
        nodes: pack.stats.nodes,
        playable: pack.stats.playable,
        estMinutes: m.estMinutes,
        license: m.license,
        published,
        tryUrl: `dist/${base}.try.json`,
      };
      const previous = (existing?.packs.find((p) => p.id === m.id)?.versions ?? []).filter((v) =>
        existsSync(join(opts.outDir, v.url)),
      );
      report.index.packs.push(registryEntry(pack, version, previous));
      report.built.push({
        id: m.id,
        version: m.version,
        file: join(dist, `${base}.lmpack`),
        sha256,
        size: bytes.byteLength,
      });
    } catch (e) {
      report.errors.push({ dir: d.dir, message: (e as Error).message });
    }
  }
  report.index.packs.sort((a, b) => a.id.localeCompare(b.id));
  RegistryIndexSchema.parse(report.index);
  writeJsonAtomic(join(opts.outDir, "index.json"), report.index);
  const referenced = new Set(
    report.index.packs
      .flatMap((p) => p.versions.flatMap((v) => [v.url, v.tryUrl]))
      .map((u) => u.replace(/^dist\//, "")),
  );
  for (const name of readdirSync(dist))
    if ((name.endsWith(".lmpack") || name.endsWith(".try.json")) && !referenced.has(name))
      rmSync(join(dist, name), { force: true });
  return report;
}

/** Write a single pack's .lmpack (learncroc build-pack). Returns the file path and sha256. */
export async function buildPackArchive(
  dir: string,
  outDir: string,
): Promise<{ file: string; sha256: string; size: number; pack: CompiledPack }> {
  const pack = await compilePackDir(dir);
  const files = PackStore.filesFromSource(pack, dir);
  validatePackFiles(files);
  const bytes = buildLmpack([...files].map(([path, data]) => ({ path, data })));
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${pack.manifest.id}-${pack.manifest.version}.lmpack`);
  writeFileSync(file, bytes);
  return { file, sha256: sha256Hex(bytes), size: bytes.byteLength, pack };
}
