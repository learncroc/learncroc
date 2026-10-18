#!/usr/bin/env bun
/**
 * bun scripts/audio/render.ts <pack-dir…> | --all  [--plan] [--prune] [--force] [--json]
 *
 * Pre-renders every target-language phrase of a pack with Piper and writes Ogg Opus files to
 * packs/<id>/assets/audio/, plus data/audio-manifest.json for the compiler. Maintainer machines only.
 *
 *   --plan    list phrases, file names and the size budget; render nothing (no tools needed)
 *   --prune   also delete rendered files no phrase uses any more
 *   --force   re-render files that already exist
 *   --json    machine-readable report
 *
 * Environment: PIPER_BIN (default "piper"), PIPER_VOICES (directory with <model>.onnx and
 * <model>.onnx.json; default ~/.local/share/piper-voices), FFMPEG_BIN (default "ffmpeg").
 *
 * Exit codes: 0 ok, 1 budget exceeded or a render failed, 2 bad usage or missing tools.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { type AudioPlan, kb, planPack, prunePack, renderPack, writeManifest } from "./pipeline";
import { ffmpegOpusEncoder, hasBinary, modelPaths, piperSynth, voicesDir } from "./tools";
import type { VoiceConfig } from "./voices";

const repoRoot = resolve(import.meta.dir, "..", "..");

function packDirs(args: string[]): string[] {
  const dirs = args.filter((a) => !a.startsWith("--")).map((a) => resolve(a));
  if (args.includes("--all")) {
    const packs = join(repoRoot, "packs");
    for (const name of existsSync(packs) ? readdirSync(packs).sort() : []) {
      const d = join(packs, name);
      if (statSync(d).isDirectory() && existsSync(join(d, "pack.yaml"))) dirs.push(d);
    }
  }
  return [...new Set(dirs)];
}

/** Missing tools or voice models, as human instructions. */
function missingTools(plans: AudioPlan[], piperBin: string, ffmpegBin: string, dir: string): string[] {
  const out: string[] = [];
  if (!hasBinary(piperBin)) {
    out.push(`Piper not found ("${piperBin}"). Install it (https://github.com/OHF-Voice/piper1-gpl or the`);
    out.push("  rhasspy/piper release binaries) and put it on PATH, or set PIPER_BIN.");
  }
  if (!hasBinary(ffmpegBin))
    out.push(`ffmpeg not found ("${ffmpegBin}"). Install ffmpeg with libopus, or set FFMPEG_BIN.`);
  const voices = new Map<string, VoiceConfig>();
  for (const plan of plans) for (const p of plan.phrases) if (!p.exists) voices.set(p.voice.model, p.voice);
  for (const voice of voices.values()) {
    const paths = modelPaths(voice, dir);
    if (!existsSync(paths.onnx) || !existsSync(paths.config)) {
      out.push(`Voice model ${voice.model} not found in ${dir}. Download both files there (or set PIPER_VOICES):`);
      out.push(`  ${voice.source.onnx}`);
      out.push(`  ${voice.source.config}`);
    }
  }
  return out;
}

function printPlan(plan: AudioPlan, verbose: boolean): void {
  const rel = relative(process.cwd(), plan.packDir) || ".";
  const todo = plan.phrases.filter((p) => !p.exists).length;
  console.log(
    `${rel}: ${plan.phrases.length} phrase(s), ${plan.phrases.length - todo} rendered, ${todo} to render, ` +
      `${kb(plan.totalBytes)}${todo ? " (estimated)" : ""} of 10 MB`,
  );
  if (plan.unvoiced.length) {
    const langs = [...new Set(plan.unvoiced.map((p) => p.lang))].join(", ");
    console.log(`  ${plan.unvoiced.length} phrase(s) in ${langs} have no voice configured; they use speechSynthesis`);
  }
  if (verbose) for (const p of plan.phrases) console.log(`  ${p.exists ? "ok  " : "todo"} ${p.src}  ${p.text}`);
  for (const problem of plan.problems) console.log(`  error ${problem}`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dirs = packDirs(args);
  const json = args.includes("--json");
  if (dirs.length === 0) {
    console.error("usage: bun scripts/audio/render.ts <pack-dir…> | --all  [--plan] [--prune] [--force] [--json]");
    return 2;
  }
  for (const d of dirs) {
    if (!existsSync(join(d, "pack.yaml"))) {
      console.error(`${d}: no pack.yaml (is this a pack directory?)`);
      return 2;
    }
  }

  const plans = dirs.map(planPack).filter((p) => p.phrases.length > 0 || p.unvoiced.length > 0);
  if (args.includes("--plan")) {
    if (json) console.log(JSON.stringify(plans, null, 2));
    else for (const plan of plans) printPlan(plan, args.includes("--verbose") || plans.length === 1);
    return plans.some((p) => p.problems.length) ? 1 : 0;
  }

  const piperBin = process.env.PIPER_BIN ?? "piper";
  const ffmpegBin = process.env.FFMPEG_BIN ?? "ffmpeg";
  const dir = voicesDir();
  const needsRender = plans.some((p) => p.phrases.some((ph) => !ph.exists || args.includes("--force")));
  if (needsRender) {
    const missing = missingTools(plans, piperBin, ffmpegBin, dir);
    if (missing.length) {
      for (const line of missing) console.error(line);
      console.error("Nothing rendered. The packs still play through speechSynthesis until the audio exists.");
      return 2;
    }
  }

  const synth = piperSynth({ bin: piperBin, voicesDir: dir });
  const encoder = ffmpegOpusEncoder(ffmpegBin);
  let failed = false;
  const report: unknown[] = [];
  for (const plan of plans) {
    const rel = relative(process.cwd(), plan.packDir) || ".";
    try {
      const result = await renderPack(plan.packDir, {
        synth,
        encoder,
        force: args.includes("--force"),
        log: json ? undefined : console.log,
      });
      const pruned = args.includes("--prune") ? prunePack(result.plan) : [];
      const manifest = writeManifest(result.plan);
      if (result.plan.problems.length) failed = true;
      report.push({ pack: rel, rendered: result.rendered.length, pruned, manifest, problems: result.plan.problems });
      if (!json) {
        printPlan(result.plan, false);
        if (pruned.length) console.log(`  pruned ${pruned.length} unused file(s)`);
        console.log(manifest ? `  wrote ${relative(process.cwd(), manifest)}` : "  no audio rendered; no manifest");
      }
    } catch (e) {
      failed = true;
      console.error(`${rel}: ${(e as Error).message}`);
    }
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(await main());
