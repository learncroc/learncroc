/**
 * Pack-format codemods for `learncroc migrate <dir>`. `schema` in pack.yaml is the format version;
 * each codemod upgrades one version by editing the YAML texts, so comments and layout survive.
 * A codemod deletes a file by removing it from the file map.
 *
 * - 0 → 1: drafts written before the format was frozen (no `schema` key) used snake_case keys
 *   (`renamed_from`, `on_wrong`, `feedback_right`…). Keys become camelCase (D21) except inside
 *   records keyed by authored ids or values (vars, blanks, misconceptions, onWrong, replies…), and
 *   `schema: 1` is added.
 * - 1 → 2: the card loop (revision 3). The mechanical half only: `hook.reveal` becomes `close.text`
 *   with an empty `close.teaser`, revision-2 keys go, `cards` becomes `flashcards`, boss stages become
 *   transfer items on their card, bosses become checkpoints, toy.yaml goes. Section wiring (a gate
 *   every 2–3 cards), teasers and byGuess closes are editorial: validation shows where they are missing.
 *   This codemod edits text ranges in place, so everything it doesn't touch stays byte for byte.
 */
import { Document, isMap, isScalar, isSeq, type Pair, parseDocument, visit, type YAMLMap } from "yaml";

export const CURRENT_SCHEMA = 2;

export interface PackCodemod {
  name: string;
  from: number;
  to: number;
  description: string;
  /** Edit the texts in place (delete a file by removing it from the map); returns one line per change. */
  apply(files: Map<string, string>): string[];
}

/** Records keyed by authored ids: the keys stay, the values are renamed as usual. */
const RECORD_KEYS = new Set([
  "misconceptions",
  "onWrong",
  "on_wrong",
  "replies",
  "landmarks",
  "widgets",
  "provenance",
  "nodes",
  "blanks",
  "alts",
]);
/** Widget-defined or learner-defined values: nothing inside is renamed. */
const OPAQUE_KEYS = new Set(["props", "goal", "solution", "vars", "values", "assignment", "scratch"]);

const SNAKE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function renameKeys(node: unknown, file: string, path: string[], changes: string[], insideRecord: boolean): void {
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = pair.key;
      let name = isScalar(key) ? String(key.value) : "";
      if (!insideRecord && isScalar(key) && typeof key.value === "string" && SNAKE_RE.test(key.value)) {
        const next = camel(key.value);
        changes.push(`${file}: ${[...path, key.value].join(".")} → ${next}`);
        key.value = next;
        name = next;
      }
      // A record's own keys are ids; its values are ordinary objects again.
      if (OPAQUE_KEYS.has(name) && !insideRecord) continue;
      if (insideRecord) renameKeys(pair.value, file, [...path, name], changes, false);
      else renameKeys(pair.value, file, [...path, name], changes, RECORD_KEYS.has(name));
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, i) => {
      renameKeys(item, file, [...path, String(i)], changes, false);
    });
  }
}

// ── 1 → 2: range edits on the original text

interface Edit {
  start: number;
  end: number;
  text: string;
}

type Ranged = { range?: [number, number, number] | null };

const keyOf = (p: Pair) => (isScalar(p.key) ? String(p.key.value) : "");
const pairOf = (map: unknown, key: string): Pair | undefined =>
  isMap(map) ? map.items.find((p) => keyOf(p) === key) : undefined;
const valueAt = (map: unknown, key: string): unknown => pairOf(map, key)?.value;
const rangeOf = (n: unknown): [number, number, number] | undefined => (n as Ranged | null)?.range ?? undefined;

function lineStart(text: string, i: number): number {
  return text.lastIndexOf("\n", i - 1) + 1;
}
function lineEnd(text: string, i: number): number {
  const n = text.indexOf("\n", i);
  return n < 0 ? text.length : n + 1;
}

