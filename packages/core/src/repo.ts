/**
 * Storage seam. SqliteRepo (server), IdbRepo (static demo), MemoryRepo (tests, try-runs).
 */
import type {
  AttemptRow,
  CardState,
  CompiledPack,
  ExportTables,
  FieldNote,
  InstalledPackSummary,
  ItemId,
  Millis,
  NodeId,
  NodeProgress,
  PackId,
  ReviewLogRow,
  RunState,
  SemVer,
} from "./schema/index";

export interface Repo {
  tx<T>(fn: (r: Repo) => Promise<T>): Promise<T>;
  progress(packId: PackId): Promise<Record<NodeId, NodeProgress>>;
  putProgress(packId: PackId, p: NodeProgress): Promise<void>;
  cards(f: { packId?: PackId; kind?: CardState["kind"]; dueBefore?: Millis }): Promise<CardState[]>;
  putCard(c: CardState): Promise<void>;
  deleteCard(id: string): Promise<void>;
  addReviewLog(r: ReviewLogRow): Promise<void>;
  run(id: string): Promise<RunState | null>;
  putRun(r: RunState): Promise<void>;
  openRuns(f: { packId?: PackId }): Promise<RunState[]>;
  addAttempt(a: AttemptRow): Promise<number>;
  attempts(f: { runId?: string; packId?: PackId; nodeId?: NodeId }): Promise<AttemptRow[]>;
  itemRatings(packId: PackId, nodeId: NodeId): Promise<Record<ItemId, number>>;
  putItemRating(packId: PackId, nodeId: NodeId, itemId: ItemId, d: number): Promise<void>;
  fieldNotes(f: { packId?: PackId }): Promise<FieldNote[]>;
  putFieldNote(n: FieldNote): Promise<void>;
  kv<T>(key: string): Promise<T | undefined>;
  setKv<T>(key: string, value: T): Promise<void>;
  /** Every kv entry whose key starts with `prefix` (local numbers read `numbers:create:*`). Optional: without it those numbers stay empty. */
  kvList?<T>(prefix: string): Promise<[key: string, value: T][]>;
  exportTables(): Promise<ExportTables>;
  importTables(t: ExportTables): Promise<Record<string, number>>;
}

export interface PackSource {
  list(): Promise<InstalledPackSummary[]>;
  get(id: PackId, version?: SemVer): Promise<CompiledPack>;
}

export interface Clock {
  now(): Millis;
}

/** Wall-clock time. Tests and the test-only clock route inject their own Clock. */
export const systemClock: Clock = { now: () => Date.now() };
