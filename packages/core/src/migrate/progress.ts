/**
 * Progress across pack versions, and the revision-3 learner-data mapping. Node ids are stable forever; a renamed
 * node lists its old ids in `renamedFrom`. On install or update, progress (and FSRS cards) keyed by
 * an old id moves to the new id, and progress for nodes that no longer exist goes to an archive so a
 * downgrade can restore it.
 */
import { flashcardId, nodeCardId } from "../fsrs";
import {
  AttemptRow,
  CardState,
  type CompiledPack,
  DEFAULT_SETTINGS,
  ExportTables,
  FieldNote,
  type NodeId,
  type NodeProgress,
  ReviewLogRow,
  RunKind,
  RunPhase,
  RunState,
} from "../schema/index";

export interface ProgressMigration {
  progress: Record<NodeId, NodeProgress>;
  /** Progress for nodes the new version no longer has (kept for a downgrade). */
  archived: NodeProgress[];
  renamed: { from: NodeId; to: NodeId }[];
  /** Entries of the old version that the new version dropped (not renamed). */
  removed: NodeId[];
}

export const RANK: Record<NodeProgress["status"], number> = { started: 0, done: 1, lit: 2 };

/** Keep the stronger of two progress rows for the same node (lit > done > started, then newest). */
function stronger(a: NodeProgress, b: NodeProgress): NodeProgress {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] > RANK[b.status] ? a : b;
  return (a.litAt ?? a.doneAt ?? 0) >= (b.litAt ?? b.doneAt ?? 0) ? a : b;
}

/** Map old node ids to the new version's ids (renamedFrom), for every node of the new pack. */
export function renameMap(newPack: Pick<CompiledPack, "nodes" | "map">): Map<NodeId, NodeId> {
  const out = new Map<NodeId, NodeId>();
  for (const [id, node] of Object.entries(newPack.nodes))
    for (const old of node.renamedFrom ?? []) if (!newPack.map.nodes[old]) out.set(old, id);
  return out;
}

export function migrateProgress(
  oldPack: Pick<CompiledPack, "map"> | null,
  newPack: Pick<CompiledPack, "nodes" | "map">,
  progress: Readonly<Record<NodeId, NodeProgress>>,
): ProgressMigration {
  const renames = renameMap(newPack);
  const out: Record<NodeId, NodeProgress> = {};
  const archived: NodeProgress[] = [];
  const renamed: { from: NodeId; to: NodeId }[] = [];
  const exists = (id: NodeId) => Object.hasOwn(newPack.map.nodes, id) && newPack.map.nodes[id]?.status !== "planned";
  // Existing ids first, so a renamed row never overwrites a row already on the new id unless stronger.
  const entries = Object.entries(progress).sort(
    ([a], [b]) => Number(renames.has(a)) - Number(renames.has(b)) || a.localeCompare(b),
  );
  for (const [id, p] of entries) {
    if (exists(id) && !renames.has(id)) {
      out[id] = p;
      continue;
    }
    const to = renames.get(id);
    if (to && exists(to)) {
      const moved = { ...p, nodeId: to };
      const prev = out[to];
      if (prev) {
        const keep = stronger(prev, moved);
        archived.push(keep === prev ? { ...p } : prev);
        out[to] = keep;
      } else out[to] = moved;
      renamed.push({ from: id, to });
      continue;
    }
    archived.push({ ...p });
  }
  const removed = Object.keys(oldPack?.map.nodes ?? {}).filter(
    (id) => !Object.hasOwn(newPack.map.nodes, id) && !renames.has(id),
  );
  return { progress: out, archived, renamed, removed };
}

/**
 * Re-key cards after a migration: node cards and pack flashcards follow renamed nodes; cards of
 * archived nodes are returned separately (suspended) so they can be kept but stop coming up.
 */
