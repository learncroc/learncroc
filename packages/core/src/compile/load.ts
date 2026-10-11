/**
 * Load a pack's YAML sources: parse (keeping the YAML documents for line numbers and lint
 * suppressions), inline `$data` references, validate every file against its zod schema and check
 * the cross-file structure (ids match file names, every card has its file, checkpoints have none,
 * planned entries have a title and a teaser).
 */
import { isMap, isSeq, LineCounter, parseDocument, type Document as YamlDocument, type Node as YamlNode } from "yaml";
import type { ZodType } from "zod";
import { MapFile, NODE_ID_RE, PackLock, PackManifest, PackNode } from "../schema/index";
import { type PackFs, walkFiles } from "./fs";

/** A problem found while loading (reported by lint as rule L000). */
export interface LoadIssue {
  severity: "error" | "warn";
  file: string;
  /** JSON pointer. */
  path: string;
  line?: number;
  message: string;
}

export interface SourceFile<T> {
  path: string;
  text: string;
  doc: YamlDocument;
  lines: LineCounter;
  /** The plain value after `$data` inlining (before schema parsing). */
  raw: unknown;
  /** The schema-parsed value, when valid. */
  value?: T;
}

export interface PackSources {
  manifest?: SourceFile<PackManifest>;
  map?: SourceFile<MapFile>;
  lock?: SourceFile<PackLock>;
  /** Keyed by the file's node id (file name). */
  nodes: Record<string, SourceFile<PackNode>>;
  /** Every file in the pack (pack-relative). */
  files: string[];
  issues: LoadIssue[];
}

/** JSON pointer for a path. */
export function pointer(path: readonly PropertyKey[]): string {
  return path.length ? `/${path.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}` : "";
}

/** Parse a JSON pointer back into keys (array indices stay strings). */
export function parsePointer(ptr: string): string[] {
  if (!ptr) return [];
  return ptr
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** The YAML node at a path (deepest existing ancestor), for line numbers and comments. */
export function yamlNodeAt(doc: YamlDocument, path: readonly PropertyKey[]): YamlNode | undefined {
  let node: unknown = doc.contents;
  let found = node as YamlNode | undefined;
  for (const key of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => String((p.key as { value?: unknown } | null)?.value) === String(key));
      if (!pair) break;
      node = pair.value;
    } else if (isSeq(node)) {
      node = node.items[Number(key)];
    } else break;
    if (node && typeof node === "object" && "range" in node) found = node as YamlNode;
  }
  return found;
}

/** 1-based line of a path in a source file. */
export function lineOf(
  file: Pick<SourceFile<unknown>, "doc" | "lines">,
  path: readonly PropertyKey[],
): number | undefined {
  const offset = yamlNodeAt(file.doc, path)?.range?.[0];
  return offset === undefined ? undefined : file.lines.linePos(offset).line;
}

const DATA_RE = /^(data\/[a-z0-9._/-]+\.json)(?:#(\/.*)?)?$/;

async function inlineData(
  value: unknown,
  fs: PackFs,
  file: SourceFile<unknown>,
  path: PropertyKey[],
  issues: LoadIssue[],
  cache: Map<string, unknown>,
): Promise<unknown> {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) out.push(await inlineData(value[i], fs, file, [...path, i], issues, cache));
    return out;
  }
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 1 && keys[0] === "$data") {
    const fail = (message: string) => {
      issues.push({ severity: "error", file: file.path, path: pointer(path), line: lineOf(file, path), message });
      return undefined;
    };
    const ref = obj.$data;
    if (typeof ref !== "string") return fail("$data must be a string");
    const m = DATA_RE.exec(ref);
    const rel = m?.[1];
    if (!m || !rel || rel.split("/").includes(".."))
      return fail(`$data must look like "data/<file>.json#/<pointer>" (got "${ref}")`);
    if (!cache.has(rel)) {
      if (!(await fs.exists(rel)) || (fs.isInside && !(await fs.isInside(rel))))
        return fail(`$data file not found: ${rel}`);
      try {
        cache.set(rel, JSON.parse(await fs.readText(rel)));
      } catch (e) {
        return fail(`$data file is not valid JSON: ${(e as Error).message}`);
      }
    }
    let target = cache.get(rel);
    for (const key of parsePointer(m[2] ?? "")) {
      if (target === null || typeof target !== "object" || !Object.hasOwn(target, key))
        return fail(`$data pointer not found: ${ref}`);
      target = (target as Record<string, unknown>)[key];
    }
    return structuredClone(target);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = await inlineData(v, fs, file, [...path, k], issues, cache);
  return out;
}

async function loadFile<T>(
  fs: PackFs,
  path: string,
  schema: ZodType<T>,
  issues: LoadIssue[],
  opts: { data?: boolean; cache: Map<string, unknown> },
): Promise<SourceFile<T> | undefined> {
  let text: string;
  try {
    text = await fs.readText(path);
  } catch (e) {
    issues.push({ severity: "error", file: path, path: "", message: `can't read: ${(e as Error).message}` });
    return undefined;
  }
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false, uniqueKeys: true });
  for (const err of doc.errors) {
    issues.push({
      severity: "error",
      file: path,
      path: "",
      line: lines.linePos(err.pos[0]).line,
      message: `YAML: ${err.message}`,
    });
  }
  for (const w of doc.warnings) {
    issues.push({
      severity: "warn",
      file: path,
      path: "",
      line: lines.linePos(w.pos[0]).line,
      message: `YAML: ${w.message}`,
    });
  }
  const file: SourceFile<T> = { path, text, doc, lines, raw: undefined };
  if (doc.errors.length) return file;
  let raw: unknown = doc.toJS({ maxAliasCount: 100 });
  if (opts.data) raw = await inlineData(raw, fs, file as SourceFile<unknown>, [], issues, opts.cache);
  file.raw = raw;
  const r = schema.safeParse(raw);
  if (r.success) file.value = r.data;
  else {
    for (const iss of r.error.issues) {
      issues.push({
        severity: "error",
        file: path,
        path: pointer(iss.path),
        line: lineOf(file, iss.path),
        message: iss.message,
      });
    }
  }
  return file;
}