/** The edit that removes `pair` from `map` (block: its whole lines; flow: the item and one comma). */
function removePair(text: string, map: YAMLMap, pair: Pair): Edit | undefined {
  const kr = rangeOf(pair.key);
  if (!kr) return undefined;
  const vr = rangeOf(pair.value) ?? kr;
  if (map.flow) {
    const i = map.items.indexOf(pair);
    const prev = map.items[i - 1];
    const next = map.items[i + 1];
    const prevEnd = rangeOf(prev?.value)?.[1] ?? rangeOf(prev?.key)?.[1];
    if (prev && prevEnd !== undefined) return { start: prevEnd, end: vr[1], text: "" };
    const nextStart = rangeOf(next?.key)?.[0];
    if (next && nextStart !== undefined) return { start: kr[0], end: nextStart, text: "" };
    const mr = rangeOf(map);
    return mr ? { start: mr[0], end: mr[1], text: "{}" } : undefined;
  }
  const start = lineStart(text, kr[0]);
  let end = vr[2];
  if (end > 0 && text[end - 1] !== "\n") end = lineEnd(text, end);
  // Don't leave two blank lines where one block was.
  if (start >= 2 && text.slice(start - 2, start) === "\n\n" && text[end] === "\n") end += 1;
  return { start, end, text: "" };
}

function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let limit = Number.POSITIVE_INFINITY;
  for (const e of sorted) {
    if (e.end > limit) throw new Error("overlapping codemod edits");
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    limit = e.start;
  }
  return out;
}

/** The end of a block pair's value, at a line boundary (where a sibling block can be inserted). */
function blockEnd(text: string, pair: Pair): number {
  const r = rangeOf(pair.value) ?? rangeOf(pair.key);
  if (!r) return text.length;
  return text[r[2] - 1] === "\n" ? r[2] : lineEnd(text, r[2]);
}

/** Column of a block sequence's dashes. */
function seqIndent(text: string, seq: unknown): number {
  const first = isSeq(seq) ? seq.items[0] : undefined;
  const r = rangeOf(first);
  if (!r) return 2;
  const ls = lineStart(text, r[0]);
  const dash = text.indexOf("-", ls);
  return dash >= ls && dash < r[0] ? dash - ls : 2;
}

/** YAML for generated values in the pack's style: small all-scalar maps and lists go on one line. */
function toYaml(value: unknown): string {
  const doc = new Document(value);
  visit(doc, {
    Map(_, node) {
      if (node.items.every((p) => isScalar(p.value)) && node.items.length <= 6) node.flow = true;
    },
    Seq(_, node) {
      if (node.items.every((x) => isScalar(x) || (isMap(x) && x.flow))) node.flow = true;
    },
  });
  return doc.toString({ lineWidth: 0 });
}

/** First `max` words (with an ellipsis when cut). */
function trimWords(text: string, max: number): string {
  const parts = text.trim().split(/\s+/);
  return parts.length <= max ? text.trim() : `${parts.slice(0, max).join(" ")}…`;
}

function editManifest(text: string, changes: string[]): string {
  const doc = parseDocument(text);
  const root = doc.contents;
  if (!isMap(root)) return text;
  const edits: Edit[] = [];
  const schema = pairOf(root, "schema");
  const sr = rangeOf(schema?.value);
  if (sr) edits.push({ start: sr[0], end: sr[1], text: "2" });
  else
    edits.push({
      start: lineStart(text, rangeOf(root)?.[0] ?? 0),
      end: lineStart(text, rangeOf(root)?.[0] ?? 0),
      text: "schema: 2\n",
    });
  changes.push("pack.yaml: schema: 2");
  const drop = (map: unknown, key: string, what: string) => {
    const pair = pairOf(map, key);
    const e = pair && isMap(map) ? removePair(text, map, pair) : undefined;
    if (e) {
      edits.push(e);
      changes.push(`pack.yaml: removed ${what}`);
    }
  };
  drop(root, "guide", "guide");
  const entry = valueAt(root, "entry");
  drop(entry, "coldOpenNode", "entry.coldOpenNode");
  drop(entry, "placement", "entry.placement");
  const tn = pairOf(valueAt(root, "theme"), "terminusName");
  const tr = rangeOf(tn?.key);
  if (tr) {
    edits.push({ start: tr[0], end: tr[1], text: "gateName" });
    changes.push("pack.yaml: theme.terminusName → theme.gateName");
  }
  return applyEdits(text, edits);
}

