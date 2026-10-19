/**
 * Moss, the croc: the name, the reply cap, the answer-leak guard and the offline replies built from
 * authored card content. Prompts use `{{crocName}}`; UI strings import CROC_NAME. Pure and browser-safe.
 *
 * Offline replies are deterministic, at most CROC_MAX_WORDS words, and always end with "Try this: …".
 * In hint mode they never use an item's answer, solution, feedbackRight or a close's byGuess text, and
 * every candidate line passes `answerLeak` before it is used.
 */
import { plainText } from "./compile/text";
import { evaluate } from "./expr";
import { stripAccents } from "./grade";
import { instantiateItem, renderTemplate } from "./params";
import type {
  CompiledPack,
  CrocIntent,
  HookInteraction,
  Interaction,
  Item,
  ItemRef,
  Markdown,
  NodeId,
  PackNode,
  Screen,
} from "./schema/index";
import { words } from "./words";

export const CROC_NAME = "Moss";
/** Every croc reply, offline or AI, stays within this many words. */
export const CROC_MAX_WORDS = 75;
/** Said before the hook guess, whatever was asked. */
export const CROC_GUESS_FIRST = "Guess first. I'll explain right after.";

export interface CrocContext {
  pack: CompiledPack;
  nodeId?: NodeId;
  screenId?: string;
  mode: "hint" | "full";
  intent: CrocIntent;
  /** Checkpoint/relight current item (hint mode). Hint mode without an item is the card's hook. */
  item?: { ref: ItemRef; item: Item; vars?: Record<string, number>; hintLevel: 0 | 1 | 2 };
  /** Free-text question (intent "ask"): matched against the card's FAQ. */
  question?: string;
}

export type CrocBasis = "alts" | "faq" | "underTheHood" | "close" | "misconception" | "item-why" | "generic";

// ── answer leaks

export interface LeakResult {
  leak: boolean;
  /** What leaked, for logs ("the correct option …"). */
  what?: string;
}

/** Lowercase, accent-free, punctuation as spaces, single-spaced. Decimal points survive. */
function norm(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[*_`~=#>[\](){}"“”‘’'!?,;:]/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does `haystack` mention `needle` as whole words? Needles under 3 characters never count. */
function mentions(haystack: string, needle: string): boolean {
  const n = norm(needle);
  if (n.length < 3) return false;
  return ` ${norm(haystack)} `.includes(` ${n} `);
}

/** Number tokens in a text ("1,000" → 1000, "0.50" → 0.5). */
export function numbersIn(text: string): number[] {
  return (text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((t) => Number(t.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

/**
 * Does `text` give away the answer of an unanswered interaction? Checks the correct option's text and
 * letter, numeric answers (with parametric vars, within tolerance), accepted text answers, cloze blanks,
 * a full order, match pairs and scalar widget/html solutions.
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
        const re = new RegExp(
          `\\b(option|answer|choice|pick|choose|it'?s)\\s*\\(?(${letter}|${idx + 1})\\)?(?![\\w])`,
          "i",
        );
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
        if (ls && rs && mentions(text, ls) && mentions(text, rs)) hits++;
      }
      return hits >= 2 ? { leak: true, what: "the pairs" } : { leak: false };
    }
    case "widget":
    case "html":
      return solutionLeak(text, it.solution, it.fallback as unknown as Interaction);
    case "explain":
      return { leak: false };
  }
}

