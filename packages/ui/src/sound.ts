/**
 * The sound engine (craft, not research): WebAudio-synthesised cues, no audio assets.
 *
 * - "commit": a muted knock when a guess is locked in. Doesn't step the scale (guesses aren't graded).
 * - "tok":    a wooden knock for a right answer; each call within a run steps up a pentatonic scale.
 * - "hm":     a curious rising two-note "hm?" for an action not yet right. Never a buzzer.
 * - "done":   two soft sines a major third apart when a card closes (no shimmer: sparkle is for the gate).
 * - "unlock": a soft single bell when the first card after a gate becomes ready.
 * - "gate":   a low, slow chord plus a high sine for air when a gate swings open.
 * - "finish": the gate chord, then an ascending pentatonic arpeggio when a map is finished.
 *
 * Mixing: cues start at least 120 ms apart (a later cue waits its turn), `gate` and `finish` drop any
 * queued `tok` (the chord carries the moment), and nothing plays while the tab is hidden.
 *
 * Off by default. The AudioContext is created lazily on the first cue after `enabled` is true, so
 * nothing touches audio until the learner opts in. Without WebAudio (tests, old browsers) it is a no-op.
 */

export type SoundCue = "tok" | "hm" | "commit" | "done" | "gate" | "unlock" | "finish";

/** Every cue. `claim` and `spark` are gone (now `gate` and `done`). */
export const SOUND_CUES: readonly SoundCue[] = ["commit", "tok", "hm", "done", "unlock", "gate", "finish"];

/** Approximate length of each cue in ms, for callers that chain visuals to sound. */
export const CUE_MS: Record<SoundCue, number> = {
  commit: 90,
  tok: 120,
  hm: 480,
  done: 400,
  unlock: 500,
  gate: 1700,
  finish: 2200,
};

/** Minimum gap between two cue starts. */
export const CUE_GAP_MS = 120;

export interface SoundEngine {
  readonly enabled: boolean;
  readonly volume: number;
  setEnabled(enabled: boolean): void;
  /** 0..1 */
  setVolume(volume: number): void;
  play(cue: SoundCue): void;
  /** Start a new run: the "tok" scale returns to its first step. */
  resetRun(): void;
  /** Release the AudioContext. */
  close(): void;
}

/** C major pentatonic from C5, two octaves (Hz). */
export const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];

type AudioCtor = new () => AudioContext;

function audioCtor(): AudioCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

export interface SoundEngineOptions {
  enabled?: boolean;
  volume?: number;
  /** Injected for tests. */
  createContext?: () => AudioContext;
  /** Injected for tests: ms clock (default performance.now). */
  now?: () => number;
  /** Injected for tests: is the tab hidden (default document.visibilityState). */
  hidden?: () => boolean;
  /** Injected for tests: schedule a deferred cue (default setTimeout). */
  schedule?: (fn: () => void, ms: number) => unknown;
  /** Injected for tests: cancel a deferred cue (default clearTimeout). */
  cancel?: (handle: unknown) => void;
}

