/**
 * Phrase playback for listen, dialogue and tile-builder: the pack's pre-rendered audio first, then the browser's
 * speechSynthesis with a voice chosen by language, at any rate. When neither can play (no file, no voice for
 * the language, autoplay blocked), it resolves "none" and the caller shows the transcript instead.
 *
 * One phrase plays at a time: starting a new one stops the previous one.
 */
import type { AssetPath } from "@learncroc/core";

export interface PlayPhraseOptions {
  src?: AssetPath;
  tts?: { text: string; lang: string };
  /** Playback rate: 1 = natural, 0.7 = slow. Applied to audio files and speech. */
  rate?: number;
  assetUrl: (path: AssetPath) => string;
  /** Called once when playback finishes (not when it is stopped or fails). */
  onEnd?: () => void;
}

export type PlaybackKind = "audio" | "speech" | "none";

export interface PlaybackResult {
  kind: PlaybackKind;
  /** Why nothing played (for a quiet caption next to the transcript). */
  reason?: "no-source" | "audio-failed" | "no-voice" | "speech-failed" | "unsupported";
}

// ─── Environment (injectable for tests) ─────────────────────────────────────────────────────────

/** The bits of HTMLAudioElement the helper uses. */
export interface AudioLike {
  playbackRate: number;
  preservesPitch?: boolean;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended" | "error", fn: () => void, opts?: { once?: boolean }): void;
  removeAttribute?(name: string): void;
  load?(): void;
}

/** The bits of SpeechSynthesis the helper uses. */
export interface SpeechLike {
  getVoices(): VoiceLike[];
  speak(u: UtteranceLike): void;
  cancel(): void;
  addEventListener?(type: "voiceschanged", fn: () => void): void;
  removeEventListener?(type: "voiceschanged", fn: () => void): void;
}

export interface VoiceLike {
  lang: string;
  name: string;
  default?: boolean;
  localService?: boolean;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  voice: VoiceLike | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

export interface AudioEnv {
  createAudio?: (url: string) => AudioLike;
  speech?: SpeechLike;
  createUtterance?: (text: string) => UtteranceLike;
  /** Milliseconds to wait for audio to start or a voice list to load. */
  timeouts?: { audioStart?: number; voices?: number; speechStart?: number };
}

function browserEnv(): AudioEnv {
  const g = globalThis as unknown as {
    Audio?: new (url: string) => AudioLike;
    speechSynthesis?: SpeechLike;
    SpeechSynthesisUtterance?: new (text: string) => UtteranceLike;
  };
  return {
    createAudio: g.Audio ? (url) => new (g.Audio as new (u: string) => AudioLike)(url) : undefined,
    speech: g.speechSynthesis,
    createUtterance: g.SpeechSynthesisUtterance
      ? (text) => new (g.SpeechSynthesisUtterance as new (t: string) => UtteranceLike)(text)
      : undefined,
  };
}

// ─── Voice choice ───────────────────────────────────────────────────────────────────────────────

function tag(lang: string): string {
  return lang.trim().replace(/_/g, "-").toLowerCase();
}

/**
 * The best voice for a BCP 47 language tag: an exact match first, then the same base language (es-MX for
 * es-ES); within each, the platform default, then local voices. Undefined when nothing speaks the language.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | undefined {
  const want = tag(lang);
  const base = want.split("-")[0] ?? want;
  const rank = (v: V) => (v.default ? 0 : 2) + (v.localService ? 0 : 1);
  const best = (list: V[]) => [...list].sort((a, b) => rank(a) - rank(b))[0];
  const exact = voices.filter((v) => tag(v.lang) === want);
  if (exact.length) return best(exact);
  const sameBase = voices.filter((v) => (tag(v.lang).split("-")[0] ?? "") === base);
  return sameBase.length ? best(sameBase) : undefined;
}

/** Voices, waiting briefly for the async voice list some browsers load after page start. */
export async function loadVoices(speech: SpeechLike, waitMs = 1200): Promise<VoiceLike[]> {
  const now = speech.getVoices();
  if (now.length || !speech.addEventListener) return now;
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      speech.removeEventListener?.("voiceschanged", done);
      resolve(speech.getVoices());
    };
    const timer = setTimeout(done, waitMs);
    speech.addEventListener?.("voiceschanged", done);
  });
}

