/**
 * learncroc install | list | uninstall | build-pack | registry build
 */
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { type InstallEvent, type InstalledPackSummary, PACK_ID_RE, parseSseStream } from "@learncroc/core";
import {
  buildPackArchive,
  buildRegistry,
  discoverSourcePacks,
  InstallError,
  installLocalFile,
  PackStore,
  REPO_PACKS_DIR,
  REPO_REGISTRY_DIR,
  RegistryClient,
  SettingsStore,
} from "@learncroc/server";
import pc from "picocolors";
import { parseArgs } from "../lib/args";
import { cliEnv, runningServer, withLock } from "../lib/context";

function printInstallEvent(e: InstallEvent): void {
  if (e.type === "resolving") console.log(pc.dim(`resolving ${e.id}…`));
  else if (e.type === "downloading" && e.total > 0)
    process.stdout.write(pc.dim(`\rdownloading ${Math.round((100 * e.received) / e.total)}%   `));
  else if (e.type === "verifying") console.log(pc.dim("\nverifying…"));
  else if (e.type === "extracting") console.log(pc.dim("installing…"));
}

/** learncroc install <id | ./file.lmpack> [--registry URL] [--version X.Y.Z] */
export async function install(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["registry", "version", "port", "home"]);
  const env = cliEnv(argv);
  const target = args._[0];
  if (!target) {
    console.error("Usage: learncroc install <pack-id | ./pack.lmpack> [--registry URL] [--version X.Y.Z]");
    return 2;
  }
  const isFile = target.endsWith(".lmpack") || target.includes("/") || target.includes("\\");
  if (isFile) {
    const file = resolve(target);
    if (!existsSync(file) || !statSync(file).isFile()) {
      console.error(`No such file: ${target}`);
      return 1;
    }
    // Local archives are installed in-process, never through the HTTP API.
    try {
      const pack = await withLock(env.home, async () => installLocalFile(new PackStore({ home: env.home }), file));
      console.log(`${pc.green("Installed")} ${pack.manifest.title} (${pack.manifest.id}@${pack.manifest.version})`);
      return 0;
    } catch (e) {
      console.error(`Could not install ${target}: ${(e as Error).message}`);
      return 1;
    }
  }
  if (!PACK_ID_RE.test(target)) {
    console.error(`"${target}" is not a pack id or a .lmpack file`);
    return 2;
  }
  const registry = args.values.get("registry") ?? "builtin";
  const version = args.values.get("version");
  const server = await runningServer(env.home);
  if (server) {
    const res = await server.request("POST /packs/install", {
      body: { id: target, registry, ...(version ? { version } : {}) },
    });
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      console.error(`Could not install ${target}: ${body.message ?? res.statusText}`);
      return 1;
    }
    for await (const e of parseSseStream<InstallEvent>(res.body)) {
      printInstallEvent(e);
      if (e.type === "done") console.log(`${pc.green("Installed")} ${e.id}@${e.version}`);
      if (e.type === "error") {
        console.error(`Could not install ${target}: ${e.message}`);
        return 1;
      }
    }
    return 0;
  }
  try {
    return await withLock(env.home, async () => {
      const store = new PackStore({ home: env.home });
      const settings = new SettingsStore({ home: env.home });
      if (registry !== "builtin" && !settings.get().registries.includes(registry)) {
        console.error(`Registry ${registry} is not in your settings; add it in Settings → Data first.`);
        return 1;
      }
      const client = new RegistryClient({ store, dev: env.dev });
      const pack = await client.install({ id: target, registry, ...(version ? { version } : {}) }, printInstallEvent);
      console.log(`${pc.green("Installed")} ${pack.manifest.title} (${pack.manifest.id}@${pack.manifest.version})`);
      return 0;
    });
  } catch (e) {
    const code = e instanceof InstallError ? ` [${e.code}]` : "";
    console.error(`Could not install ${target}${code}: ${(e as Error).message}`);
    return 1;
  }
}