async function yamlFilesIn(fs: PackFs, dir: string): Promise<string[]> {
  return (await fs.list(dir)).filter((n) => !n.endsWith("/") && /\.ya?ml$/.test(n)).sort();
}

/** Load and validate every source file of a pack. Never throws on content problems. */
export async function loadPackSources(fs: PackFs, opts: { building?: readonly string[] } = {}): Promise<PackSources> {
  const issues: LoadIssue[] = [];
  const cache = new Map<string, unknown>();
  const sources: PackSources = { nodes: {}, files: await walkFiles(fs), issues };

  if (!(await fs.exists("pack.yaml")))
    issues.push({ severity: "error", file: "pack.yaml", path: "", message: "pack.yaml is missing" });
  else {
    const mark = issues.length;
    sources.manifest = await loadFile(fs, "pack.yaml", PackManifest, issues, { cache });
    const schema = (sources.manifest?.raw as { schema?: unknown } | undefined)?.schema;
    if (typeof schema === "number" && schema < 2) {
      // One clear message instead of every field the old format names.
      issues.splice(mark);
      issues.push({
        severity: "error",
        file: "pack.yaml",
        path: "/schema",
        message: `pack format ${schema}: run \`learncroc migrate\``,
      });
    }
  }
  if (!(await fs.exists("map.yaml")))
    issues.push({ severity: "error", file: "map.yaml", path: "", message: "map.yaml is missing" });
  else sources.map = await loadFile(fs, "map.yaml", MapFile, issues, { cache });
  if (await fs.exists("pack.lock.yaml"))
    sources.lock = await loadFile(fs, "pack.lock.yaml", PackLock, issues, { cache });
  if ((await fs.exists("toy.yaml")) || sources.files.some((f) => f.startsWith("bosses/")))
    issues.push({
      severity: "error",
      file: (await fs.exists("toy.yaml")) ? "toy.yaml" : "bosses/",
      path: "",
      message: "bosses/ and toy.yaml were removed in revision 3; run `learncroc migrate`",
    });

  for (const name of await yamlFilesIn(fs, "nodes")) {
    const id = name.replace(/\.ya?ml$/, "");
    const path = `nodes/${name}`;
    const f = await loadFile(fs, path, PackNode, issues, { data: true, cache });
    if (!f) continue;
    if (!NODE_ID_RE.test(id))
      issues.push({ severity: "error", file: path, path: "", message: `file name "${id}" isn't a valid node id` });
    const fileId = (f.raw as { id?: unknown } | undefined)?.id;
    if (typeof fileId === "string" && fileId !== id)
      issues.push({
        severity: "error",
        file: path,
        path: "/id",
        line: lineOf(f, ["id"]),
        message: `id "${fileId}" doesn't match the file name "${id}"`,
      });
    sources.nodes[id] = f;
  }
  checkStructure(sources, new Set(opts.building ?? []));
  return sources;
}

/** Cross-file checks that compiling depends on (lint adds the full rule set on top). */
function checkStructure(s: PackSources, building: ReadonlySet<string>): void {
  const map = s.map?.value;
  if (!map || !s.map) return;
  const mapFile = s.map;
  const at = (path: PropertyKey[]) => ({ file: "map.yaml", path: pointer(path), line: lineOf(mapFile, path) });
  const lineIds = new Set(map.lines.map((l) => l.id));
  for (const [id, e] of Object.entries(map.nodes)) {
    const kind = e.kind ?? "node";
    const status = e.status ?? "playable";
    if (!lineIds.has(e.line))
      s.issues.push({ severity: "error", ...at(["nodes", id, "line"]), message: `unknown line "${e.line}"` });
    if (status === "planned") {
      if (!e.title)
        s.issues.push({ severity: "error", ...at(["nodes", id]), message: `planned entry "${id}" needs a title` });
      if (!e.teaser)
        s.issues.push({ severity: "error", ...at(["nodes", id]), message: `planned entry "${id}" needs a teaser` });
      continue;
    }
    if (kind === "node" && !s.nodes[id] && !building.has(id))
      s.issues.push({ severity: "error", ...at(["nodes", id]), message: `card "${id}" has no nodes/${id}.yaml` });
  }
  for (const id of Object.keys(s.nodes)) {
    const e = map.nodes[id];
    if (e?.kind === "checkpoint")
      s.issues.push({
        severity: "error",
        file: `nodes/${id}.yaml`,
        path: "",
        message: `"${id}" is a checkpoint; checkpoints have no node file`,
      });
    else if (!e)
      s.issues.push({
        severity: "warn",
        file: `nodes/${id}.yaml`,
        path: "",
        message: `node "${id}" isn't on the map (map.yaml)`,
      });
  }
}