interface PortedItem {
  item: Record<string, unknown>;
  note: string;
}

function editNode(file: string, text: string, ported: readonly PortedItem[], changes: string[]): string {
  const doc = parseDocument(text);
  const root = doc.contents;
  if (!isMap(root)) return text;
  const edits: Edit[] = [];
  const note = (what: string) => changes.push(`${file}: ${what}`);
  const drop = (map: unknown, key: string, what: string) => {
    const pair = pairOf(map, key);
    const e = pair && isMap(map) ? removePair(text, map, pair) : undefined;
    if (e) {
      edits.push(e);
      note(`removed ${what}`);
    }
    return !!e;
  };

  // hook.reveal → close.text (+ an empty teaser for a writer to fill), placed after the beats.
  const hook = valueAt(root, "hook");
  if (!pairOf(root, "close")) {
    const reveal = pairOf(hook, "reveal");
    const rr = rangeOf(reveal?.value);
    const revealText = rr ? text.slice(rr[0], rr[1]) : '""';
    if (reveal && isMap(hook)) {
      const e = removePair(text, hook, reveal);
      if (e) edits.push(e);
    }
    const anchor = pairOf(root, "screens") ?? pairOf(root, "hook");
    const at = anchor ? blockEnd(text, anchor) : text.length;
    const block = `close:\n  text: ${revealText}\n  teaser: ""\n`;
    edits.push({ start: at, end: at, text: text[at] === "\n" || at >= text.length ? `\n${block}` : `\n${block}\n` });
    note(reveal ? "hook.reveal → close.text (close.teaser is empty)" : "added close (text and teaser are empty)");
  }
  for (const k of ["sayIt", "coldOpen", "quickRun", "teach", "keystone", "speaker"]) drop(root, k, k);
  const cards = rangeOf(pairOf(root, "cards")?.key);
  if (cards) {
    edits.push({ start: cards[0], end: cards[1], text: "flashcards" });
    note("cards → flashcards");
  }
  const screens = valueAt(root, "screens");
  if (isSeq(screens))
    screens.items.forEach((s, i) => {
      drop(s, "role", `screens[${i}].role`);
    });
  const mis = valueAt(root, "misconceptions");
  if (isMap(mis))
    for (const pair of mis.items) {
      const id = keyOf(pair);
      drop(pair.value, "probe", `misconceptions.${id}.probe`);
      const up = valueAt(pair.value, "upstream");
      if (isScalar(up) && String(up.value).startsWith("in-node:"))
        drop(pair.value, "upstream", `misconceptions.${id}.upstream (${String(up.value)})`);
    }
  const items = valueAt(root, "items");
  if (isSeq(items))
    items.items.forEach((it, i) => {
      drop(it, "placement", `items[${i}].placement`);
      const use = valueAt(it, "use");
      const ur = rangeOf(use);
      if (isSeq(use) && ur) {
        const before = use.items.map((x) => (isScalar(x) ? String(x.value) : ""));
        const after = [...new Set(before.flatMap((u) => (u === "check" ? ["checkpoint"] : u === "quiz" ? [] : [u])))];
        if (after.join() !== before.join()) {
          if (after.length) edits.push({ start: ur[0], end: ur[1], text: `[${after.join(", ")}]` });
          else drop(it, "use", `items[${i}].use`);
          note(`items[${i}].use: [${before.join(", ")}] → [${after.join(", ")}]`);
        }
      }
    });

  // Ported boss stages go at the end of the bank.
  if (ported.length) {
    const itemsPair = pairOf(root, "items");
    if (itemsPair && isSeq(items) && items.items.length && !items.flow) {
      const indent = " ".repeat(seqIndent(text, items));
      const yaml = toYaml(ported.map((p) => p.item))
        .split("\n")
        .filter((l) => l.length)
        .map((l) => `${indent}${l}\n`)
        .join("");
      const at = blockEnd(text, itemsPair);
      edits.push({ start: at, end: at, text: yaml });
    } else {
      const at = text.length;
      const yaml = toYaml({ items: ported.map((p) => p.item) });
      edits.push({ start: at, end: at, text: `${text.endsWith("\n") ? "" : "\n"}${yaml}` });
    }
    for (const p of ported) note(p.note);
  }
  return applyEdits(text, edits);
}

