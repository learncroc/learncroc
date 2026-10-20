/**
 * Learner preferences the player needs on every frame: reduced motion, app theme, sound.
 */
import { useReducedMotion as useUiReducedMotion } from "@learncroc/ui";
import { useEffect, useState } from "react";
import { useSettingsQuery } from "./queries";

function useMedia(query: string): boolean {
  const get = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [query]);
  return matches;
}

/** Settings override first ("on" / "off"), then the app/OS preference. */
export function useReducedMotion(): boolean {
  const system = useUiReducedMotion();
  const setting = useSettingsQuery().data?.appearance.reducedMotion ?? "system";
  return setting === "on" ? true : setting === "off" ? false : system;
}

/** The app theme in effect (for widgets drawn on app surfaces). */
export function useAppTheme(): "light" | "dark" {
  const systemDark = useMedia("(prefers-color-scheme: dark)");
  const setting = useSettingsQuery().data?.appearance.theme ?? "system";
  if (setting === "light" || setting === "dark") return setting;
  return systemDark ? "dark" : "light";
}

export interface SoundPrefs {
  enabled: boolean;
  volume: number;
}

export function useSoundPrefs(): SoundPrefs {
  const s = useSettingsQuery().data?.sound;
  return { enabled: s?.enabled ?? false, volume: s?.volume ?? 0.6 };
}

const SESSION_KEY = "lm.sessionStartedAt";
/** About 25 minutes of play in one sitting. */
export const NATURAL_ENDING_MS = 25 * 60_000;

/**
 * Remember when this tab started learning (the first run opened). UI pacing only (sessionStorage,
 * wall clock): it never touches learner state.
 */
export function noteSessionStart(now = Date.now()): void {
  try {
    if (!sessionStorage.getItem(SESSION_KEY)) sessionStorage.setItem(SESSION_KEY, String(now));
  } catch {
    /* storage off: no natural ending line */
  }
}

/** "Nice place to stop. Your map will be here.": about 25 minutes after the first run of the sitting. */
export function naturalEndingDue(now = Date.now()): boolean {
  try {
    const started = Number(sessionStorage.getItem(SESSION_KEY));
    return Number.isFinite(started) && started > 0 && now - started >= NATURAL_ENDING_MS;
  } catch {
    return false;
  }
}
