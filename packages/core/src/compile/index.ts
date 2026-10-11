/**
 * YAML sources → CompiledPack (pack.json). The app only reads compiled packs; the dev server
 * compiles packs/* on the fly, `learncroc build-pack` writes them into .lmpack archives.
 *
 * Steps: load + validate (load.ts) → DAG checks and topological order (the reading order) → per card:
 * clone, fill generated flashcards, audio sources → checkpoints (covers, size, title, estMinutes; `gate`
 * on covered cards) → defaults (suggested start) → layout (layout.ts) → stats (cardWords) → content hash.
 */
import { checkpointCovers, defaultCheckpointSize } from "../checkpoint";
import { dagOf, missingRequires, topoSort } from "../dag";
import {
  type CompiledMapNode,
  CompiledPack,
  type IsoDate,
  type NodeId,
  type PackManifest,
  type PackNode,
} from "../schema/index";
import { LEARNCROC_VERSION } from "../version";
import type { PackFs } from "./fs";
import { type AudioManifest, fillAudio, generateFlashcards } from "./generate";
import { contentHashOf } from "./hash";
import { DEFAULT_CELL, layoutMap } from "./layout";
import { type LoadIssue, loadPackSources, type PackSources } from "./load";
import { cardWords, plainText } from "./text";

export interface CompileOptions {
  /** compiledWith.at (ISO 8601). Inject it for reproducible builds; default: the current time. */
  at?: IsoDate;
  /** Pocket cards still being generated: status "building", no node file needed yet. */
  building?: readonly NodeId[];
  /** Force the provisional flag (default: true while anything is building). */
  provisional?: boolean;
  /** Layout cell size (default 168 × 112). */
  cell?: { w: number; h: number };
}

export interface CompileResult {
  /** Present when the sources compiled without errors. */
  pack?: CompiledPack;
  sources: PackSources;
  /** Load, structure and compile problems (warnings don't block compiling). */
  issues: LoadIssue[];
}

export const AUDIO_MANIFEST_PATH = "data/audio-manifest.json";

/** Minutes a checkpoint attempt takes: about 45 seconds per question. */
export function checkpointMinutes(size: number): number {
  return Math.ceil(size * 0.75);
}

/** Compile a pack directory. */
export async function compilePack(fs: PackFs, opts: CompileOptions = {}): Promise<CompileResult> {
  const sources = await loadPackSources(fs, { building: opts.building ?? [] });
  return compileSources(sources, fs, opts);
}

async function readAudioManifest(fs: PackFs, issues: LoadIssue[]): Promise<AudioManifest | undefined> {
  if (!(await fs.exists(AUDIO_MANIFEST_PATH))) return undefined;
  try {
    const m = JSON.parse(await fs.readText(AUDIO_MANIFEST_PATH)) as Partial<AudioManifest>;
    if (m && typeof m === "object" && m.phrases && typeof m.phrases === "object") return { phrases: m.phrases };
  } catch (e) {
    issues.push({
      severity: "warn",
      file: AUDIO_MANIFEST_PATH,
      path: "",
      message: `unreadable: ${(e as Error).message}`,
    });
  }
  return undefined;
}

/** Fill a card's generated boilerplate (on a copy): flashcards when omitted, audio sources. */
export function finishNode(source: PackNode, audio?: AudioManifest): PackNode {
  const node = structuredClone(source);
  if (!node.flashcards) node.flashcards = generateFlashcards(node);
  fillAudio(node, audio);
  return node;
}