export function createSoundEngine(opts: SoundEngineOptions = {}): SoundEngine {
  let enabled = opts.enabled ?? false;
  let volume = clamp01(opts.volume ?? 0.6);
  let ctx: AudioContext | undefined;
  let master: GainNode | undefined;
  let step = 0;
  /** When the last cue started (or will start, if queued), in ms. */
  let lastStart = Number.NEGATIVE_INFINITY;
  /** When the last cue actually started. */
  let lastActual = Number.NEGATIVE_INFINITY;
  const queued: { cue: SoundCue; at: number; handle: unknown }[] = [];
  const now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const hidden = opts.hidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const ensure = (): AudioContext | undefined => {
    if (ctx) return ctx;
    const make = opts.createContext ?? (() => new (audioCtor() as AudioCtor)());
    if (!opts.createContext && !audioCtor()) return undefined;
    try {
      ctx = make();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    } catch {
      ctx = undefined;
    }
    return ctx;
  };

  /** One enveloped oscillator note. */
  const note = (
    c: AudioContext,
    out: AudioNode,
    freq: number,
    at: number,
    dur: number,
    { type = "sine" as OscillatorType, peak = 0.3, attack = 0.005 } = {},
  ) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.02);
    return osc;
  };

  /** The gate chord: C3 G3 E4 C5 strummed 30 ms apart, plus a high sine at +120 ms for air. */
  const gateChord = (c: AudioContext, out: AudioNode) => {
    const t = c.currentTime;
    for (const [i, f] of [130.81, 196.0, 329.63, 523.25].entries()) {
      note(c, out, f, t + i * 0.03, 1.6, { type: i === 0 ? "triangle" : "sine", peak: 0.16, attack: 0.08 });
    }
    note(c, out, 1046.5, t + 0.12, 1.4, { type: "sine", peak: 0.06, attack: 0.05 });
  };

  const cues: Record<SoundCue, (c: AudioContext, out: AudioNode) => void> = {
    tok(c, out) {
      const f = PENTATONIC[Math.min(step, PENTATONIC.length - 1)] ?? 523.25;
      step++;
      const t = c.currentTime;
      // A wooden knock: a fast-decaying triangle plus a pitched-down sine "body".
      note(c, out, f, t, 0.12, { type: "triangle", peak: 0.35, attack: 0.002 });
      const body = note(c, out, f / 2, t, 0.09, { type: "sine", peak: 0.25, attack: 0.002 });
      body.frequency.exponentialRampToValueAtTime(f / 3, t + 0.08);
    },
    hm(c, out) {
      const t = c.currentTime;
      note(c, out, 392.0, t, 0.22, { type: "sine", peak: 0.22, attack: 0.03 });
      note(c, out, 493.88, t + 0.18, 0.3, { type: "sine", peak: 0.2, attack: 0.04 });
    },
    commit(c, out) {
      const t = c.currentTime;
      note(c, out, 330, t, 0.08, { type: "triangle", peak: 0.18, attack: 0.002 });
      note(c, out, 165, t, 0.07, { type: "sine", peak: 0.14, attack: 0.002 });
    },
    done(c, out) {
      const t = c.currentTime;
      note(c, out, 523.25, t, 0.3, { type: "sine", peak: 0.12, attack: 0.01 });
      note(c, out, 659.25, t + 0.09, 0.3, { type: "sine", peak: 0.12, attack: 0.01 });
    },
    gate(c, out) {
      gateChord(c, out);
    },
    finish(c, out) {
      gateChord(c, out);
      const t = c.currentTime + 0.4;
      for (const [i, f] of [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5].entries()) {
        note(c, out, f, t + i * 0.09, 0.3, { type: "sine", peak: 0.08, attack: 0.006 });
      }
    },
    unlock(c, out) {
      note(c, out, 880.0, c.currentTime, 0.5, { type: "sine", peak: 0.12, attack: 0.01 });
    },
  };

  /** Start a cue now (it may have waited in the queue); silent if the tab went hidden meanwhile. */
  const start = (cue: SoundCue) => {
    lastActual = now();
    if (!enabled || volume === 0 || hidden()) return;
    const c = ensure();
    if (!c || !master) return;
    if (c.state === "suspended") void c.resume();
    cues[cue](c, master);
  };

  return {
    get enabled() {
      return enabled;
    },
    get volume() {
      return volume;
    },
    setEnabled(v) {
      enabled = v;
    },
    setVolume(v) {
      volume = clamp01(v);
      if (master && ctx) master.gain.setValueAtTime(volume, ctx.currentTime);
    },
    play(cue) {
      if (!enabled || volume === 0 || hidden()) return;
      // The chord carries the moment: drop any tok still waiting its turn.
      if (cue === "gate" || cue === "finish") {
        for (let i = queued.length - 1; i >= 0; i--) {
          const q = queued[i];
          if (q?.cue === "tok") {
            cancel(q.handle);
            queued.splice(i, 1);
          }
        }
        lastStart = Math.max(lastActual, ...queued.map((q) => q.at));
      }
      const t = now();
      const at = Math.max(t, lastStart + CUE_GAP_MS);
      lastStart = at;
      if (at <= t) {
        start(cue);
        return;
      }
      const entry: { cue: SoundCue; at: number; handle: unknown } = { cue, at, handle: undefined };
      queued.push(entry);
      entry.handle = schedule(() => {
        const i = queued.indexOf(entry);
        if (i >= 0) queued.splice(i, 1);
        start(cue);
      }, at - t);
    },
    resetRun() {
      step = 0;
    },
    close() {
      for (const q of queued.splice(0)) cancel(q.handle);
      void ctx?.close();
      ctx = undefined;
      master = undefined;
    },
  };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
