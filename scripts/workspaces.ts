#!/usr/bin/env bun
/**
 * bun scripts/workspaces.ts <script> [--serial]
 *
 * Runs a package.json script (typecheck, test) in every workspace that defines it, plus the root
 * project (scripts/ and e2e/), in parallel, and prints each one's output as it finishes.
 * Exit code 1 if any fails. `bun run typecheck` and `bun run test` use this.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const script = process.argv[2];
const serial = process.argv.includes("--serial");
if (!script) {
  console.error("usage: bun scripts/workspaces.ts <script> [--serial]");
  process.exit(2);
}

interface Job {
  name: string;
  cwd: string;
  cmd: string[];
}

const jobs: Job[] = [];
for (const group of ["packages", "apps"]) {
  for (const dir of readdirSync(join(root, group)).sort()) {
    const pkgPath = join(root, group, dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name: string; scripts?: Record<string, string> };
    if (pkg.scripts?.[script]) jobs.push({ name: pkg.name, cwd: join(root, group, dir), cmd: ["bun", "run", script] });
  }
}
// Root project: tooling scripts and e2e specs.
if (script === "typecheck")
  jobs.push({ name: "root (scripts, e2e)", cwd: root, cmd: ["bun", "x", "tsc", "--noEmit", "-p", "."] });
if (script === "test") jobs.push({ name: "root (scripts)", cwd: root, cmd: ["bun", "test"] });

const started = Date.now();
async function run(job: Job): Promise<boolean> {
  const t = Date.now();
  const proc = Bun.spawn(job.cmd, {
    cwd: job.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const ok = code === 0;
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  console.log(`${ok ? "✓" : "✗"} ${job.name} ${script} (${secs}s) [${relative(root, job.cwd) || "."}]`);
  if (!ok || process.env.VERBOSE) {
    const text = `${out}${err}`.trim();
    if (text) console.log(text.replace(/^/gm, "    "));
  }
  return ok;
}

const results: boolean[] = [];
if (serial) for (const j of jobs) results.push(await run(j));
else results.push(...(await Promise.all(jobs.map(run))));
const failed = results.filter((r) => !r).length;
console.log(
  `${failed ? `${failed} of ${jobs.length} failed` : `all ${jobs.length} passed`} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
process.exit(failed ? 1 : 0);
