/**
 * Lint rule catalogue. Ids are stable forever; every message carries why the rule exists (one line,
 * pointing at the learning principle behind it) and a one-line fix example. Retired rules stay listed and are never emitted.
 */
import type { LintProfile } from "../schema/index";

export interface RuleInfo {
  id: string;
  title: string;
  why: string;
  example: string;
  /** Never emitted; an ignore comment naming it warns "retired rule". */
  retired?: boolean;
}

export const RULES = {
  L000: {
    id: "L000",
    title: "Files parse and match their schema",
    why: "Packs are data: every file must validate so the app, lint and editors agree (docs/reference).",
    example: "Run `bun run validate:pack packs/<id>` and fix the reported key.",
  },
  L001: {
    id: "L001",
    title: "Word caps per card part",
    why: "Rule zero: reading comes in short bursts, after the learner has done something.",
    example: "Hook ≤ 30 words, beat ≤ 120, close and each byGuess ≤ 60, teaser ≤ 20; move overflow into alts.simpler.",
  },
  L001b: {
    id: "L001b",
    title: "Card length: 100–500 learner-facing words",
    why: "Rule zero: a card is 2–4 minutes of doing, not an article.",
    example: "Cut repeated setup; let the canvas show what a sentence describes.",
  },
  L002: {
    id: "L002",
    title: "Word caps for flashcards, feedback, hints and extras",
    why: "Short feedback and cards are read; long ones are skipped (rule zero).",
    example: 'feedbackRight: "Steeper line, faster trip."',
  },
  L003: {
    id: "L003",
    title: "Real interactions",
    why: "Never #2: no Next button that needs no thinking; every action asks the learner to do something.",
    example: 'Replace a "Continue" option with a question about what the canvas just showed.',
  },
  L004: {
    id: "L004",
    title: "A picture on every beat, with alt text",
    why: "One idea per beat, with a picture (dual coding); alt text keeps it accessible.",
    example: 'visual: { kind: figure, asset: assets/img/x.svg, alt: "A clock beside a road" }',
  },
  L005: {
    id: "L005",
    title: "A guess-first hook that doesn't give the close away",
    why: "Open with a question the learner can't answer yet, not a definition.",
    example: 'prompt: "Which is longer, 90 minutes or 2 hours?"',
  },
  L006: {
    id: "L006",
    title: "Card shape: 2–3 beats, at least one with an action",
    why: "A card is hook → 2–3 beats → close, and the learner does something in at least one beat.",
    example: "Give one beat an interaction and its reveal; a read-only beat has neither.",
  },
  L007: {
    id: "L007",
    title: "A healthy prerequisite graph",
    why: "The map is a DAG with real choices; planned cards never block playable ones.",
    example: "Give the first section two roots, or two cards that open after the first one.",
  },
  L008: {
    id: "L008",
    title: "Misconceptions resolve",
    why: "A checkpoint miss points back to the card that teaches it, so an upstream must be an ancestor card.",
    example: "upstream: units   # an ancestor card id, or omit it",
  },
  L009: {
    id: "L009",
    title: "Answers are valid and solutions grade correct",
    why: "A wrong answer key teaches the wrong thing; every authored solution is replayed by the grader.",
    example: "answer: same   # an id from options",
  },
  L010: {
    id: "L010",
    title: "Widget references validate",
    why: "Widgets are versioned contracts: props must pass the widget's own schema and checks.",
    example: "widgets: { sorter: 1 }   # in pack.yaml, matching every v: 1",
  },
  L011: {
    id: "L011",
    title: "Enough items, enough new situations",
    why: "Checkpoints and Relight need a bank with fresh, transfer-level questions.",
    example: "Add items with level: transfer (curated, sampler and pocket: ≥ 6 items, ≥ 3 transfer).",
  },
  L012: {
    id: "L012",
    title: "Banned words and patterns",
    why: "The honesty rule and the house voice: no streaks, XP, learning styles or hype.",
    example: '"Lots of people guess …" instead of "Most people …"',
  },
  L013: {
    id: "L013",
    title: "Assets are local, allowed and safe",
    why: "Packs are data: no remote URLs, no unsafe files, nothing outside the pack.",
    example: "asset: assets/img/clock.svg   # lowercase, inside assets/, ≤ 2 MB",
  },
  L014: {
    id: "L014",
    title: "Theme contrast and colour distance",
    why: "Line colours must read on the ground and never look like Lumen (mastery), Ember or Sea.",
    example: 'lines: ["#7FB2FF", …]   # ≥ 3:1 on the ground, ΔE2000 ≥ 15 from Lumen/Ember/Sea',
  },
  L015: {
    id: "L015",
    title: "Bosses (retired)",
    why: "Retired in revision 3: checkpoints replaced bosses.",
    example: "Remove the ignore comment.",
    retired: true,
  },
  L016: {
    id: "L016",
    title: "Quick-runs (retired)",
    why: "Retired in revision 3: cards replaced quick-runs.",
    example: "Remove the ignore comment.",
    retired: true,
  },
  L017: {
    id: "L017",
    title: "Reviewed means a named human reviewed it",
    why: 'Honesty rule: "reviewed" needs a recorded human sign-off in pack.lock.yaml.',
    example: "reviews: [{ name: Ada, role: subject expert, date: 2026-10-20, files: [nodes/x.yaml] }]",
  },
  L018: {
    id: "L018",
    title: "Interaction mix: mostly doing, few choices, no true/false",
    why: "North star: learners manipulate, estimate, order and write; tapping one of four is not the lesson.",
    example: "Turn a choice item into numeric, order or text.",
  },
  L019: {
    id: "L019",
    title: "Choice options act out on the canvas",
    why: "Choice answers make the canvas show what the chosen answer would mean.",
    example: 'options: [{ id: a, text: …, visualState: { props: { v: 20 }, note: "too slow" } }]',
  },
  L020: {
    id: "L020",
    title: "HTML interactives are small, offline and bridged",
    why: "Pack HTML runs sandboxed with no network and reports through window.lm.",
    example: "Use lm.report(value) and inline every script and style; no fetch, no remote src.",
  },
  L021: {
    id: "L021",
    title: "Rendered audio where it matters",
    why: "Language packs play pre-rendered audio, because many systems have no voice for the language.",
    example: "Run `bun run packs:audio` so every phrase gets a src.",
  },
  L022: {
    id: "L022",
    title: "Language packs are mostly production",
    why: "Producing language (typing, building, saying) teaches more than recognising it.",
    example: "Turn choice items into text, cloze or tile-builder items.",
  },
  L023: {
    id: "L023",
    title: "The close answers the hook and names the guess",
    why: "The close resolves the exact question the learner guessed at, and names their guess.",
    example: 'close: { text: "…", byGuess: { b: "You picked *Train B*. …", idk: "…" }, teaser: "…?" }',
  },
  L024: {
    id: "L024",
    title: "Checkpoints gate the map",
    why: "Every card lights at a checkpoint every 2–3 cards, and the map ends in one.",
    example: "checkpoint-basics: { requires: [unit-conversion], line: basics, kind: checkpoint }",
  },
  L025: {
    id: "L025",
    title: "Reading order",
    why: "The teaser opens the next card in map order, so map.yaml key order must follow the graph.",
    example: "List map.yaml nodes in the order a learner meets them.",
  },
} as const satisfies Record<string, RuleInfo>;

