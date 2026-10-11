/**
 * `learncroc lint`: the same code runs in the CLI, CI, the GitHub Action and the server. Loads and
 * compiles the pack, runs every rule for the pack's profile, applies inline suppressions and returns
 * a LintReport.
 */

import type { PackFs } from "../compile/fs";
import { compileSources } from "../compile/index";
import { lineOf, loadPackSources, type PackSources, parsePointer } from "../compile/load";
import type { WidgetSpecRegistry } from "../ports";
import type { CompiledPack, LintIssue, LintProfile, LintReport, NodeId } from "../schema/index";
import { emit, type LintContext } from "./context";
import { lintNode } from "./node-rules";
import {
  lintAssets,
  lintBannedWords,
  lintGeneratedHtml,
  lintGraph,
  lintLanguage,
  lintManifest,
  lintReviews,
  lintTheme,
} from "./pack-rules";
import { PROFILES, RULE_IDS, RULES, type RuleId, type RuleInfo } from "./rules";
import { covers, findSuppressions, type Suppression } from "./suppress";

export interface LintOptions {
  /** Override the manifest's profile (CLI --profile). */
  profile?: LintProfile;
  /** Widget specs: without them widget props, goals and solutions are not checked. */
  widgets?: WidgetSpecRegistry;
  /** SVG sanitiser (DOMPurify on the server/CLI); when given, SVGs it would change are rejected. */
  sanitizeSvg?: (svg: string) => string;
  /** Pocket cards still being generated. */
  building?: readonly NodeId[];
}

export interface LintResult {
  report: LintReport;
  /** The compiled pack, when the sources compiled. */
  pack?: CompiledPack;
  sources: PackSources;
}

/** Lint a pack directory. */
export async function lintPack(fs: PackFs, opts: LintOptions = {}): Promise<LintResult> {
  const sources = await loadPackSources(fs, { building: opts.building ?? [] });
  return lintSources(sources, fs, opts);
}

/** Lint already-loaded sources. */
export async function lintSources(sources: PackSources, fs: PackFs, opts: LintOptions = {}): Promise<LintResult> {
  const profile: LintProfile = opts.profile ?? sources.manifest?.value?.profile ?? "community";
  const rawId = (sources.manifest?.raw as { id?: unknown } | undefined)?.id;
  const packId = sources.manifest?.value?.id ?? (typeof rawId === "string" ? rawId : "unknown");
  const issues: LintIssue[] = [];
  const base = {
    sources,
    profile,
    rules: PROFILES[profile],
    fs,
    issues,
    ...(opts.widgets ? { widgets: opts.widgets } : {}),
    ...(opts.sanitizeSvg ? { sanitizeSvg: opts.sanitizeSvg } : {}),
  };

  // L000: load problems.
  const l000 = { issues };
  for (const i of sources.issues)
    emit(l000, loadRule(i.message), i.severity, i.file, i.path, i.line ? `${i.message} (line ${i.line})` : i.message);

  const manifest = sources.manifest?.value;
  const map = sources.map?.value;
  let pack: CompiledPack | undefined;
  if (manifest && map) {
    const compiled = await compileSources(sources, fs, { building: opts.building ?? [] });
    pack = compiled.pack;
    for (const i of compiled.issues.slice(sources.issues.length))
      emit(l000, loadRule(i.message), i.severity, i.file, i.path, i.message);
    const ctx: LintContext = { ...base, manifest, map, lang: manifest.lang, ...(pack ? { pack } : {}) };
    lintGraph(ctx);
    lintManifest(ctx);
    for (const [id, f] of Object.entries(sources.nodes)) if (f.value) lintNode(ctx, id, f.value);
    lintBannedWords(ctx);
    await lintAssets(ctx);
    lintGeneratedHtml(ctx);
    lintTheme(ctx);
    lintReviews(ctx);
    lintLanguage(ctx, pack);
  }
  return { report: applySuppressions(sources, profile, packId, dedupe(issues)), ...(pack ? { pack } : {}), sources };
}

