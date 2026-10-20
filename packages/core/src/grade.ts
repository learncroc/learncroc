/**
 * Grading for every built-in interaction kind, html goals, explain answers
 * (offline keyword matching and self-rating) and delegation to widget specs through the injected
 * WidgetSpecRegistry. Pure and synchronous; the server is the only caller that records results.
 *
 * Learner input never throws: a malformed or mismatched answer grades as incorrect. Pack-side
 * problems (unknown widget, props that fail the widget schema) throw GradeError, which lint (L009,
 * L010) is there to prevent.
 */
import { formatNumber, paramAnswer } from "./params";
import type { WidgetSpecRegistry } from "./ports";
import type {
  AnswerValue,
  ChoiceOption,
  ExplainGrade,
  FallbackInteraction,
  GradeResult,
  HtmlGoal,
  Interaction,
  ItemParams,
  KeyPoint,
  Markdown,
  Normalize,
  OnWrong,
  WidgetRef,
} from "./schema/index";

export class GradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradeError";
  }
}

export interface GradeContext {
  /** Widget specs (required to grade widget interactions and items). */
  widgets?: WidgetSpecRegistry;
  /** Parametric instance for numeric/estimate items with `params`. */
  vars?: Readonly<Record<string, number>>;
  /** BCP-47 language of the answer text (articles, case folding). Default "en". */
  lang?: string;
}

/** Anything gradable with a built-in grader: authored interactions, items, hooks and fallbacks. */
export type Gradable = Interaction | FallbackInteraction;

type AnswerOf<K extends AnswerValue["kind"]> = Extract<AnswerValue, { kind: K }>;

const wrong = (extra: Partial<GradeResult> = {}): GradeResult => ({ correct: false, score: 0, ...extra });
const right = (extra: Partial<GradeResult> = {}): GradeResult => ({ correct: true, score: 1, ...extra });
const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

// ── text normalisation

const ARTICLES: Record<string, string[]> = {
  en: ["a", "an", "the"],
  es: ["el", "la", "los", "las", "un", "una", "unos", "unas", "lo"],
  fr: ["le", "la", "les", "un", "une", "des", "l", "du"],
  de: ["der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines"],
  it: ["il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "l"],
  pt: ["o", "a", "os", "as", "um", "uma", "uns", "umas"],
};

/** Remove combining marks (é → e, ñ → n). */
export function stripAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC");
}

/** Default text normalisation: ["case", "punct", "space"]. */
export const DEFAULT_NORMALIZE: readonly Normalize[] = ["case", "punct", "space"];

