/**
 * The .lmpack archive: a gzip-compressed ustar tarball holding pack.json, assets/,
 * MANIFEST.sha256, LICENSE and README.md.
 *
 * Writing is deterministic (sorted entries, mtime 0, uid/gid 0, mode 0644) so the same pack gives
 * the same sha256. Reading is defensive: only regular files and directories, no absolute
 * paths, `..`, backslashes or NUL, an entry allowlist, ≤ 5,000 entries, ≤ 200 MB unpacked, a
 * compression-ratio cap, and a MANIFEST.sha256 that must cover every file exactly.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { ASSET_PATH_RE } from "@learncroc/core";

export interface ArchiveEntry {
  path: string;
  data: Uint8Array;
}

export class UnsafeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeArchiveError";
  }
}

export const ARCHIVE_LIMITS = {
  maxEntries: 5000,
  maxUnpackedBytes: 200 * 1024 * 1024,
  /** Unpacked / compressed. Text-heavy packs compress ~5-10x; a bomb is far beyond this. */
  maxRatio: 200,
  maxFileBytes: 20 * 1024 * 1024,
};

/** Top-level files a pack archive may contain besides assets/. */
const ROOT_FILES = new Set(["pack.json", "MANIFEST.sha256", "LICENSE", "README.md"]);

/** True for a path allowed inside an .lmpack. */
export function isAllowedEntry(path: string): boolean {
  if (ROOT_FILES.has(path)) return true;
  if (!ASSET_PATH_RE.test(path)) return false;
  return !path.endsWith(".html") || path.startsWith("assets/interactive/");
}

/** Reasons a raw tar path is unsafe, or null. */
export function unsafePathReason(path: string): string | null {
  if (path.length === 0) return "empty path";
  if (path.includes("\0")) return "NUL in path";
  if (path.includes("\\")) return "backslash in path";
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return "absolute path";
  if (path.split("/").some((seg) => seg === ".." || seg === ".")) return "'..' or '.' segment";
  return null;
}

export const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

// ── ustar writer

const enc = new TextEncoder();

function writeString(buf: Uint8Array, off: number, len: number, s: string): void {
  const b = enc.encode(s);
  if (b.length > len) throw new Error(`tar field overflow: ${s}`);
  buf.set(b, off);
}

function writeOctal(buf: Uint8Array, off: number, len: number, n: number): void {
  writeString(buf, off, len, `${n.toString(8).padStart(len - 1, "0")}\0`);
}

function splitName(path: string): { name: string; prefix: string } {
  if (enc.encode(path).length <= 100) return { name: path, prefix: "" };
  const i = path.lastIndexOf("/", 155);
  if (i <= 0 || enc.encode(path.slice(i + 1)).length > 100 || enc.encode(path.slice(0, i)).length > 155)
    throw new Error(`path too long for an lmpack: ${path}`);
  return { name: path.slice(i + 1), prefix: path.slice(0, i) };
}

function header(path: string, size: number, type: "0" | "5"): Uint8Array {
  const h = new Uint8Array(512);
  const { name, prefix } = splitName(path);
  writeString(h, 0, 100, name);
  writeOctal(h, 100, 8, type === "5" ? 0o755 : 0o644);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, 0);
  h.fill(0x20, 148, 156); // checksum placeholder (spaces)
  writeString(h, 156, 1, type);
  writeString(h, 257, 6, "ustar\0");
  writeString(h, 263, 2, "00");
  writeString(h, 345, 155, prefix);
  let sum = 0;
  for (const b of h) sum += b;
  writeString(h, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return h;
}