function printPacks(list: InstalledPackSummary[]): void {
  if (list.length === 0) {
    console.log("No packs installed. Run learncroc to seed the bundled packs, or learncroc install <id>.");
    return;
  }
  const w = Math.max(...list.map((p) => p.id.length));
  for (const p of list) {
    const status = p.status === "ok" ? "" : pc.yellow(` [${p.status}]`);
    const lit = p.playable ? pc.dim(` ${p.lit}/${p.playable} lit`) : "";
    console.log(`${p.id.padEnd(w)}  ${pc.dim(p.version.padEnd(8))} ${p.title}${lit}${status}`);
  }
}

/** learncroc list [--json] */
export async function list(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["port", "home"]);
  const env = cliEnv(argv);
  const server = await runningServer(env.home);
  const packs = server
    ? await server.json<InstalledPackSummary[]>("GET /packs")
    : await new PackStore({ home: env.home }).list();
  if (args.flags.has("json")) console.log(JSON.stringify(packs, null, 2));
  else printPacks(packs);
  return 0;
}

/** learncroc uninstall <id> [--version X.Y.Z] — progress is kept. */
export async function uninstall(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["version", "port", "home"]);
  const env = cliEnv(argv);
  const id = args._[0];
  if (!id || !PACK_ID_RE.test(id)) {
    console.error("Usage: learncroc uninstall <pack-id> [--version X.Y.Z]");
    return 2;
  }
  const version = args.values.get("version");
  const server = await runningServer(env.home);
  if (server) {
    const res = await server.request("DELETE /packs/:id", {
      path: `/packs/${id}${version ? `?version=${version}` : ""}`,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      console.error(body.message ?? `Could not remove ${id}`);
      return 1;
    }
  } else {
    const removed = await withLock(env.home, async () => new PackStore({ home: env.home }).uninstall(id, version));
    if (!removed) {
      console.error(`${id} is not installed`);
      return 1;
    }
  }
  console.log(`Removed ${id}${version ? `@${version}` : ""}. Your progress is kept.`);
  return 0;
}

/** learncroc build-pack <dir> [--out dist] */
export async function buildPack(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["out"]);
  const dir = args._[0];
  if (!dir) {
    console.error("Usage: learncroc build-pack <pack-dir> [--out dist]");
    return 2;
  }
  try {
    const r = await buildPackArchive(resolve(dir), resolve(args.values.get("out") ?? "dist"));
    console.log(`${pc.green("Built")} ${r.file} (${(r.size / 1024).toFixed(1)} KB, sha256 ${r.sha256.slice(0, 12)}…)`);
    return 0;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

/** learncroc registry build [--packs DIR] [--out DIR] [--name NAME] [--include-private] */
export async function registry(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["packs", "out", "name"]);
  if (args._[0] !== "build") {
    console.error("Usage: learncroc registry build [--packs packs] [--out registry] [--name NAME]");
    return 2;
  }
  const packsDir = resolve(args.values.get("packs") ?? REPO_PACKS_DIR);
  const outDir = resolve(args.values.get("out") ?? REPO_REGISTRY_DIR);
  const dirs = discoverSourcePacks(packsDir).filter((d) => d.kind === "pack" || args.flags.has("include-private"));
  if (dirs.length === 0) {
    console.error(`No pack folders found in ${packsDir}`);
    return 1;
  }
  const report = await buildRegistry({
    dirs,
    outDir,
    ...(args.values.get("name") ? { name: args.values.get("name") as string } : {}),
    includePrivate: args.flags.has("include-private"),
  });
  for (const b of report.built)
    console.log(`${pc.green("✓")} ${b.id}@${b.version}  ${pc.dim(`${(b.size / 1024).toFixed(1)} KB`)}`);
  for (const e of report.errors)
    console.error(`${pc.yellow("skipped")} ${e.dir}\n  ${e.message.split("\n").join("\n  ")}`);
  console.log(`Wrote ${resolve(outDir, "index.json")} (${report.index.packs.length} packs)`);
  return report.errors.length && report.built.length === 0 ? 1 : 0;
}
