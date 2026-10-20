/**
 * Every fixed line Moss's surfaces show. Dry, warm, adult; no exclamation
 * marks; never "Most people", never a streak, never guilt. Reaction lines live in reactions.ts.
 */
import { CROC_NAME } from "@learncroc/core";
import type { CrocContext } from "./store";

export const CROC_COPY = {
  /** Accessible name of the corner button (AC-MAP-4). */
  cornerLabel: `${CROC_NAME}, ask about this map`,
  askHotkey: `Ask ${CROC_NAME}`,
  mapPanelTitle: "About this map",
  mapPanelIntro: `Ask about anything on this map. ${CROC_NAME} keeps answers short.`,
  hintOnly: "Hints only during a checkpoint.",
  firstHintFree: "A first hint is free.",
  secondHint: "This one won't count if you take it. The retry will have fresh questions.",
  hintsUsed: "That's all the hint I've got for this one.",
  hookNote: "Guess first. I'll explain right after.",
  offlineFree:
    "Without an AI key I can only use what's written for this card. Try a button above, or add a key in Settings.",
  offlineEmpty: "Nothing extra written for this one yet. The card's beats are the best source.",
  offlineLabel: "From this card's notes",
  mapLabel: "From this map",
  setUpAi: "Set up AI",
  thinking: `${CROC_NAME} is thinking…`,
  unreachable: "Couldn't reach the local app. Try that again in a moment.",
  stopped: "Stopped.",
  minimise: `Hide ${CROC_NAME}`,
  restore: `Show ${CROC_NAME}`,
} as const;

/** The input placeholder per moment. */
export function placeholderFor(context: CrocContext, cardTitle?: string): string {
  switch (context) {
    case "map":
      return cardTitle ? `Ask about ${cardTitle}` : `Ask ${CROC_NAME}`;
    case "hook":
      return "Ask about this card (I won't give the answer away yet)";
    case "card":
      return "Ask about this card";
    case "checkpoint":
    case "relight":
      return "Ask for a hint";
    case "checkpoint-result":
      return "Ask about what you missed";
  }
}

/** The pane's header line ("About Tokens", "Checkpoint question"). */
export function contextLine(context: CrocContext, cardTitle?: string): string {
  switch (context) {
    case "map":
      return cardTitle ? `About ${cardTitle}` : CROC_COPY.mapPanelTitle;
    case "checkpoint":
      return cardTitle ? `Checkpoint question · from ${cardTitle}` : "Checkpoint question";
    case "relight":
      return "Relight question";
    case "checkpoint-result":
      return "About what you missed";
    default:
      return cardTitle ? `About ${cardTitle}` : "About this card";
  }
}