/** Build a deterministic tarball (uncompressed). */
export function packTar(entries: ArchiveEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const parts: Uint8Array[] = [];
  for (const e of sorted) {
    const reason = unsafePathReason(e.path);
    if (reason) throw new Error(`refusing to pack ${e.path}: ${reason}`);
    parts.push(header(e.path, e.data.byteLength, "0"));
    parts.push(e.data);
    const pad = (512 - (e.data.byteLength % 512)) % 512;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/** MANIFEST.sha256 text: "<sha256>  <path>\n" per file, sorted. */
export function manifestText(entries: ArchiveEntry[]): string {
  return [...entries]
    .filter((e) => e.path !== "MANIFEST.sha256")
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((e) => `${sha256Hex(e.data)}  ${e.path}\n`)
    .join("");
}

/** Build an .lmpack (adds MANIFEST.sha256). */
export function buildLmpack(entries: ArchiveEntry[]): Uint8Array {
  const files = entries.filter((e) => e.path !== "MANIFEST.sha256");
  for (const e of files) if (!isAllowedEntry(e.path)) throw new Error(`not allowed in an lmpack: ${e.path}`);
  const withManifest = [...files, { path: "MANIFEST.sha256", data: enc.encode(manifestText(files)) }];
  return new Uint8Array(gzipSync(packTar(withManifest), { level: 9 }));
}

// ── defensive reader

const dec = new TextDecoder("utf-8", { fatal: true });

function readString(buf: Uint8Array, off: number, len: number): string {
  const slice = buf.subarray(off, off + len);
  const end = slice.indexOf(0);
  return dec.decode(end >= 0 ? slice.subarray(0, end) : slice);
}

function readOctal(buf: Uint8Array, off: number, len: number): number {
  const s = readString(buf, off, len).trim();
  if (!/^[0-7]*$/.test(s)) throw new UnsafeArchiveError("bad octal field in tar header");
  return s ? Number.parseInt(s, 8) : 0;
}

/** Parse a tarball, rejecting anything but regular files and directories. */
export function readTar(tar: Uint8Array, limits = ARCHIVE_LIMITS): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  const seen = new Set<string>();
  let off = 0;
  let total = 0;
  let count = 0;
  while (off + 512 <= tar.byteLength) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : (h[i] as number);
    if (sum !== readOctal(h, 148, 8)) throw new UnsafeArchiveError("tar header checksum mismatch");
    const name = readString(h, 0, 100);
    const prefix = readString(h, 257, 6).startsWith("ustar") ? readString(h, 345, 155) : "";
    const type = String.fromCharCode(h[156] as number);
    const size = readOctal(h, 124, 12);
    const path = prefix ? `${prefix}/${name}` : name;
    off += 512;
    if (++count > limits.maxEntries) throw new UnsafeArchiveError(`more than ${limits.maxEntries} entries`);
    if (type === "x" || type === "g" || type === "L" || type === "K")
      throw new UnsafeArchiveError(`extended tar headers are not allowed (${path})`);
    if (type === "1") throw new UnsafeArchiveError(`hard link not allowed: ${path}`);
    if (type === "2") throw new UnsafeArchiveError(`symlink not allowed: ${path}`);
    if (type === "3" || type === "4" || type === "6")
      throw new UnsafeArchiveError(`device or FIFO not allowed: ${path}`);
    const clean = path.replace(/\/+$/, "");
    const reason = unsafePathReason(clean);
    if (reason) throw new UnsafeArchiveError(`unsafe path ${JSON.stringify(path)}: ${reason}`);
    if (type === "5") {
      if (clean !== "assets" && !clean.startsWith("assets/"))
        throw new UnsafeArchiveError(`unexpected directory ${clean}`);
      continue;
    }
    if (type !== "0" && type !== "\0") throw new UnsafeArchiveError(`unsupported entry type "${type}" for ${path}`);
    if (!isAllowedEntry(clean)) throw new UnsafeArchiveError(`entry not on the allowlist: ${clean}`);
    if (seen.has(clean)) throw new UnsafeArchiveError(`duplicate entry ${clean}`);
    seen.add(clean);
    if (size > limits.maxFileBytes) throw new UnsafeArchiveError(`${clean} is too large`);
    total += size;
    if (total > limits.maxUnpackedBytes) throw new UnsafeArchiveError("archive unpacks to more than the limit");
    if (off + size > tar.byteLength) throw new UnsafeArchiveError("truncated tar");
    out.push({ path: clean, data: tar.slice(off, off + size) });
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Gunzip with a hard output cap and the ratio check, parse, and verify MANIFEST.sha256. */
export function readLmpack(gz: Uint8Array, limits = ARCHIVE_LIMITS): Map<string, Uint8Array> {
  let tar: Uint8Array;
  try {
    tar = new Uint8Array(
      gunzipSync(gz, {
        maxOutputLength: Math.min(limits.maxUnpackedBytes + 1024 * 1024, gz.byteLength * limits.maxRatio + 1024 * 1024),
      }),
    );
  } catch (e) {
    if (e instanceof RangeError || /larger than|maxOutputLength|buffer/i.test((e as Error).message))
      throw new UnsafeArchiveError("archive decompresses beyond the size or ratio limit");
    throw new UnsafeArchiveError(`not a gzip archive: ${(e as Error).message}`);
  }
  const entries = readTar(tar, limits);
  const files = new Map(entries.map((e) => [e.path, e.data]));
  const manifest = files.get("MANIFEST.sha256");
  if (!manifest) throw new UnsafeArchiveError("MANIFEST.sha256 missing");
  if (!files.has("pack.json")) throw new UnsafeArchiveError("pack.json missing");
  const listed = new Map<string, string>();
  for (const line of dec.decode(manifest).split("\n")) {
    if (!line.trim()) continue;
    const m = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
    if (!m) throw new UnsafeArchiveError(`bad MANIFEST.sha256 line: ${line.slice(0, 80)}`);
    listed.set(m[2] as string, m[1] as string);
  }
  for (const [path, data] of files) {
    if (path === "MANIFEST.sha256") continue;
    const want = listed.get(path);
    if (!want) throw new UnsafeArchiveError(`${path} is not listed in MANIFEST.sha256`);
    if (sha256Hex(data) !== want) throw new UnsafeArchiveError(`${path} does not match MANIFEST.sha256`);
    listed.delete(path);
  }
  if (listed.size)
    throw new UnsafeArchiveError(`MANIFEST.sha256 lists missing files: ${[...listed.keys()].join(", ")}`);
  return files;
}
