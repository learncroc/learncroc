/**
 * `learncroc lint`: core's rule set over a source folder, with the widget specs for
 * props/goal/solution checks and the server's SVG safety check. `--fix` applies core's mechanical
 * fixes to the YAML files first (comments and layout preserved), then lints the result.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LintProfile, LintReport } from "@learncroc/core";
import { lintFix, lintPack } from "@learncroc/core/lint/index";
import { packFs } from "@learncroc/server";
import { checkSvg } from "@learncroc/server/security/svg";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";

/** Sanitiser contract for lint: an SVG that fails the safety check comes back changed (empty). */
export const sanitizeSvg = (svg: string): string => (checkSvg(svg).ok ? svg : "");

export interface LintRun {
  report: LintReport;
  fixed: { rule: string; file: string; path: string; what: string }[];
}

export async function lintDir(dir: string, opts: { profile?: LintProfile; fix?: boolean } = {}): Promise<LintReport> {
  return (await lintDirWithFixes(dir, opts)).report;
}

export async function lintDirWithFixes(
  dir: string,
  opts: { profile?: LintProfile; fix?: boolean } = {},
): Promise<LintRun> {
  const fs = packFs(dir);
  let fixed: LintRun["fixed"] = [];
  if (opts.fix) {
    const r = await lintFix(fs, opts.profile ? { profile: opts.profile } : {});
    for (const [rel, text] of Object.entries(r.files)) writeFileSync(join(dir, rel), text);
    fixed = r.fixed;
  }
  const { report } = await lintPack(fs, {
    widgets: widgetSpecRegistry,
    sanitizeSvg,
    ...(opts.profile ? { profile: opts.profile } : {}),
  });
  return { report, fixed };
}
