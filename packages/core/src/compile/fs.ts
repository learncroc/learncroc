/**
 * Filesystem access for the compiler and lint, injected so core stays browser-safe (no node:*).
 * Paths are pack-relative POSIX paths ("nodes/attention.yaml", "assets/img/x.svg").
 */
export interface PackFs {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  /** Entry names of a directory ("" = the pack root); [] when it doesn't exist. Directories end with "/". */
  list(dir: string): Promise<string[]>;
  /** Size in bytes, undefined when missing. */
  size(path: string): Promise<number | undefined>;
  /** False when the resolved real path leaves the pack root (symlinks). Default: true. */
  isInside?(path: string): Promise<boolean>;
}

const norm = (p: string) => p.replace(/^\.?\/+/, "").replace(/\/+$/, "");

/** An in-memory pack (tests, the static demo, pocket maps being built). */
export function memoryFs(files: Readonly<Record<string, string | Uint8Array>>): PackFs {
  const map = new Map<string, string | Uint8Array>();
  for (const [k, v] of Object.entries(files)) map.set(norm(k), v);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const get = (p: string) => {
    const v = map.get(norm(p));
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  };
  return {
    readText: async (p) => {
      const v = get(p);
      return typeof v === "string" ? v : dec.decode(v);
    },
    readBytes: async (p) => {
      const v = get(p);
      return typeof v === "string" ? enc.encode(v) : v;
    },
    exists: async (p) => map.has(norm(p)) || [...map.keys()].some((k) => k.startsWith(`${norm(p)}/`)),
    list: async (dir) => {
      const prefix = norm(dir) ? `${norm(dir)}/` : "";
      const out = new Set<string>();
      for (const k of map.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const i = rest.indexOf("/");
        out.add(i < 0 ? rest : `${rest.slice(0, i)}/`);
      }
      return [...out].sort();
    },
    size: async (p) => {
      const v = map.get(norm(p));
      return v === undefined ? undefined : typeof v === "string" ? enc.encode(v).byteLength : v.byteLength;
    },
  };
}

/** The subset of node:fs/promises the disk adapter needs (passed in by the server or the CLI). */
export interface NodeFsPromises {
  readFile(path: string): Promise<Uint8Array>;
  readdir(path: string, opts: { withFileTypes: true }): Promise<{ name: string; isDirectory(): boolean }[]>;
  stat(path: string): Promise<{ size: number; isFile(): boolean }>;
  realpath(path: string): Promise<string>;
}

/**
 * A disk-backed PackFs over an injected `node:fs/promises` (core never imports node modules).
 * `root` must be an absolute path; every access is checked to stay under it.
 */
export function diskFs(fsp: NodeFsPromises, root: string, sep = "/"): PackFs {
  const base = root.replace(/[\\/]+$/, "");
  const abs = (p: string) => {
    const rel = norm(p);
    if (rel.split("/").some((s) => s === ".." || s === "") && rel !== "") throw new Error(`unsafe path: ${p}`);
    return rel ? `${base}${sep}${rel.split("/").join(sep)}` : base;
  };
  const dec = new TextDecoder();
  return {
    readText: async (p) => dec.decode(await fsp.readFile(abs(p))),
    readBytes: (p) => fsp.readFile(abs(p)),
    exists: async (p) => {
      try {
        await fsp.stat(abs(p));
        return true;
      } catch {
        return false;
      }
    },
    list: async (dir) => {
      try {
        const entries = await fsp.readdir(abs(dir), { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      } catch {
        return [];
      }
    },
    size: async (p) => {
      try {
        const s = await fsp.stat(abs(p));
        return s.isFile() ? s.size : undefined;
      } catch {
        return undefined;
      }
    },
    isInside: async (p) => {
      try {
        const [real, realRoot] = await Promise.all([fsp.realpath(abs(p)), fsp.realpath(base)]);
        return real === realRoot || real.startsWith(`${realRoot}${sep}`);
      } catch {
        return false;
      }
    },
  };
}

/** Every file under `dir` (recursive), pack-relative. */
export async function walkFiles(fs: PackFs, dir = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.list(dir)) {
    const path = dir ? `${dir}/${entry}` : entry;
    if (entry.endsWith("/")) out.push(...(await walkFiles(fs, path.slice(0, -1))));
    else out.push(path);
  }
  return out;
}
