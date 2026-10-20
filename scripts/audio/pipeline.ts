/**
 * Plan, render and index a pack's audio.
 *
 *   plan    phrases → file names, which already exist, estimated sizes, budget check
 *   render  synthesise + encode the missing files (atomic writes), then verify the real sizes
 *   index   write data/audio-manifest.json: every rendered phrase → its asset path
 *   prune   delete .ogg files under assets/audio/ that no phrase uses any more
 *
 * The compiler reads the manifest to fill `src` on audio blocks and listen widgets and `audio` on
 * dialogue lines. Phrases without a rendered file keep their `tts` and play through speechSynthesis.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioAssetPath, phraseKey } from "./hash";
import { extractPhrases, loadPackFiles, type Phrase } from "./phrases";
import type { Encoder, Synth } from "./tools";
import { type VoiceConfig, voiceFor } from "./voices";

/** ≤ 2 MB per asset, ≤ 10 MB of audio per pack. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_PACK_AUDIO_BYTES = 10 * 1024 * 1024;
export const MANIFEST_PATH = "data/audio-manifest.json";
export const GENERATOR = "scripts/audio@1";

export interface PlannedPhrase extends Phrase {
  voice: VoiceConfig;
  /** Pack-relative asset path. */
  src: string;
  exists: boolean;
  /** Real size when the file exists, otherwise an estimate. */
  bytes: number;
  estimated: boolean;
}

export interface AudioPlan {
  packDir: string;
  phrases: PlannedPhrase[];
  /** Phrases in a language with no configured voice (they stay on speechSynthesis). */
  unvoiced: Phrase[];
  totalBytes: number;
  problems: string[];
}

/** Rough Ogg Opus size for a phrase: ~13 characters of speech a second at 4 KB/s, plus padding and headers. */
export function estimateBytes(text: string): number {
  const seconds = text.length / 13 + 0.6;
  return Math.round(seconds * 4000 + 1200);
}

export function planPack(packDir: string): AudioPlan {
  const phrases = extractPhrases(loadPackFiles(packDir));
  const planned: PlannedPhrase[] = [];
  const unvoiced: Phrase[] = [];
  for (const p of phrases) {
    const voice = voiceFor(p.lang);
    if (!voice) {
      unvoiced.push(p);
      continue;
    }
    const src = audioAssetPath(p.text, p.lang, voice.id);
    const file = join(packDir, src);
    const exists = existsSync(file);
    planned.push({
      ...p,
      voice,
      src,
      exists,
      bytes: exists ? statSync(file).size : estimateBytes(p.text),
      estimated: !exists,
    });
  }
  return { packDir, phrases: planned, unvoiced, totalBytes: sum(planned), problems: budgetProblems(planned) };
}

function sum(phrases: readonly PlannedPhrase[]): number {
  return phrases.reduce((n, p) => n + p.bytes, 0);
}

function budgetProblems(phrases: readonly PlannedPhrase[]): string[] {
  const problems: string[] = [];
  for (const p of phrases) {
    if (p.bytes > MAX_FILE_BYTES)
      problems.push(`${p.src} is ${kb(p.bytes)}, over the 2 MB per-file limit ("${p.text}")`);
  }
  const total = sum(phrases);
  if (total > MAX_PACK_AUDIO_BYTES) problems.push(`audio totals ${kb(total)}, over the 10 MB per-pack budget`);
  return problems;
}

export function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

export interface RenderOptions {
  synth: Synth;
  encoder: Encoder;
  /** Re-render files that already exist. */
  force?: boolean;
  log?: (line: string) => void;
}

export interface RenderResult {
  rendered: string[];
  skipped: string[];
  plan: AudioPlan;
}

/** Render every missing phrase, then re-plan so sizes are real. Throws on the first tool failure. */
export async function renderPack(packDir: string, opts: RenderOptions): Promise<RenderResult> {
  const log = opts.log ?? (() => {});
  const before = planPack(packDir);
  const rendered: string[] = [];
  const skipped: string[] = [];
  const work = mkdtempSync(join(tmpdir(), "learncroc-audio-"));
  try {
    mkdirSync(join(packDir, "assets", "audio"), { recursive: true });
    for (const [i, p] of before.phrases.entries()) {
      if (p.exists && !opts.force) {
        skipped.push(p.src);
        continue;
      }
      const wav = join(work, `${i}.wav`);
      const ogg = join(work, `${i}.ogg`);
      await opts.synth.synthesize(p.text, p.voice, wav);
      await opts.encoder.encode(wav, ogg);
      renameOrCopy(ogg, join(packDir, p.src));
      rendered.push(p.src);
      log(`  rendered ${p.src}  ${p.text}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { rendered, skipped, plan: planPack(packDir) };
}

/** rename(2) fails across devices (tmp on another volume): fall back to write + rename inside the pack. */
function renameOrCopy(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    const staging = `${to}.tmp`;
    copyFileSync(from, staging);
    renameSync(staging, to);
  }
}

export interface AudioManifest {
  schema: 1;
  generator: string;
  voices: Record<string, { id: string; model: string; speaker?: string | number }>;
  /** Keyed by "<lang>|<text>" (see hash.ts phraseKey); only phrases whose file exists. */
  phrases: Record<string, { src: string; bytes: number }>;
}

export function buildManifest(plan: AudioPlan): AudioManifest {
  const voices: AudioManifest["voices"] = {};
  const phrases: AudioManifest["phrases"] = {};
  for (const p of [...plan.phrases].sort((a, b) =>
    phraseKey(a.text, a.lang).localeCompare(phraseKey(b.text, b.lang)),
  )) {
    if (!p.exists) continue;
    voices[p.lang] = {
      id: p.voice.id,
      model: p.voice.model,
      ...(p.voice.speaker === undefined ? {} : { speaker: p.voice.speaker }),
    };
    phrases[phraseKey(p.text, p.lang)] = { src: p.src, bytes: p.bytes };
  }
  return { schema: 1, generator: GENERATOR, voices, phrases };
}

/** Write (or remove, when nothing is rendered) data/audio-manifest.json. Returns the path written, if any. */
export function writeManifest(plan: AudioPlan): string | undefined {
  const manifest = buildManifest(plan);
  const file = join(plan.packDir, MANIFEST_PATH);
  if (Object.keys(manifest.phrases).length === 0) {
    rmSync(file, { force: true });
    return undefined;
  }
  mkdirSync(join(plan.packDir, "data"), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(tmp, file);
  return file;
}

/** Delete rendered files no phrase refers to. Returns the deleted pack-relative paths. */
export function prunePack(plan: AudioPlan): string[] {
  const dir = join(plan.packDir, "assets", "audio");
  if (!existsSync(dir)) return [];
  const keep = new Set(plan.phrases.map((p) => p.src));
  const removed: string[] = [];
  for (const f of readdirSync(dir)) {
    const rel = `assets/audio/${f}`;
    if (f.endsWith(".ogg") && !keep.has(rel)) {
      rmSync(join(dir, f));
      removed.push(rel);
    }
  }
  return removed;
}
