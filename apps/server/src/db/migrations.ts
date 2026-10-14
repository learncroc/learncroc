/**
 * SQLite migrations, applied in order and recorded in PRAGMA user_version. Kept as strings so the
 * compiled single-file binary carries them.
 *
 * Rows keep their lookup keys as columns and the full record as JSON in `data`, so additive schema
 * changes need no migration.
 *
 * #1 the tables. #2 revision 3 (the card loop): sparked → done (doneAt = sparkedAt), progress sources
 * quick-run → run and placement/boss → import, cut run kinds deleted, attempt phases outside the new
 * RunPhase → legacy, placement review logs → legacy, and the boss/placement/misconception kv keys gone.
 * Each migration runs in one transaction (see migrate() in sqlite-repo.ts). Core's migrateLearnerRows
 * applies the same mapping to imported version-1 export files.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE node_progress (
    pack_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    data    TEXT NOT NULL,
    PRIMARY KEY (pack_id, node_id)
  );
  CREATE TABLE card (
    id        TEXT PRIMARY KEY,
    pack_id   TEXT NOT NULL,
    node_id   TEXT,
    kind      TEXT NOT NULL,
    due       INTEGER NOT NULL,
    suspended INTEGER NOT NULL DEFAULT 0,
    data      TEXT NOT NULL
  );
  CREATE INDEX card_pack ON card (pack_id, kind);
  CREATE INDEX card_due ON card (due);
  CREATE TABLE review_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    at      INTEGER NOT NULL,
    data    TEXT NOT NULL
  );
  CREATE INDEX review_log_card ON review_log (card_id);
  CREATE TABLE run (
    id          TEXT PRIMARY KEY,
    pack_id     TEXT NOT NULL,
    kind        TEXT NOT NULL,
    finished_at INTEGER,
    started_at  INTEGER NOT NULL,
    data        TEXT NOT NULL
  );
  CREATE INDEX run_open ON run (finished_at, pack_id);
  CREATE TABLE attempt (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    at      INTEGER NOT NULL,
    data    TEXT NOT NULL
  );
  CREATE INDEX attempt_run ON attempt (run_id);
  CREATE INDEX attempt_node ON attempt (pack_id, node_id);
  CREATE TABLE item_rating (
    pack_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    d       REAL NOT NULL,
    PRIMARY KEY (pack_id, node_id, item_id)
  );
  CREATE TABLE field_note (
    id      TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    lit_at  INTEGER NOT NULL,
    data    TEXT NOT NULL
  );
  CREATE INDEX field_note_pack ON field_note (pack_id);
  CREATE TABLE generated_item (
    id      TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    data    TEXT NOT NULL
  );
  CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  UPDATE node_progress
    SET data = json_set(data, '$.doneAt', json_extract(data, '$.sparkedAt'))
    WHERE json_extract(data, '$.status') = 'sparked'
      AND json_extract(data, '$.sparkedAt') IS NOT NULL
      AND json_extract(data, '$.doneAt') IS NULL;
  UPDATE node_progress
    SET data = json_set(data, '$.status', 'done')
    WHERE json_extract(data, '$.status') = 'sparked';
  UPDATE node_progress
    SET data = json_set(data, '$.source', CASE json_extract(data, '$.source')
      WHEN 'quick-run' THEN 'run'
      WHEN 'placement' THEN 'import'
      WHEN 'boss' THEN 'import'
      ELSE json_extract(data, '$.source') END)
    WHERE json_extract(data, '$.source') IN ('quick-run', 'placement', 'boss');
  UPDATE node_progress
    SET data = json_remove(data, '$.bossPassedAt', '$.sparkedAt');
  DELETE FROM run WHERE kind NOT IN ('card', 'checkpoint', 'relight');
  UPDATE attempt
    SET data = json_set(data, '$.phase', 'legacy')
    WHERE json_extract(data, '$.phase') NOT IN ('hook', 'screen', 'close', 'checkpoint', 'relight', 'done')
       OR json_extract(data, '$.phase') IS NULL;
  UPDATE review_log
    SET data = json_set(data, '$.source', 'legacy')
    WHERE json_extract(data, '$.source') = 'placement';
  DELETE FROM kv
    WHERE key LIKE 'boss:%' OR key LIKE 'boss-retry:%' OR key LIKE 'placement:%' OR key LIKE 'mhits:%'
       OR key LIKE 'misconceptions:%' OR key LIKE 'quiz-items:%';
  `,
];