/** Compile already-loaded sources (lint reuses the loaded files). */
export async function compileSources(
  sources: PackSources,
  fs: PackFs,
  opts: CompileOptions = {},
): Promise<CompileResult> {
  const issues = [...sources.issues];
  const fail = (): CompileResult => ({ sources, issues });
  const manifestIn = sources.manifest?.value;
  const map = sources.map?.value;
  if (!manifestIn || !map || issues.some((i) => i.severity === "error")) return fail();

  const building = new Set(opts.building ?? []);
  const dag = dagOf(map.nodes);
  for (const m of missingRequires(dag)) {
    issues.push({
      severity: "error",
      file: "map.yaml",
      path: `/nodes/${m.node}/requires`,
      message: `"${m.node}" requires unknown entry "${m.requires}"`,
    });
  }
  const { order, cycle } = topoSort(dag);
  if (cycle)
    issues.push({
      severity: "error",
      file: "map.yaml",
      path: "/nodes",
      message: `the map has a cycle: ${cycle.join(" → ")}`,
    });
  if (issues.some((i) => i.severity === "error")) return fail();

  const audio = await readAudioManifest(fs, issues);
  const nodes: Record<NodeId, PackNode> = {};
  const mapNodes: Record<NodeId, CompiledMapNode> = {};

  for (const id of order) {
    const e = map.nodes[id];
    if (!e) continue;
    const kind = e.kind ?? "node";
    const status = building.has(id) && kind === "node" ? "building" : (e.status ?? "playable");
    const entry: CompiledMapNode = {
      id,
      requires: [...e.requires],
      line: e.line,
      kind,
      status,
      title: e.title ?? id,
      teaser: e.teaser ?? "",
    };
    if (status === "playable" && kind === "node") {
      const src = sources.nodes[id]?.value;
      if (!src) continue;
      const node = finishNode(src, audio);
      nodes[id] = node;
      entry.title = node.title;
      entry.teaser = plainText(node.hook.interaction.prompt);
      entry.estMinutes = node.estMinutes;
    } else if (kind === "checkpoint" && e.covers) {
      entry.covers = [...e.covers];
    }
    mapNodes[id] = entry;
  }

  // Checkpoints: resolve covers, size, title and minutes; covered cards point at their first gate.
  const graph = { nodes: mapNodes, topo: order };
  const gateName = manifestIn.theme.gateName;
  let n = 0;
  for (const id of order) {
    const entry = mapNodes[id];
    const e = map.nodes[id];
    if (entry?.kind !== "checkpoint" || !e) continue;
    n++;
    if (!e.title) entry.title = gateName ? `${gateName} ${n}` : `Checkpoint ${n}`;
    if (entry.status === "planned") {
      delete entry.covers;
      continue;
    }
    const covers = checkpointCovers(graph, id);
    const size = e.size ?? defaultCheckpointSize(covers.length);
    entry.covers = covers;
    entry.size = size;
    entry.estMinutes = checkpointMinutes(size);
    for (const c of covers) {
      const card = mapNodes[c];
      if (card && card.gate === undefined) card.gate = id;
    }
  }

  const manifest: PackManifest = structuredClone(manifestIn);
  if (!manifest.entry.suggestedStart) {
    const first = order.find(
      (id) =>
        mapNodes[id]?.kind === "node" &&
        mapNodes[id]?.status === "playable" &&
        (mapNodes[id]?.requires.length ?? 1) === 0,
    );
    if (first) manifest.entry.suggestedStart = first;
  }
  const pins: Record<NodeId, { col: number; row: number }> = {};
  for (const [id, e] of Object.entries(map.nodes)) if (e.pin) pins[id] = e.pin;
  const layout = await layoutMap({
    nodes: order.map((id) => mapNodes[id]).filter((n): n is CompiledMapNode => n !== undefined),
    lines: map.lines,
    direction: manifest.theme.direction,
    pins,
    cell: opts.cell ?? DEFAULT_CELL,
  });

  const nodeList = Object.values(nodes);
  const lang = manifest.lang;
  const all = Object.values(mapNodes);
  const pack: CompiledPack = {
    format: 2,
    manifest,
    map: { lines: structuredClone(map.lines), nodes: mapNodes, topo: order, layout },
    nodes,
    stats: {
      nodes: all.length,
      playable: all.filter((m) => m.status === "playable").length,
      planned: all.filter((m) => m.status === "planned").length,
      checkpoints: all.filter((m) => m.kind === "checkpoint").length,
      screens: nodeList.reduce((t, m) => t + m.screens.length, 0),
      items: nodeList.reduce((t, m) => t + m.items.length, 0),
      flashcards: nodeList.reduce((t, m) => t + (m.flashcards?.length ?? 0), 0),
      words: nodeList.reduce((t, m) => t + cardWords(m, lang).total, 0),
    },
    compiledWith: { learncroc: LEARNCROC_VERSION, at: opts.at ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
    contentHash: "",
    ...((opts.provisional ?? building.size > 0) ? { provisional: true } : {}),
  };
  pack.contentHash = await contentHashOf(pack as unknown as Record<string, unknown>);

  const check = CompiledPack.safeParse(pack);
  if (!check.success) {
    for (const iss of check.error.issues)
      issues.push({
        severity: "error",
        file: "pack.json",
        path: `/${iss.path.join("/")}`,
        message: `compiled output: ${iss.message}`,
      });
    return fail();
  }
  return { pack, sources, issues };
}

export { diskFs, memoryFs, type NodeFsPromises, type PackFs, walkFiles } from "./fs";
export * from "./generate";
export * from "./hash";
export * from "./layout";
export * from "./load";
export * from "./text";
