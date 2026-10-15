/**
 * Authoring commands: learncroc lint | new | play | migrate
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  CURRENT_SCHEMA,
  type LintProfile,
  LintProfile as LintProfileSchema,
  type LintReport,
  migratePack,
  PACK_ID_RE,
} from "@learncroc/core";
import { compilePackDir, discoverSourcePacks, REPO_PACKS_DIR, startServer } from "@learncroc/server";
import open from "open";
import pc from "picocolors";
import { parseDocument } from "yaml";
import { parseArgs } from "../lib/args";
import { cliEnv } from "../lib/context";
import { lintDirWithFixes } from "../lib/lint";

/** templates/pack at the repo root (the source of the pack-template repo). */
export const TEMPLATE_DIR = resolve(import.meta.dir, "../../../../templates/pack");

function printReport(dir: string, r: LintReport): void {
  for (const i of r.issues) {
    const sev = i.severity === "error" ? pc.red("error") : pc.yellow("warn ");
    console.log(`${sev} ${pc.bold(i.rule)} ${i.file}${i.path ? pc.dim(` ${i.path}`) : ""}`);
    console.log(`      ${i.message}`);
    if (i.why) console.log(pc.dim(`      why: ${i.why}`));
    if (i.example) console.log(pc.dim(`      fix: ${i.example}`));
  }
  for (const s of r.suppressed) console.log(pc.dim(`suppressed ${s.rule} ${s.file} ${s.path}: ${s.reason}`));
  const summary = `${r.packId} (${r.profile}): ${r.errors} error${r.errors === 1 ? "" : "s"}, ${r.warnings} warning${r.warnings === 1 ? "" : "s"}`;
  console.log(
    r.errors ? pc.red(summary) : r.warnings ? pc.yellow(summary) : pc.green(`${summary} — ${basename(dir)} is clean`),
  );
}

/** learncroc lint <dir> [--fix] [--json] [--profile curated|sampler|community|pocket] */
export async function lint(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["profile"]);
  const all = args.flags.has("all");
  const dir = args._[0] ?? (all ? REPO_PACKS_DIR : undefined);
  if (!dir) {
    console.error("Usage: learncroc lint <pack-dir> [--json] [--fix] [--profile curated|sampler|community|pocket]");
    console.error("       learncroc lint --all [packs-dir]   every pack folder (and packs/_pocket/*) under it");
    return 2;
  }
  const profileRaw = args.values.get("profile");
  let profile: LintProfile | undefined;
  if (profileRaw !== undefined) {
    const p = LintProfileSchema.safeParse(profileRaw);
    if (!p.success) {
      console.error(`--profile must be one of ${LintProfileSchema.options.join(", ")}`);
      return 2;
    }
    profile = p.data;
  }
  const dirs = all ? discoverSourcePacks(resolve(dir)).map((d) => d.dir) : [resolve(dir)];
  if (dirs.length === 0) {
    console.error(`No pack folders under ${dir}`);
    return 2;
  }
  for (const d of dirs) {
    if (!existsSync(join(d, "pack.yaml"))) {
      console.error(`${d} has no pack.yaml`);
      return 2;
    }
  }
  const reports: LintReport[] = [];
  for (const d of dirs) {
    const { report, fixed } = await lintDirWithFixes(d, {
      ...(profile ? { profile } : {}),
      fix: args.flags.has("fix"),
    });
    reports.push(report);
    if (!args.flags.has("json")) {
      for (const f of fixed)
        console.log(`${pc.cyan("fixed")} ${pc.bold(f.rule)} ${f.file} ${pc.dim(f.path)}: ${f.what}`);
      printReport(d, report);
    }
  }
  if (args.flags.has("json")) console.log(JSON.stringify(all ? reports : reports[0], null, 2));
  return reports.some((r) => r.errors > 0) ? 1 : 0;
}

