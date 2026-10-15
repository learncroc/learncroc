/**
 * Draft (LLM-facing) → contract conversions. Ids are assigned here, never by the model, and
 * anything malformed is dropped or reported so the repair round can fix it.
 */
import {
  type ChoiceOption,
  type FallbackInteraction,
  type Flashcard,
  type Interaction,
  type Item,
  ItemId,
  type Misconception,
} from "@learncroc/core";
import { tidyVoice } from "./guards";
import type { ItemDraft, OptionDraft } from "./schemas";
import { cutAtSentence, slug } from "./text";

/** Lint cap on a choice option's why (L002). */
const WHY_WORDS = 25;

export interface ConvertIssue {
  path: string;
  message: string;
}

export function choiceFrom(
  options: (OptionDraft & { why?: string | null })[],
  misIds: Set<string>,
  path: string,
  issues: ConvertIssue[],
): { options: ChoiceOption[]; answer: string } | null {
  const opts = options.filter((o) => o.text.trim().length > 0).slice(0, 5);
  const correct = opts.filter((o) => o.correct);
  if (opts.length < 2) {
    issues.push({ path, message: "a choice needs 2 to 5 options" });
    return null;
  }
  if (correct.length !== 1) {
    issues.push({ path, message: `a choice needs exactly one correct option (found ${correct.length})` });
    return null;
  }
  if (opts.length === 2 && opts.every((o) => /^(true|false|yes|no)\.?$/i.test(o.text.trim()))) {
    issues.push({ path, message: "no True/False items" });
    return null;
  }
  const out: ChoiceOption[] = opts.map((o, i) => ({
    id: `o${i + 1}`,
    text: tidyVoice(o.text),
    ...(!o.correct && o.misconception && misIds.has(o.misconception) ? { misconception: o.misconception } : {}),
    // A miss explains instead of only saying "not quite" (shown on the first wrong attempt).
    ...(!o.correct && o.why?.trim() ? { why: cutAtSentence(tidyVoice(o.why), WHY_WORDS) } : {}),
  }));
  return { options: out, answer: `o${opts.findIndex((o) => o.correct) + 1}` };
}

const clampDifficulty = (d: number): 1 | 2 | 3 | 4 | 5 => Math.min(5, Math.max(1, Math.round(d))) as 1 | 2 | 3 | 4 | 5;

/** A bank item from a draft, or null (with an issue) when it can't be made valid. */
export function itemFromDraft(
  d: ItemDraft & { params?: { vars: { name: string; values: number[] }[]; answerExpr: string } | null },
  id: string,
  misIds: Set<string>,
  path: string,
  issues: ConvertIssue[],
): Item | null {
  const base = {
    id,
    prompt: tidyVoice(d.prompt),
    level: d.level,
    difficulty: clampDifficulty(d.difficulty),
    ...(d.callback ? { callback: true } : {}),
    ...(d.why ? { why: tidyVoice(d.why) } : {}),
    ...(d.feedbackRight ? { feedbackRight: tidyVoice(d.feedbackRight) } : {}),
  };
  switch (d.kind) {
    case "choice": {
      const c = choiceFrom(d.options, misIds, `${path}.options`, issues);
      return c ? { ...base, kind: "choice", options: c.options, answer: c.answer } : null;
    }
    case "numeric": {
      if (d.numericAnswer === null || !Number.isFinite(d.numericAnswer)) {
        issues.push({ path, message: "a numeric item needs numericAnswer" });
        return null;
      }
      const params =
        d.params && d.params.vars.length > 0 && d.params.vars.every((v) => v.values.length > 0)
          ? {
              params: {
                vars: Object.fromEntries(d.params.vars.map((v) => [v.name, v.values])),
                answerExpr: d.params.answerExpr,
              },
            }
          : {};
      return {
        ...base,
        kind: "numeric",
        answer: d.numericAnswer,
        ...(d.tolerance !== null ? { tolerance: Math.abs(d.tolerance) } : {}),
        ...(d.unit ? { unit: d.unit } : {}),
        ...params,
      };
    }
    case "order": {
      const steps = d.steps.map((s) => s.trim()).filter(Boolean);
      if (steps.length < 2 || new Set(steps).size !== steps.length) {
        issues.push({ path, message: "an order item needs 2 or more distinct steps" });
        return null;
      }
      return { ...base, kind: "order", items: steps.map(tidyVoice), answer: steps.map((_, i) => i) };
    }
    case "text": {
      const accept = d.accept.map((a) => a.trim()).filter(Boolean);
      if (accept.length === 0) {
        issues.push({ path, message: "a text item needs at least one accepted answer" });
        return null;
      }
      return { ...base, kind: "text", accept };
    }
  }
}

/** Built-in fallback for a widget or html interaction (a11y path). */
export function fallbackChoice(prompt: string, options: ChoiceOption[], answer: string): FallbackInteraction {
  // The fallback is a plain choice (2–5 options): keep the answer and the first distractors.
  const right = options.find((o) => o.id === answer);
  const kept = right ? [right, ...options.filter((o) => o.id !== answer).slice(0, 4)] : options.slice(0, 5);
  const ordered = options.filter((o) => kept.includes(o));
  return { kind: "choice", prompt, options: ordered.map(({ id, text }) => ({ id, text })), answer };
}

export interface MisconceptionDraft {
  id: string;
  label: string;
  hint: string;
}

/** Misconceptions keyed by a slug of their id; `upstreamFor` may name an ancestor card (never the card itself). */
export function misconceptionsFrom(
  drafts: MisconceptionDraft[],
  upstreamFor: (id: string) => string | undefined = () => undefined,
): Record<string, Misconception> {
  const out: Record<string, Misconception> = {};
  for (const m of drafts.slice(0, 3)) {
    const id = slug(m.id || m.label, 30);
    if (!id || out[id] || !m.label.trim()) continue;
    const upstream = upstreamFor(id);
    out[id] = {
      label: tidyVoice(m.label),
      ...(upstream ? { upstream } : {}),
      hint: cutAtSentence(tidyVoice(m.hint || "Look again at what the card showed."), 30),
    };
  }
  return out;
}

/** Lint caps on the close (L001) and teaser. */
export const CLOSE_WORDS = 60;
export const TEASER_WORDS = 20;

export function cardsFrom(drafts: { front: string; back: string }[], prefix = "c"): Flashcard[] {
  return drafts.slice(0, 6).map((c, i) => ({
    id: `${prefix}${i + 1}`,
    kind: "qa",
    front: tidyVoice(c.front),
    back: tidyVoice(c.back),
  }));
}

/** Keeps generated ids valid ItemIds. */
export function itemId(s: string): string {
  const id = slug(s, 60);
  return ItemId.safeParse(id).success ? id : `i-${id}`;
}

export type { Interaction };
