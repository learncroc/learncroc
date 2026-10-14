/**
 * Filesystem helpers: atomic JSON writes (temp file + rename), safe JSON reads, and the one-writer
 * lock (PLAN §17: when no server answers, the CLI takes ~/.learncroc/.lock and works directly).
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

/** Write a file atomically: a sibling temp file, fsync, then rename over the target. */
export function writeFileAtomic(file: string, data: string | Uint8Array, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  const fd = openSync(tmp, "w", mode ?? 0o644);
  try {
    writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf8") : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (mode !== undefined) chmodSync(tmp, mode);
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function writeJsonAtomic(file: string, value: unknown, mode?: number): void {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

/** Read and parse a JSON file; undefined when missing. Throws on malformed JSON. */
export function readJson(file: string): unknown {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8"));
}

export class LockHeldError extends Error {
  constructor(
    readonly file: string,
    readonly pid: number,
  ) {
    super(`another learncroc process (pid ${pid}) holds ${file}`);
    this.name = "LockHeldError";
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Take an exclusive lock file holding our pid. A stale lock (dead pid) is replaced.
 * Returns a release function.
 */
export function acquireLock(file: string): () => void {
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx" });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          if (readFileSync(file, "utf8").trim() === String(process.pid)) rmSync(file, { force: true });
        } catch {
          /* already gone */
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(readFileSync(file, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && processAlive(pid))
        throw new LockHeldError(file, pid);
      rmSync(file, { force: true });
    }
  }
  throw new Error(`could not take lock ${file}`);
}