/** Widget/html: leak when every scalar of a small solution appears, or the fallback's answer does. */
function solutionLeak(text: string, solution: unknown, fallback: Interaction | undefined): LeakResult {
  if (fallback) {
    const f = answerLeak(text, fallback);
    if (f.leak) return f;
  }
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

// ── text helpers

const plain = (md: string | undefined): string => (md ? plainText(md).replace(/\s+/g, " ").trim() : "");

/** Sentences of a plain text (keeps the end punctuation). */
function sentencesOf(text: string): string[] {
  return (
    text
      .match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? [text]
  );
}

/** At most `max` words, cut at a sentence boundary when one fits, else at a word boundary with "…". */
export function trimToWords(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (words(t) <= max) return t;
  let out = "";
  for (const s of sentencesOf(t)) {
    const next = out ? `${out} ${s}` : s;
    if (words(next) > max) break;
    out = next;
  }
  if (out) return out;
  const parts = t.split(" ");
  return `${parts
    .slice(0, Math.max(1, max))
    .join(" ")
    .replace(/[,;:]$/, "")}…`;
}

/** Make sure a body line ends like a sentence. */
function sentence(s: string): string {
  const t = s.trim().replace(/!+/g, ".");
  if (!t) return t;
  return /[.?…]$/.test(t) ? t : `${t}.`;
}

/** body + "Try this: …", within the word cap (the body is trimmed, never the action). */
function compose(body: string, action: string): string {
  const act = `Try this: ${sentence(action.replace(/^try this:\s*/i, ""))}`;
  const room = Math.max(8, CROC_MAX_WORDS - words(act));
  const b = body.trim() ? sentence(trimToWords(body, room)) : "";
  return b ? `${b} ${act}` : act;
}

const STOP = new Set(
  "the a an and or but of to in on at for with is are was were be been it its this that these those what why how when which who does do did can could would should will i you your my me we our they them their there here than then so if as by from about into not no yes just more most much many some any".split(
    " ",
  ),
);

function contentTokens(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(" ")
      .map((w) => w.replace(/(ing|ed|es|s)$/, ""))
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

// ── offline replies

function nodeOf(c: CrocContext): PackNode | undefined {
  return c.nodeId ? c.pack.nodes[c.nodeId] : undefined;
}

function screenOf(node: PackNode, screenId: string | undefined): Screen | undefined {
  return screenId ? node.screens.find((s) => s.id === screenId) : undefined;
}

/** Misconception hints an interaction or item tags, in option / onWrong order. */
function taggedHints(node: PackNode, ix: Interaction | HookInteraction | Item | undefined): string[] {
  if (!ix) return [];
  const ids =
    ix.kind === "choice"
      ? ix.options.map((o) => o.misconception)
      : Object.values(ix.onWrong ?? {}).map((o) => o.misconception);
  const out: string[] = [];
  for (const m of ids) {
    const h = m ? node.misconceptions[m]?.hint : undefined;
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/** A nudge that says how to approach this kind of question, never what the answer is. */
function kindNudge(ix: Interaction | Item | HookInteraction): string {
  switch (ix.kind) {
    case "choice":
      return "rule out the option that would only be true on the card, not in this situation";
    case "numeric":
    case "estimate":
      return "write the units down first and set up the sum in words before any numbers go in";
    case "order":
      return "fix the step that has to come first, then the one that has to come last";
    case "match":
      return "pair the one you are surest of, then see what that leaves";
    case "text":
    case "cloze":
      return "say the idea in plain words first, then look for the term that names it";
    case "explain":
      return "name the cause first, then say what it changes";
    case "widget":
    case "html":
      return "change one thing at a time and watch what moves";
  }
}

/** Level-1 and level-2 hints for a checkpoint or relight question; each candidate passes answerLeak. */
export function itemHintText(
  node: PackNode,
  item: Item,
  level: 1 | 2,
  vars?: Record<string, number>,
  misconception?: string,
): { text: Markdown; basis: CrocBasis } {
  const shown = instantiateItem(item, vars);
  const safe = (t: string | undefined) => !!t && !answerLeak(plain(t), shown, vars).leak;
  const tagged = taggedHints(node, shown);
  const all = Object.values(node.misconceptions).map((m) => m.hint);
  const chosen = misconception ? node.misconceptions[misconception]?.hint : undefined;
  const firstPool: { t: string | undefined; basis: CrocBasis }[] = [
    { t: chosen, basis: "misconception" },
    ...tagged.map((t) => ({ t, basis: "misconception" as const })),
    { t: item.why ? renderTemplate(item.why, vars ?? {}) : undefined, basis: "item-why" },
    { t: all[0], basis: "misconception" },
  ];
  const first = firstPool.find((x) => safe(x.t));
  if (level === 1 && first) return { text: plain(first.t), basis: first.basis };
  const used = level === 2 && first ? plain(first.t) : undefined;
  const second = [...tagged, ...all].map(plain).find((t) => t !== used && safe(t));
  const idea = safe(node.bigIdea) ? `Think back to ${node.title}: ${sentence(plain(node.bigIdea))}` : "";
  if (level === 2 && second) return { text: second, basis: "misconception" };
  const nudge = `${idea ? `${idea} ` : ""}${capitalise(kindNudge(shown))}.`;
  return { text: nudge, basis: "generic" };
}

const capitalise = (s: string) => (s ? s[0]?.toUpperCase() + s.slice(1) : s);

/** The hook-phase nudge: no answer and nothing from the close. */
function hookReply(node: PackNode | undefined): { text: Markdown; basis: CrocBasis } {
  const ix = node?.hook.interaction;
  const action = !ix
    ? "pick the option that feels right and see"
    : ix.kind === "choice"
      ? "rule out the option you are surest is wrong, then go with your gut"
      : ix.kind === "estimate"
        ? "start from a number you already know and nudge it up or down"
        : ix.kind === "order"
          ? "place the one you are surest of, then fill in around it"
          : "make your best attempt; a wrong guess is the useful kind";
  return {
    text: compose(`${CROC_GUESS_FIRST} A wrong guess is fine here. It makes the answer stick.`, action),
    basis: "generic",
  };
}

function explainDifferently(node: PackNode, screen: Screen | undefined): { body: string; basis: CrocBasis } {
  const alts = screen?.alts ?? node.screens.find((s) => s.alts?.simpler || s.alts?.analogy)?.alts;
  const alt = alts?.simpler ?? alts?.analogy;
  if (alt) return { body: plain(alt), basis: "alts" };
  const hint = Object.values(node.misconceptions)[0]?.hint;
  return {
    body: [plain(node.close.text.replace(/\{guess\}/g, "your guess")), plain(hint)].filter(Boolean).join(" "),
    basis: "close",
  };
}

function example(node: PackNode, screen: Screen | undefined): { body: string; basis: CrocBasis; scenario: boolean } {
  const alt = screen?.alts?.example ?? node.screens.find((s) => s.alts?.example)?.alts?.example;
  if (alt) return { body: plain(alt), basis: "alts", scenario: false };
  const transfer =
    node.items.find((i) => i.level === "transfer" && i.kind !== "explain") ??
    node.items.find((i) => i.level === "transfer");
  if (transfer) {
    const shown = transfer.params ? instantiateItem(transfer, defaultVarsOf(transfer)) : transfer;
    return { body: `Here is a new case. ${plain(shown.prompt)}`, basis: "generic", scenario: true };
  }
  return { ...explainDifferently(node, screen), scenario: false };
}

function defaultVarsOf(item: Item): Record<string, number> | undefined {
  if (!item.params) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(item.params.vars)) out[k] = v[0] as number;
  return out;
}

function deeper(node: PackNode): { body: string; basis: CrocBasis } {
  if (node.underTheHood) return { body: plain(node.underTheHood.body), basis: "underTheHood" };
  const faq = node.faq?.[0];
  if (faq) return { body: `${sentence(plain(faq.q).replace(/\.$/, "?"))} ${plain(faq.a)}`, basis: "faq" };
  return { body: plain(node.bigIdea), basis: "close" };
}

function bestFaq(node: PackNode, question: string | undefined) {
  if (!question || !node.faq?.length) return undefined;
  const q = contentTokens(question);
  let best: { q: string; a: string } | undefined;
  let bestScore = 0;
  for (const f of node.faq) {
    const t = contentTokens(`${f.q} ${f.q} ${f.a}`);
    let score = 0;
    for (const w of q) if (t.has(w)) score++;
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}

/** Map-level reply (no card): what the map is and where to begin. */
function mapReply(pack: CompiledPack): { text: Markdown; basis: CrocBasis } {
  const start = pack.manifest.entry.suggestedStart ?? pack.map.topo.find((id) => pack.nodes[id]);
  const title = start ? pack.map.nodes[start]?.title : undefined;
  const body = `${pack.manifest.title}${pack.manifest.subtitle ? `: ${plain(pack.manifest.subtitle)}` : ""}. Each card is one question and a few short steps; a checkpoint opens each section.`;
  return {
    text: compose(body, title ? `open ${title} and make a guess` : "open any Ready card and make a guess"),
    basis: "generic",
  };
}

/**
 * The offline reply (≤ 75 words, ends with "Try this: …", deterministic).
 * Full mode: explain-differently → alts.simpler/analogy, else the close plus a misconception hint;
 * example → alts.example, else a transfer item's prompt as a new case (never its answer);
 * deeper → underTheHood trimmed at a sentence, else the FAQ; ask → the best FAQ by keyword overlap,
 * else explain-differently. Hint mode: on a checkpoint/relight question, level 1 is the misconception
 * hint (or item.why when it leaks nothing) and level 2 a second hint or a structural nudge; before the
 * hook guess, "Guess first. I'll explain right after." plus a nudge.
 */
export function offlineCrocReply(c: CrocContext): { text: Markdown; basis: CrocBasis } {
  const node = nodeOf(c);
  if (c.mode === "hint") {
    if (c.item) {
      const itemNode = c.pack.nodes[c.item.ref.nodeId] ?? node;
      const level = c.item.hintLevel >= 2 ? 2 : 1;
      if (!itemNode) return { text: compose("", kindNudge(c.item.item)), basis: "generic" };
      const h = itemHintText(itemNode, c.item.item, level, c.item.vars);
      const shownItem = instantiateItem(c.item.item, c.item.vars);
      const action =
        h.basis === "generic"
          ? "say in one line what this question changes from the card"
          : level === 1 && shownItem.kind === "choice"
            ? "check each option against that idea before you commit"
            : kindNudge(shownItem);
      const text = compose(h.text, action);
      // Last line of defence: never let a reply in hint mode carry the answer.
      if (answerLeak(text, instantiateItem(c.item.item, c.item.vars), c.item.vars).leak)
        return { text: compose("", kindNudge(c.item.item)), basis: "generic" };
      return { text, basis: h.basis };
    }
    return hookReply(node);
  }
  if (!node) return mapReply(c.pack);
  const screen = screenOf(node, c.screenId);
  switch (c.intent) {
    case "explain-differently": {
      const r = explainDifferently(node, screen);
      return { text: compose(r.body, "say it back in one sentence with an example of your own"), basis: r.basis };
    }
    case "example": {
      const r = example(node, screen);
      return {
        text: compose(
          r.body,
          r.scenario
            ? "work out what happens here before you look back at the card"
            : "find one more case like this from your own week",
        ),
        basis: r.basis,
      };
    }
    case "deeper": {
      const r = deeper(node);
      return { text: compose(r.body, "find the beat in this card where that shows up"), basis: r.basis };
    }
    case "hint": {
      const ix = screen?.interaction;
      const hints = ix ? taggedHints(node, ix) : [];
      const h = hints[0] ?? Object.values(node.misconceptions)[0]?.hint;
      const safe = h && (!ix || !answerLeak(plain(h), ix).leak) ? plain(h) : "";
      return {
        text: compose(safe, ix ? kindNudge(ix) : "go back one beat and look at what changed"),
        basis: safe ? "misconception" : "generic",
      };
    }
    case "ask": {
      const f = bestFaq(node, c.question);
      if (f)
        return {
          text: compose(plain(f.a), "ask it the other way round and see if the answer still holds"),
          basis: "faq",
        };
      const r = explainDifferently(node, screen);
      return { text: compose(r.body, "say it back in one sentence with an example of your own"), basis: r.basis };
    }
  }
}