/** Normalise a typed answer or an accepted form. Always NFC-normalises and trims. */
export function normalizeText(s: string, norms: readonly Normalize[] = DEFAULT_NORMALIZE, lang = "en"): string {
  let t = s.normalize("NFC");
  if (norms.includes("case")) t = t.toLocaleLowerCase(lang);
  if (norms.includes("accents")) t = stripAccents(t);
  if (norms.includes("punct")) t = t.replace(/[\p{P}]+/gu, " ");
  if (norms.includes("articles")) {
    const list = ARTICLES[lang.slice(0, 2).toLowerCase()] ?? ARTICLES.en ?? [];
    const set = new Set(list);
    t = t
      .split(/(\s+|['’])/)
      .filter((w) => !set.has(w.toLocaleLowerCase(lang)))
      .join("");
    if (!norms.includes("punct")) t = t.replace(/^['’]+/, "");
  }
  if (norms.includes("space") || norms.includes("punct") || norms.includes("articles")) t = t.replace(/\s+/g, " ");
  return t.trim();
}

/** Find an accepted form; `accentSlip` marks a match that only works once accents are ignored. */
function matchAccepted(
  value: string,
  accept: readonly string[],
  norms: readonly Normalize[],
  lang: string,
): { match?: string; accentSlip?: string } {
  const v = normalizeText(value, norms, lang);
  const exact = accept.find((a) => normalizeText(a, norms, lang) === v);
  if (exact !== undefined) return { match: exact };
  if (!norms.includes("accents")) {
    const loose = [...norms, "accents"] as Normalize[];
    const lv = normalizeText(value, loose, lang);
    const slip = accept.find((a) => normalizeText(a, loose, lang) === lv);
    if (slip !== undefined) return { accentSlip: slip };
  }
  return {};
}

// ── onWrong lookup

function onWrongFor(onWrong: Record<string, OnWrong> | undefined, key: string): OnWrong | undefined {
  if (!onWrong) return undefined;
  return Object.hasOwn(onWrong, key) ? onWrong[key] : undefined;
}

function onWrongNumeric(onWrong: Record<string, OnWrong> | undefined, value: number, tol: number): OnWrong | undefined {
  if (!onWrong) return undefined;
  for (const [k, v] of Object.entries(onWrong)) {
    if (k === "default") continue;
    const n = Number(k);
    if (Number.isFinite(n) && Math.abs(n - value) <= Math.max(tol, 1e-9 * Math.max(1, Math.abs(n)))) return v;
  }
  return onWrongFor(onWrong, "default");
}

function withMisconception(r: GradeResult, ow?: OnWrong, fallback?: { misconception?: string; feedback?: string }) {
  const misconception = ow?.misconception ?? fallback?.misconception;
  const feedback = ow?.feedback ?? fallback?.feedback;
  return {
    ...r,
    ...(misconception !== undefined ? { misconception } : {}),
    ...(feedback !== undefined ? { feedback } : {}),
  };
}

// ── per-kind graders

function gradeChoice(ix: Extract<Gradable, { kind: "choice" }>, a: AnswerOf<"choice">): GradeResult {
  const expected = Array.isArray(ix.answer) ? ix.answer : [ix.answer];
  const solution: AnswerValue = { kind: "choice", selected: ix.answer };
  const byId = new Map<string, ChoiceOption>(ix.options.map((o) => [o.id, o]));
  const selected = Array.isArray(a.selected) ? a.selected : [a.selected];
  if (!ix.multi && !Array.isArray(ix.answer)) {
    const pick = selected.length === 1 ? (selected[0] as string) : undefined;
    if (pick !== undefined && pick === ix.answer) return right({ solution, feedback: ix.feedbackRight });
    const opt = pick === undefined ? undefined : byId.get(pick);
    const ow = pick === undefined ? undefined : (onWrongFor(ix.onWrong, pick) ?? onWrongFor(ix.onWrong, "default"));
    return withMisconception(wrong({ solution }), ow, { misconception: opt?.misconception, feedback: opt?.why });
  }
  const want = new Set(expected);
  const got = new Set(selected.filter((s) => byId.has(s)));
  const tp = [...got].filter((s) => want.has(s)).length;
  const fp = got.size - tp;
  const correct = tp === want.size && fp === 0;
  if (correct) return right({ solution, feedback: ix.feedbackRight });
  const firstWrong = [...got].find((s) => !want.has(s));
  const opt = firstWrong === undefined ? undefined : byId.get(firstWrong);
  const ow =
    (firstWrong === undefined ? undefined : onWrongFor(ix.onWrong, firstWrong)) ?? onWrongFor(ix.onWrong, "default");
  return withMisconception(wrong({ score: clamp01((tp - fp) / Math.max(1, want.size)), solution }), ow, {
    misconception: opt?.misconception,
    feedback: opt?.why,
  });
}

/** The numeric answer for an instance (parametric items recompute it from vars). */
function expectedNumber(answer: number, params: ItemParams | undefined, vars: GradeContext["vars"]): number {
  if (!params || !vars) return answer;
  try {
    return paramAnswer(params, vars);
  } catch {
    return answer;
  }
}

function gradeNumeric(
  ix: Extract<Gradable, { kind: "numeric" }>,
  a: AnswerOf<"numeric">,
  ctx: GradeContext,
): GradeResult {
  const params = "params" in ix ? (ix.params as ItemParams | undefined) : undefined;
  const expected = expectedNumber(ix.answer, params, ctx.vars);
  const tol = Math.max(0, ix.tolerance ?? 0);
  const solution: AnswerValue = { kind: "numeric", value: expected };
  if (!Number.isFinite(a.value)) return wrong({ solution });
  const eps = Math.max(tol, 1e-9 * Math.max(1, Math.abs(expected)));
  if (Math.abs(a.value - expected) <= eps) return right({ solution, feedback: ix.feedbackRight });
  return withMisconception(wrong({ solution }), onWrongNumeric(ix.onWrong, a.value, 0));
}

/** The accepted band of an estimate: [low, high]. */
export function estimateBand(answer: number, accept: { factor?: number; abs?: number }): [number, number] {
  let low = answer;
  let high = answer;
  if (accept.factor !== undefined && accept.factor >= 1 && answer > 0) {
    low = Math.min(low, answer / accept.factor);
    high = Math.max(high, answer * accept.factor);
  }
  if (accept.abs !== undefined && accept.abs >= 0) {
    low = Math.min(low, answer - accept.abs);
    high = Math.max(high, answer + accept.abs);
  }
  return [low, high];
}

function gradeEstimate(
  ix: Extract<Gradable, { kind: "estimate" }>,
  a: AnswerOf<"estimate">,
  ctx: GradeContext,
): GradeResult {
  const params = "params" in ix ? (ix.params as ItemParams | undefined) : undefined;
  const expected = expectedNumber(ix.answer, params, ctx.vars);
  const [low, high] = estimateBand(expected, ix.accept);
  const solution: AnswerValue = { kind: "estimate", value: expected, low, high };
  if (!Number.isFinite(a.value)) return wrong({ solution });
  if (a.value >= low - 1e-12 && a.value <= high + 1e-12) return right({ solution, feedback: ix.feedbackRight });
  // Partial credit fades over three band-widths (log distance on log scales).
  let miss: number;
  if (ix.scale.log && a.value > 0 && expected > 0 && low > 0) {
    const width = Math.max(1e-9, Math.log(high / low) / 2 || Math.log(2));
    miss = Math.abs(Math.log(a.value / expected)) / width;
  } else {
    const width = Math.max(1e-9, (high - low) / 2 || Math.abs(expected) * 0.1 || 1);
    miss = Math.abs(a.value - expected) / width;
  }
  const score = clamp01(0.5 * (1 - (miss - 1) / 3));
  return withMisconception(wrong({ score, solution }), onWrongNumeric(ix.onWrong, a.value, 0));
}

function gradeText(ix: Extract<Gradable, { kind: "text" }>, a: AnswerOf<"text">, ctx: GradeContext): GradeResult {
  const lang = ix.lang ?? ctx.lang ?? "en";
  const norms = ix.normalize ?? DEFAULT_NORMALIZE;
  const solution: AnswerValue = { kind: "text", value: ix.accept[0] ?? "" };
  const m = matchAccepted(a.value, ix.accept, norms, lang);
  if (m.match !== undefined) return right({ solution, feedback: ix.feedbackRight });
  if (m.accentSlip !== undefined) return right({ solution, feedback: `Mind the accents: **${m.accentSlip}**.` });
  const key = normalizeText(a.value, norms, lang);
  const ow = Object.entries(ix.onWrong ?? {}).find(
    ([k]) => k !== "default" && normalizeText(k, norms, lang) === key,
  )?.[1];
  return withMisconception(wrong({ solution }), ow ?? onWrongFor(ix.onWrong, "default"));
}

/** Kendall's tau between the expected order and the learner's (1 identical, -1 reversed). */
export function kendallTau(expected: readonly number[], actual: readonly number[]): number {
  const pos = new Map(actual.map((v, i) => [v, i] as const));
  const n = expected.length;
  if (n < 2) return 1;
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = pos.get(expected[i] as number);
      const b = pos.get(expected[j] as number);
      s += a !== undefined && b !== undefined && a < b ? 1 : -1;
    }
  }
  return s / ((n * (n - 1)) / 2);
}

function gradeOrder(ix: Extract<Gradable, { kind: "order" }>, a: AnswerOf<"order">): GradeResult {
  const solution: AnswerValue = { kind: "order", order: ix.answer };
  const isPerm = a.order.length === ix.answer.length && new Set(a.order).size === a.order.length;
  if (isPerm && a.order.every((v, i) => v === ix.answer[i])) return right({ solution, feedback: ix.feedbackRight });
  const score = isPerm ? clamp01((kendallTau(ix.answer, a.order) + 1) / 2) * 0.9 : 0;
  return withMisconception(
    wrong({ score, solution }),
    onWrongFor(ix.onWrong, a.order.join(",")) ?? onWrongFor(ix.onWrong, "default"),
  );
}

function gradeMatch(ix: Extract<Gradable, { kind: "match" }>, a: AnswerOf<"match">): GradeResult {
  const solution: AnswerValue = { kind: "match", pairs: ix.answer };
  const want = new Set(ix.answer.map(([l, r]) => `${l}:${r}`));
  const got = new Set(a.pairs.map(([l, r]) => `${l}:${r}`));
  const tp = [...got].filter((p) => want.has(p)).length;
  const fp = got.size - tp;
  if (tp === want.size && fp === 0) return right({ solution, feedback: ix.feedbackRight });
  return withMisconception(
    wrong({ score: clamp01((tp - fp) / Math.max(1, want.size)), solution }),
    onWrongFor(ix.onWrong, "default"),
  );
}

function gradeCloze(ix: Extract<Gradable, { kind: "cloze" }>, a: AnswerOf<"cloze">, ctx: GradeContext) {
  const lang = ctx.lang ?? "en";
  const norms = ix.normalize ?? DEFAULT_NORMALIZE;
  const keys = Object.keys(ix.blanks);
  const solution: AnswerValue = {
    kind: "cloze",
    values: Object.fromEntries(keys.map((k) => [k, ix.blanks[k]?.accept[0] ?? ""])),
  };
  let ok = 0;
  const slips: string[] = [];
  for (const k of keys) {
    const given = Object.hasOwn(a.values, k) ? a.values[k] : undefined;
    if (given === undefined) continue;
    const m = matchAccepted(given, ix.blanks[k]?.accept ?? [], norms, lang);
    if (m.match !== undefined) ok++;
    else if (m.accentSlip !== undefined) {
      ok++;
      slips.push(m.accentSlip);
    }
  }
  if (ok === keys.length) {
    return right({
      solution,
      feedback: slips.length ? `Mind the accents: **${slips.join("**, **")}**.` : ix.feedbackRight,
    });
  }
  return withMisconception(
    wrong({ score: clamp01(ok / Math.max(1, keys.length)), solution }),
    onWrongFor(ix.onWrong, "default"),
  );
}

// ── html goals and widgets

/** Grade the last value an html interactive reported against its goal (on the host, never in the frame). */
export function gradeHtmlGoal(goal: HtmlGoal, value: string | number | boolean | string[]): GradeResult {
  const solution = htmlGoalSolution(goal);
  switch (goal.kind) {
    case "equals": {
      if (typeof goal.value === "number") {
        const v = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
        const tol = Math.max(goal.tolerance ?? 0, 1e-9 * Math.max(1, Math.abs(goal.value)));
        return Number.isFinite(v) && Math.abs(v - goal.value) <= tol ? right({ solution }) : wrong({ solution });
      }
      if (typeof goal.value === "boolean") return value === goal.value ? right({ solution }) : wrong({ solution });
      return typeof value === "string" && value.trim() === goal.value.trim()
        ? right({ solution })
        : wrong({ solution });
    }
    case "range": {
      const v = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
      return Number.isFinite(v) && v >= goal.min && v <= goal.max ? right({ solution }) : wrong({ solution });
    }
    case "set": {
      const got = new Set(Array.isArray(value) ? value : typeof value === "string" ? [value] : []);
      const want = new Set(goal.values);
      const hits = [...want].filter((v) => got.has(v)).length;
      const extra = [...got].filter((v) => !want.has(v)).length;
      const ok =
        goal.match === "any" ? hits > 0 : goal.match === "all" ? hits === want.size : hits === want.size && extra === 0;
      return ok ? right({ solution }) : wrong({ score: clamp01((hits - extra) / Math.max(1, want.size)), solution });
    }
  }
}

function htmlGoalSolution(goal: HtmlGoal): AnswerValue {
  switch (goal.kind) {
    case "equals":
      return { kind: "html", value: goal.value };
    case "range":
      return { kind: "html", value: (goal.min + goal.max) / 2 };
    case "set":
      return { kind: "html", value: goal.values };
  }
}

/**
 * Grade a widget answer through its spec. Throws GradeError when the widget is unknown or the
 * authored props/goal fail the widget's schema; a malformed learner answer grades as incorrect.
 */
export function gradeWidget(ref: WidgetRef, answer: unknown, widgets: WidgetSpecRegistry | undefined): GradeResult {
  if (!widgets) throw new GradeError(`grading widget "${ref.id}" needs a WidgetSpecRegistry`);
  const spec = widgets.get(ref.id);
  if (!spec) throw new GradeError(`unknown widget "${ref.id}"`);
  if (!spec.goal) throw new GradeError(`widget "${ref.id}" is explore-only and can't be graded`);
  const props = spec.props.safeParse(ref.props);
  if (!props.success) throw new GradeError(`widget "${ref.id}" props are invalid: ${props.error.issues[0]?.message}`);
  const goal = spec.goal.safeParse(ref.goal);
  if (!goal.success) throw new GradeError(`widget "${ref.id}" goal is invalid: ${goal.error.issues[0]?.message}`);
  const parsed = spec.answer.safeParse(answer);
  if (!parsed.success) return wrong();
  try {
    const r = spec.grade({ props: props.data, goal: goal.data, answer: parsed.data });
    return { ...r, score: clamp01(r.score) };
  } catch {
    return wrong();
  }
}

// ── explain items

/** A builder tile for an offline explain answer. */
export interface ExplainTile {
  text: string;
  keyPoint?: string;
  wrong?: boolean;
}

/** What an explain answer is graded against. */
export interface ExplainTarget {
  keyPoints: readonly KeyPoint[];
  minHits: number;
  /** explain items: the built-in fallback used when the learner picks instead of typing. */
  offline?: FallbackInteraction;
  /** Builder tiles (offline). */
  tiles?: readonly ExplainTile[];
  /** "Pick the best of 3"; the choice is the option index as a string. */
  options?: readonly { text: Markdown; correct: boolean; misconception?: string }[];
}

/** One keyword occurrence, with offsets into the ORIGINAL text (for highlighting). */
export interface KeywordMatch {
  keyPoint: string;
  keyword: string;
  start: number;
  end: number;
}

/** Lowercase + accent-free copy of `s` with a map from each output char to its source index. */
function foldWithMap(s: string, lang: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const folded = stripAccents(ch).toLocaleLowerCase(lang);
    for (let k = 0; k < folded.length; k++) map.push(i);
    text += folded;
    i += ch.length;
  }
  map.push(s.length);
  return { text, map };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Inflectional endings a keyword may carry in the learner's text (plurals, tenses, -ly, -er). */
const INFLECTIONS = "s|es|d|ed|ing|er|ers|ly";

/**
 * Offline keyword matching for explain answers (case- and accent-insensitive, whole words where
 * the keyword starts/ends with a letter or digit; a keyword ending in 3+ letters also matches its
 * common inflections, so "blend" hits "blends"). Key points without keywords fall back to their
 * own text's content words (≥ 60% of the words of 4+ letters must appear).
 */
export function matchKeywords(text: string, keyPoints: readonly KeyPoint[], lang = "en"): KeywordMatch[] {
  const { text: folded, map } = foldWithMap(text, lang);
  const out: KeywordMatch[] = [];
  for (const kp of keyPoints) {
    const keywords = kp.keywords?.length ? kp.keywords : contentWords(kp.text, lang);
    const found: KeywordMatch[] = [];
    for (const kw of keywords) {
      const k = stripAccents(kw.trim()).toLocaleLowerCase(lang);
      if (!k) continue;
      const pre = /^[\p{L}\p{N}]/u.test(k) ? "(?<![\\p{L}\\p{N}])" : "";
      // Learners inflect: "blends" hits "blend", "scored" hits "score". Short keywords stay exact.
      const inflect = /\p{L}{3}$/u.test(k) ? `(?:${INFLECTIONS})?` : "";
      const post = /[\p{L}\p{N}]$/u.test(k) ? `${inflect}(?![\\p{L}\\p{N}])` : "";
      const re = new RegExp(`${pre}${escapeRe(k).replace(/\s+/g, "\\s+")}${post}`, "gu");
      for (const m of folded.matchAll(re)) {
        const s = m.index ?? 0;
        found.push({ keyPoint: kp.id, keyword: kw, start: map[s] ?? 0, end: map[s + m[0].length] ?? text.length });
      }
    }
    if (kp.keywords?.length) out.push(...found);
    else {
      const distinct = new Set(found.map((f) => f.keyword));
      if (keywords.length && distinct.size / keywords.length >= 0.6) out.push(...found);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

function contentWords(s: string, lang: string): string[] {
  const seg = new Intl.Segmenter(lang, { granularity: "word" });
  const words = new Set<string>();
  for (const p of seg.segment(s)) if (p.isWordLike && p.segment.length >= 4) words.add(p.segment);
  return [...words];
}

/** Key point ids an explain text hits (offline). */
export function matchedKeyPoints(text: string, keyPoints: readonly KeyPoint[], lang = "en"): string[] {
  const hit = new Set(matchKeywords(text, keyPoints, lang).map((m) => m.keyPoint));
  return keyPoints.filter((k) => hit.has(k.id)).map((k) => k.id);
}

/**
 * Offline explain grading:
 * - `choice`: the option index, or the explain item's offline choice;
 * - `tiles`: correct when the tiles cover ≥ minHits key points and none is wrong;
 * - typed `text` + `selfRating`: correct when self-rated "got-it" and keywords hit ≥ minHits
 *   (score 1 / 0.5 / 0 for got-it / partly / missed). Without a self-rating the keyword hits decide.
 */
export function gradeExplainOffline(target: ExplainTarget, a: AnswerOf<"explain">, lang = "en"): GradeResult {
  const exemplarIds = target.keyPoints.map((k) => k.id);
  if (a.choice !== undefined) {
    if (target.options?.length) {
      const opt = target.options[Number(a.choice)];
      const best = target.options.findIndex((o) => o.correct);
      const solution: AnswerValue = { kind: "explain", choice: String(best) };
      if (opt?.correct) return right({ solution, matched: exemplarIds });
      return wrong({ solution, ...(opt?.misconception ? { misconception: opt.misconception } : {}) });
    }
    if (target.offline?.kind === "choice") return gradeChoice(target.offline, { kind: "choice", selected: a.choice });
    return wrong();
  }
  if (a.tiles !== undefined) {
    const byText = new Map((target.tiles ?? []).map((t) => [t.text, t] as const));
    const picked = a.tiles.map((t) => byText.get(t));
    const hits = new Set(picked.flatMap((t) => (t?.keyPoint ? [t.keyPoint] : [])));
    const bad = picked.filter((t) => t === undefined || t.wrong).length;
    const need = Math.min(target.minHits, target.keyPoints.length);
    const matched = exemplarIds.filter((id) => hits.has(id));
    if (bad === 0 && hits.size >= need) return right({ matched });
    return wrong({ score: clamp01((hits.size - bad) / Math.max(1, need)) * 0.5, matched });
  }
  const matched = matchedKeyPoints(a.text ?? "", target.keyPoints, lang);
  const enough = matched.length >= target.minHits;
  switch (a.selfRating) {
    case "got-it":
      return { correct: enough, score: 1, matched };
    case "partly":
      return { correct: false, score: 0.5, matched };
    case "missed":
      return { correct: false, score: 0, matched };
    default:
      return { correct: enough, score: clamp01(matched.length / Math.max(1, target.minHits)), matched };
  }
}

/** Convert the AI verdict into a GradeResult (score: share of key points hit). */
export function gradeFromExplainGrade(g: ExplainGrade, target: ExplainTarget): GradeResult {
  const hits = new Set(g.hit);
  const matched = target.keyPoints.filter((k) => hits.has(k.id)).map((k) => k.id);
  return {
    correct: g.correct,
    score: g.correct ? 1 : clamp01(matched.length / Math.max(1, target.keyPoints.length)),
    feedback: g.feedback,
    matched,
  };
}

// ── entry point

/**
 * Grade an answer against an interaction (screen, hook, item or fallback). Widget and html
 * interactions also accept answers of their fallback's kind (a11y path); explain accepts answers
 * of its offline fallback's kind. `idk` ("No idea yet") is always incorrect.
 */
export function gradeInteraction(ix: Gradable, answer: AnswerValue, ctx: GradeContext = {}): GradeResult {
  if (answer.kind === "idk") return wrong({ solution: solutionOf(ix) });
  switch (ix.kind) {
    case "choice":
      return answer.kind === "choice" ? gradeChoice(ix, answer) : wrong({ solution: solutionOf(ix) });
    case "numeric":
      return answer.kind === "numeric" ? gradeNumeric(ix, answer, ctx) : wrong({ solution: solutionOf(ix, ctx) });
    case "text":
      return answer.kind === "text" ? gradeText(ix, answer, ctx) : wrong({ solution: solutionOf(ix) });
    case "order":
      return answer.kind === "order" ? gradeOrder(ix, answer) : wrong({ solution: solutionOf(ix) });
    case "estimate":
      return answer.kind === "estimate" ? gradeEstimate(ix, answer, ctx) : wrong({ solution: solutionOf(ix, ctx) });
    case "match":
      return answer.kind === "match" ? gradeMatch(ix, answer) : wrong({ solution: solutionOf(ix) });
    case "cloze":
      return answer.kind === "cloze" ? gradeCloze(ix, answer, ctx) : wrong({ solution: solutionOf(ix) });
    case "widget": {
      if (answer.kind === "widget") {
        const r = gradeWidget(ix.widget, answer.value, ctx.widgets);
        if (r.correct) return { ...r, feedback: r.feedback ?? ix.feedbackRight };
        return withMisconception(r, onWrongFor(ix.onWrong, "default"));
      }
      return answer.kind === ix.fallback.kind ? gradeInteraction(ix.fallback, answer, ctx) : wrong();
    }
    case "html": {
      if (answer.kind === "html") {
        const r = gradeHtmlGoal(ix.goal, answer.value);
        if (r.correct) return { ...r, feedback: ix.feedbackRight };
        return withMisconception(r, onWrongFor(ix.onWrong, "default"));
      }
      return answer.kind === ix.fallback.kind ? gradeInteraction(ix.fallback, answer, ctx) : wrong();
    }
    case "explain": {
      if (answer.kind === "explain") return gradeExplainOffline(ix, answer, ctx.lang);
      return answer.kind === ix.offline.kind ? gradeInteraction(ix.offline, answer, ctx) : wrong();
    }
  }
}

/** The correct answer in AnswerValue shape, for review mode and the level-3 hint. */
export function solutionOf(ix: Gradable, ctx: GradeContext = {}): AnswerValue | undefined {
  switch (ix.kind) {
    case "choice":
      return { kind: "choice", selected: ix.answer };
    case "numeric": {
      const params = "params" in ix ? (ix.params as ItemParams | undefined) : undefined;
      return { kind: "numeric", value: expectedNumber(ix.answer, params, ctx.vars) };
    }
    case "estimate": {
      const params = "params" in ix ? (ix.params as ItemParams | undefined) : undefined;
      const value = expectedNumber(ix.answer, params, ctx.vars);
      const [low, high] = estimateBand(value, ix.accept);
      return { kind: "estimate", value, low, high };
    }
    case "text":
      return { kind: "text", value: ix.accept[0] ?? "" };
    case "order":
      return { kind: "order", order: ix.answer };
    case "match":
      return { kind: "match", pairs: ix.answer };
    case "cloze":
      return {
        kind: "cloze",
        values: Object.fromEntries(Object.entries(ix.blanks).map(([k, b]) => [k, b.accept[0] ?? ""])),
      };
    case "widget":
      return { kind: "widget", value: ix.solution };
    case "html":
      return htmlGoalSolution(ix.goal);
    case "explain":
      return undefined;
  }
}

/** Plain-text rendering of an answer (Field Note "I used to think", the level-3 hint). */
export function answerText(ix: Gradable, answer: AnswerValue | undefined, ctx: GradeContext = {}): string {
  if (!answer) return "";
  switch (answer.kind) {
    case "idk":
      return "No idea yet";
    case "choice": {
      if (ix.kind !== "choice") return String(answer.selected);
      const ids = Array.isArray(answer.selected) ? answer.selected : [answer.selected];
      return ids.map((id) => ix.options.find((o) => o.id === id)?.text ?? id).join(", ");
    }
    case "numeric":
    case "estimate": {
      const unit = "unit" in ix && typeof ix.unit === "string" ? ` ${ix.unit}` : "";
      const scaleUnit = ix.kind === "estimate" && ix.scale.unit ? ` ${ix.scale.unit}` : unit;
      return `${formatNumber(answer.value)}${scaleUnit}`;
    }
    case "text":
      return answer.value;
    case "order":
      return ix.kind === "order" ? answer.order.map((i) => ix.items[i] ?? "?").join(" → ") : answer.order.join(", ");
    case "match":
      return ix.kind === "match"
        ? answer.pairs.map(([l, r]) => `${ix.left[l] ?? "?"} → ${ix.right[r] ?? "?"}`).join("; ")
        : JSON.stringify(answer.pairs);
    case "cloze":
      return Object.values(answer.values).join(", ");
    case "widget": {
      if (ix.kind !== "widget") return "";
      const spec = ctx.widgets?.get(ix.widget.id);
      const props = spec?.props.safeParse(ix.widget.props);
      const parsed = spec?.answer.safeParse(answer.value);
      if (spec && props?.success && parsed?.success) {
        try {
          return spec.toText(props.data, parsed.data);
        } catch {
          return "";
        }
      }
      return "";
    }
    case "html":
      return Array.isArray(answer.value) ? answer.value.join(", ") : String(answer.value);
    case "explain":
      return answer.text ?? "";
  }
}
