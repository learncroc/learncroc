/**
 * The learncroc lint GitHub Action: runs `learncroc lint --json` on one pack (or every pack folder
 * under a directory), prints GitHub annotations for each issue and fails on errors.
 */
import { appendFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

interface LintIssue {
  rule: string;
  severity: "error" | "warn";
  file: string;
  path: string;
  message: string;
  why?: string;
  example?: string;
}
interface LintReport {
  packId: string;
  profile: string;
  errors: number;
  warnings: number;
  issues: LintIssue[];
}

const root = resolve(process.env.LM_PATH || ".");
const all = process.env.LM_ALL === "true";
const profile = process.env.LM_PROFILE?.trim();
const version = process.env.LM_VERSION?.trim() || "latest";

const dirs = all
  ? readdirSync(root)
      .map((n) => join(root, n))
      .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "pack.yaml")))
  : [root];
if (dirs.length === 0) {
  console.log(`::warning::no pack folders found under ${root}`);
  process.exit(0);
}

const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
let errors = 0;
let warnings = 0;
for (const dir of dirs) {
  const args = ["x", `learncroc@${version}`, "lint", dir, "--json", ...(profile ? ["--profile", profile] : [])];
  const proc = Bun.spawnSync(["bun", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = proc.stdout.toString();
  let report: LintReport;
  try {
    report = JSON.parse(out) as LintReport;
  } catch {
    console.log(`::error title=learncroc lint::could not lint ${dir}: ${esc(proc.stderr.toString() || out)}`);
    errors++;
    continue;
  }
  errors += report.errors;
  warnings += report.warnings;
  console.log(`${report.packId} (${report.profile}): ${report.errors} errors, ${report.warnings} warnings`);
  for (const i of report.issues) {
    const level = i.severity === "error" ? "error" : "warning";
    const file = join(dir, i.file).replace(`${process.cwd()}/`, "");
    const detail = [i.message, i.why ? `Why: ${i.why}` : "", i.example ? `Fix: ${i.example}` : ""]
      .filter(Boolean)
      .join("\n");
    console.log(`::${level} file=${file},title=${i.rule}${i.path ? ` ${i.path}` : ""}::${esc(detail)}`);
  }
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `errors=${errors}\nwarnings=${warnings}\n`);
process.exit(errors > 0 ? 1 : 0);
