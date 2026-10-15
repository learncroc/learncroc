/**
 * Card assembly. `assembleStop`: a CardWriteDraft (typed cards, what create-card writes) becomes a
 * PackNode with `cards`, its legacy hook / screens / close filled by core `legacyFromCards`.
 * `assembleCard`: a BeatWriteDraft (what author-node writes) becomes a contract PackNode card:
 * hook (the Ask) → 2–3 beats told by Moss around verbatim passages (Teach, with a Try or, last, the
 * Check) → close (the Takeaway, naming the hunch) → teaser, plus its item bank. Ids are
 * assigned here, widgets are validated by their own specs, words are counted with core `cardWords`
 * and the card is checked with core `cardShapeIssues`, so the pipeline and lint never disagree.
 *
 * Used by the article-map pipeline (profile `pocket`) and `learncroc build` (profile `curated`).
 */
import {
  type Block,
  CARD_CAPS,
  type Card,
  cardShapeIssues,
  cardWords,
  closeTextWords,
  type Interaction,
  type Item,
  type LintProfile,
  legacyFromCards,
  PackNode,
  type Provenance,
  type Screen,
  type Source,
  type Visual,
  words,
} from "@learncroc/core";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import { type ConvertIssue, cardsFrom, choiceFrom, itemFromDraft, misconceptionsFrom } from "../convert";
import { tidyVoice } from "../guards";
import type { Para } from "../inputs";
import type {
  ActionDraft,
  BeatDraft,
  BeatWriteDraft,
  CardWriteDraft,
  HookVariantDraft,
  StopCardDraft,
} from "../schemas";
import { clip, cutAtSentence, sentences, slug } from "../text";

export interface CardAssembly {
  node?: PackNode;
  issues: ConvertIssue[];
  /** Word-cap and lint findings (core lint terms). */
  lint: { errors: number; warnings: number; messages: string[] };
}

export interface CardContext {
  id: string;
  title: string;
  tagline?: string;
  bigIdea: string;
  objectives: string[];
  estMinutes?: number;
  /** The plan's misconceptions (ids the model was told to use); hints come from the draft. */
  misconceptions: { id: string; label: string }[];
  /** Ancestor card a misconception points back to (curated maps). */
  upstreamFor?(misconceptionId: string): string | undefined;
  /** Index of the hook variant to use (the judge's pick). Default: the preferred style, else 0. */
  hook?: number;
  preferStyle?: HookVariantDraft["style"];
  /** Overrides the draft's teaser (the teaser pass). */
  teaser?: string;
  /** Article paragraphs: beat quotes are checked against them word for word. */
  paragraphs?: Para[];
  /** A missing or non-verbatim quote on beat 1 is an issue (so the repair round runs), not a warning. */
  strictQuote?: boolean;
  /** Where quotes are cited from. */
  cite?: { title: string; url?: string };
  /** Ids a beat's `src` may name (paragraph ids or source ids); others are dropped. */
  srcIds?: Set<string>;
  sources: Source[];
  provenance?: Provenance;
  faq?: { q: string; a: string }[];
  profile: LintProfile;
}

const normQuote = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Strips wrapping quote marks and a leading or trailing ellipsis the model adds around a copied phrase. */
export function cleanQuote(q: string): string {
  return q
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, "")
    .trim();
}

/** The paragraph that contains `quote` word for word (case, whitespace and curly quotes aside). */
export function verbatimIn(quote: string, paragraphs: readonly Para[]): Para | undefined {
  const q = normQuote(cleanQuote(quote));
  if (words(q) < 3) return undefined;
  return paragraphs.find((p) => normQuote(p.text).includes(q));
}

/**
 * Snap a verbatim passage to whole sentences of its paragraph and grow it toward `min` words (forward,
 * then back), never past `max`. Returns the passage unchanged when the sentences can't be matched word
 * for word (abbreviations like "e.g." split oddly).
 */
export function wholeSentences(passage: string, para: Para, min: number, max: number): string {
  const ss = sentences(para.text);
  const q = normQuote(passage);
  let a = -1;
  let b = -1;
  // The shortest run of sentences that holds the passage.
  for (let len = 1; len <= ss.length && a < 0; len++) {
    for (let i = 0; i + len <= ss.length; i++) {
      if (normQuote(ss.slice(i, i + len).join(" ")).includes(q)) {
        a = i;
        b = i + len - 1;
        break;
      }
    }
  }
  if (a < 0) return passage;
  const run = () => ss.slice(a, b + 1).join(" ");
  if (words(run()) > max) return passage;
  while (words(run()) < min) {
    const next = ss[b + 1];
    const prev = ss[a - 1];
    if (next && words(run()) + words(next) <= max) b++;
    else if (prev && words(run()) + words(prev) <= max) a--;
    else break;
  }
  const out = run();
  return verbatimIn(out, [para]) ? out : passage;
}

