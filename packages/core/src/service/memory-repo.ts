/**
 * An in-memory Repo (tests, "Try the first stop", the static demo before IndexedDB is wired).
 * Values are cloned on the way in and out, so callers can't mutate stored rows by accident.
 * `tx` snapshots the state and rolls back when the callback throws.
 */
import type { Repo } from "../repo";
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
  ReviewLogRow,
  RunState,
} from "../schema/index";

interface State {
  progress: Map<PackId, Map<NodeId, NodeProgress>>;
  cards: Map<string, CardState>;
  reviewLog: ReviewLogRow[];
  runs: Map<string, RunState>;
  attempts: AttemptRow[];
  nextAttemptId: number;
  ratings: Map<string, number>;
  notes: Map<string, FieldNote>;
  kv: Map<string, unknown>;
  generated: ExportTables["generated_item"];
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

function emptyState(): State {
  return {
    progress: new Map(),
    cards: new Map(),
    reviewLog: [],
    runs: new Map(),
    attempts: [],
    nextAttemptId: 1,
    ratings: new Map(),
    notes: new Map(),
    kv: new Map(),
    generated: [],
  };
}

function snapshot(s: State): State {
  return {
    progress: new Map([...s.progress].map(([k, m]) => [k, new Map([...m].map(([n, p]) => [n, clone(p)]))])),
    cards: new Map([...s.cards].map(([k, c]) => [k, clone(c)])),
    reviewLog: s.reviewLog.map(clone),
    runs: new Map([...s.runs].map(([k, r]) => [k, clone(r)])),
    attempts: s.attempts.map(clone),
    nextAttemptId: s.nextAttemptId,
    ratings: new Map(s.ratings),
    notes: new Map([...s.notes].map(([k, n]) => [k, clone(n)])),
    kv: new Map([...s.kv].map(([k, v]) => [k, clone(v)])),
    generated: s.generated.map(clone),
  };
}

export class MemoryRepo implements Repo {
  private s: State = emptyState();
  private depth = 0;

  async tx<T>(fn: (r: Repo) => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn(this);
    const saved = snapshot(this.s);
    this.depth++;
    try {
      return await fn(this);
    } catch (e) {
      this.s = saved;
      throw e;
    } finally {
      this.depth--;
    }
  }

  async progress(packId: PackId): Promise<Record<NodeId, NodeProgress>> {
    const out: Record<NodeId, NodeProgress> = {};
    for (const [id, p] of this.s.progress.get(packId) ?? []) out[id] = clone(p);
    return out;
  }

  async putProgress(packId: PackId, p: NodeProgress): Promise<void> {
    let m = this.s.progress.get(packId);
    if (!m) {
      m = new Map();
      this.s.progress.set(packId, m);
    }
    m.set(p.nodeId, clone(p));
  }

  async cards(f: { packId?: PackId; kind?: CardState["kind"]; dueBefore?: Millis }): Promise<CardState[]> {
    return [...this.s.cards.values()]
      .filter((c) => (f.packId === undefined || c.packId === f.packId) && (f.kind === undefined || c.kind === f.kind))
      .filter((c) => f.dueBefore === undefined || c.due <= f.dueBefore)
      .sort((a, b) => a.due - b.due || a.id.localeCompare(b.id))
      .map(clone);
  }

  async putCard(c: CardState): Promise<void> {
    this.s.cards.set(c.id, clone(c));
  }

  async deleteCard(id: string): Promise<void> {
    this.s.cards.delete(id);
  }

  async addReviewLog(r: ReviewLogRow): Promise<void> {
    this.s.reviewLog.push(clone(r));
  }

  /** Review log rows (tests and export). */
  reviewLogs(): ReviewLogRow[] {
    return this.s.reviewLog.map(clone);
  }

  async run(id: string): Promise<RunState | null> {
    return clone(this.s.runs.get(id) ?? null);
  }

  async putRun(r: RunState): Promise<void> {
    this.s.runs.set(r.id, clone(r));
  }

  async openRuns(f: { packId?: PackId }): Promise<RunState[]> {
    return [...this.s.runs.values()]
      .filter((r) => r.finishedAt === undefined && (f.packId === undefined || r.packId === f.packId))
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(clone);
  }

  async addAttempt(a: AttemptRow): Promise<number> {
    const id = this.s.nextAttemptId++;
    this.s.attempts.push({ ...clone(a), id });
    return id;
  }

  async attempts(f: { runId?: string; packId?: PackId; nodeId?: NodeId }): Promise<AttemptRow[]> {
    return this.s.attempts
      .filter(
        (a) =>
          (f.runId === undefined || a.runId === f.runId) &&
          (f.packId === undefined || a.packId === f.packId) &&
          (f.nodeId === undefined || a.nodeId === f.nodeId),
      )
      .map(clone);
  }

  async itemRatings(packId: PackId, nodeId: NodeId): Promise<Record<ItemId, number>> {
    const prefix = `${packId}\u0000${nodeId}\u0000`;
    const out: Record<ItemId, number> = {};
    for (const [k, v] of this.s.ratings) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    return out;
  }

  async putItemRating(packId: PackId, nodeId: NodeId, itemId: ItemId, d: number): Promise<void> {
    this.s.ratings.set(`${packId}\u0000${nodeId}\u0000${itemId}`, d);
  }

  async fieldNotes(f: { packId?: PackId }): Promise<FieldNote[]> {
    return [...this.s.notes.values()]
      .filter((n) => f.packId === undefined || n.packId === f.packId)
      .sort((a, b) => b.litAt - a.litAt)
      .map(clone);
  }

  async putFieldNote(n: FieldNote): Promise<void> {
    this.s.notes.set(n.id, clone(n));
  }

  async kv<T>(key: string): Promise<T | undefined> {
    return clone(this.s.kv.get(key) as T | undefined);
  }

  async setKv<T>(key: string, value: T): Promise<void> {
    if (value === undefined) this.s.kv.delete(key);
    else this.s.kv.set(key, clone(value));
  }

  async kvList<T>(prefix: string): Promise<[string, T][]> {
    return [...this.s.kv]
      .filter(([k]) => k.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, clone(v) as T]);
  }

  async exportTables(): Promise<ExportTables> {
    return {
      node_progress: [...this.s.progress].flatMap(([packId, m]) =>
        [...m.values()].map((p) => ({ ...clone(p), packId })),
      ),
      card: [...this.s.cards.values()].map(clone),
      review_log: this.s.reviewLog.map(clone),
      attempt: this.s.attempts.map(clone),
      field_note: [...this.s.notes.values()].map(clone),
      generated_item: this.s.generated.map(clone),
      run: [...this.s.runs.values()].map(clone),
    };
  }

  async importTables(t: ExportTables): Promise<Record<string, number>> {
    for (const { packId, ...p } of t.node_progress) await this.putProgress(packId, p);
    for (const c of t.card) await this.putCard(c);
    for (const r of t.review_log) await this.addReviewLog(r);
    for (const a of t.attempt) {
      const id = a.id ?? this.s.nextAttemptId;
      this.s.attempts = this.s.attempts.filter((x) => x.id !== id);
      this.s.attempts.push({ ...clone(a), id });
      this.s.nextAttemptId = Math.max(this.s.nextAttemptId, id + 1);
    }
    for (const n of t.field_note) await this.putFieldNote(n);
    for (const g of t.generated_item) {
      this.s.generated = this.s.generated.filter((x) => x.id !== g.id);
      this.s.generated.push(clone(g));
    }
    for (const r of t.run) await this.putRun(r);
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
}
