/**
 * SqliteRepo: the server's implementation of core's Repo over bun:sqlite (WAL).
 *
 * Every statement is parameterised. `tx()` runs an async function inside BEGIN IMMEDIATE … COMMIT;
 * transactions are serialised, and calls made outside a transaction wait for the active one to end
 * so they never land inside someone else's transaction.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type AttemptRow,
  type CardState,
  type ExportTables,
  type FieldNote,
  type ItemId,
  LEGACY_KV_PREFIXES,
  type Millis,
  type NodeId,
  type NodeProgress,
  type PackId,
  type Repo,
  type ReviewLogRow,
  type RunState,
} from "@learncroc/core";
import { MIGRATIONS } from "./migrations";

type Row = { data: string };
const parse = <T>(rows: Row[]): T[] => rows.map((r) => JSON.parse(r.data) as T);

/** Tables written by importTables, in dependency-free order. */
export const EXPORT_TABLES = [
  "node_progress",
  "card",
  "review_log",
  "attempt",
  "field_note",
  "generated_item",
  "run",
] as const satisfies readonly (keyof ExportTables)[];

export function openDatabase(file: string): Database {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: Database): void {
  const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.run(MIGRATIONS[v] as string);
      db.run(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}

class SqliteOps implements Repo {
  constructor(
    protected readonly db: Database,
    private readonly gate: () => Promise<void>,
  ) {}

  async tx<T>(fn: (r: Repo) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async progress(packId: PackId): Promise<Record<NodeId, NodeProgress>> {
    await this.gate();
    const rows = this.db.query("SELECT data FROM node_progress WHERE pack_id = ?").all(packId) as Row[];
    const out: Record<NodeId, NodeProgress> = {};
    for (const p of parse<NodeProgress>(rows)) out[p.nodeId] = p;
    return out;
  }

  async putProgress(packId: PackId, p: NodeProgress): Promise<void> {
    await this.gate();
    this.db
      .query(
        "INSERT INTO node_progress (pack_id, node_id, data) VALUES (?, ?, ?) ON CONFLICT (pack_id, node_id) DO UPDATE SET data = excluded.data",
      )
      .run(packId, p.nodeId, JSON.stringify(p));
  }

  async cards(f: { packId?: PackId; kind?: CardState["kind"]; dueBefore?: Millis }): Promise<CardState[]> {
    await this.gate();
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.packId !== undefined) {
      where.push("pack_id = ?");
      args.push(f.packId);
    }
    if (f.kind !== undefined) {
      where.push("kind = ?");
      args.push(f.kind);
    }
    if (f.dueBefore !== undefined) {
      where.push("due <= ? AND suspended = 0");
      args.push(f.dueBefore);
    }
    const sql = `SELECT data FROM card${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY due, id`;
    return parse<CardState>(this.db.query(sql).all(...args) as Row[]);
  }

  async putCard(c: CardState): Promise<void> {
    await this.gate();
    this.db
      .query(
        `INSERT INTO card (id, pack_id, node_id, kind, due, suspended, data) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET pack_id = excluded.pack_id, node_id = excluded.node_id, kind = excluded.kind,
           due = excluded.due, suspended = excluded.suspended, data = excluded.data`,
      )
      .run(c.id, c.packId, c.nodeId, c.kind, Math.round(c.due), c.suspended ? 1 : 0, JSON.stringify(c));
  }

  async deleteCard(id: string): Promise<void> {
    await this.gate();
    this.db.query("DELETE FROM card WHERE id = ?").run(id);
  }

  async addReviewLog(r: ReviewLogRow): Promise<void> {
    await this.gate();
    this.db
      .query("INSERT INTO review_log (card_id, at, data) VALUES (?, ?, ?)")
      .run(r.cardId, Math.round(r.at), JSON.stringify(r));
  }

  async run(id: string): Promise<RunState | null> {
    await this.gate();
    const row = this.db.query("SELECT data FROM run WHERE id = ?").get(id) as Row | null;
    return row ? (JSON.parse(row.data) as RunState) : null;
  }

  async putRun(r: RunState): Promise<void> {
    await this.gate();
    this.db
      .query(
        `INSERT INTO run (id, pack_id, kind, finished_at, started_at, data) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET pack_id = excluded.pack_id, kind = excluded.kind,
           finished_at = excluded.finished_at, started_at = excluded.started_at, data = excluded.data`,
      )
      .run(r.id, r.packId, r.kind, r.finishedAt ?? null, Math.round(r.startedAt), JSON.stringify(r));
  }

  async openRuns(f: { packId?: PackId }): Promise<RunState[]> {
    await this.gate();
    const rows =
      f.packId === undefined
        ? this.db.query("SELECT data FROM run WHERE finished_at IS NULL ORDER BY started_at").all()
        : this.db
            .query("SELECT data FROM run WHERE finished_at IS NULL AND pack_id = ? ORDER BY started_at")
            .all(f.packId);
    return parse<RunState>(rows as Row[]);
  }

  async addAttempt(a: AttemptRow): Promise<number> {
    await this.gate();
    const { id: _ignored, ...rest } = a;
    const res = this.db
      .query("INSERT INTO attempt (run_id, pack_id, node_id, at, data) VALUES (?, ?, ?, ?, ?)")
      .run(a.runId, a.packId, a.nodeId, Math.round(a.at), JSON.stringify(rest));
    return Number(res.lastInsertRowid);
  }

  async attempts(f: { runId?: string; packId?: PackId; nodeId?: NodeId }): Promise<AttemptRow[]> {
    await this.gate();
    const where: string[] = [];
    const args: string[] = [];
    if (f.runId !== undefined) {
      where.push("run_id = ?");
      args.push(f.runId);
    }
    if (f.packId !== undefined) {
      where.push("pack_id = ?");
      args.push(f.packId);
    }
    if (f.nodeId !== undefined) {
      where.push("node_id = ?");
      args.push(f.nodeId);
    }
    const sql = `SELECT id, data FROM attempt${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id`;
    return (this.db.query(sql).all(...args) as (Row & { id: number })[]).map((r) => ({
      ...(JSON.parse(r.data) as AttemptRow),
      id: r.id,
    }));
  }

  async itemRatings(packId: PackId, nodeId: NodeId): Promise<Record<ItemId, number>> {
    await this.gate();
    const rows = this.db
      .query("SELECT item_id, d FROM item_rating WHERE pack_id = ? AND node_id = ?")
      .all(packId, nodeId) as { item_id: string; d: number }[];
    return Object.fromEntries(rows.map((r) => [r.item_id, r.d]));
  }

  async putItemRating(packId: PackId, nodeId: NodeId, itemId: ItemId, d: number): Promise<void> {
    await this.gate();
    this.db
      .query(
        "INSERT INTO item_rating (pack_id, node_id, item_id, d) VALUES (?, ?, ?, ?) ON CONFLICT (pack_id, node_id, item_id) DO UPDATE SET d = excluded.d",
      )
      .run(packId, nodeId, itemId, d);
  }

  async fieldNotes(f: { packId?: PackId }): Promise<FieldNote[]> {
    await this.gate();
    const rows =
      f.packId === undefined
        ? this.db.query("SELECT data FROM field_note ORDER BY lit_at DESC, id").all()
        : this.db.query("SELECT data FROM field_note WHERE pack_id = ? ORDER BY lit_at DESC, id").all(f.packId);
    return parse<FieldNote>(rows as Row[]);
  }

  async putFieldNote(n: FieldNote): Promise<void> {
    await this.gate();
    this.db
      .query(
        "INSERT INTO field_note (id, pack_id, lit_at, data) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET pack_id = excluded.pack_id, lit_at = excluded.lit_at, data = excluded.data",
      )
      .run(n.id, n.packId, Math.round(n.litAt), JSON.stringify(n));
  }

  async kv<T>(key: string): Promise<T | undefined> {
    await this.gate();
    const row = this.db.query("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | null;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  async setKv<T>(key: string, value: T): Promise<void> {
    await this.gate();
    if (value === undefined) {
      this.db.query("DELETE FROM kv WHERE key = ?").run(key);
      return;
    }
    this.db
      .query("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  async kvList<T>(prefix: string): Promise<[key: string, value: T][]> {
    await this.gate();
    const rows = this.db
      .query("SELECT key, value FROM kv WHERE substr(key, 1, ?) = ? ORDER BY key")
      .all(prefix.length, prefix) as { key: string; value: string }[];
    return rows.map((r) => [r.key, JSON.parse(r.value) as T]);
  }

  async exportTables(): Promise<ExportTables> {
    await this.gate();
    const all = (sql: string) => parse<never>(this.db.query(sql).all() as Row[]);
    return {
      node_progress: (
        this.db.query("SELECT pack_id, data FROM node_progress ORDER BY pack_id, node_id").all() as (Row & {
          pack_id: string;
        })[]
      ).map((r) => ({ ...(JSON.parse(r.data) as NodeProgress), packId: r.pack_id })),
      card: all("SELECT data FROM card ORDER BY id"),
      review_log: all("SELECT data FROM review_log ORDER BY id"),
      attempt: (this.db.query("SELECT id, data FROM attempt ORDER BY id").all() as (Row & { id: number })[]).map(
        (r) => ({ ...(JSON.parse(r.data) as AttemptRow), id: r.id }),
      ),
      field_note: all("SELECT data FROM field_note ORDER BY id"),
      generated_item: all("SELECT data FROM generated_item ORDER BY id"),
      run: all("SELECT data FROM run ORDER BY started_at, id"),
    };
  }

  /** Upserts every row (callers validate with the ExportTables schema first). Returns rows written per table. */
  async importTables(t: ExportTables): Promise<Record<string, number>> {
    await this.gate();
    const counts: Record<string, number> = {};
    const write = this.db.transaction(() => {
      for (const p of t.node_progress) {
        const { packId, ...rest } = p;
        this.db
          .query(
            "INSERT INTO node_progress (pack_id, node_id, data) VALUES (?, ?, ?) ON CONFLICT (pack_id, node_id) DO UPDATE SET data = excluded.data",
          )
          .run(packId, rest.nodeId, JSON.stringify(rest));
      }
      counts.node_progress = t.node_progress.length;
      for (const c of t.card)
        this.db
          .query(
            `INSERT INTO card (id, pack_id, node_id, kind, due, suspended, data) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET pack_id = excluded.pack_id, node_id = excluded.node_id, kind = excluded.kind,
               due = excluded.due, suspended = excluded.suspended, data = excluded.data`,
          )
          .run(c.id, c.packId, c.nodeId, c.kind, Math.round(c.due), c.suspended ? 1 : 0, JSON.stringify(c));
      counts.card = t.card.length;
      for (const r of t.review_log)
        this.db
          .query("INSERT INTO review_log (card_id, at, data) VALUES (?, ?, ?)")
          .run(r.cardId, Math.round(r.at), JSON.stringify(r));
      counts.review_log = t.review_log.length;
      for (const a of t.attempt) {
        const { id: _id, ...rest } = a;
        this.db
          .query("INSERT INTO attempt (run_id, pack_id, node_id, at, data) VALUES (?, ?, ?, ?, ?)")
          .run(a.runId, a.packId, a.nodeId, Math.round(a.at), JSON.stringify(rest));
      }
      counts.attempt = t.attempt.length;
      for (const n of t.field_note)
        this.db
          .query(
            "INSERT INTO field_note (id, pack_id, lit_at, data) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET pack_id = excluded.pack_id, lit_at = excluded.lit_at, data = excluded.data",
          )
          .run(n.id, n.packId, Math.round(n.litAt), JSON.stringify(n));
      counts.field_note = t.field_note.length;
      for (const g of t.generated_item)
        this.db
          .query(
            "INSERT INTO generated_item (id, pack_id, node_id, data) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data",
          )
          .run(g.id, g.packId, g.nodeId, JSON.stringify(g));
      counts.generated_item = t.generated_item.length;
      for (const r of t.run)
        this.db
          .query(
            `INSERT INTO run (id, pack_id, kind, finished_at, started_at, data) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET pack_id = excluded.pack_id, kind = excluded.kind,
               finished_at = excluded.finished_at, started_at = excluded.started_at, data = excluded.data`,
          )
          .run(r.id, r.packId, r.kind, r.finishedAt ?? null, Math.round(r.startedAt), JSON.stringify(r));
      counts.run = t.run.length;
    });
    write();
    return counts;
  }
}

/** The Repo the server uses. Open with `SqliteRepo.open(homePaths(home).db)` or `":memory:"` in tests. */
export class SqliteRepo extends SqliteOps {
  private active: Promise<void> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private readonly scoped: SqliteOps;

  private constructor(db: Database) {
    super(db, () => this.idle());
    this.scoped = new SqliteOps(db, async () => {});
  }

  static open(file: string): SqliteRepo {
    return new SqliteRepo(openDatabase(file));
  }

  private async idle(): Promise<void> {
    while (this.active) await this.active;
  }

  override async tx<T>(fn: (r: Repo) => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release: () => void = () => {};
    const mine = new Promise<void>((r) => {
      release = r;
    });
    this.tail = prev.then(() => mine);
    await prev;
    this.active = mine;
    this.db.run("BEGIN IMMEDIATE");
    try {
      const out = await fn(this.scoped);
      this.db.run("COMMIT");
      return out;
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    } finally {
      this.active = null;
      release();
    }
  }

  /** Delete every learner row for a pack (POST /reset/:packId). Installed files are untouched. */
  async resetPack(packId: PackId): Promise<void> {
    await this.tx(async () => {
      for (const table of ["node_progress", "card", "attempt", "item_rating", "field_note", "generated_item"])
        this.db.query(`DELETE FROM ${table} WHERE pack_id = ?`).run(packId);
      this.db
        .query("DELETE FROM review_log WHERE card_id LIKE ? OR card_id LIKE ?")
        .run(`node:${packId}:%`, `card:${packId}:%`);
      // Per-pack service state: opened time, checkpoint records, and the question plans of the pack's runs.
      this.db.query("DELETE FROM kv WHERE key IN (SELECT 'plan:' || id FROM run WHERE pack_id = ?)").run(packId);
      this.db.query("UPDATE run SET finished_at = started_at WHERE pack_id = ? AND finished_at IS NULL").run(packId);
      this.db
        .query("DELETE FROM kv WHERE key = ? OR substr(key, 1, ?) = ?")
        .run(`opened:${packId}`, `checkpoint:${packId}:`.length, `checkpoint:${packId}:`);
    });
  }

  /** Delete the kv keys revision 3 dropped (boss records, placement, misconception hits, quiz items). */
  dropLegacyKv(): number {
    let n = 0;
    for (const prefix of LEGACY_KV_PREFIXES)
      n += this.db.query("DELETE FROM kv WHERE substr(key, 1, ?) = ?").run(prefix.length, prefix).changes;
    return n;
  }

  close(): void {
    this.db.close();
  }
}
