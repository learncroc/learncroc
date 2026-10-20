/**
 * Host-side guards on every model reply. The model is told the rules; these make
 * them true: word caps, an action at the end, no answer leaks before the learner has answered, and
 * Nib replies that introduce no new terms or numbers.
 */
import { type AnswerValue, evaluate, type Interaction, type Item } from "@learncroc/core";
import { cutAtSentence, keywords, norm, sentences, words } from "./text";

export const ASK_MAX_WORDS = 75;
export const SOCRATIC_MAX_WORDS = 40;
export const HINT_MAX_WORDS = 40;
export const NIB_MAX_WORDS = 40;
export const GRADE_FEEDBACK_MAX_WORDS = 30;

export function overCap(text: string, max: number, lang = "en"): boolean {
  return words(text, lang) > max;
}

/** Cut at the last full sentence within the cap (the second-line guard after one regenerate). */
export function enforceCap(text: string, max: number, lang = "en"): string {
  return overCap(text, max, lang) ? cutAtSentence(text, max, lang) : text.trim();
}

const IMPERATIVES =
  /^(try|drag|set|move|sort|type|write|say|pick|choose|tap|press|order|predict|guess|compare|look|find|explain|turn|slide|put|place|check|name|count|estimate|build|play|run|swap|change|think|tell|ask|go|open|hold)\b/i;

