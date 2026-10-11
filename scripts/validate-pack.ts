#!/usr/bin/env bun
/**
 * bun run validate:pack <dir…> [--all] [--profile <p>] [--json]
 *
 * Parses a pack's YAML sources and validates them against the zod schemas. Also checks the things a
 * schema alone can't see but every author trips on: file names match ids, every card has its file and
 * no checkpoint has one, `$data` refs resolve, every widget reference validates against that widget's
 * own props/goal/answer schemas, and the revision-3 card shape and gate wiring (core `cardShapeIssues`
 * and `gateShapeIssues`, the same checks `learncroc lint` runs). The full rule set is `learncroc lint`.
 *
 * Exit code 1 when any error is found.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  cardShapeIssues,
  gateShapeIssues,
  LintProfile,
  MapFile,
  PackLock,
  PackManifest,
  PackNode,
  WIDGET_IDS,
  type WidgetId,
} from "@learncroc/core";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import { isMap, isSeq, LineCounter, parseDocument, type Node as YamlNode } from "yaml";
import type { ZodType } from "zod";

interface Issue {
  severity: "error" | "warn";
  file: string;
  path: string;
  line?: number;
  message: string;
}

interface PackResult {
  dir: string;
  packId?: string;
  profile?: string;
  issues: Issue[];
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const all = args.includes("--all");
let profileArg: string | undefined;
const dirs: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i] as string;
  if (a === "--profile") profileArg = args[++i];
  else if (!a.startsWith("--")) dirs.push(a);
}

if (profileArg !== undefined && !LintProfile.safeParse(profileArg).success) {
  console.error(`--profile must be one of ${LintProfile.options.join(", ")}`);
  process.exit(2);
}

const repoRoot = resolve(import.meta.dir, "..");
if (all) {
  const packsDir = join(repoRoot, "packs");
  for (const name of existsSync(packsDir) ? readdirSync(packsDir).sort() : []) {
    const dir = join(packsDir, name);
    if (statSync(dir).isDirectory() && existsSync(join(dir, "pack.yaml"))) dirs.push(dir);
    if (name === "_pocket" && statSync(dir).isDirectory()) {
      for (const sub of readdirSync(dir).sort()) {
        const d = join(dir, sub);
        if (statSync(d).isDirectory() && existsSync(join(d, "pack.yaml"))) dirs.push(d);
      }
    }
  }
}

if (all && dirs.length === 0) {
  console.log("validate:pack --all: no pack folders under packs/ yet");
  process.exit(0);
}
if (dirs.length === 0) {
  console.error(
    "usage: bun run validate:pack <pack-dir…> [--all] [--profile curated|sampler|community|pocket] [--json]",
  );
  process.exit(2);
}

// ── YAML loading with line numbers

interface Loaded {
  value: unknown;
  doc: ReturnType<typeof parseDocument>;
  lines: LineCounter;
}

function loadYaml(file: string, rel: string, issues: Issue[]): Loaded | undefined {
  const lines = new LineCounter();
  const doc = parseDocument(readFileSync(file, "utf8"), { lineCounter: lines, prettyErrors: false, uniqueKeys: true });
  for (const err of doc.errors) {
    issues.push({
      severity: "error",
      file: rel,
      path: "",
      line: lines.linePos(err.pos[0]).line,
      message: `YAML: ${err.message}`,
    });
  }
  for (const warn of doc.warnings) {
    issues.push({
      severity: "warn",
      file: rel,
      path: "",
      line: lines.linePos(warn.pos[0]).line,
      message: `YAML: ${warn.message}`,
    });
  }
  if (doc.errors.length) return undefined;
  return { value: doc.toJS({ maxAliasCount: 100 }), doc, lines };
}

function lineOf(loaded: Loaded | undefined, path: readonly PropertyKey[]): number | undefined {
  if (!loaded) return undefined;
  let node: unknown = loaded.doc.contents;
  let found: YamlNode | undefined = node as YamlNode | undefined;
  for (const key of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => (p.key as { value?: unknown } | null)?.value === key);
      if (!pair) break;
      node = pair.value;
    } else if (isSeq(node) && typeof key === "number") {
      node = node.items[key];
    } else break;
    if (node && typeof node === "object" && "range" in node) found = node as YamlNode;
  }
  const offset = found?.range?.[0];
  return offset === undefined ? undefined : loaded.lines.linePos(offset).line;
}

function pointer(path: readonly PropertyKey[]): string {
  return path.length ? `/${path.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}` : "";
}

// ── $data refs: { $data: "data/<file>.json#/<json-pointer>" } anywhere in node files

function resolveData(
  value: unknown,
  packDir: string,
  rel: string,
  path: PropertyKey[],
  issues: Issue[],
  loaded?: Loaded,
): unknown {
  if (Array.isArray(value)) return value.map((v, i) => resolveData(v, packDir, rel, [...path, i], issues, loaded));
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 1 && keys[0] === "$data") {
    const ref = obj.$data;
    const fail = (message: string) => {
      issues.push({ severity: "error", file: rel, path: pointer(path), line: lineOf(loaded, path), message });
      return undefined;
    };
    if (typeof ref !== "string") return fail("$data must be a string");
    const m = /^(data\/[a-z0-9._/-]+\.json)(?:#(\/.*)?)?$/.exec(ref);
    if (!m || m[1]?.split("/").includes(".."))
      return fail(`$data must look like "data/<file>.json#/<pointer>" (got "${ref}")`);
    const file = join(packDir, m[1] as string);
    if (!existsSync(file)) return fail(`$data file not found: ${m[1]}`);
    let target: unknown;
    try {
      target = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      return fail(`$data file is not valid JSON: ${(e as Error).message}`);
    }
    for (const raw of (m[2] ?? "").split("/").slice(1)) {
      const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      if (target === null || typeof target !== "object" || !(key in (target as object)))
        return fail(`$data pointer not found: ${ref}`);
      target = (target as Record<string, unknown>)[key];
    }
    return target;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = resolveData(v, packDir, rel, [...path, k], issues, loaded);
  return out;
}

// ── schema validation

function check<T>(schema: ZodType<T>, value: unknown, rel: string, issues: Issue[], loaded?: Loaded): T | undefined {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  for (const iss of r.error.issues) {
    issues.push({
      severity: "error",
      file: rel,
      path: pointer(iss.path),
      line: lineOf(loaded, iss.path),
      message: iss.message,
    });
  }
  return undefined;
}

/** Walk any value and validate every widget reference ({ id: <widget id>, v, props }) against its spec. */
function checkWidgets(
  value: unknown,
  rel: string,
  path: PropertyKey[],
  issues: Issue[],
  loaded?: Loaded,
  parent?: Record<string, unknown>,
): void {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) checkWidgets(v, rel, [...path, i], issues, loaded);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const isRef =
    typeof obj.id === "string" && (WIDGET_IDS as readonly string[]).includes(obj.id) && "props" in obj && "v" in obj;
  if (isRef) {
    const spec = widgetSpecRegistry.get(obj.id as WidgetId);
    const at = (sub: PropertyKey[], message: string, severity: Issue["severity"] = "error") =>
      issues.push({
        severity,
        file: rel,
        path: pointer([...path, ...sub]),
        line: lineOf(loaded, [...path, ...sub]),
        message,
      });
    if (spec) {
      if (obj.v !== spec.version) at(["v"], `widget "${spec.id}" is version ${spec.version}, not ${String(obj.v)}`);
      const props = spec.props.safeParse(obj.props);
      if (!props.success)
        for (const iss of props.error.issues) at(["props", ...iss.path], `${spec.id} props: ${iss.message}`);
      let goal: unknown;
      if (obj.goal !== undefined) {
        if (!spec.goal) at(["goal"], `widget "${spec.id}" is explore-only and takes no goal`);
        else {
          const g = spec.goal.safeParse(obj.goal);
          if (!g.success)
            for (const iss of g.error.issues) at(["goal", ...iss.path], `${spec.id} goal: ${iss.message}`);
          else goal = g.data;
        }
      }
      // A sibling `solution` (widget interaction or item) must match the answer schema.
      if (parent && "solution" in parent && parent.widget === obj) {
        const s = spec.answer.safeParse(parent.solution);
        if (!s.success) {
          for (const iss of s.error.issues) {
            issues.push({
              severity: "error",
              file: rel,
              path: pointer([...path.slice(0, -1), "solution", ...iss.path]),
              line: lineOf(loaded, [...path.slice(0, -1), "solution"]),
              message: `${spec.id} solution: ${iss.message}`,
            });
          }
        } else if (props.success && goal !== undefined) {
          // Real graders only; placeholder graders always return score 0 with a "not implemented" note.
          const result = spec.grade({ props: props.data, goal, answer: s.data });
          const placeholder = !result.correct && result.feedback?.includes("not implemented");
          if (!placeholder) {
            for (const msg of spec.validate(props.data, goal)) at(["props"], `${spec.id}: ${msg}`);
            if (!result.correct)
              issues.push({
                severity: "error",
                file: rel,
                path: pointer([...path.slice(0, -1), "solution"]),
                line: lineOf(loaded, [...path.slice(0, -1), "solution"]),
                message: `${spec.id}: solution does not grade correct against the goal`,
              });
          }
        }
      }
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "props" && isRef) continue;
    checkWidgets(v, rel, [...path, k], issues, loaded, obj);
  }
}

