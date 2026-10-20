#!/usr/bin/env bun
/**
 * bun run schemas
 *
 * Generates JSON Schemas (schemas/*.schema.json, published under CC0 at
 * https://learncroc.github.io/schema/v1/) and reference docs (docs/reference/*.md) from the zod schemas.
 *
 * - Doc comments on schema fields (the contract notes) become JSON Schema `description`s, so editors
 *   show them on hover in pack YAML files.
 * - Widget references get one branch per built-in widget, so `props` and `goal` autocomplete too.
 *
 * `--check` exits 1 if the committed files are out of date (used by tests and CI).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as core from "@learncroc/core";
import * as widgetSpecs from "@learncroc/widgets/spec";
import { z } from "zod";

const root = resolve(import.meta.dir, "..");
const SCHEMA_BASE = "https://learncroc.github.io/schema/v1/";
const check = process.argv.includes("--check");

type Json = Record<string, unknown>;
type AnyZod = z.ZodType;

/** The files we publish. `kind` is the file stem: <kind>.schema.json. */
export const SCHEMA_FILES: { kind: string; schema: AnyZod; title: string; description: string; source: string }[] = [
  {
    kind: "pack",
    schema: core.PackManifest,
    title: "learncroc pack manifest",
    description: "pack.yaml: identity, theme and entry point of a pack.",
    source: "pack.yaml",
  },
  {
    kind: "map",
    schema: core.MapFile,
    title: "learncroc map",
    description: "map.yaml: lines and the prerequisite graph of cards, checkpoints and planned cards.",
    source: "map.yaml",
  },
  {
    kind: "node",
    schema: core.PackNode,
    title: "learncroc card",
    description: "nodes/<id>.yaml: one card (hook, 2–3 beats, close) and its item bank.",
    source: "nodes/<id>.yaml",
  },
  {
    kind: "lock",
    schema: core.PackLock,
    title: "learncroc pack lock",
    description: "pack.lock.yaml: AI provenance and human review sign-offs.",
    source: "pack.lock.yaml",
  },
  {
    kind: "compiled-pack",
    schema: core.CompiledPack,
    title: "learncroc compiled pack",
    description: "pack.json inside a .lmpack.",
    source: "pack.json",
  },
  {
    kind: "registry",
    schema: core.RegistryIndex,
    title: "learncroc registry index",
    description: "A registry's index.json.",
    source: "index.json",
  },
];

// ── 1. collect doc comments from the schema sources

/** topName → (dotted key path → doc) */
type DocTable = Map<string, Map<string, string>>;

