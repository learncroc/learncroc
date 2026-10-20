/**
 * Moss's reaction bus: client-side, canned, offline. Anything in the app emits an event;
 * the croc corner (map) and the croc pane (modals) listen and show one short line with a croc state.
 *
 * Caps are applied by the listener, not the emitter: ≤ 1 line per moment, ≤ 1 unsolicited
 * bubble per 45 s, never while typing or dragging, never on idle, bubbles fade after about 4 s.
 * "Quiet" (settings.croc.reactions) keeps animations and chat and drops unsolicited bubbles.
 */
import type { CrocState } from "@learncroc/ui";

/** One member per row of the canonical deck. */
export type CrocReaction =
  | { type: "map-first-visit"; packId: string }
  | { type: "guess-locked"; packId: string; nodeId: string }
  | { type: "idk-locked"; packId: string; nodeId: string }
  | { type: "close-wrong"; packId: string; nodeId: string }
  | { type: "close-confident-wrong"; packId: string; nodeId: string }
  | { type: "close-right"; packId: string; nodeId: string }
  | { type: "first-card-done"; packId: string; nodeId: string }
  | { type: "beat-missed"; packId: string; nodeId: string }
  | { type: "section-complete"; packId: string; checkpointId: string; minutes: number }
  | { type: "gate-opened"; packId: string; checkpointId: string; nextTitle?: string }
  | { type: "checkpoint-not-yet"; packId: string; checkpointId: string; close?: boolean }
  | { type: "map-finished"; packId: string }
  | { type: "back-after-days"; packId: string }
  | { type: "fading"; packId: string; nodeId: string; title: string };

export type CrocReactionType = CrocReaction["type"];

/** The croc state for each event; `lumen` lights the lantern (gate open, map finished only). */
export const REACTION_STATE: Record<CrocReactionType, { state: CrocState; lumen?: boolean }> = {
  "map-first-visit": { state: "happy" },
  "guess-locked": { state: "curious" },
  "idk-locked": { state: "curious" },
  "close-wrong": { state: "happy" },
  "close-confident-wrong": { state: "happy" },
  "close-right": { state: "happy" },
  "first-card-done": { state: "happy" },
  "beat-missed": { state: "curious" },
  "section-complete": { state: "curious" },
  "gate-opened": { state: "cheering", lumen: true },
  "checkpoint-not-yet": { state: "curious" },
  "map-finished": { state: "cheering", lumen: true },
  "back-after-days": { state: "idle" },
  fading: { state: "idle" },
};

/** The canonical lines (≤ 12 words, dry and warm, no exclamation marks). */
export function reactionLines(e: CrocReaction): string[] {
  switch (e.type) {
    case "map-first-visit":
      return ["This is the map. Pick any Ready card."];
    case "guess-locked":
      return ["Hold that thought.", "Noted. Let's see.", "Good one to test."];
    case "idk-locked":
      return ["Honest. Let's find out."];
    case "close-wrong":
      return ["Good wrong guess. That's the useful kind.", "Wrong guesses stick best. That one will."];
    case "close-confident-wrong":
      return ["Plot twist. Surprises like this stick."];
    case "close-right":
      return ["Called it. Now you know why."];
    case "first-card-done":
      return ["Done. It lights up at the checkpoint."];
    case "beat-missed":
      return ["One more go. H gives a nudge."];
    case "section-complete":
      return [`That's the section. The checkpoint takes about ${Math.max(1, Math.round(e.minutes))} minutes.`];
    case "gate-opened":
      return [e.nextTitle ? `Section open. ${e.nextTitle} is next.` : "Section open.", "That section is yours now."];
    case "checkpoint-not-yet":
      return e.close
        ? ["Close. One card's worth a second look.", "Nearly. Fresh questions whenever you're ready."]
        : ["Not yet. The cards will get you there.", "Fresh questions whenever you're ready."];
    case "map-finished":
      return ["That's the whole map. You can explain this now. Try it on someone."];
    case "back-after-days":
      return ["Welcome back. The map kept your place."];
    case "fading":
      return [`${e.title} is fading. A short Relight brings it back.`];
  }
}

const lastLine = new Map<CrocReactionType, string>();

/** Rotate through an event's lines, never the same line twice in a row. */
export function pickLine(e: CrocReaction, random: () => number = Math.random): string {
  const lines = reactionLines(e);
  const prev = lastLine.get(e.type);
  const pool = lines.length > 1 ? lines.filter((l) => l !== prev) : lines;
  const line = pool[Math.floor(random() * pool.length)] ?? lines[0] ?? "";
  lastLine.set(e.type, line);
  return line;
}

export type CrocReactionListener = (e: CrocReaction) => void;

const listeners = new Set<CrocReactionListener>();

/** The bus. Emitting is cheap and safe with no listener mounted. */
export const crocReactions: {
  emit(e: CrocReaction): void;
  subscribe(fn: CrocReactionListener): () => void;
} = {
  emit(e) {
    for (const fn of [...listeners]) {
      try {
        fn(e);
      } catch {
        /* a listener must never break the emitter */
      }
    }
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
