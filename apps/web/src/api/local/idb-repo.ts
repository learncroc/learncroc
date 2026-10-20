/**
 * IdbRepo: core's Repo over IndexedDB for the static demo. One object store per
 * table. IndexedDB transactions can't stay open across the services' other awaits, so `tx()`
 * serialises callers instead (one learner, one tab); each individual write is atomic.
 */
import type {
  AttemptRow,
  CardState,
  ExportTables,
  FieldNote,
  ItemId,
  Millis,
  NodeId,
  NodeProgress,
  PackId,
  Repo,
  ReviewLogRow,
  RunState,
} from "@learncroc/core";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

interface LmDb extends DBSchema {
  node_progress: { key: [string, string]; value: NodeProgress & { packId: PackId }; indexes: { pack: string } };
  card: { key: string; value: CardState; indexes: { pack: string } };
  review_log: { key: number; value: ReviewLogRow & { id?: number } };
  run: { key: string; value: RunState & { open: 0 | 1 }; indexes: { open: number } };
  attempt: { key: number; value: AttemptRow; indexes: { run: string; pack: string } };
  item_rating: { key: [string, string, string]; value: { packId: string; nodeId: string; itemId: string; d: number } };
  field_note: { key: string; value: FieldNote; indexes: { pack: string } };
  generated_item: { key: string; value: ExportTables["generated_item"][number] };
  kv: { key: string; value: { key: string; value: unknown } };
}

export const IDB_NAME = "learncroc";
const VERSION = 1;

export function openLearncrocDb(name = IDB_NAME): Promise<IDBPDatabase<LmDb>> {
  return openDB<LmDb>(name, VERSION, {
    upgrade(db) {
      db.createObjectStore("node_progress", { keyPath: ["packId", "nodeId"] }).createIndex("pack", "packId");
      db.createObjectStore("card", { keyPath: "id" }).createIndex("pack", "packId");
      db.createObjectStore("review_log", { keyPath: "id", autoIncrement: true });
      db.createObjectStore("run", { keyPath: "id" }).createIndex("open", "open");
      const attempts = db.createObjectStore("attempt", { keyPath: "id", autoIncrement: true });
      attempts.createIndex("run", "runId");
      attempts.createIndex("pack", "packId");
      db.createObjectStore("item_rating", { keyPath: ["packId", "nodeId", "itemId"] });
      db.createObjectStore("field_note", { keyPath: "id" }).createIndex("pack", "packId");
      db.createObjectStore("generated_item", { keyPath: "id" });
      db.createObjectStore("kv", { keyPath: "key" });
    },
  });
}

const strip = <T extends object>(v: T, ...keys: string[]): T => {
  const out = { ...v } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return out as T;
};

export class IdbRepo implements Repo {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  constructor(private readonly db: IDBPDatabase<LmDb>) {}

  static async open(name = IDB_NAME): Promise<IdbRepo> {
    return new IdbRepo(await openLearncrocDb(name));
  }