/** Load problems are L000, except `$data` references, which L013 owns ("`$data` refs resolve inside data/"). */
function loadRule(message: string): "L000" | "L013" {
  return message.startsWith("$data") ? "L013" : "L000";
}

function dedupe(issues: LintIssue[]): LintIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.rule}|${i.file}|${i.path}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function applySuppressions(
  sources: PackSources,
  profile: LintProfile,
  packId: string,
  issues: LintIssue[],
): LintReport {
  const all: Suppression[] = [];
  const meta: LintIssue[] = [];
  const files = [sources.manifest, sources.map, sources.lock, ...Object.values(sources.nodes)];
  const l000 = (file: string, message: string, severity: "error" | "warn" = "error"): LintIssue => ({
    rule: "L000",
    severity,
    file,
    path: "",
    message,
    why: RULES.L000.why,
    example: "# lint-ignore L001: quoted source",
    fixable: false,
  });
  for (const f of files) {
    if (!f) continue;
    const { suppressions, problems } = findSuppressions(f.path, f.text, f.doc, f.lines);
    for (const p of problems) meta.push(l000(p.file, `${p.message} (line ${p.line})`));
    for (const s of suppressions) {
      if (!(RULE_IDS as string[]).includes(s.rule))
        meta.push(l000(s.file, `lint-ignore names unknown rule "${s.rule}" (line ${s.line})`, "warn"));
      else if ((RULES[s.rule as RuleId] as RuleInfo).retired)
        meta.push(l000(s.file, `lint-ignore names retired rule "${s.rule}" (line ${s.line})`, "warn"));
      else all.push(s);
    }
  }
  const budget = PROFILES[profile].suppressionBudget;
  if (all.length > budget)
    meta.push(l000("pack.yaml", `${all.length} lint suppressions (the ${profile} profile allows ${budget})`));
  const used = new Set<Suppression>();
  const kept: LintIssue[] = [];
  for (const issue of issues) {
    const s = issue.rule === "L000" ? undefined : all.find((x) => covers(x, issue));
    if (s) used.add(s);
    else kept.push(issue);
  }
  const final = [...kept, ...meta];
  return {
    packId: /^[a-z0-9][a-z0-9-]{1,63}$/.test(packId) ? packId : "unknown",
    profile,
    errors: final.filter((i) => i.severity === "error").length,
    warnings: final.filter((i) => i.severity === "warn").length,
    suppressed: all.map((s) => ({ rule: s.rule, file: s.file, path: s.path, reason: s.reason })),
    issues: final,
  };
}

/** The 1-based source line of an issue, when it can be located. */
export function issueLine(sources: PackSources, issue: Pick<LintIssue, "file" | "path">): number | undefined {
  const files = [sources.manifest, sources.map, sources.lock, ...Object.values(sources.nodes)];
  const f = files.find((x) => x?.path === issue.file);
  return f ? lineOf(f, parsePointer(issue.path)) : undefined;
}

/** Human-readable report lines ("file:line  L001 error  message"), for the CLI. */
export function formatReport(report: LintReport, sources?: PackSources): string[] {
  return report.issues.map((i) => {
    const line = sources ? issueLine(sources, i) : undefined;
    const where = `${i.file}${line ? `:${line}` : ""}${i.path ? ` ${i.path}` : ""}`;
    return `${where}  ${i.rule} ${i.severity}  ${i.message}\n    why: ${i.why}${i.example ? `\n    e.g. ${i.example}` : ""}`;
  });
}

export {
  CARD_CAPS,
  cardShapeIssues,
  checkpointEligible,
  gateShapeIssues,
  INTRO_NODE_ID,
  isManipulation,
  quotesItsBeat,
  readsLikeRecall,
  type ShapeIssue,
} from "./card-shape";
export * from "./color";
export { type FixResult, lintFix } from "./fix";
export { htmlProblems } from "./pack-rules";
export { PROFILES, type ProfileRules, RULE_IDS, RULES, type RuleId, type RuleInfo } from "./rules";
export { findSuppressions, type Suppression } from "./suppress";