/** Words of choice options longer than 6 words: they count toward their hook or beat (L001). */
function longOptionWords(ix: { kind: string; options?: { text: string }[] }): number {
  if (ix.kind !== "choice" || !ix.options) return 0;
  return ix.options.reduce((a, o) => a + (words(o.text) > 6 ? words(o.text) : 0), 0);
}

export function contrastVisual(d: Pick<BeatDraft, "contrast">): Visual {
  return {
    kind: "widget",
    widget: {
      id: "ab-compare",
      v: 1,
      props: {
        a: { label: tidyVoice(d.contrast.a.label), text: tidyVoice(d.contrast.a.text) },
        b: { label: tidyVoice(d.contrast.b.label), text: tidyVoice(d.contrast.b.text) },
        layout: "side-by-side",
      },
    },
    alt: `${d.contrast.a.label}: ${d.contrast.a.text}. ${d.contrast.b.label}: ${d.contrast.b.text}.`,
  };
}

/** A beat's action as a contract interaction, or null (with an issue). */
export function screenInteraction(
  d: ActionDraft,
  id: string,
  misIds: Set<string>,
  path: string,
  issues: ConvertIssue[],
): Interaction | null {
  const base = {
    id,
    prompt: tidyVoice(d.prompt),
    ...(d.feedbackRight ? { feedbackRight: tidyVoice(d.feedbackRight) } : {}),
  };
  switch (d.kind) {
    case "choice": {
      const c = choiceFrom(d.options, misIds, `${path}.options`, issues);
      // The canvas acts out each answer (L019): a short note pinned on the visual.
      const options = c?.options.map((o) => ({ ...o, visualState: { note: clip(o.text, 8).replace(/…$/, "") } }));
      return c && options ? { ...base, kind: "choice", options, answer: c.answer } : null;
    }
    case "numeric":
      if (d.numericAnswer === null) {
        issues.push({ path, message: "numeric actions need numericAnswer" });
        return null;
      }
      return {
        ...base,
        kind: "numeric",
        answer: d.numericAnswer,
        ...(d.tolerance !== null ? { tolerance: Math.abs(d.tolerance) } : {}),
        ...(d.unit ? { unit: d.unit } : {}),
      };
    case "order": {
      const steps = d.steps.map((s) => tidyVoice(s)).filter(Boolean);
      if (steps.length < 3 || steps.length > 6 || new Set(steps).size !== steps.length) {
        issues.push({ path, message: "order actions need 3 to 6 distinct steps" });
        return null;
      }
      return { ...base, kind: "order", items: steps, answer: steps.map((_, i) => i) };
    }
    case "sort": {
      const buckets = d.buckets.filter((b) => b.label.trim() && b.cards.length > 0).slice(0, 4);
      const cards = buckets.flatMap((b, bi) =>
        b.cards.map((text) => ({ text: tidyVoice(text), bucket: `b${bi + 1}` })),
      );
      const props = {
        mode: "buckets" as const,
        buckets: buckets.map((b, i) => ({ id: `b${i + 1}`, label: tidyVoice(b.label) })),
        cards: cards.map((c, i) => ({ id: `c${i + 1}`, text: c.text })),
      };
      const assignment = Object.fromEntries(cards.map((c, i) => [`c${i + 1}`, c.bucket]));
      const goal = { kind: "buckets" as const, assignment };
      const spec = widgetSpecRegistry.get("sorter");
      const errs = spec ? spec.validate(props, goal) : ["sorter is not available"];
      if (errs.length > 0) {
        issues.push({ path, message: `sort: ${errs.join("; ")}` });
        return null;
      }
      const solution = { assignment };
      if (spec && !spec.grade({ props, goal, answer: solution }).correct) {
        issues.push({ path, message: "sort: the solution does not grade correct" });
        return null;
      }
      const first = props.buckets[0];
      const all = cards.map((c, i) => ({ ...c, id: `c${i + 1}` }));
      // The fallback is a choice of at most 5: up to 3 cards from the first group, the rest from others.
      const yes = all.filter((c) => c.bucket === "b1").slice(0, 3);
      const no = all.filter((c) => c.bucket !== "b1").slice(0, 5 - yes.length);
      const kept = new Set([...yes, ...no].map((c) => c.id));
      return {
        ...base,
        kind: "widget",
        widget: { id: "sorter", v: 1, props, goal },
        solution,
        fallback: {
          kind: "choice",
          prompt: `Which of these belong in "${first?.label ?? "the first group"}"?`,
          options: props.cards.filter((c) => kept.has(c.id)).map((c) => ({ id: c.id, text: c.text })),
          answer: yes.map((c) => c.id),
          multi: true,
        },
      };
    }
  }
}