  async tx<T>(fn: (r: Repo) => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn(this);
    const run = this.tail.then(async () => {
      this.depth++;
      try {
        return await fn(this);
      } finally {
        this.depth--;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  async progress(packId: PackId): Promise<Record<NodeId, NodeProgress>> {
    const rows = await this.db.getAllFromIndex("node_progress", "pack", packId);
    return Object.fromEntries(rows.map((r) => [r.nodeId, strip(r, "packId") as NodeProgress]));
  }

  async putProgress(packId: PackId, p: NodeProgress): Promise<void> {
    await this.db.put("node_progress", { ...p, packId });
  }

  async cards(f: { packId?: PackId; kind?: CardState["kind"]; dueBefore?: Millis }): Promise<CardState[]> {
    const all =
      f.packId !== undefined ? await this.db.getAllFromIndex("card", "pack", f.packId) : await this.db.getAll("card");
    return all
      .filter(
        (c) =>
          (f.kind === undefined || c.kind === f.kind) &&
          (f.dueBefore === undefined || (c.due <= f.dueBefore && !c.suspended)),
      )
      .sort((a, b) => a.due - b.due || (a.id < b.id ? -1 : 1));
  }

  async putCard(c: CardState): Promise<void> {
    await this.db.put("card", c);
  }

  async deleteCard(id: string): Promise<void> {
    await this.db.delete("card", id);
  }

  async addReviewLog(r: ReviewLogRow): Promise<void> {
    await this.db.add("review_log", { ...r });
  }

  async run(id: string): Promise<RunState | null> {
    const r = await this.db.get("run", id);
    return r ? (strip(r, "open") as RunState) : null;
  }

  async putRun(r: RunState): Promise<void> {
    await this.db.put("run", { ...r, open: r.finishedAt === undefined ? 1 : 0 });
  }

  async openRuns(f: { packId?: PackId }): Promise<RunState[]> {
    const rows = await this.db.getAllFromIndex("run", "open", 1);
    return rows
      .filter((r) => f.packId === undefined || r.packId === f.packId)
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((r) => strip(r, "open") as RunState);
  }

  async addAttempt(a: AttemptRow): Promise<number> {
    const { id: _id, ...rest } = a;
    return (await this.db.add("attempt", rest as AttemptRow)) as number;
  }

  async attempts(f: { runId?: string; packId?: PackId; nodeId?: NodeId }): Promise<AttemptRow[]> {
    const rows =
      f.runId !== undefined
        ? await this.db.getAllFromIndex("attempt", "run", f.runId)
        : f.packId !== undefined
          ? await this.db.getAllFromIndex("attempt", "pack", f.packId)
          : await this.db.getAll("attempt");
    return rows
      .filter(
        (a) => (f.packId === undefined || a.packId === f.packId) && (f.nodeId === undefined || a.nodeId === f.nodeId),
      )
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }

  async itemRatings(packId: PackId, nodeId: NodeId): Promise<Record<ItemId, number>> {
    const range = IDBKeyRange.bound([packId, nodeId, ""], [packId, nodeId, "￿"]);
    const rows = await this.db.getAll("item_rating", range);
    return Object.fromEntries(rows.map((r) => [r.itemId, r.d]));
  }

  async putItemRating(packId: PackId, nodeId: NodeId, itemId: ItemId, d: number): Promise<void> {
    await this.db.put("item_rating", { packId, nodeId, itemId, d });
  }

  async fieldNotes(f: { packId?: PackId }): Promise<FieldNote[]> {
    const rows =
      f.packId !== undefined
        ? await this.db.getAllFromIndex("field_note", "pack", f.packId)
        : await this.db.getAll("field_note");
    return rows.sort((a, b) => b.litAt - a.litAt || (a.id < b.id ? -1 : 1));
  }

  async putFieldNote(n: FieldNote): Promise<void> {
    await this.db.put("field_note", n);
  }

  async kv<T>(key: string): Promise<T | undefined> {
    return (await this.db.get("kv", key))?.value as T | undefined;
  }

  async setKv<T>(key: string, value: T): Promise<void> {
    if (value === undefined) await this.db.delete("kv", key);
    else await this.db.put("kv", { key, value });
  }

  async kvList<T>(prefix: string): Promise<[key: string, value: T][]> {
    const rows = await this.db.getAll("kv", IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    return rows.map((r) => [r.key, r.value as T]);
  }

  async exportTables(): Promise<ExportTables> {
    const [progress, cards, logs, runs, attempts, notes, generated] = await Promise.all([
      this.db.getAll("node_progress"),
      this.db.getAll("card"),
      this.db.getAll("review_log"),
      this.db.getAll("run"),
      this.db.getAll("attempt"),
      this.db.getAll("field_note"),
      this.db.getAll("generated_item"),
    ]);
    return {
      node_progress: progress,
      card: cards,
      review_log: logs.map((l) => strip(l, "id")),
      attempt: attempts,
      field_note: notes,
      generated_item: generated,
      run: runs.map((r) => strip(r, "open") as RunState),
    };
  }

  async importTables(t: ExportTables): Promise<Record<string, number>> {
    const tx = this.db.transaction(
      ["node_progress", "card", "review_log", "attempt", "field_note", "generated_item", "run"],
      "readwrite",
    );
    for (const p of t.node_progress) void tx.objectStore("node_progress").put(p);
    for (const c of t.card) void tx.objectStore("card").put(c);
    for (const r of t.review_log) void tx.objectStore("review_log").add({ ...r });
    for (const a of t.attempt) {
      const { id: _id, ...rest } = a;
      void tx.objectStore("attempt").add(rest as AttemptRow);
    }
    for (const n of t.field_note) void tx.objectStore("field_note").put(n);
    for (const g of t.generated_item) void tx.objectStore("generated_item").put(g);
    for (const r of t.run) void tx.objectStore("run").put({ ...r, open: r.finishedAt === undefined ? 1 : 0 });
    await tx.done;
    return {
      node_progress: t.node_progress.length,
      card: t.card.length,
      review_log: t.review_log.length,
      attempt: t.attempt.length,
      field_note: t.field_note.length,
      generated_item: t.generated_item.length,
      run: t.run.length,
    };
  }

  /**
   * Delete every learner row for a pack, its per-pack kv state (opened time, checkpoint records, the
   * question plans of its runs) and close its open runs.
   */
  async resetPack(packId: PackId): Promise<void> {
    const tx = this.db.transaction(
      ["node_progress", "card", "attempt", "field_note", "item_rating", "run", "kv"],
      "readwrite",
    );
    const del = async (store: "node_progress" | "card" | "attempt" | "field_note") => {
      const s = tx.objectStore(store);
      for (const key of await s.index("pack").getAllKeys(packId)) await s.delete(key as never);
    };
    await Promise.all([del("node_progress"), del("card"), del("attempt"), del("field_note")]);
    const ratings = tx.objectStore("item_rating");
    for (const key of await ratings.getAllKeys(IDBKeyRange.bound([packId, "", ""], [packId, "\uffff", "\uffff"])))
      await ratings.delete(key);
    const runs = tx.objectStore("run");
    const kv = tx.objectStore("kv");
    for (const r of await runs.getAll()) {
      if (r.packId !== packId) continue;
      await kv.delete(`plan:${r.id}`);
      if (r.open === 1) await runs.put({ ...r, finishedAt: r.startedAt, open: 0 });
    }
    await kv.delete(`opened:${packId}`);
    const prefix = `checkpoint:${packId}:`;
    for (const key of await kv.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`))) await kv.delete(key);
    await tx.done;
  }

  /** Delete every kv entry whose key starts with one of the prefixes (learner-data migration). */
  async deleteKvPrefixes(prefixes: readonly string[]): Promise<number> {
    const tx = this.db.transaction("kv", "readwrite");
    let n = 0;
    for (const prefix of prefixes)
      for (const key of await tx.store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`))) {
        await tx.store.delete(key);
        n++;
      }
    await tx.done;
    return n;
  }

  /** Every learner table as stored, without parsing (the input of the learner-data migration). */
  async rawTables(): Promise<Record<string, unknown[]>> {
    const t = await this.exportTables();
    return t as unknown as Record<string, unknown[]>;
  }

  /** Clear the learner tables and write these rows instead (one transaction). kv is left alone. */
  async replaceTables(t: ExportTables): Promise<Record<string, number>> {
    const tx = this.db.transaction(
      ["node_progress", "card", "review_log", "attempt", "field_note", "generated_item", "run"],
      "readwrite",
    );
    await Promise.all(
      (["node_progress", "card", "review_log", "attempt", "field_note", "generated_item", "run"] as const).map((s) =>
        tx.objectStore(s).clear(),
      ),
    );
    await tx.done;
    return this.importTables(t);
  }

  close(): void {
    this.db.close();
  }
}
