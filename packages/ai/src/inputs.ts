/**
 * The machine-readable <input> block each AI call carries (alongside the human-readable context).
 * Real models read it as part of the prompt; the fake provider builds deterministic answers from it.
 */
import type { Item } from "@learncroc/core";
import type { SkeletonNodeDraft } from "./schemas";

export interface Para {
  id: string;
  text: string;
  heading?: string;
}

export interface SkeletonInput {
  kind: "create-skeleton";
  /** Card count range (CREATE_SIZES[size]); the planner picks the exact number. */
  cards: { min: number; max: number };
  familiarity: "none" | "some" | "lots";
  title: string;
  paragraphs: Para[];
}
export interface CardInput {
  kind: "create-card";
  node: SkeletonNodeDraft;
  /** 1-based position in reading order, and the planned total. */
  index: number;
  total: number;
  /** The next card in map order (its hook idea is what the teaser opens), or null for the last card. */
  next: { title: string; hookIdea: string } | null;
  articleTitle: string;
  paragraphs: Para[];
  familiarity: "none" | "some" | "lots";
}
export interface JudgeInput {
  kind: "card-judge";
  title: string;
  hooks: { style: string; prompt: string; options: { text: string; correct: boolean }[] }[];
  close: string;
  byGuess: string[];
  teaser: string;
  claims: { text: string; para: string; paraText: string }[];
  /** Each beat as the learner meets it: Moss's lines and the passage. */
  beats: { moss: string[]; passage: string | null }[];
  nextHookIdea: string | null;
}
export interface TeaserInput {
  kind: "card-teaser";
  title: string;
  close: string;
  next: { title: string; hook: string };
}
export interface SplitInput {
  kind: "card-split";
  title: string;
  hook: string;
  close: string;
  beats: { idea: string; text: string }[];
  next: { title: string; hookIdea: string } | null;
}
export interface ConvertCardInput {
  kind: "convert-card";
  node: { id: string; title: string; bigIdea: string };
  hook: { kind: string; prompt: string; options: { id: string; text: string; correct: boolean }[] };
  /** The close the codemod wrote (old hook reveal and Say-it exemplar). */
  close: string;
  next: { title: string; hook: string } | null;
}
export interface FigureInput {
  kind: "create-figure";
  nodeId: string;
  screenId: string;
  title: string;
  description: string;
  labels: string[];
  /** The screen's idea, so the figure draws what the teaching beat says. */
  idea?: string;
}
export interface GradeInput {
  kind: "grade";
  keyPoints: { id: string; text: string; keywords?: string[] }[];
  minHits: number;
  text: string;
  misconceptions: { id: string; label: string }[];
}
export interface HintInput {
  kind: "hint";
  prompt: string;
  answer: string;
  authoredHint: string;
  level: number;
}
export interface VariantInput {
  kind: "quiz-variant";
  item: Item;
  keyPoints: string[];
  misconceptions: { id: string; label: string }[];
}
export interface SolveInput {
  kind: "solve";
  itemKind: Item["kind"];
  question: string;
  options?: { id: string; text: string }[];
  steps?: string[];
}
export interface CardsInput {
  kind: "cards";
  nodeId: string;
  nodeTitle: string;
  hook?: { prompt: string; guess: string; truth: string; correct: boolean };
  misconceptions: { id: string; label: string; hint: string }[];
  myWords?: string;
  existing: string[];
}
export interface CrocInput {
  kind: "croc";
  mode: "hint" | "full";
  intent: "ask" | "explain-differently" | "example" | "deeper" | "hint";
  question: string;
  crocName: string;
  hintLevel: number;
  card?: { title: string; bigIdea: string; ideas: string[] };
  task?: { prompt: string };
}
export interface AuthorPlanInput {
  kind: "author-plan";
  title: string;
  topic: string;
  nodeCount: number;
  sources: { id: string; title: string; excerpt: string }[];
}
export interface AuthorNodeInput {
  kind: "author-node";
  node: { id: string; title: string; bigIdea: string; hookIdea: string; objectives: string[] };
  misconceptions: { id: string; label: string }[];
  beatCount: number;
  next: { title: string; hookIdea: string } | null;
  widgets: { id: string; useWhen: string }[];
}
export interface AuthorPracticeInput {
  kind: "author-practice";
  node: { id: string; title: string; bigIdea: string; keyPoints: string[] };
  misconceptions: { id: string; label: string }[];
  itemCount: number;
}

export type AiInput =
  | SkeletonInput
  | CardInput
  | JudgeInput
  | TeaserInput
  | SplitInput
  | ConvertCardInput
  | FigureInput
  | GradeInput
  | HintInput
  | VariantInput
  | SolveInput
  | CardsInput
  | CrocInput
  | AuthorPlanInput
  | AuthorNodeInput
  | AuthorPracticeInput;