export type RuleId = keyof typeof RULES;
export const RULE_IDS = Object.keys(RULES) as RuleId[];

type Sev = "error" | "warn" | null;

export interface ProfileRules {
  /** Beats per card (all profiles). */
  screens: [number, number];
  items: number;
  /** Items with level "transfer". */
  transferItems: number;
  misconceptions: number;
  /** Cards per checkpoint. */
  checkpointEvery: [number, number];
  checkpointSeverity: Sev;
  closeNamesGuess: Sev;
  nonChoiceScreens: number;
  nonChoiceSeverity: Sev;
  choiceShare: Sev;
  visualState: Sev;
  theme: Sev;
  reviewed: Sev;
  /** Max inline suppressions (Infinity = no budget). */
  suppressionBudget: number;
  /** The "≥ 2 roots or ≥ 2 ready after the first root" rule (first section only). */
  choiceOfPath: Sev;
}

export const PROFILES: Record<LintProfile, ProfileRules> = {
  curated: {
    screens: [2, 3],
    items: 6,
    transferItems: 3,
    misconceptions: 2,
    checkpointEvery: [2, 3],
    checkpointSeverity: "error",
    closeNamesGuess: "error",
    nonChoiceScreens: 1,
    nonChoiceSeverity: "warn",
    choiceShare: "error",
    visualState: "error",
    theme: "error",
    reviewed: "error",
    suppressionBudget: 5,
    choiceOfPath: "warn",
  },
  sampler: {
    screens: [2, 3],
    items: 6,
    transferItems: 3,
    misconceptions: 2,
    checkpointEvery: [2, 3],
    checkpointSeverity: "error",
    closeNamesGuess: "error",
    nonChoiceScreens: 1,
    nonChoiceSeverity: "warn",
    choiceShare: "error",
    visualState: "error",
    theme: "error",
    reviewed: "error",
    suppressionBudget: 5,
    choiceOfPath: "warn",
  },
  community: {
    screens: [2, 3],
    items: 4,
    transferItems: 2,
    misconceptions: 1,
    checkpointEvery: [1, 6],
    checkpointSeverity: "warn",
    closeNamesGuess: "warn",
    nonChoiceScreens: 1,
    nonChoiceSeverity: "warn",
    choiceShare: "warn",
    visualState: "warn",
    theme: "warn",
    reviewed: "error",
    suppressionBudget: Number.POSITIVE_INFINITY,
    choiceOfPath: "warn",
  },
  pocket: {
    screens: [2, 3],
    items: 6,
    transferItems: 3,
    misconceptions: 1,
    checkpointEvery: [4, 6],
    checkpointSeverity: "error",
    closeNamesGuess: "error",
    nonChoiceScreens: 1,
    nonChoiceSeverity: "warn",
    choiceShare: "warn",
    visualState: null,
    // Pocket themes are generated and auto-corrected; lint only notes problems.
    theme: "warn",
    reviewed: null,
    suppressionBudget: Number.POSITIVE_INFINITY,
    choiceOfPath: null,
  },
};