/** Cut to `max` words at a sentence boundary, noting the cut; "" when nothing fits. */
export function capText(text: string, max: number, where: string, messages: string[]): string {
  if (words(text) <= max) return text;
  messages.push(`${where}: ${words(text)} words (max ${max}), cut`);
  // The cut counts whitespace tokens; lint counts words ("day-to-day" is 3), so trim until it fits.
  let out = cutAtSentence(text, max);
  for (let n = max - 1; words(out) > max && n > 0; n--) out = cutAtSentence(text, n);
  return words(out) <= max ? out : "";
}

/** Hook words that count toward the 30-word cap: the prompt plus options longer than 6 words (L001). */
function hookWords(h: HookVariantDraft): number {
  return words(tidyVoice(h.prompt)) + h.options.reduce((a, o) => a + (words(o.text) > 6 ? words(o.text) : 0), 0);
}

/**
 * The hook variant to use: the judge's pick, else the plan's preferred style, else the first, taking
 * the first of those that fits the hook cap (a variant with long options is skipped while another fits).
 */
export function pickHook(draft: BeatWriteDraft, ctx: Pick<CardContext, "hook" | "preferStyle">): number {
  if (ctx.hook !== undefined && draft.hooks[ctx.hook]) return ctx.hook;
  const styled = ctx.preferStyle ? draft.hooks.findIndex((h) => h.style === ctx.preferStyle) : -1;
  const order = [...new Set([styled, 0, 1, 2].filter((i) => i >= 0 && draft.hooks[i]))];
  return order.find((i) => hookWords(draft.hooks[i] as HookVariantDraft) <= CARD_CAPS.hook) ?? order[0] ?? 0;
}

/** L001b: the card's learner-facing words (core cardWords is the only counter). */
export function learnerWords(n: PackNode): number {
  return cardWords(n, "en").total;
}

/**
 * A beat as Moss tells it: Moss's lead-in, the source's own words (a verbatim passage, cited), Moss's
 * plain-words line and an optional closing line. Every story block is a Moss line. Over the beat's room,
 * the closing line goes first, then the plain-words line is cut, then the passage (at a sentence), then
 * the lead-in. A beat that teaches needs its passage when the source text is known; the card's Check
 * (the last beat, a choice, no passage) only needs its lead-in.
 */
function teachingBlocks(
  d: BeatDraft,
  i: number,
  id: string,
  room: number,
  checkOnly: boolean,
  ctx: CardContext,
  used: string[],
  issues: ConvertIssue[],
  messages: string[],
  path = `beats.${i}`,
  label = `beat ${i + 1}`,
): { blocks: Block[]; warn: boolean } {
  let warn = false;
  let lead = capText(tidyVoice(d.lead), CARD_CAPS.moss, `${id} lead`, messages);
  let plain = capText(tidyVoice(d.plain), CARD_CAPS.plain, `${id} plain`, messages);
  let aside = capText(tidyVoice(d.aside), CARD_CAPS.moss, `${id} aside`, messages);
  let passage = "";
  let para: string | undefined;
  const raw = d.passage ? cleanQuote(d.passage) : "";
  if (raw) {
    const cited = ctx.paragraphs?.filter((p) => d.paras.includes(p.id));
    const pool = cited && cited.length > 0 ? cited : ctx.paragraphs;
    let text = capText(raw, CARD_CAPS.passage, `${id} passage`, messages);
    const match = text && pool ? verbatimIn(text, pool) : undefined;
    if (match) text = wholeSentences(text, match, CARD_CAPS.passageMin, CARD_CAPS.passage);
    const seen = normQuote(text);
    if (pool && !match) messages.push(`${id} passage: not found word for word in the cited paragraphs, dropped`);
    else if (used.some((u) => u.includes(seen) || seen.includes(u)))
      messages.push(`${id} passage: an earlier beat already quotes it, dropped`);
    else if (text && ctx.cite) {
      used.push(seen);
      passage = text;
      para = match?.id ?? d.paras[0] ?? "p1";
      // A whole short paragraph is fine; a short cut from a long one teaches too little.
      if (words(text) < CARD_CAPS.passageMin && (!match || words(match.text) > words(text) + 5))
        messages.push(`${id} passage: ${words(text)} words (aim for ${CARD_CAPS.passageMin}–${CARD_CAPS.passage})`);
    }
  }
  if (!checkOnly && !passage && ctx.paragraphs) {
    const message = `${label} teaches, so it needs a passage of ${CARD_CAPS.passageMin}–${CARD_CAPS.passage} words copied exactly, sentence for sentence, from one of its paras`;
    if (ctx.strictQuote) issues.push({ path: `${path}.passage`, message });
    else {
      warn = true;
      messages.push(`${id}: ${message} (kept Moss's lines)`);
    }
  }
  const total = () => words(lead) + words(passage) + words(plain) + words(aside);
  if (total() > room && aside) {
    messages.push(`${id} aside: no room beside the action, dropped`);
    aside = "";
  }
  if (total() > room && plain) {
    const left = room - words(lead) - words(passage);
    plain = left >= 10 ? capText(plain, left, `${id} plain`, messages) : "";
  }
  if (total() > room && passage) {
    const left = room - words(lead) - words(plain);
    passage = left >= 20 ? capText(passage, left, `${id} passage`, messages) : "";
  }
  if (total() > room) lead = capText(lead, Math.max(0, room - words(passage) - words(plain)), `${id} lead`, messages);
  const blocks: Block[] = [];
  if (lead) blocks.push({ type: "story", text: lead });
  if (passage && ctx.cite)
    blocks.push({
      type: "quote",
      text: passage,
      cite: { title: ctx.cite.title, ...(ctx.cite.url ? { url: ctx.cite.url } : {}), ...(para ? { para } : {}) },
    });
  if (plain) blocks.push({ type: "story", text: plain });
  if (aside) blocks.push({ type: "story", text: aside });
  return { blocks, warn };
}

