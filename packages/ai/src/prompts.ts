/// <reference path="./md.d.ts" />
/**
 * Versioned prompt files (packages/ai/prompts/*.md): YAML front-matter plus a Markdown body with
 * {{placeholders}}. The server, the CLI (`learncroc build`, `learncroc prompt <id>`) and the
 * authoring skills all read the same files.
 */
import { CROC_NAME, type Effort, type ModelTier, type SystemBlock } from "@learncroc/core";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import askText from "../prompts/ask.md" with { type: "text" };
import askSocraticText from "../prompts/ask-socratic.md" with { type: "text" };
import authorNodeText from "../prompts/author-node.md" with { type: "text" };
import authorPlanText from "../prompts/author-plan.md" with { type: "text" };
import authorPracticeText from "../prompts/author-practice.md" with { type: "text" };
import cardJudgeText from "../prompts/card-judge.md" with { type: "text" };
import cardTeaserText from "../prompts/card-teaser.md" with { type: "text" };
import cardsText from "../prompts/cards.md" with { type: "text" };
import createCardText from "../prompts/create-card.md" with { type: "text" };
import createFigureText from "../prompts/create-figure.md" with { type: "text" };
import createSkeletonText from "../prompts/create-skeleton.md" with { type: "text" };
import gradeText from "../prompts/grade.md" with { type: "text" };
import hintText from "../prompts/hint.md" with { type: "text" };
import houseStyleText from "../prompts/house-style.md" with { type: "text" };
import quizVariantText from "../prompts/quiz-variant.md" with { type: "text" };
import repairText from "../prompts/repair.md" with { type: "text" };
import solveText from "../prompts/solve.md" with { type: "text" };

export const PROMPT_IDS = [
  "house-style",
  "ask",
  "ask-socratic",
  "hint",
  "grade",
  "quiz-variant",
  "solve",
  "cards",
  "create-skeleton",
  "create-card",
  "card-judge",
  "card-teaser",
  "create-figure",
  "repair",
  "author-plan",
  "author-node",
  "author-practice",
] as const;
export type PromptId = (typeof PROMPT_IDS)[number];

const RAW: Record<PromptId, string> = {
  "house-style": houseStyleText,
  ask: askText,
  "ask-socratic": askSocraticText,
  hint: hintText,
  grade: gradeText,
  "quiz-variant": quizVariantText,
  solve: solveText,
  cards: cardsText,
  "create-skeleton": createSkeletonText,
  "create-card": createCardText,
  "card-judge": cardJudgeText,
  "card-teaser": cardTeaserText,
  "create-figure": createFigureText,
  repair: repairText,
  "author-plan": authorPlanText,
  "author-node": authorNodeText,
  "author-practice": authorPracticeText,
};

const FrontMatter = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  description: z.string(),
  tier: z.enum(["fast", "smart", "deep"]).optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
  maxTokens: z.number().int().positive().optional(),
  schema: z.string().optional(),
});

export interface PromptFile {
  id: PromptId;
  version: number;
  description: string;
  tier: ModelTier;
  effort: Effort;
  maxTokens: number;
  schema?: string;
  /** Markdown body with {{placeholders}}. */
  body: string;
  /** "ask@1": recorded in provenance and the pack lock. */
  ref: string;
}

const cache = new Map<PromptId, PromptFile>();

/** Parse one prompt file. Throws on malformed front-matter (a build error, caught by tests). */
export function parsePromptFile(id: PromptId, raw: string): PromptFile {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw.replace(/\r\n/g, "\n"));
  if (!m) throw new Error(`prompt ${id}: missing front-matter`);
  const fm = FrontMatter.parse(parseYaml(m[1] as string));
  if (fm.id !== id) throw new Error(`prompt ${id}: front-matter id is "${fm.id}"`);
  return {
    id,
    version: fm.version,
    description: fm.description,
    tier: fm.tier ?? "fast",
    effort: fm.effort ?? "low",
    maxTokens: fm.maxTokens ?? 1000,
    ...(fm.schema ? { schema: fm.schema } : {}),
    body: (m[2] as string).trim(),
    ref: `${id}@${fm.version}`,
  };
}

export function prompt(id: PromptId): PromptFile {
  let p = cache.get(id);
  if (!p) {
    p = parsePromptFile(id, RAW[id]);
    cache.set(id, p);
  }
  return p;
}

export function isPromptId(s: string): s is PromptId {
  return (PROMPT_IDS as readonly string[]).includes(s);
}

/** Fill {{name}} placeholders. Unknown placeholders are left visible so tests catch them. */
export function render(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{\{\s*([a-zA-Z][\w]*)\s*\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** The house style with Moss's name filled in (it carries Moss's voice). */
function houseStyle(): string {
  return render(prompt("house-style").body, { crocName: CROC_NAME });
}

/**
 * System blocks in cache order: house style (stable, shared by every generation call), then the
 * stage prompt (stable per stage), then optional volatile context.
 */
export function systemBlocks(
  id: PromptId,
  vars: Record<string, string | number> = {},
  opts: { houseStyle?: boolean; extra?: SystemBlock[] } = {},
): SystemBlock[] {
  const blocks: SystemBlock[] = [];
  if (opts.houseStyle !== false) blocks.push({ text: houseStyle(), cache: "5m" });
  blocks.push({ text: render(prompt(id).body, { crocName: CROC_NAME, ...vars }), cache: "5m" });
  if (opts.extra) blocks.push(...opts.extra);
  return blocks;
}

/** `learncroc prompt <id>`: the exact text an authoring agent should follow. */
export function printablePrompt(id: PromptId, vars: Record<string, string | number> = {}): string {
  const p = prompt(id);
  const head = `# ${p.ref} (tier ${p.tier}, effort ${p.effort}${p.schema ? `, schema ${p.schema}` : ""})\n# ${p.description}\n`;
  const house = id === "house-style" ? "" : `\n${houseStyle()}\n\n---\n`;
  return `${head}${house}\n${render(p.body, { crocName: CROC_NAME, ...vars })}\n`;
}

/** Wrap untrusted data for a prompt (articles, learner text). */
export function tag(name: string, body: string, attrs: Record<string, string> = {}): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/"/g, "&quot;")}"`)
    .join("");
  const safe = body.replaceAll(`</${name}>`, `<\\/${name}>`);
  return `<${name}${a}>\n${safe}\n</${name}>`;
}

/** Machine-readable input block every pipeline call carries (the fake provider reads it too). */
export function inputBlock(value: unknown): string {
  return tag("input", JSON.stringify(value));
}

/** Read the <input> JSON back out of a message (fake provider, tests). */
export function readInputBlock(text: string): unknown {
  const m = /<input>\n([\s\S]*?)\n<\/input>/.exec(text);
  if (!m) return undefined;
  try {
    return JSON.parse((m[1] as string).replaceAll("<\\/input>", "</input>"));
  } catch {
    return undefined;
  }
}