/** learncroc new <id> [--title "…"] [--author "…"] [--dir PATH] — a lint-clean starter pack. */
export async function newPack(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["title", "author", "dir"]);
  const id = args._[0];
  if (!id || !PACK_ID_RE.test(id)) {
    console.error('Usage: learncroc new <pack-id> [--title "My pack"] [--author "Your name"]');
    console.error("The id uses lowercase letters, digits and dashes, e.g. kitchen-chemistry.");
    return 2;
  }
  const target = resolve(args.values.get("dir") ?? id);
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`${target} already exists and isn't empty`);
    return 1;
  }
  if (!existsSync(join(TEMPLATE_DIR, "pack.yaml"))) {
    console.error(`The pack template is missing (${TEMPLATE_DIR})`);
    return 1;
  }
  const title = args.values.get("title") ?? id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  const author = args.values.get("author") ?? process.env.GIT_AUTHOR_NAME ?? process.env.USER ?? "Pack author";
  cpSync(TEMPLATE_DIR, target, { recursive: true });
  const fill = (s: string) =>
    s
      .replaceAll("__PACK_ID__", id)
      .replaceAll("__PACK_TITLE__", title.replace(/"/g, "'"))
      .replaceAll("__AUTHOR__", author.replace(/"/g, "'"));
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ya?ml|md)$/.test(name)) writeFileSync(p, fill(readFileSync(p, "utf8")));
    }
  };
  walk(target);
  console.log(`${pc.green("Created")} ${target}`);
  console.log(
    `\n  cd ${args.values.get("dir") ?? id}\n  learncroc play .     ${pc.dim("open it in the app")}\n  learncroc lint .     ${pc.dim("check it")}\n`,
  );
  return 0;
}

/** learncroc play <dir> [--port N] — serve a source folder live (recompiled on change) and open its map. */
export async function play(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["port", "home"]);
  const dir = args._[0] ?? ".";
  const abs = resolve(dir);
  if (!existsSync(join(abs, "pack.yaml"))) {
    console.error(`${dir} has no pack.yaml`);
    return 2;
  }
  let id: string;
  try {
    id = (await compilePackDir(abs)).manifest.id;
  } catch (e) {
    console.error((e as Error).message);
    console.error(pc.dim("Fix these, then run learncroc play again (the app reloads on every save)."));
    return 1;
  }
  const env = cliEnv(argv);
  const server = await startServer({
    home: env.home,
    port: env.port,
    dev: env.dev,
    playDirs: [{ name: basename(abs), dir: abs, kind: "pack" }],
    log: (m) => console.log(pc.dim(m)),
  });
  const url = `${server.url}/p/${id}`;
  console.log(`Playing ${pc.bold(id)} at ${pc.cyan(url)}  ${pc.dim("(edits reload live; Ctrl+C to stop)")}`);
  if (!args.flags.has("no-open")) await open(url).catch(() => {});
  await new Promise<void>((done) => {
    const stop = () => {
      server.stop();
      done();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

/** learncroc migrate <dir> — upgrade a pack's files to the current format. */
export async function migrate(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const dir = args._[0];
  if (!dir) {
    console.error("Usage: learncroc migrate <pack-dir>");
    return 2;
  }
  const root = resolve(dir);
  const file = join(root, "pack.yaml");
  if (!existsSync(file)) {
    console.error(`${dir} has no pack.yaml`);
    return 2;
  }
  const schema = parseDocument(readFileSync(file, "utf8")).get("schema");
  if (schema === CURRENT_SCHEMA) {
    console.log(`${basename(root)} is already at pack format ${CURRENT_SCHEMA}. Nothing to migrate.`);
    return 0;
  }
  if (typeof schema === "number" && schema > CURRENT_SCHEMA) {
    console.error(
      `pack.yaml has schema ${schema}; this learncroc understands up to ${CURRENT_SCHEMA}. Update learncroc.`,
    );
    return 1;
  }
  // The YAML sources a codemod may touch: pack.yaml, map.yaml, pack.lock.yaml, toy.yaml, nodes/*, bosses/*.
  const files: Record<string, string> = {};
  for (const f of ["pack.yaml", "map.yaml", "pack.lock.yaml", "toy.yaml"])
    if (existsSync(join(root, f))) files[f] = readFileSync(join(root, f), "utf8");
  for (const sub of ["nodes", "bosses"]) {
    const d = join(root, sub);
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d).sort())
      if (/\.ya?ml$/.test(name)) files[`${sub}/${name}`] = readFileSync(join(d, name), "utf8");
  }
  let result: ReturnType<typeof migratePack>;
  try {
    result = migratePack(files);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  for (const [rel, text] of Object.entries(result.files)) writeFileSync(join(root, rel), text);
  for (const rel of result.deleted) rmSync(join(root, rel), { force: true });
  for (const sub of ["bosses"]) {
    const d = join(root, sub);
    if (existsSync(d) && readdirSync(d).length === 0) rmSync(d, { recursive: true, force: true });
  }
  for (const c of result.changes) console.log(pc.dim(`  ${c}`));
  console.log(
    `${basename(root)}: pack format ${result.from} → ${result.to} (${result.applied.join(", ")}); ` +
      `${Object.keys(result.files).length} file(s) changed, ${result.deleted.length} deleted.`,
  );
  return 0;
}