export function assembleCard(draft: BeatWriteDraft, ctx: CardContext): CardAssembly {
  const issues: ConvertIssue[] = [];
  const messages: string[] = [];
  let warnings = 0;

  // Misconceptions: the plan's ids and labels, the draft's hints.
  const hintFor = (id: string) => draft.misconceptions.find((m) => slug(m.id, 30) === slug(id, 30))?.hint ?? "";
  const misDrafts =
    ctx.misconceptions.length > 0
      ? ctx.misconceptions.map((m) => ({ id: m.id, label: m.label, hint: hintFor(m.id) }))
      : draft.misconceptions;
  const misconceptions = misconceptionsFrom(misDrafts, ctx.upstreamFor);
  const misIds = new Set(Object.keys(misconceptions));
  if (misIds.size === 0) issues.push({ path: "misconceptions", message: "a card needs at least one misconception" });

  // Hook: the chosen variant. Option ids follow the kept options, so closeByGuess indexes map through.
  const hi = pickHook(draft, ctx);
  const variant = draft.hooks[hi];
  if (draft.hooks.length < 3) {
    warnings++;
    messages.push(`${draft.hooks.length} hook variants (3 expected)`);
  }
  let hook: PackNode["hook"] | undefined;
  const byGuess: Record<string, string> = {};
  if (!variant) issues.push({ path: "hooks", message: "no hook variant" });
  else {
    const kept = variant.options.map((o, i) => ({ o, i })).filter((x) => x.o.text.trim().length > 0);
    const idOf = new Map(kept.slice(0, 5).map((x, k) => [x.i, `o${k + 1}`]));
    const choice = choiceFrom(variant.options, misIds, `hooks.${hi}.options`, issues);
    if (choice) {
      const optWords = longOptionWords({ kind: "choice", options: choice.options });
      // A cut-off question is worse than a repair round: an over-long hook is an issue, never trimmed.
      const prompt = tidyVoice(variant.prompt);
      if (words(prompt) + optWords > CARD_CAPS.hook)
        issues.push({
          path: `hooks.${hi}`,
          message: `the hook is ${words(prompt) + optWords} words (max ${CARD_CAPS.hook}): keep the prompt at most 18 words and every option at most 6 words`,
        });
      const setupMax = CARD_CAPS.hook - optWords - words(prompt);
      const setup = setupMax >= 4 ? capText(tidyVoice(variant.setup), setupMax, `hooks.${hi}.setup`, messages) : "";
      const lots = variant.lotsGuess !== null ? idOf.get(variant.lotsGuess) : undefined;
      hook = {
        ...(setup ? { blocks: [{ type: "story" as const, text: setup }] } : {}),
        interaction: {
          id: "hook",
          kind: "choice",
          prompt,
          options: choice.options,
          answer: choice.answer,
          confidence: true,
          shuffle: true,
        },
        ...(lots && lots !== choice.answer ? { lotsGuess: lots } : {}),
        style: variant.style,
      };
      for (const g of variant.closeByGuess) {
        const key = idOf.get(g.option);
        const text = capText(tidyVoice(g.text), CARD_CAPS.close, `close.byGuess.${key}`, messages);
        if (key && text) byGuess[key] = text;
      }
      // Every wrong guess is named (pocket: L023 error); a missing one gets a plain line in front of the close.
      const closeText = tidyVoice(draft.close.text);
      for (const o of choice.options) {
        if (o.id === choice.answer || byGuess[o.id]) continue;
        const named = capText(
          `"${o.text}" is a fair guess, and lots of people make it. ${closeText}`,
          CARD_CAPS.close,
          `close.byGuess.${o.id}`,
          messages,
        );
        if (named) byGuess[o.id] = named;
        warnings++;
        messages.push(`close.byGuess.${o.id}: missing, written from the close`);
      }
    }
  }
  const idk = capText(tidyVoice(draft.close.idk), CARD_CAPS.close, "close.idk", messages);
  if (idk) byGuess.idk = idk;

  // Beats.
  const screens: Screen[] = [];
  const usedPassages: string[] = [];
  draft.beats.slice(0, 3).forEach((d, i) => {
    const id = `s${i + 1}`;
    let interaction: Interaction | undefined;
    if (d.action) {
      const ix = screenInteraction(d.action, `${id}-do`, misIds, `beats.${i}.action`, issues);
      if (!ix) return;
      interaction = { ...ix, prompt: capText(ix.prompt, CARD_CAPS.prompt, `${id} prompt`, messages) };
    }
    const reveal = d.action ? capText(tidyVoice(d.action.reveal), 30, `${id} reveal`, messages) : "";
    if (d.action && !reveal) issues.push({ path: `beats.${i}.action.reveal`, message: "an action needs a reveal" });
    const room =
      CARD_CAPS.beat - (interaction ? words(interaction.prompt) + longOptionWords(interaction) : 0) - words(reveal);
    // The card's Check (the last beat, a choice) may go without a passage; every other beat teaches.
    const checkOnly = i === Math.min(draft.beats.length, 3) - 1 && d.action?.kind === "choice";
    const teach = teachingBlocks(d, i, id, room, checkOnly, ctx, usedPassages, issues, messages);
    if (teach.warn) warnings++;
    const src = d.paras.filter((p) => !ctx.srcIds || ctx.srcIds.has(p));
    const idea = tidyVoice(d.idea);
    screens.push({
      id,
      ...(idea ? { newIdea: clip(idea, 15).replace(/…$/, "") } : {}),
      blocks: teach.blocks,
      ...(interaction ? { interaction, reveal: { text: reveal } } : {}),
      visual: contrastVisual(d),
      ...(src.length > 0 ? { src, confidence: "sourced" as const } : { confidence: "model" as const }),
    });
  });
  if (screens.length < 2) issues.push({ path: "beats", message: `need 2 or 3 valid beats (got ${screens.length})` });
  if (screens.length > 0 && !screens.some((s) => s.interaction)) {
    issues.push({ path: "beats", message: "at least one beat needs an action" });
  }

  // Item bank: ≥ 3 transfer items (checkpoints draw from them), promoted from the end when short.
  const items: Item[] = [];
  draft.items.forEach((d, i) => {
    const it = itemFromDraft(d, `q${i + 1}`, misIds, `items.${i}`, issues);
    if (it)
      items.push({ ...it, prompt: capText(it.prompt, CARD_CAPS.prompt, `q${i + 1} prompt`, messages) || it.prompt });
  });
  for (let i = items.length - 1, n = items.filter((it) => it.level === "transfer").length; i >= 0 && n < 3; i--) {
    const it = items[i];
    if (it && it.level !== "transfer") {
      items[i] = { ...it, level: "transfer" };
      n++;
    }
  }

  const closeText = capText(tidyVoice(draft.close.text), CARD_CAPS.close, "close.text", messages);
  if (!closeText) issues.push({ path: "close.text", message: "the close is empty or doesn't fit 60 words" });
  const teaserRaw = tidyVoice(ctx.teaser ?? draft.teaser);
  const teaser = capText(teaserRaw, CARD_CAPS.teaser, "teaser", messages) || clip(teaserRaw, CARD_CAPS.teaser);
  const flashcards = cardsFrom(draft.flashcards.slice(0, 3));
  // Side questions: Moss's answers, each within the FAQ cap.
  const faq = (ctx.faq?.length ? ctx.faq : (draft.faq ?? []))
    .slice(0, 3)
    .map((f) => ({ q: tidyVoice(f.q), a: capText(tidyVoice(f.a), 60, "faq", messages) }))
    .filter((f) => f.q && f.a);

  if (!hook || issues.length > 0) return { issues, lint: { errors: issues.length, warnings, messages } };

  const candidate = {
    id: ctx.id,
    title: ctx.title,
    ...(ctx.tagline ? { tagline: ctx.tagline } : {}),
    estMinutes: ctx.estMinutes ?? 3,
    bigIdea: ctx.bigIdea,
    objectives: ctx.objectives.length > 0 ? ctx.objectives : [ctx.bigIdea],
    misconceptions,
    hook,
    screens,
    close: { text: closeText, ...(Object.keys(byGuess).length > 0 ? { byGuess } : {}), teaser },
    items,
    ...(flashcards.length > 0 ? { flashcards } : {}),
    ...(faq.length ? { faq } : {}),
    sources: ctx.sources,
    status: "draft" as const,
    ...(ctx.provenance ? { provenance: ctx.provenance } : {}),
  };
  const parsed = PackNode.safeParse(candidate);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) issues.push({ path: i.path.join("."), message: i.message });
    return { issues, lint: { errors: issues.length, warnings, messages } };
  }
  const node = parsed.data;

  // Core card-shape lint is the gate: its errors go to the repair round, its warnings are noted.
  for (const s of cardShapeIssues(node.id, node, ctx.profile, "en")) {
    const where = s.path.join(".");
    if (s.severity === "error") issues.push({ path: where || s.rule, message: `${s.rule}: ${s.message}` });
    else {
      warnings++;
      messages.push(`${s.rule} ${where}: ${s.message}`);
    }
  }
  if (issues.length > 0) return { issues, lint: { errors: issues.length, warnings, messages } };
  return { node, issues, lint: { errors: 0, warnings, messages } };
}