/** Can this browser speak `lang` aloud? (False on a Linux Chromium with no voices installed.) */
export async function canSpeak(lang: string, env: AudioEnv = browserEnv()): Promise<boolean> {
  if (!env.speech || !env.createUtterance) return false;
  return pickVoice(await loadVoices(env.speech, env.timeouts?.voices), lang) !== undefined;
}

// ─── Playback ───────────────────────────────────────────────────────────────────────────────────

let stopCurrent: (() => void) | null = null;

/** Stop whatever phrase is playing. */
export function stopPhrase(): void {
  stopCurrent?.();
  stopCurrent = null;
}

function clampRate(rate: number | undefined): number {
  const r = rate ?? 1;
  return Number.isFinite(r) ? Math.max(0.25, Math.min(4, r)) : 1;
}

async function playFile(url: string, rate: number, env: AudioEnv, onEnd?: () => void): Promise<boolean> {
  if (!env.createAudio) return false;
  let audio: AudioLike;
  try {
    audio = env.createAudio(url);
  } catch {
    return false;
  }
  audio.preload = "auto";
  audio.playbackRate = rate;
  audio.preservesPitch = true; // slow playback keeps the speaker's pitch
  let stopped = false;
  const stop = () => {
    stopped = true;
    audio.pause();
  };
  stopCurrent = stop;
  audio.addEventListener(
    "ended",
    () => {
      if (!stopped) onEnd?.();
      if (stopCurrent === stop) stopCurrent = null;
    },
    { once: true },
  );
  const failed = new Promise<false>((resolve) => audio.addEventListener("error", () => resolve(false), { once: true }));
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), env.timeouts?.audioStart ?? 4000));
  const started = audio.play().then(
    () => true as const,
    () => false as const,
  );
  const ok = await Promise.race([started, failed, timeout]);
  if (!ok) {
    stopped = true;
    audio.pause();
    if (stopCurrent === stop) stopCurrent = null;
  }
  return ok && !stopped;
}

async function playSpeech(
  text: string,
  lang: string,
  rate: number,
  env: AudioEnv,
  onEnd?: () => void,
): Promise<PlaybackResult> {
  const speech = env.speech;
  if (!speech || !env.createUtterance) return { kind: "none", reason: "unsupported" };
  const voice = pickVoice(await loadVoices(speech, env.timeouts?.voices), lang);
  if (!voice) return { kind: "none", reason: "no-voice" };
  speech.cancel();
  const u = env.createUtterance(text);
  u.lang = voice.lang || lang;
  u.voice = voice;
  u.rate = rate;
  let stopped = false;
  const stop = () => {
    stopped = true;
    speech.cancel();
  };
  stopCurrent = stop;
  const ok = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), env.timeouts?.speechStart ?? 2500);
    u.onstart = () => {
      clearTimeout(timer);
      resolve(true);
    };
    u.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    u.onend = () => {
      clearTimeout(timer);
      resolve(true); // some engines skip onstart for short phrases
      if (!stopped) onEnd?.();
      if (stopCurrent === stop) stopCurrent = null;
    };
    speech.speak(u);
  });
  if (!ok) {
    stopped = true;
    speech.cancel();
    if (stopCurrent === stop) stopCurrent = null;
    return { kind: "none", reason: "speech-failed" };
  }
  return { kind: "speech" };
}

/**
 * Play a phrase: the pack file (src) first, then speech (tts) in its language. Resolves once playback has
 * started, with what played; "none" means the caller should rely on the transcript.
 */
export async function play(opts: PlayPhraseOptions, env: AudioEnv = browserEnv()): Promise<PlaybackResult> {
  stopPhrase();
  const rate = clampRate(opts.rate);
  if (!opts.src && !opts.tts) return { kind: "none", reason: "no-source" };
  if (opts.src) {
    let url: string | undefined;
    try {
      url = opts.assetUrl(opts.src);
    } catch {
      url = undefined;
    }
    if (url && (await playFile(url, rate, env, opts.onEnd))) return { kind: "audio" };
    if (!opts.tts) return { kind: "none", reason: "audio-failed" };
  }
  const tts = opts.tts as { text: string; lang: string };
  return playSpeech(tts.text, tts.lang, rate, env, opts.onEnd);
}

/** Resolves false when nothing could be played (the caller shows the transcript). */
export async function playPhrase(opts: PlayPhraseOptions, env?: AudioEnv): Promise<boolean> {
  return (await play(opts, env)).kind !== "none";
}