function validatePack(dirArg: string): PackResult {
  const dir = resolve(dirArg);
  const issues: Issue[] = [];
  const result: PackResult = { dir: relative(process.cwd(), dir) || ".", issues };
  const relOf = (f: string) => relative(dir, f);
  const err = (file: string, message: string, path = "") => issues.push({ severity: "error", file, path, message });

  if (!existsSync(join(dir, "pack.yaml"))) {
    err("pack.yaml", "pack.yaml not found (is this a pack directory?)");
    return result;
  }

  const manifestY = loadYaml(join(dir, "pack.yaml"), "pack.yaml", issues);
  const manifest = manifestY && check(PackManifest, manifestY.value, "pack.yaml", issues, manifestY);
  result.packId = manifest?.id;
  result.profile = profileArg ?? manifest?.profile;
  if (manifest && basename(dir) !== manifest.id && !manifest.id.startsWith("pm-")) {
    issues.push({
      severity: "warn",
      file: "pack.yaml",
      path: "/id",
      message: `id "${manifest.id}" doesn't match the folder name "${basename(dir)}"`,
    });
  }
  if (manifest?.publisher === "learncroc" && !["curated", "sampler"].includes(manifest.profile)) {
    err("pack.yaml", 'publisher "learncroc" packs must use profile "curated" or "sampler"', "/profile");
  }

  const mapY = existsSync(join(dir, "map.yaml")) ? loadYaml(join(dir, "map.yaml"), "map.yaml", issues) : undefined;
  if (!mapY && !existsSync(join(dir, "map.yaml"))) err("map.yaml", "map.yaml not found");
  const map = mapY && check(MapFile, mapY.value, "map.yaml", issues, mapY);

  const nodeFiles = new Map<string, ReturnType<typeof PackNode.parse> | undefined>();
  const nodesDir = join(dir, "nodes");
  for (const f of existsSync(nodesDir)
    ? readdirSync(nodesDir)
        .filter((n) => n.endsWith(".yaml"))
        .sort()
    : []) {
    const file = join(nodesDir, f);
    const rel = relOf(file);
    const y = loadYaml(file, rel, issues);
    if (!y) continue;
    const value = resolveData(y.value, dir, rel, [], issues, y);
    const node = check(PackNode, value, rel, issues, y);
    checkWidgets(value, rel, [], issues, y);
    const id = basename(f, ".yaml");
    if (node && node.id !== id) err(rel, `node id "${node.id}" must match the file name "${id}"`, "/id");
    nodeFiles.set(id, node);
  }

  for (const gone of ["toy.yaml", "bosses"])
    if (existsSync(join(dir, gone)))
      err(gone, "bosses/ and toy.yaml were removed in revision 3; run `learncroc migrate`");

  if (existsSync(join(dir, "pack.lock.yaml"))) {
    const y = loadYaml(join(dir, "pack.lock.yaml"), "pack.lock.yaml", issues);
    if (y) check(PackLock, y.value ?? {}, "pack.lock.yaml", issues, y);
  }

  // ── cross-file structure (the cheap checks; `learncroc lint` does the rest)
  if (map) {
    const lineIds = new Set(map.lines.map((l) => l.id));
    for (const [id, entry] of Object.entries(map.nodes)) {
      const at = (message: string, sub = "") => err("map.yaml", message, `/nodes/${id}${sub}`);
      if (!lineIds.has(entry.line)) at(`line "${entry.line}" is not defined in lines`, "/line");
      for (const req of entry.requires) if (!(req in map.nodes)) at(`requires unknown entry "${req}"`, "/requires");
      const planned = entry.status === "planned";
      if (planned) {
        if (!entry.title) at("planned entries need a title", "/title");
        if (!entry.teaser) at("planned entries need a teaser", "/teaser");
        continue;
      }
      if (entry.kind !== "checkpoint" && !nodeFiles.has(id)) at(`playable card "${id}" has no nodes/${id}.yaml`);
    }
    for (const id of nodeFiles.keys()) {
      const entry = map.nodes[id];
      if (!entry) err(`nodes/${id}.yaml`, `node "${id}" is not in map.yaml`);
      else if (entry.kind === "checkpoint")
        err(`nodes/${id}.yaml`, `"${id}" is a checkpoint; checkpoints have no node file`);
      else if (entry.status === "planned")
        err(`nodes/${id}.yaml`, `"${id}" is planned in map.yaml but has a node file`);
    }
    if (manifest) {
      const ref = manifest.entry.suggestedStart;
      if (ref && !nodeFiles.has(ref))
        err("pack.yaml", `entry.suggestedStart "${ref}" is not a playable card file`, "/entry/suggestedStart");
      for (const [id] of Object.entries(manifest.theme.landmarks ?? {})) {
        if (!map.nodes[id]) err("pack.yaml", `landmark for unknown entry "${id}"`, `/theme/landmarks/${id}`);
      }
    }
  }

  // ── revision-3 shape: cards and gates (shared with `learncroc lint`)
  const profile = (result.profile ?? "community") as LintProfile;
  const lang = manifest?.lang ?? "en";
  const shaped = (i: {
    severity: Issue["severity"];
    file: string;
    path: (string | number)[];
    message: string;
    rule: string;
  }) => issues.push({ severity: i.severity, file: i.file, path: pointer(i.path), message: `${i.message} (${i.rule})` });
  for (const [id, node] of nodeFiles) if (node) for (const i of cardShapeIssues(id, node, profile, lang)) shaped(i);
  if (map) for (const i of gateShapeIssues(map, profile)) shaped(i);
  return result;
}

const results = dirs.map(validatePack);
if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    const errors = r.issues.filter((i) => i.severity === "error");
    const warns = r.issues.filter((i) => i.severity === "warn");
    const head = `${r.packId ?? r.dir}${r.profile ? ` (${r.profile})` : ""}`;
    console.log(
      errors.length
        ? `✗ ${head}: ${errors.length} error(s), ${warns.length} warning(s)`
        : `✓ ${head}: schema valid${warns.length ? `, ${warns.length} warning(s)` : ""}`,
    );
    for (const i of r.issues) {
      const loc = `${i.file}${i.line ? `:${i.line}` : ""}${i.path ? ` ${i.path}` : ""}`;
      console.log(`  ${i.severity === "error" ? "error" : "warn "} ${loc}  ${i.message}`);
    }
  }
}
process.exit(results.some((r) => r.issues.some((i) => i.severity === "error")) ? 1 : 0);