/** Words of the longest close variant (for the judge's input and tests). */
export function longestClose(node: PackNode): number {
  return Math.max(
    closeTextWords(node.close.text, "en"),
    ...Object.values(node.close.byGuess ?? {}).map((t) => closeTextWords(t, "en")),
  );
}

// ── typed cards (create-card)

/** Structure rules of a stop's card list; each broken rule is an issue (so the repair round runs). */
export function stopShapeIssues(types: readonly StopCardDraft["type"][]): ConvertIssue[] {
  const out: ConvertIssue[] = [];
  const n = (t: StopCardDraft["type"]) => types.filter((x) => x === t).length;
  if (types.length < 4 || types.length > 10)
    out.push({ path: "cards", message: `a stop has 5 to 8 cards (got ${types.length})` });
  if (types[0] !== "ask") out.push({ path: "cards.0", message: "the first card is the ask" });
  if (types.at(-1) !== "takeaway")
    out.push({ path: `cards.${types.length - 1}`, message: "the last card is the takeaway" });
  if (n("ask") !== 1) out.push({ path: "cards", message: `exactly one ask card (got ${n("ask")})` });
  if (n("takeaway") !== 1) out.push({ path: "cards", message: `exactly one takeaway card (got ${n("takeaway")})` });
  if (n("check") !== 1) out.push({ path: "cards", message: `exactly one check card (got ${n("check")})` });
  const firstTeach = types.indexOf("teach");
  const firstGraded = types.findIndex((t) => t === "try" || t === "check");
  if (firstTeach < 0) out.push({ path: "cards", message: "a stop needs at least one teach card" });
  else if (firstGraded >= 0 && firstGraded < firstTeach)
    out.push({ path: `cards.${firstGraded}`, message: "teach before any try or check" });
  for (let i = 2; i < types.length; i++)
    if (types[i] === "teach" && types[i - 1] === "teach" && types[i - 2] === "teach")
      out.push({ path: `cards.${i}`, message: "never more than 2 teach cards in a row" });
  const graded = types.filter((t) => t === "try" || t === "check");
  if (graded.length > 0 && graded.at(-1) !== "check")
    out.push({ path: "cards", message: "the last graded card is the check" });
  return out;
}

