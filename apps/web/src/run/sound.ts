/**
 * Run sounds (craft, not research) through the design system's WebAudio engine, gated by
 * Settings → Sound (off by default). A muted knock when a guess is locked in, a wooden "tok" rising along
 * a pentatonic scale within a run, a curious "hm?" on a miss, two warm notes when a card closes, the gate
 * chord when a gate opens, an arpeggio when a map is finished. No buzzer, no assets.
 */
import { createSoundEngine, type SoundEngine } from "@learncroc/ui";
import { useEffect, useMemo } from "react";
import { useSoundPrefs } from "./prefs";

let engine: SoundEngine | null = null;
function shared(): SoundEngine {
  engine ??= createSoundEngine();
  return engine;
}

export interface RunSounds {
  commit(): void;
  tok(): void;
  hm(): void;
  done(): void;
  gate(): void;
  unlock(): void;
  finish(): void;
  /** A new run starts the "tok" scale from its first step. */
  resetRun(): void;
}

export function useRunSounds(): RunSounds {
  const { enabled, volume } = useSoundPrefs();
  useEffect(() => {
    const e = shared();
    e.setEnabled(enabled);
    e.setVolume(volume);
  }, [enabled, volume]);
  return useMemo<RunSounds>(() => {
    const e = shared();
    return {
      commit: () => e.play("commit"),
      tok: () => e.play("tok"),
      hm: () => e.play("hm"),
      done: () => e.play("done"),
      gate: () => e.play("gate"),
      unlock: () => e.play("unlock"),
      finish: () => e.play("finish"),
      resetRun: () => e.resetRun(),
    };
  }, []);
}