export function migrateCards(
  packId: string,
  cards: readonly CardState[],
  migration: Pick<ProgressMigration, "renamed" | "archived">,
): { cards: CardState[]; removedIds: string[]; archived: CardState[] } {
  const to = new Map(migration.renamed.map((r) => [r.from, r.to]));
  const gone = new Set(migration.archived.map((p) => p.nodeId).filter((id) => !to.has(id)));
  const out: CardState[] = [];
  const removedIds: string[] = [];
  const archived: CardState[] = [];
  for (const c of cards) {
    if (c.packId !== packId || c.nodeId === null || c.kind === "user") {
      if (c.kind === "user" && c.packId === packId && c.nodeId !== null && to.has(c.nodeId))
        out.push({ ...c, nodeId: to.get(c.nodeId) as NodeId });
      else out.push(c);
      continue;
    }
    const target = to.get(c.nodeId);
    if (target) {
      const id =
        c.kind === "node"
          ? nodeCardId(packId, target)
          : flashcardId(packId, target, c.id.split(":").slice(3).join(":"));
      removedIds.push(c.id);
      out.push({ ...c, id, nodeId: target });
    } else if (gone.has(c.nodeId)) {
      removedIds.push(c.id);
      archived.push({ ...c, suspended: true });
    } else out.push(c);
  }
  return { cards: out, removedIds, archived };
}

/** kv keys that revision 3 drops (boss, placement, stuck and quiz state). */
export const LEGACY_KV_PREFIXES = [
  "boss:",
  "boss-retry:",
  "placement:",
  "mhits:",
  "misconceptions:",
  "quiz-items:",
] as const;

/** Is this a kv key revision 3 drops on migration and import? */
export function isLegacyKvKey(key: string): boolean {
  return LEGACY_KV_PREFIXES.some((p) => key.startsWith(p));
}

const RUN_KINDS = new Set<string>(RunKind.options);
const RUN_PHASES = new Set<string>(RunPhase.options);
const PROGRESS_SOURCE: Record<string, NodeProgress["source"]> = {
  run: "run",
  checkpoint: "checkpoint",
  import: "import",
  "quick-run": "run",
  placement: "import",
  boss: "import",
};
const REVIEW_SOURCES = new Set<string>(ReviewLogRow.shape.source.options);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Parse rows with a schema, dropping the ones that don't fit (never throws). */
function keep<T>(
  rows: readonly unknown[] | undefined,
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  map: (r: Record<string, unknown>) => Record<string, unknown> | null,
): T[] {
  const out: T[] = [];
  for (const raw of rows ?? []) {
    if (!isObj(raw)) continue;
    const mapped = map({ ...raw });
    if (!mapped) continue;
    const r = schema.safeParse(mapped);
    if (r.success) out.push(r.data as T);
  }
  return out;
}

/** A revision-2 bank item → revision 3: `use: check` → checkpoint, `quiz` dropped, `placement` gone. */
function migrateItem(item: unknown): unknown {
  if (!isObj(item)) return item;
  const { placement: _placement, ...rest } = item;
  if (Array.isArray(rest.use)) {
    const use = [...new Set(rest.use.flatMap((u) => (u === "check" ? ["checkpoint"] : u === "quiz" ? [] : [u])))];
    if (use.length) rest.use = use;
    else delete rest.use;
  }
  return rest;
}

/**
 * Revision-2 learner rows → revision 3, the same mapping as SQLite migration #2:
 * - node_progress: sparked → done (doneAt = sparkedAt); source quick-run → run, placement/boss → import;
 *   sparkedAt and bossPassedAt removed;
 * - run: kinds other than card/checkpoint/relight dropped (open ones too); the rest re-parsed;
 * - attempt: phases outside RunPhase → "legacy";
 * - review_log: source placement (or anything unknown) → "legacy";
 * - card: kind "card" → "flashcard"; field_note kept; generated_item banks follow the item renames.
 * Rows that still don't fit the revision-3 schemas are dropped, so this never throws. kv is not part
 * of the export: stores drop legacy keys with `isLegacyKvKey`. Used by POST /import (export v1) and the
 * browser demo store.
 */