/** True when the reply ends in an action: a question, "Try this: …" / "Your move: …", or an imperative. */
export function endsInAction(text: string): boolean {
  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.trim() && !/^CHECK:/i.test(l.trim()));
  const last = lines.at(-1)?.trim() ?? "";
  if (/^(try this|your move)\s*:/i.test(last)) return true;
  const lastSentence = sentences(last).at(-1) ?? last;
  if (/\?\s*["')\]]*$/.test(lastSentence)) return true;
  return IMPERATIVES.test(lastSentence.replace(/^["'(]/, ""));
}

/** Append "Your move: …" when a reply doesn't end in an action. */
export function ensureAction(text: string, move: string): string {
  if (endsInAction(text)) return text.trim();
  return `${text.trim()}\nYour move: ${move.trim()}`;
}

/** Number tokens in a text, normalised ("1,000" → 1000, "0.50" → 0.5). */
export function numbersIn(text: string): number[] {
  return (text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((t) => Number(t.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

const plain = (s: string) =>
  norm(s)
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function mentions(haystack: string, needle: string): boolean {
  const n = plain(needle);
  if (n.length < 3) return false;
  const h = ` ${plain(haystack)} `;
  return h.includes(` ${n} `) || (n.split(" ").length >= 3 && h.includes(n));
}

export interface LeakResult {
  leak: boolean;
  /** What leaked (for logs and the regenerate instruction). */
  what?: string;
}

/**
 * Does `text` give away the answer of an unanswered interaction? Checks the answer string, its
 * normalised forms, numbers, and for choice items the correct option's text and its letter/number.
 */
export function answerLeak(text: string, it: Interaction | Item, vars?: Record<string, number>): LeakResult {
  switch (it.kind) {
    case "choice": {
      const ids = Array.isArray(it.answer) ? it.answer : [it.answer];
      for (const id of ids) {
        const idx = it.options.findIndex((o) => o.id === id);
        const o = it.options[idx];
        if (!o) continue;
        if (mentions(text, o.text)) return { leak: true, what: `the correct option "${o.text}"` };
        const letter = String.fromCharCode(65 + idx);
        const re = new RegExp(`\\b(option|answer|choice|pick|choose|it'?s)\\s*\\(?(${letter}|${idx + 1})\\)?\\b`, "i");
        if (re.test(text)) return { leak: true, what: `option ${letter}` };
      }
      return { leak: false };
    }
    case "numeric":
    case "estimate": {
      let answer = it.answer;
      if (vars && "params" in it && it.params) {
        try {
          answer = evaluate(it.params.answerExpr, vars);
        } catch {
          return { leak: false };
        }
      }
      const tol = it.kind === "numeric" ? (it.tolerance ?? 0) : 0;
      const hit = numbersIn(text).some((n) => Math.abs(n - answer) <= Math.max(tol, Math.abs(answer) * 1e-9));
      return hit ? { leak: true, what: `the number ${answer}` } : { leak: false };
    }
    case "text": {
      const a = it.accept.find((s) => mentions(text, s));
      return a ? { leak: true, what: `"${a}"` } : { leak: false };
    }
    case "cloze": {
      for (const b of Object.values(it.blanks)) {
        const a = b.accept.find((s) => mentions(text, s));
        if (a) return { leak: true, what: `"${a}"` };
      }
      return { leak: false };
    }
    case "order": {
      const seq = it.answer.map((i) => it.items[i] ?? "");
      const h = norm(text);
      const positions = seq.map((s) => h.indexOf(norm(s)));
      const allPresent = positions.length >= 3 && positions.every((p) => p >= 0);
      const inOrder = allPresent && positions.every((p, i) => i === 0 || p > (positions[i - 1] ?? -1));
      return inOrder ? { leak: true, what: "the full order" } : { leak: false };
    }
    case "match": {
      let hits = 0;
      for (const [l, r] of it.answer) {
        const ls = it.left[l];
        const rs = it.right[r];
        if (ls && rs && mentions(text, `${ls} ${rs}`)) hits++;
      }
      return hits >= 2 ? { leak: true, what: "the pairs" } : { leak: false };
    }
    case "widget":
    case "html":
      return solutionLeak(text, it.solution);
    case "explain":
      return { leak: false };
  }
}

/** Widget/html solutions: leak when a scalar solution value (or every value of a small set) appears. */
function solutionLeak(text: string, solution: unknown): LeakResult {
  const scalars: (string | number)[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 3) return;
    if (typeof v === "number" || (typeof v === "string" && v.length >= 3)) scalars.push(v);
    else if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(solution, 0);
  if (scalars.length === 0 || scalars.length > 6) return { leak: false };
  const nums = numbersIn(text);
  const leaked = scalars.every((s) =>
    typeof s === "number" ? nums.some((n) => Math.abs(n - s) < 1e-9) : mentions(text, s),
  );
  return leaked ? { leak: true, what: "the solution" } : { leak: false };
}

/** A short human description of the learner's answer, for prompts ("you picked 'cereal'"). */
export function describeAnswer(answer: AnswerValue, it?: Interaction | Item): string {
  switch (answer.kind) {
    case "choice": {
      const ids = Array.isArray(answer.selected) ? answer.selected : [answer.selected];
      if (it?.kind === "choice") return ids.map((id) => it.options.find((o) => o.id === id)?.text ?? id).join(", ");
      return ids.join(", ");
    }
    case "numeric":
    case "estimate":
      return String(answer.value);
    case "text":
      return answer.value;
    case "order":
      return it?.kind === "order" ? answer.order.map((i) => it.items[i] ?? i).join(" → ") : answer.order.join(", ");
    case "match":
      return answer.pairs.map(([a, b]) => `${a}-${b}`).join(", ");
    case "cloze":
      return Object.values(answer.values).join(", ");
    case "widget":
    case "html":
      return JSON.stringify("value" in answer ? answer.value : null).slice(0, 200);
    case "explain":
      return answer.text ?? answer.choice ?? (answer.tiles ?? []).join(" ");
    case "idk":
      return "no idea yet";
  }
}

export interface NibCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Nib may not introduce new claims: every number must appear in the allowed text, and at most one
 * content word may be new (moths are allowed a little colour).
 */
export function nibReplyAllowed(reply: string, allowedText: string): NibCheck {
  if (overCap(reply, NIB_MAX_WORDS)) return { ok: false, reason: "too long" };
  const allowedNums = new Set(numbersIn(allowedText));
  const newNum = numbersIn(reply).find((n) => !allowedNums.has(n));
  if (newNum !== undefined) return { ok: false, reason: `new number ${newNum}` };
  const allowed = new Set(
    norm(allowedText)
      .replace(/\.(?!\d)/g, " ")
      .split(/\s+/),
  );
  const novel = keywords(reply, 40).filter((w) => w.length >= 6 && !allowed.has(w) && !NIB_VOICE.has(w));
  if (novel.length > 1) return { ok: false, reason: `new terms: ${novel.slice(0, 3).join(", ")}` };
  return { ok: true };
}

const NIB_VOICE = new Set(
  "thought though thinking actually wrong right obviously course really probably understand explain explained mistake confused sorry figured wondering suppose clearly".split(
    " ",
  ),
);

/** Banned phrases in any generated learner-facing text (L012), case-insensitive. */
export const BANNED = [/learning styles?/i, /\bstreaks?\b/i, /\bXP\b/, /great job/i, /\bmost people\b/i, /!!/];

export function bannedPhrase(text: string): string | undefined {
  return BANNED.find((re) => re.test(text))?.source;
}

/** House style for generated learner text: no exclamation marks or emoji, "Lots of people", never "Most people". */
export function tidyVoice(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/!+/g, ".")
    .replace(/\bMost people\b/g, "Lots of people")
    .replace(/\bmost people\b/g, "lots of people")
    .replace(/\.{2,}(?!\.)/g, ".")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
