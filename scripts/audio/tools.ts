/**
 * External tools for rendering: Piper (text → WAV) and ffmpeg (WAV → Ogg Opus).
 * Both are maintainer-only. The pipeline talks to them through the small Synth / Encoder interfaces,
 * so tests can swap in a synthetic voice.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveSpeaker, type VoiceConfig } from "./voices";

export interface Synth {
  /** Shown in logs and recorded in the manifest. */
  readonly name: string;
  /** Write `text`, spoken in `voice`, to a 16-bit PCM WAV file at `outWav`. */
  synthesize(text: string, voice: VoiceConfig, outWav: string): Promise<void>;
}

export interface Encoder {
  readonly name: string;
  /** Encode a WAV file to Ogg Opus at `outOgg`. */
  encode(inWav: string, outOgg: string): Promise<void>;
}

/** Opus at 32 kb/s mono: clear speech, about 4 KB per second. */
export const OPUS_BITRATE = "32k";

async function run(cmd: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdin: stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (stdin !== undefined && proc.stdin) {
    proc.stdin.write(stdin);
    await proc.stdin.end();
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** True when `bin` resolves on PATH (or is an existing path). */
export function hasBinary(bin: string): boolean {
  return existsSync(bin) || Bun.which(bin) !== null;
}

/** Default voices directory: $PIPER_VOICES, else ~/.local/share/piper-voices. */
export function voicesDir(env: Record<string, string | undefined> = process.env): string {
  return env.PIPER_VOICES ?? join(homedir(), ".local", "share", "piper-voices");
}

export interface PiperOptions {
  bin: string;
  voicesDir: string;
}

export function modelPaths(voice: VoiceConfig, dir: string): { onnx: string; config: string } {
  return { onnx: join(dir, `${voice.model}.onnx`), config: join(dir, `${voice.model}.onnx.json`) };
}

/**
 * Piper's CLI changed flag style between releases (C++ `--output_file`, Python `--output-file`).
 * Ask `--help` once and use whichever the installed binary documents.
 */
async function piperFlagStyle(bin: string): Promise<"snake" | "kebab"> {
  const help = await run([bin, "--help"]);
  const text = `${help.stdout}\n${help.stderr}`;
  return text.includes("--output-file") && !text.includes("--output_file") ? "kebab" : "snake";
}

export function piperSynth(opts: PiperOptions): Synth {
  let style: Promise<"snake" | "kebab"> | undefined;
  return {
    name: `piper (${opts.bin})`,
    async synthesize(text, voice, outWav) {
      style ??= piperFlagStyle(opts.bin);
      const kebab = (await style) === "kebab";
      const flag = (name: string) => `--${kebab ? name.replace(/_/g, "-") : name}`;
      const paths = modelPaths(voice, opts.voicesDir);
      const speaker = resolveSpeaker(voice, JSON.parse(readFileSync(paths.config, "utf8")));
      const cmd = [opts.bin, "--model", paths.onnx, "--config", paths.config, flag("output_file"), outWav];
      if (speaker !== undefined) cmd.push("--speaker", String(speaker));
      if (voice.lengthScale !== undefined) cmd.push(flag("length_scale"), String(voice.lengthScale));
      if (voice.sentenceSilence !== undefined) cmd.push(flag("sentence_silence"), String(voice.sentenceSilence));
      const r = await run(cmd, `${text}\n`);
      if (r.code !== 0 || !existsSync(outWav)) {
        throw new Error(`piper failed (${r.code}) for "${text}": ${r.stderr.trim().slice(-400)}`);
      }
    },
  };
}

export function ffmpegOpusEncoder(bin = "ffmpeg"): Encoder {
  return {
    name: `ffmpeg libopus ${OPUS_BITRATE} (${bin})`,
    async encode(inWav, outOgg) {
      const r = await run([
        bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inWav,
        "-ac",
        "1",
        "-c:a",
        "libopus",
        "-b:a",
        OPUS_BITRATE,
        "-application",
        "voip",
        "-map_metadata",
        "-1",
        "-f",
        "ogg",
        outOgg,
      ]);
      if (r.code !== 0 || !existsSync(outOgg)) throw new Error(`ffmpeg failed (${r.code}): ${r.stderr.trim()}`);
    },
  };
}