function scanDocs(src: string, table: DocTable): void {
  // A small scanner: tracks `export const Name =`, object-literal frames with their key paths,
  // `/** … */` comments and `...spread` of earlier consts.
  const re =
    /\/\*\*([\s\S]*?)\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\.\.\.([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*:(?!:)|(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=|[{}()[\],]/g;
  interface Frame {
    path: string[];
    depth: number;
    key?: string;
    atPropStart: boolean;
  }
  let top: string | undefined;
  let frames: Frame[] = [];
  let depth = 0; // paren + bracket depth
  let pendingDoc: string | undefined;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const tok = m[0];
    const frame = frames[frames.length - 1];
    if (m[1] !== undefined) {
      pendingDoc = m[1]
        .split("\n")
        .map((l) => l.replace(/^\s*\*\s?/, "").trim())
        .filter(Boolean)
        .join(" ");
      continue;
    }
    if (tok.startsWith("//") || tok.startsWith('"') || tok.startsWith("'") || tok.startsWith("`")) continue;
    if (m[5] !== undefined && frames.length === 0) {
      top = m[5];
      if (pendingDoc) topDocs.set(top, pendingDoc);
      frames = [];
      pendingDoc = undefined;
      continue;
    }
    if (m[2] !== undefined && frame && top) {
      const spread = table.get(m[2]);
      const into = table.get(top) ?? new Map<string, string>();
      for (const [k, v] of spread ?? []) into.set([...frame.path, k].join("."), v);
      table.set(top, into);
      continue;
    }
    if (m[3] !== undefined) {
      if (frame?.atPropStart && depth === frame.depth && top) {
        frame.key = m[3];
        frame.atPropStart = false;
        if (pendingDoc) {
          const docs = table.get(top) ?? new Map<string, string>();
          docs.set([...frame.path, m[3]].join("."), pendingDoc);
          table.set(top, docs);
        }
      }
      pendingDoc = undefined;
      continue;
    }
    switch (tok) {
      case "{": {
        const path = frame ? (frame.key ? [...frame.path, frame.key] : frame.path) : [];
        frames.push({ path, depth, atPropStart: true });
        break;
      }
      case "}":
        frames.pop();
        if (frames.length === 0 && depth === 0) {
          /* stay in `top` until the next const */
        }
        break;
      case "(":
      case "[":
        depth++;
        break;
      case ")":
      case "]":
        depth--;
        break;
      case ",":
        if (frame && depth === frame.depth) {
          frame.atPropStart = true;
          frame.key = undefined;
        }
        break;
    }
    if (tok !== "{") pendingDoc = undefined;
  }
}

const docTable: DocTable = new Map();
/** Doc comments on the `export const` declarations themselves. */
const topDocs = new Map<string, string>();
const sourceFiles = [
  ...readdirSync(join(root, "packages/core/src/schema")).map((f) => join(root, "packages/core/src/schema", f)),
  ...readdirSync(join(root, "packages/widgets/src"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(root, "packages/widgets/src", d.name, "spec.ts")),
].filter((f) => f.endsWith(".ts"));
for (const f of sourceFiles) if (existsSync(f)) scanDocs(readFileSync(f, "utf8"), docTable);

// ── 2. map docs onto zod object instances

interface Def {
  type: string;
  shape?: Record<string, AnyZod>;
  innerType?: AnyZod;
  element?: AnyZod;
  valueType?: AnyZod;
  options?: AnyZod[];
  items?: AnyZod[];
  in?: AnyZod;
  left?: AnyZod;
  right?: AnyZod;
  catchall?: AnyZod;
}
const defOf = (s: AnyZod): Def => (s as unknown as { _zod: { def: Def } })._zod.def;

/** Every object schema reachable from `s` through wrappers (optional, array, record, union…). */
function objectsIn(s: AnyZod | undefined, seen = new Set<AnyZod>()): AnyZod[] {
  if (!s || seen.has(s)) return [];
  seen.add(s);
  const d = defOf(s);
  switch (d.type) {
    case "object":
      return [s];
    case "optional":
    case "nullable":
    case "default":
    case "readonly":
    case "catch":
    case "nonoptional":
    case "prefault":
      return objectsIn(d.innerType, seen);
    case "array":
      return objectsIn(d.element, seen);
    case "record":
      return objectsIn(d.valueType, seen);
    case "union":
      return (d.options ?? []).flatMap((o) => objectsIn(o, seen));
    case "tuple":
      return (d.items ?? []).flatMap((o) => objectsIn(o, seen));
    case "pipe":
      return objectsIn(d.in, seen);
    case "intersection":
      return [...objectsIn(d.left, seen), ...objectsIn(d.right, seen)];
    default:
      return [];
  }
}

const docsByObject = new Map<AnyZod, Record<string, string>>();
const exportsByName: Record<string, unknown> = { ...core, ...widgetSpecs };
for (const [name, docs] of docTable) {
  const schema = exportsByName[name];
  if (!(schema instanceof z.ZodType)) continue;
  for (const [dotted, doc] of docs) {
    const path = dotted.split(".");
    const key = path.pop() as string;
    let objs = objectsIn(schema);
    for (const seg of path) objs = objs.flatMap((o) => objectsIn(defOf(o).shape?.[seg]));
    for (const o of objs) {
      if (!defOf(o).shape?.[key]) continue;
      // `.meta()` returns a clone whose JSON Schema is generated from its parent: document both.
      for (let it: AnyZod | undefined = o; it; it = (it as unknown as { _zod: { parent?: AnyZod } })._zod.parent) {
        const rec = docsByObject.get(it) ?? {};
        rec[key] ??= doc;
        docsByObject.set(it, rec);
      }
    }
  }
}

// ── 3. JSON Schema generation

/**
 * Name every exported core schema so $defs read "Screen", "Interaction"… instead of "__schema12".
 * The file's own root schema is left unnamed so it is inlined at the top level.
 */
function namedIds(root: AnyZod) {
  const ids = z.registry<{ id: string; description?: string }>();
  const seen = new Set<AnyZod>();
  const rootChain = new Set<AnyZod>();
  for (let it: AnyZod | undefined = root; it; it = (it as unknown as { _zod: { parent?: AnyZod } })._zod.parent)
    rootChain.add(it);
  for (const [name, value] of Object.entries(core)) {
    if (!(value instanceof z.ZodType) || !/^[A-Z][a-z]/.test(name) || seen.has(value) || rootChain.has(value)) continue;
    seen.add(value);
    const description = topDocs.get(name);
    ids.add(value, description ? { id: name, description } : { id: name });
  }
  return ids;
}

function widgetRefBranches(): Json[] {
  return core.WIDGET_IDS.map((id) => {
    const spec = widgetSpecs.widgetSpecRegistry.get(id);
    if (!spec) throw new Error(`no spec for ${id}`);
    const props = z.toJSONSchema(spec.props as AnyZod, {
      target: "draft-2020-12",
      io: "input",
      unrepresentable: "any",
      override: describe,
    }) as Json;
    const goal = spec.goal
      ? (z.toJSONSchema(spec.goal as AnyZod, {
          target: "draft-2020-12",
          io: "input",
          unrepresentable: "any",
          override: describe,
        }) as Json)
      : undefined;
    for (const s of [props, goal]) if (s) delete s.$schema;
    return {
      title: spec.title,
      description: `${spec.description} Use when: ${spec.llmDoc.useWhen}`,
      type: "object",
      properties: {
        id: { const: id },
        v: { const: spec.version, description: "Widget major version." },
        props,
        ...(goal
          ? {
              goal: {
                ...goal,
                description: "Required when used as an interaction or item; omitted for visuals.",
              },
            }
          : {}),
      },
      required: ["id", "v", "props"],
      additionalProperties: false,
    };
  });
}

function describe(ctx: { zodSchema: unknown; jsonSchema: Json }): void {
  const docs = docsByObject.get(ctx.zodSchema as AnyZod);
  const props = ctx.jsonSchema.properties as Record<string, Json> | undefined;
  if (docs && props)
    for (const [k, doc] of Object.entries(docs)) if (props[k] && !props[k].description) props[k].description = doc;
}

let branches: Json[] | undefined;
function override(ctx: { zodSchema: unknown; jsonSchema: Json }): void {
  describe(ctx);
  if (ctx.zodSchema === core.WidgetRef) {
    branches ??= widgetRefBranches();
    for (const k of Object.keys(ctx.jsonSchema)) delete ctx.jsonSchema[k];
    Object.assign(ctx.jsonSchema, {
      description: "A configured built-in widget. Pick an id to get autocomplete for its props and goal.",
      anyOf: branches,
    });
  }
}

export function buildSchema(entry: (typeof SCHEMA_FILES)[number]): Json {
  const json = z.toJSONSchema(entry.schema, {
    target: "draft-2020-12",
    io: "input",
    metadata: namedIds(entry.schema),
    reused: "ref",
    unrepresentable: "any",
    override,
  }) as Json;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${SCHEMA_BASE}${entry.kind}.schema.json`,
    title: entry.title,
    description: entry.description,
    ...Object.fromEntries(
      Object.entries(json).filter(([k]) => k !== "$schema" && k !== "title" && k !== "description"),
    ),
  };
}

// ── 4. reference docs

function typeLabel(s: Json, defs: Record<string, Json>): string {
  if (typeof s.$ref === "string") {
    const name = s.$ref.replace("#/$defs/", "");
    return name.startsWith("__") ? typeLabel(defs[name] ?? {}, defs) : `\`${name}\``;
  }
  if (s.const !== undefined) return `\`${JSON.stringify(s.const)}\``;
  if (Array.isArray(s.enum)) return s.enum.map((e) => `\`${JSON.stringify(e)}\``).join(" \\| ");
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const opts = (s.anyOf ?? s.oneOf) as Json[];
    if (opts.length > 6) return `one of ${opts.length} shapes`;
    return opts.map((o) => typeLabel(o, defs)).join(" \\| ");
  }
  if (s.type === "array") {
    if (Array.isArray(s.prefixItems)) return `[${(s.prefixItems as Json[]).map((i) => typeLabel(i, defs)).join(", ")}]`;
    return `${typeLabel((s.items as Json) ?? {}, defs)}[]`;
  }
  if (s.type === "object" && !s.properties && s.additionalProperties && typeof s.additionalProperties === "object") {
    return `map of ${typeLabel(s.additionalProperties as Json, defs)}`;
  }
  if (s.type === "object") return "object";
  if (typeof s.pattern === "string" && s.type === "string") return "string (pattern)";
  return typeof s.type === "string" ? s.type : "any";
}

function renderDoc(entry: (typeof SCHEMA_FILES)[number], schema: Json): string {
  const defs = (schema.$defs ?? {}) as Record<string, Json>;
  const out: string[] = [
    `# ${entry.title}`,
    "",
    `${entry.description} Generated by \`bun run schemas\` from the zod schemas in \`packages/core/src/schema\`; do not edit.`,
    "",
    `JSON Schema: [\`schemas/${entry.kind}.schema.json\`](../../schemas/${entry.kind}.schema.json) (\`${SCHEMA_BASE}${entry.kind}.schema.json\`).`,
    "",
  ];
  const seen = new Set<Json>();
  const queue: { title: string; s: Json }[] = [{ title: entry.source, s: schema }];
  while (queue.length) {
    const { title, s: raw } = queue.shift() as { title: string; s: Json };
    const s = typeof raw.$ref === "string" ? (defs[raw.$ref.replace("#/$defs/", "")] ?? raw) : raw;
    if (seen.has(s)) continue;
    seen.add(s);
    const variants = ((s.anyOf ?? s.oneOf) as Json[] | undefined)?.filter((v) => v.properties);
    if (variants?.length && !s.properties) {
      variants.forEach((v, i) => {
        const kind =
          (v.properties as Record<string, Json>)?.kind?.const ??
          (v.properties as Record<string, Json>)?.type?.const ??
          (v.properties as Record<string, Json>)?.id?.const;
        queue.push({ title: `${title} (${kind !== undefined ? `\`${String(kind)}\`` : `variant ${i + 1}`})`, s: v });
      });
      continue;
    }
    const props = s.properties as Record<string, Json> | undefined;
    if (!props) continue;
    const required = new Set((s.required as string[] | undefined) ?? []);
    out.push(`## ${title}`, "");
    if (typeof s.description === "string" && title !== entry.source) out.push(s.description, "");
    out.push("| Field | Type | Required | Notes |", "|---|---|---|---|");
    for (const [k, p] of Object.entries(props)) {
      const desc = (p.description as string | undefined) ?? "";
      out.push(
        `| \`${k}\` | ${typeLabel(p, defs)} | ${required.has(k) ? "yes" : ""} | ${desc.replace(/\|/g, "\\|")} |`,
      );
      const target = typeof p.$ref === "string" ? defs[p.$ref.replace("#/$defs/", "")] : p;
      const inner =
        target?.type === "array"
          ? (target.items as Json | undefined)
          : target?.type === "object" && !target.properties
            ? (target.additionalProperties as Json | undefined)
            : target;
      if (inner && typeof inner === "object" && k !== "props" && k !== "goal")
        queue.push({ title: `${title} → ${k}`, s: inner });
    }
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

// ── 5. write (or check)

function main(): void {
  const outputs: { file: string; content: string }[] = [];
  const index: string[] = [
    "# Reference",
    "",
    "Generated by `bun run schemas` from the zod schemas (the single source of truth). Do not edit.",
    "",
  ];
  for (const entry of SCHEMA_FILES) {
    const schema = buildSchema(entry);
    outputs.push({
      file: join(root, "schemas", `${entry.kind}.schema.json`),
      content: `${JSON.stringify(schema, null, 2)}\n`,
    });
    outputs.push({ file: join(root, "docs/reference", `${entry.kind}.md`), content: renderDoc(entry, schema) });
    index.push(`- [${entry.title}](./${entry.kind}.md) — \`${entry.source}\``);
  }
  outputs.push({ file: join(root, "docs/reference", "README.md"), content: `${index.join("\n")}\n` });
  mkdirSync(join(root, "schemas"), { recursive: true });
  mkdirSync(join(root, "docs/reference"), { recursive: true });
  const stale: string[] = [];
  for (const o of outputs) {
    let current = "";
    try {
      current = readFileSync(o.file, "utf8");
    } catch {
      /* missing */
    }
    if (current === o.content) continue;
    if (check) stale.push(relative(root, o.file));
    else writeFileSync(o.file, o.content);
  }
  if (check && stale.length) {
    console.error(`Out of date (run \`bun run schemas\`):\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  console.log(check ? "schemas up to date" : `wrote ${outputs.length} files (schemas/, docs/reference/)`);
}

if (import.meta.main) main();