export function migrateLearnerRows(tables: Readonly<Record<string, readonly unknown[]>>): Partial<ExportTables> {
  const out: Partial<ExportTables> = {};
  if (tables.node_progress)
    out.node_progress = keep(tables.node_progress, ExportTables.shape.node_progress.element, (r) => {
      if (r.status === "sparked") {
        r.status = "done";
        if (r.doneAt === undefined && typeof r.sparkedAt === "number") r.doneAt = r.sparkedAt;
      }
      if (r.status !== "started" && r.status !== "done" && r.status !== "lit") return null;
      r.source = PROGRESS_SOURCE[String(r.source)] ?? "import";
      if (r.status === "lit" && r.litAt === undefined && typeof r.bossPassedAt === "number") r.litAt = r.bossPassedAt;
      delete r.sparkedAt;
      delete r.bossPassedAt;
      if (typeof r.theta !== "number") r.theta = 0;
      if (typeof r.relightsOk !== "number") r.relightsOk = 0;
      return r;
    });
  if (tables.run)
    out.run = keep(tables.run, RunState, (r) => {
      if (!RUN_KINDS.has(String(r.kind))) return null;
      const cursor = isObj(r.cursor) ? r.cursor : null;
      if (!cursor || !RUN_PHASES.has(String(cursor.phase))) return null;
      return r;
    });
  if (tables.attempt)
    out.attempt = keep(tables.attempt, AttemptRow, (r) => {
      if (!RUN_PHASES.has(String(r.phase))) r.phase = "legacy";
      return r;
    });
  if (tables.review_log)
    out.review_log = keep(tables.review_log, ReviewLogRow, (r) => {
      if (!REVIEW_SOURCES.has(String(r.source)) || r.source === "placement") r.source = "legacy";
      return r;
    });
  if (tables.card)
    out.card = keep(tables.card, CardState, (r) => {
      if (r.kind === "card") r.kind = "flashcard";
      return r;
    });
  if (tables.field_note) out.field_note = keep(tables.field_note, FieldNote, (r) => r);
  if (tables.generated_item)
    out.generated_item = keep(tables.generated_item, ExportTables.shape.generated_item.element, (r) => {
      r.item = migrateItem(r.item);
      return r;
    });
  return out;
}

/** Deep-fill missing settings keys from the defaults (objects only; arrays and values are kept). */
function fillDefaults(value: unknown, defaults: unknown): unknown {
  if (!isObj(defaults)) return value === undefined ? defaults : value;
  const v = isObj(value) ? value : {};
  const out: Record<string, unknown> = { ...v };
  for (const [k, d] of Object.entries(defaults)) out[k] = fillDefaults(v[k], d);
  return out;
}

/**
 * An export file of any version → the version-2 shape (still unvalidated: parse it with ExportFile).
 * Version 1: learner rows through migrateLearnerRows; settings lose guessGate, placement and
 * coldOpenAt and gain the Moss, sound-offer and first-run defaults (first run counts as completed when
 * any card was closed).
 */
export function migrateExportFile(raw: unknown): unknown {
  if (!isObj(raw) || raw.format !== "learncroc-export" || raw.version !== 1) return raw;
  const tables = migrateLearnerRows(isObj(raw.tables) ? (raw.tables as Record<string, readonly unknown[]>) : {});
  const s = isObj(raw.settings) ? structuredClone(raw.settings) : {};
  if (isObj(s.ai)) delete s.ai.guessGate;
  if (isObj(s.learning)) delete s.learning.placement;
  const closed = (tables.node_progress ?? []).some((p) => p.status === "done" || p.status === "lit");
  const firstRun = isObj(s.firstRun) ? s.firstRun : {};
  delete firstRun.coldOpenAt;
  if (typeof firstRun.completed !== "boolean") firstRun.completed = closed;
  s.firstRun = firstRun;
  const { keyMasked: _m, keySource: _s, ...aiDefaults } = DEFAULT_SETTINGS.ai;
  const settings = fillDefaults(s, { ...DEFAULT_SETTINGS, ai: aiDefaults });
  const { numbers: _numbers, ...rest } = raw;
  return { ...rest, version: 2, tables, settings };
}