/** Boss stages → transfer widget items, keyed by the node file they belong to. */
function portBoss(
  file: string,
  text: string,
  nodeFiles: ReadonlySet<string>,
  ported: Map<string, PortedItem[]>,
  takenIds: (nodeFile: string) => Set<string>,
  changes: string[],
): void {
  const stages = (parseDocument(text).toJS({ maxAliasCount: 100 }) as { stages?: unknown[] } | null)?.stages;
  if (!Array.isArray(stages)) return;
  for (const raw of stages) {
    const st = raw as Record<string, unknown>;
    const nodeFile = [`nodes/${String(st.node)}.yaml`, `nodes/${String(st.node)}.yml`].find((f) => nodeFiles.has(f));
    if (!nodeFile) {
      changes.push(`${file}: stage ${String(st.id)} dropped (card "${String(st.node)}" has no node file)`);
      continue;
    }
    const taken = takenIds(nodeFile);
    let id = String(st.id);
    while (taken.has(id)) id = `${id}-b`;
    taken.add(id);
    const item: Record<string, unknown> = { kind: "widget", id, prompt: st.prompt, widget: st.widget };
    item.solution = st.solution;
    if (st.fallback !== undefined) item.fallback = st.fallback;
    if (typeof st.reveal === "string" && st.reveal.trim()) item.why = trimWords(st.reveal, 25);
    item.level = "transfer";
    item.difficulty = 3;
    const list = ported.get(nodeFile) ?? [];
    list.push({ item, note: `boss stage ${String(st.id)} (${file}) → item ${id} (transfer)` });
    ported.set(nodeFile, list);
  }
}

function editMap(text: string, changes: string[]): string {
  const nodes = valueAt(parseDocument(text).contents, "nodes");
  if (!isMap(nodes)) return text;
  const edits: Edit[] = [];
  for (const pair of nodes.items) {
    const kind = valueAt(pair.value, "kind");
    const r = rangeOf(kind);
    if (isScalar(kind) && kind.value === "boss" && r) {
      edits.push({ start: r[0], end: r[1], text: "checkpoint" });
      changes.push(`map.yaml: ${keyOf(pair)} kind: boss → checkpoint`);
    }
  }
  return applyEdits(text, edits);
}

function editLock(text: string, removed: readonly string[], changes: string[]): string {
  const prov = valueAt(parseDocument(text).contents, "provenance");
  if (!isMap(prov)) return text;
  const edits: Edit[] = [];
  for (const pair of prov.items) {
    const k = keyOf(pair);
    if (!removed.includes(k) && !k.startsWith("bosses/")) continue;
    const e = removePair(text, prov, pair);
    if (e) {
      edits.push(e);
      changes.push(`pack.lock.yaml: removed provenance for ${k}`);
    }
  }
  return applyEdits(text, edits);
}