/** Misconceptions: the plan's ids and labels, the draft's hints. */
function misconceptionsOf(draftMis: CardWriteDraft["misconceptions"], ctx: CardContext) {
  const hintFor = (id: string) => draftMis.find((m) => slug(m.id, 30) === slug(id, 30))?.hint ?? "";
  const misDrafts =
    ctx.misconceptions.length > 0
      ? ctx.misconceptions.map((m) => ({ id: m.id, label: m.label, hint: hintFor(m.id) }))
      : draftMis;
  return misconceptionsFrom(misDrafts, ctx.upstreamFor);
}

/**
 * A stop as typed cards: Moss's lines are `say` blocks, teach cards quote the article word for word
 * (the same verbatim check as beats), the check is a one-shot choice with a why on every wrong option,
 * and the takeaway answers the ask and names each hunch. The legacy hook / screens / close are derived
 * with core `legacyFromCards`.
 */
export function assembleStop(draft: CardWriteDraft, ctx: CardContext): CardAssembly {
  const issues: ConvertIssue[] = [];
  const messages: string[] = [];
  let warnings = 0;

  const misconceptions = misconceptionsOf(draft.misconceptions, ctx);
  const misIds = new Set(Object.keys(misconceptions));
  if (misIds.size === 0) issues.push({ path: "misconceptions", message: "a stop needs at least one misconception" });

  const raw = draft.cards.slice(0, 10);
  issues.push(...stopShapeIssues(raw.map((c) => c.type)));

  const sayBlocks = (lines: string[], id: string): Block[] =>
    lines
      .map((t, k) => capText(tidyVoice(t), CARD_CAPS.moss, `${id} say.${k}`, messages))
      .filter(Boolean)
      .map((text) => ({ type: "say" as const, text }));
  const counts = new Map<string, number>();
  const idFor = (type: string) => {
    const k = (counts.get(type) ?? 0) + 1;
    counts.set(type, k);
    return type === "ask" || type === "check" || type === "takeaway"
      ? k === 1
        ? type
        : `${type}-${k}`
      : `${type}-${k}`;
  };
  const teaserRaw = tidyVoice(ctx.teaser ?? draft.teaser);
  const teaser = capText(teaserRaw, CARD_CAPS.teaser, "teaser", messages) || clip(teaserRaw, CARD_CAPS.teaser);

  const cards: Card[] = [];
  const used: string[] = [];
  let askId: string | undefined;
  let hunches: { id: string; text: string }[] = [];
  let teachN = 0;
  raw.forEach((d, i) => {
    const path = `cards.${i}`;
    const id = idFor(d.type);
    switch (d.type) {
      case "ask": {
        const prompt = tidyVoice(d.prompt);
        if (!prompt) issues.push({ path: `${path}.prompt`, message: "an ask card needs its question" });
        else if (words(prompt) > CARD_CAPS.hook)
          issues.push({ path: `${path}.prompt`, message: `the question is ${words(prompt)} words (max 18)` });
        const hs = d.hunches
          .map((t) => tidyVoice(t))
          .filter(Boolean)
          .slice(0, 5)
          .map((text, k) => ({ id: `h${k + 1}`, text: clip(text, 8).replace(/…$/, "") }));
        if (!askId) {
          askId = id;
          hunches = hs.length >= 2 ? hs : [];
        }
        const blocks = sayBlocks(d.say.slice(0, 1), id);
        cards.push({
          type: "ask",
          id,
          ...(blocks.length ? { blocks } : {}),
          prompt,
          ...(hs.length >= 2 ? { hunches: hs } : {}),
        });
        return;
      }
      case "teach": {
        teachN++;
        const beat: BeatDraft = {
          idea: d.idea,
          lead: d.say.join(" "),
          passage: d.passage,
          plain: d.plain,
          aside: "",
          paras: d.paras,
          action: null,
          figure: d.figure ?? { description: "", labels: [] },
          contrast: d.contrast ?? { a: { label: "", text: "" }, b: { label: "", text: "" } },
        };
        const t = teachingBlocks(
          beat,
          i,
          id,
          CARD_CAPS.beat,
          false,
          ctx,
          used,
          issues,
          messages,
          path,
          `teach card ${teachN}`,
        );
        if (t.warn) warnings++;
        const blocks: Block[] = t.blocks.map((b) => (b.type === "story" ? { type: "say", text: b.text } : b));
        const src = d.paras.filter((p) => !ctx.srcIds || ctx.srcIds.has(p));
        cards.push({
          type: "teach",
          id,
          blocks,
          ...(d.contrast?.a.label.trim() && d.contrast.b.label.trim()
            ? { visual: contrastVisual({ contrast: d.contrast }) }
            : {}),
          ...(src.length > 0 ? { src, confidence: "sourced" as const } : { confidence: "model" as const }),
        });
        return;
      }
      case "try":
      case "check": {
        if (!d.action) {
          issues.push({ path: `${path}.action`, message: `a ${d.type} card needs an action` });
          return;
        }
        if (d.type === "check" && d.action.kind !== "choice")
          issues.push({ path: `${path}.action.kind`, message: "the check is a choice" });
        const ix = screenInteraction(d.action, `${id}-do`, misIds, `${path}.action`, issues);
        if (!ix) return;
        const interaction = { ...ix, prompt: capText(ix.prompt, CARD_CAPS.prompt, `${id} prompt`, messages) };
        if (d.type === "check" && interaction.kind === "choice") {
          const missing = interaction.options.filter((o) => o.id !== interaction.answer && !o.why);
          if (missing.length > 0)
            issues.push({ path: `${path}.action.options`, message: "every wrong option of the check needs a why" });
        }
        const reveal = capText(tidyVoice(d.action.reveal), 30, `${id} reveal`, messages);
        if (!reveal) issues.push({ path: `${path}.action.reveal`, message: "an action needs a reveal" });
        const blocks = sayBlocks(d.say.slice(0, 2), id);
        if (d.type === "try")
          cards.push({
            type: "try",
            id,
            ...(blocks.length ? { blocks } : {}),
            ...(d.contrast?.a.label.trim() && d.contrast.b.label.trim()
              ? { visual: contrastVisual({ contrast: d.contrast }) }
              : {}),
            interaction,
            ...(reveal ? { reveal: { text: reveal } } : {}),
          });
        else
          cards.push({
            type: "check",
            id,
            ...(blocks.length ? { blocks } : {}),
            interaction,
            ...(reveal ? { reveal: { text: reveal } } : {}),
          });
        return;
      }
      case "takeaway": {
        const text = capText(tidyVoice(d.text), CARD_CAPS.close, `${id} text`, messages);
        if (!text) issues.push({ path: `${path}.text`, message: "the takeaway is empty or doesn't fit 60 words" });
        const byHunch: Record<string, string> = {};
        for (const g of d.byHunch) {
          const h = hunches[g.hunch];
          const line = capText(tidyVoice(g.text), CARD_CAPS.close, `${id} byHunch.${g.hunch}`, messages);
          if (h && line) byHunch[h.id] = line;
        }
        for (const h of hunches) {
          if (byHunch[h.id] || !text) continue;
          const named = capText(
            `"${h.text}" is a fair hunch. ${text}`,
            CARD_CAPS.close,
            `${id} byHunch.${h.id}`,
            messages,
          );
          if (named) byHunch[h.id] = named;
          warnings++;
          messages.push(`${id} byHunch.${h.id}: missing, written from the takeaway`);
        }
        const idk = capText(tidyVoice(d.idk), CARD_CAPS.close, `${id} idk`, messages);
        if (idk) byHunch.idk = idk;
        cards.push({
          type: "takeaway",
          id,
          ...(askId ? { answers: askId } : {}),
          text,
          ...(Object.keys(byHunch).length ? { byHunch } : {}),
          ...(teaser ? { teaser } : {}),
        });
        return;
      }
    }
  });

  // Item bank: ≥ 3 transfer items (checkpoints draw from them), promoted from the end when short.
  const items: Item[] = [];
  draft.items.forEach((d, i) => {
    const it = itemFromDraft(d, `q${i + 1}`, misIds, `items.${i}`, issues);
    if (it)
      items.push({ ...it, prompt: capText(it.prompt, CARD_CAPS.prompt, `q${i + 1} prompt`, messages) || it.prompt });
  });
  for (let i = items.length - 1, n = items.filter((it) => it.level === "transfer").length; i >= 0 && n < 3; i--) {
    const it = items[i];
    if (it && it.level !== "transfer") {
      items[i] = { ...it, level: "transfer" };
      n++;
    }
  }
  const flashcards = cardsFrom(draft.flashcards.slice(0, 3));
  const faq = (ctx.faq?.length ? ctx.faq : (draft.faq ?? []))
    .slice(0, 3)
    .map((f) => ({ q: tidyVoice(f.q), a: capText(tidyVoice(f.a), 60, "faq", messages) }))
    .filter((f) => f.q && f.a);

  if (issues.length > 0) return { issues, lint: { errors: issues.length, warnings, messages } };

  const legacy = legacyFromCards(cards);
  const candidate = {
    id: ctx.id,
    title: ctx.title,
    ...(ctx.tagline ? { tagline: ctx.tagline } : {}),
    estMinutes: ctx.estMinutes ?? 3,
    bigIdea: ctx.bigIdea,
    objectives: ctx.objectives.length > 0 ? ctx.objectives : [ctx.bigIdea],
    misconceptions,
    ...legacy,
    cards,
    items,
    ...(flashcards.length > 0 ? { flashcards } : {}),
    ...(faq.length ? { faq } : {}),
    sources: ctx.sources,
    status: "draft" as const,
    ...(ctx.provenance ? { provenance: ctx.provenance } : {}),
  };
  const parsed = PackNode.safeParse(candidate);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) issues.push({ path: i.path.join("."), message: i.message });
    return { issues, lint: { errors: issues.length, warnings, messages } };
  }
  const node = parsed.data;
  const total = cardWords(node, "en").total;
  if (total > 800) {
    warnings++;
    messages.push(`${total} learner-facing words (max 800)`);
  }
  return { node, issues, lint: { errors: 0, warnings, messages } };
}

/** Sets a stop's teaser on the close and on its takeaway card (when it has typed cards). */
export function setTeaser(node: PackNode, teaser: string): void {
  node.close.teaser = teaser;
  for (const c of node.cards ?? []) if (c.type === "takeaway") c.teaser = teaser;
}
