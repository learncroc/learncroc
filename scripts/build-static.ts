#!/usr/bin/env bun
/**
 * bun run build:static [--base /learncroc/] [--out dist/static] [--packs packs] [--skip-vite]
 *
 * The keyless static demo: the whole card loop (card → checkpoint →
 * gate, Moss answering offline) in a browser with no server.
 *
 * 1. Builds apps/web with VITE_LM_STATIC=1, so every route is answered in the page by api/local
 *    (core services over IndexedDB).
 * 2. Compiles every bundled pack that compiles at pack format 2 (packs/<id>/ and the packs/_pocket/
 *    article-map gallery) into <out>/static-packs/<id>.json with its image and audio assets, plus
 *    static-packs/index.json. Packs that don't compile are skipped and listed.
 * 3. Bundles apps/web/src/sw.ts into <out>/sw.js with the list of every file in the build, so the
 *    worker precaches the lazily-loaded widget view chunks and the packs (offline after first load).
 * 4. Adds 404.html (a copy of the shell) for GitHub Pages deep links, and .nojekyll.
 */
import { promises as fsp } from "node:fs";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { type CompiledPack, compilePack, diskFs, SERVABLE_ASSET_RE } from "@learncroc/core";

const REPO = resolve(import.meta.dir, "..");
const WEB_DIR = join(REPO, "apps", "web");

export interface BuildStaticOptions {
  /** URL base the site is served under ("/" or "/learncroc/"); must start and end with "/". */
  base: string;
  out: string;
  packsDir: string;
  /** Skip the Vite build (packs and the worker only). */
  skipVite?: boolean;
  log?: (msg: string) => void;
}

export interface BuildStaticReport {
  packs: string[];
  skipped: { dir: string; message: string }[];
  files: number;
}

const exists = async (p: string) => !!(await stat(p).catch(() => null));

async function packDirs(packsDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(packsDir).catch(() => [] as string[])).sort()) {
    const dir = join(packsDir, name);
    if (!(await stat(dir)).isDirectory()) continue;
    if (name === "_pocket") {
      for (const sub of (await readdir(dir)).sort())
        if (await exists(join(dir, sub, "pack.yaml"))) out.push(join(dir, sub));
      continue;
    }
    if (!name.startsWith(".") && !name.startsWith("_") && (await exists(join(dir, "pack.yaml")))) out.push(dir);
  }
  return out;
}

async function copyAssets(src: string, dest: string): Promise<number> {
  let n = 0;
  const walk = async (dir: string) => {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      const st = await stat(p);
      if (st.isDirectory()) await walk(p);
      else {
        const rel = relative(src, p).split(sep).join("/");
        if (!SERVABLE_ASSET_RE.test(rel)) continue;
        await mkdir(join(dest, rel, ".."), { recursive: true });
        await cp(p, join(dest, rel));
        n++;
      }
    }
  };
  await walk(join(src, "assets"));
  return n;
}

/** Compile and write the bundled packs into <out>/static-packs/. */
export async function writeStaticPacks(
  packsDir: string,
  outDir: string,
  log: (m: string) => void = () => {},
): Promise<Pick<BuildStaticReport, "packs" | "skipped">> {
  const target = join(outDir, "static-packs");
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const packs: string[] = [];
  const skipped: BuildStaticReport["skipped"] = [];
  for (const dir of await packDirs(packsDir)) {
    let message: string | undefined;
    let pack: CompiledPack | undefined;
    try {
      const r = await compilePack(diskFs(fsp, dir, sep), { at: "2026-01-01T00:00:00Z" });
      const errors = r.issues.filter((i) => i.severity === "error");
      if (!r.pack || errors.length) message = `${errors[0]?.file ?? ""}: ${errors[0]?.message ?? "does not compile"}`;
      else if (r.pack.format !== 2) message = `pack format ${String(r.pack.format)}`;
      else pack = r.pack;
    } catch (e) {
      message = (e as Error).message.split("\n")[0];
    }
    if (!pack) {
      skipped.push({ dir: relative(REPO, dir), message: message ?? "does not compile" });
      continue;
    }
    const id = pack.manifest.id;
    if (packs.includes(id)) continue;
    await writeFile(join(target, `${id}.json`), JSON.stringify(pack));
    const assets = await copyAssets(dir, join(target, id));
    packs.push(id);
    log(`bundled ${id}@${pack.manifest.version} (${assets} assets)`);
  }
  await writeFile(join(target, "index.json"), JSON.stringify({ packs }, null, 2));
  return { packs, skipped };
}

/** Every file under `dir`, relative, with "/" separators. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const name of await readdir(d)) {
      const p = join(d, name);
      if ((await stat(p)).isDirectory()) await walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  await walk(dir);
  return out.sort();
}

/** Bundle the service worker with the precache list of the finished build. */
export async function writeServiceWorker(out: string, base: string): Promise<number> {
  const files = (await listFiles(out)).filter(
    (f) => f !== "sw.js" && f !== "404.html" && f !== ".nojekyll" && !f.endsWith(".map"),
  );
  const build = Bun.hash(files.join("\n") + String(Date.now()))
    .toString(36)
    .slice(0, 10);
  const result = await Bun.build({
    entrypoints: [join(WEB_DIR, "src", "sw.ts")],
    target: "browser",
    format: "iife",
    minify: true,
    define: {
      __LM_STATIC__: "true",
      __LM_BASE__: JSON.stringify(base),
      __LM_BUILD__: JSON.stringify(build),
      __LM_PRECACHE__: JSON.stringify(files),
    },
  });
  if (!result.success) throw new Error(`service worker build failed: ${result.logs.map(String).join("\n")}`);
  const [artifact] = result.outputs;
  if (!artifact) throw new Error("service worker build produced nothing");
  await writeFile(join(out, "sw.js"), await artifact.text());
  return files.length;
}

export async function buildStatic(opts: BuildStaticOptions): Promise<BuildStaticReport> {
  const log = opts.log ?? (() => {});
  if (!/^\/(.*\/)?$/.test(opts.base)) throw new Error(`--base must start and end with "/" (got ${opts.base})`);
  if (!opts.skipVite) {
    const proc = Bun.spawn(["bunx", "vite", "build", "--base", opts.base, "--outDir", opts.out, "--emptyOutDir"], {
      cwd: WEB_DIR,
      env: { ...process.env, VITE_LM_STATIC: "1" },
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await proc.exited) !== 0) throw new Error("vite build failed");
  } else await mkdir(opts.out, { recursive: true });
  const { packs, skipped } = await writeStaticPacks(opts.packsDir, opts.out, log);
  if (await exists(join(opts.out, "index.html"))) await cp(join(opts.out, "index.html"), join(opts.out, "404.html"));
  await writeFile(join(opts.out, ".nojekyll"), "");
  const files = await writeServiceWorker(opts.out, opts.base);
  return { packs, skipped, files };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (k: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const base = value("base") ?? process.env.LM_STATIC_BASE ?? "/";
  const out = resolve(value("out") ?? join(REPO, "dist", "static"));
  try {
    const report = await buildStatic({
      base,
      out,
      packsDir: resolve(value("packs") ?? join(REPO, "packs")),
      skipVite: args.includes("--skip-vite"),
      log: console.log,
    });
    for (const s of report.skipped) console.log(`skipped ${s.dir}: ${s.message}`);
    console.log(
      `Learncroc static demo: ${out}\n  ${report.packs.length} maps, ${report.files} files precached, base ${base}\n  preview: bunx vite preview --outDir ${out} (from apps/web), or any static file server`,
    );
    if (report.packs.length === 0) process.exit(1);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