export const PACK_CODEMODS: readonly PackCodemod[] = [
  {
    name: "snake-to-camel",
    from: 0,
    to: 1,
    description: "camelCase keys (D21) and schema: 1",
    apply(files) {
      const changes: string[] = [];
      for (const [file, text] of files) {
        const doc = parseDocument(text);
        const before = changes.length;
        renameKeys(doc.contents, file, [], changes, false);
        if (file === "pack.yaml" && isMap(doc.contents)) {
          doc.contents.items = doc.contents.items.filter((p) => !(isScalar(p.key) && p.key.value === "schema"));
          doc.contents.items.unshift(doc.createPair("schema", 1));
          changes.push("pack.yaml: schema: 1");
        }
        if (changes.length > before) files.set(file, doc.toString(TO_STRING));
      }
      return changes;
    },
  },
  {
    name: "card-loop",
    from: 1,
    to: 2,
    description: "revision 3: cards, closes, checkpoints (no bosses, toy, Say it, teach or placement)",
    apply(files) {
      const changes: string[] = [];
      const manifest = files.get("pack.yaml");
      if (manifest !== undefined) files.set("pack.yaml", editManifest(manifest, changes));
      const nodeFiles = new Set([...files.keys()].filter((f) => f.startsWith("nodes/")));
      const ported = new Map<string, PortedItem[]>();
      const taken = new Map<string, Set<string>>();
      const takenIds = (nodeFile: string) => {
        let t = taken.get(nodeFile);
        if (!t) {
          const items = (parseDocument(files.get(nodeFile) ?? "").toJS() as { items?: { id?: unknown }[] } | null)
            ?.items;
          t = new Set((items ?? []).map((i) => String(i?.id ?? "")));
          taken.set(nodeFile, t);
        }
        return t;
      };
      const removed: string[] = [];
      for (const [file, text] of [...files]) {
        if (!file.startsWith("bosses/")) continue;
        portBoss(file, text, nodeFiles, ported, takenIds, changes);
        files.delete(file);
        removed.push(file);
        changes.push(`${file}: deleted`);
      }
      if (files.delete("toy.yaml")) {
        removed.push("toy.yaml");
        changes.push("toy.yaml: deleted");
      }
      for (const file of nodeFiles) {
        const text = files.get(file);
        if (text !== undefined) files.set(file, editNode(file, text, ported.get(file) ?? [], changes));
      }
      const map = files.get("map.yaml");
      if (map !== undefined) files.set("map.yaml", editMap(map, changes));
      const lock = files.get("pack.lock.yaml");
      if (lock !== undefined) files.set("pack.lock.yaml", editLock(lock, removed, changes));
      return changes;
    },
  },
];

/** Keep lines unwrapped (the 0 → 1 codemod re-prints the files it renames keys in). */
const TO_STRING = { lineWidth: 0 } as const;

/** The format version of a pack.yaml value (0 when the key is missing). */
export function detectSchema(manifest: unknown): number {
  const v = (manifest as { schema?: unknown } | null)?.schema;
  return typeof v === "number" && Number.isInteger(v) ? v : 0;
}

export interface PackMigration {
  from: number;
  to: number;
  applied: string[];
  changes: string[];
  /** Changed files only: pack-relative path → new YAML text. */
  files: Record<string, string>;
  /** Files the migration removed (pack-relative); the caller deletes them. */
  deleted: string[];
}

/**
 * Upgrade a pack's YAML files (pack.yaml, map.yaml, pack.lock.yaml, nodes/*, and for format 1 also
 * bosses/* and toy.yaml) to the current format. Throws when the pack is newer than this app understands.
 */
export function migratePack(input: Readonly<Record<string, string>>): PackMigration {
  for (const [path, text] of Object.entries(input)) {
    const doc = parseDocument(text);
    if (doc.errors.length) throw new Error(`${path}: ${doc.errors[0]?.message}`);
  }
  const files = new Map(Object.entries(input));
  const from = detectSchema(parseDocument(files.get("pack.yaml") ?? "").toJS());
  if (from > CURRENT_SCHEMA)
    throw new Error(`pack format ${from} is newer than this app (${CURRENT_SCHEMA}); update learncroc`);
  const applied: string[] = [];
  const changes: string[] = [];
  let version = from;
  while (version < CURRENT_SCHEMA) {
    const mod = PACK_CODEMODS.find((m) => m.from === version);
    if (!mod) throw new Error(`no codemod from pack format ${version}`);
    changes.push(...mod.apply(files));
    applied.push(mod.name);
    version = mod.to;
  }
  const out: Record<string, string> = {};
  for (const [path, text] of files) if (text !== input[path]) out[path] = text;
  const deleted = Object.keys(input).filter((p) => !files.has(p));
  return { from, to: version, applied, changes, files: out, deleted };
}
