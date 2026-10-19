/**
 * Cards: guess keys, the close that names the guess, and the step the client renders.
 *
 * A card is hook (guess, never graded right/wrong in the UI) → 2–3 beats (`screens`) → close → finish.
 * The close text comes only from `resolveClose`, so server and client can never disagree about it.
 * Pure and browser-safe.
 */
import { answerText, type GradeContext } from "./grade";
import { cardAt } from "./run";
import type {
  Card,
  Close,
  CompiledMap,
  Hook,
  HookInteraction,
  Interaction,
  Item,
  Markdown,
  NodeId,
  PackNode,
  RunState,
  Screen,
} from "./schema/index";
import { GUESS_KEY_RE } from "./schema/index";

/** The guess-free keys every hook kind accepts. */
const BASE_KEYS = ["idk", "right", "wrong"] as const;

/** Keys a close variant may use for this hook (L023 checks byGuess against this). */
export function allowedGuessKeys(hook: HookInteraction): Set<string> {
  switch (hook.kind) {
    case "choice":
      return new Set([...hook.options.map((o) => o.id), ...BASE_KEYS]);
    case "estimate":
      return new Set(["under", "over", ...BASE_KEYS]);
    case "order":
    case "widget":
      return new Set(BASE_KEYS);
  }
}

/** Ordered lookup keys for a guess; the first key present in byGuess wins. */
export function guessKeys(hook: HookInteraction, guess: RunState["guess"] | undefined): string[] {
  if (!guess || guess.answer.kind === "idk") return ["idk"];
  const verdict = guess.correct ? "right" : "wrong";
  switch (hook.kind) {
    case "choice": {
      const sel = guess.answer.kind === "choice" ? guess.answer.selected : undefined;
      const single =
        typeof sel === "string" ? sel : Array.isArray(sel) && sel.length === 1 && !hook.multi ? sel[0] : undefined;
      return !hook.multi && single !== undefined ? [single, verdict] : [verdict];
    }
    case "estimate": {
      if (guess.correct) return ["right"];
      const value =
        guess.answer.kind === "estimate" || guess.answer.kind === "numeric" ? guess.answer.value : undefined;
      if (value === undefined) return ["wrong"];
      return [value < hook.answer ? "under" : "over", "wrong"];
    }
    case "order":
    case "widget":
      return [verdict];
  }
}

export interface ResolvedClose {
  /** Markdown with {guess} replaced by *guessText* (or the guess-free default when nothing applies). */
  text: Markdown;
  /** The byGuess key used, or null for close.text. */
  key: string | null;
  /** answerText(hook.interaction, guess.answer), or null (idk / no guess). */
  guessText: string | null;
  teaser: Markdown;
}

const GUESS_RE = /\{guess\}/g;
/** Only reached when lint L023 was ignored (`{guess}` in the text but no `byGuess.idk`). */
const NO_GUESS_TEXT = "no guess";

/**
 * The close for this guess:
 * 1. the first `guessKeys` entry present in `byGuess`, else `close.text`;
 * 2. `{guess}` → `*<guess text>*`;
 * 3. text with `{guess}` but no guess text (idk, no guess, unrenderable widget answer) → `byGuess.idk`.
 */
export function resolveClose(
  node: Pick<PackNode, "hook" | "close">,
  guess: RunState["guess"] | undefined,
  ctx: GradeContext = {},
): ResolvedClose {
  const { close } = node;
  const by = close.byGuess ?? {};
  const hook = node.hook.interaction;
  const guessText = guess && guess.answer.kind !== "idk" ? answerText(hook, guess.answer, ctx) || null : null;

  let key: string | null = null;
  let text = close.text;
  for (const k of guessKeys(hook, guess)) {
    const v = by[k];
    if (v !== undefined) {
      key = k;
      text = v;
      break;
    }
  }
  if (guessText === null && text.includes("{guess}") && by.idk !== undefined) {
    key = "idk";
    text = by.idk;
  }
  const filled = text.replace(GUESS_RE, guessText !== null ? `*${guessText}*` : NO_GUESS_TEXT);
  return { text: filled, key, guessText, teaser: close.teaser };
}

/** The card step the client renders (pure; mirrors the reducer's cursor). */
export type CardStep =
  | { kind: "hook" }
  | { kind: "beat"; index: number; screen: Screen; readOnly: boolean }
  | { kind: "card"; index: number; total: number; card: Card; readOnly: boolean }
  | { kind: "close"; close: ResolvedClose }
  | { kind: "done" };

export function cardStep(run: RunState, node: PackNode, ctx: GradeContext = {}): CardStep {
  if (run.finishedAt !== undefined) return { kind: "done" };
  switch (run.cursor.phase) {
    case "hook":
      return { kind: "hook" };
    case "screen": {
      const index = run.cursor.screen ?? 0;
      const screen = node.screens[index];
      if (!screen) return { kind: "close", close: resolveClose(node, run.guess, ctx) };
      return { kind: "beat", index, screen, readOnly: screen.interaction === undefined };
    }
    case "card": {
      const at = cardAt(run, node);
      if (!at) return { kind: "close", close: resolveClose(node, run.guess, ctx) };
      return { ...at, kind: "card", readOnly: at.card.type !== "try" && at.card.type !== "check" };
    }
    case "close":
      return { kind: "close", close: resolveClose(node, run.guess, ctx) };
    default:
      return { kind: "done" };
  }
}

// ── typed cards → the legacy hook / screens / close

export type LegacyParts = Pick<PackNode, "hook" | "screens" | "close">;

const FILLER_OPTIONS = [
  { id: "hunch", text: "I have a hunch" },
  { id: "idk", text: "No idea yet" },
];

/**
 * A schema-valid hook, 1–3 screens and close derived from typed cards, so producers can fill the
 * required legacy fields of a node that has `cards`. Fields present in `base` are kept as they are.
 * - hook: the first ask card (its hunches as choice options, else a filler choice);
 * - screens: the first ≤ 3 teach/try/check cards (an empty beat when there are none);
 * - close: the takeaway answering the first ask card (else the first takeaway; else the ask prompt).
 */
export function legacyFromCards(cards: readonly Card[], base: Partial<LegacyParts> = {}): LegacyParts {
  const ask = cards.find((c) => c.type === "ask");
  const takeaways = cards.filter((c) => c.type === "takeaway");
  const takeaway = (ask && takeaways.find((t) => t.answers === ask.id)) ?? takeaways[0];

  const hunches = (ask?.hunches ?? []).slice(0, 5).map((h) => ({ id: h.id, text: h.text }));
  const options = hunches.length >= 2 ? hunches : FILLER_OPTIONS;
  const hook: Hook = base.hook ?? {
    ...(ask?.blocks?.length ? { blocks: ask.blocks } : {}),
    interaction: {
      kind: "choice",
      id: ask?.id ?? "ask",
      prompt: ask?.prompt ?? "What do you expect?",
      options,
      answer: options[0]?.id ?? "hunch",
    },
  };

  const screens: Screen[] =
    base.screens ??
    (() => {
      const out: Screen[] = [];
      for (const c of cards) {
        if (out.length >= 3) break;
        const id = `s${out.length + 1}-${c.id}`;
        if (c.type === "teach") {
          const s: Screen = { id, blocks: c.blocks };
          if (c.visual) s.visual = c.visual;
          if (c.alts) s.alts = c.alts;
          if (c.src) s.src = c.src;
          if (c.confidence) s.confidence = c.confidence;
          out.push(s);
        } else if (c.type === "try" || c.type === "check") {
          const s: Screen = { id, blocks: c.blocks ?? [], interaction: c.interaction };
          if (c.type === "try" && c.visual) s.visual = c.visual;
          if (c.reveal) s.reveal = c.reveal;
          out.push(s);
        }
      }
      return out.length > 0 ? out : [{ id: "s1", blocks: [] }];
    })();

  const close: Close = base.close ?? {
    text: takeaway?.text ?? ask?.prompt ?? "",
    ...(takeaway?.byHunch
      ? {
          byGuess: Object.fromEntries(Object.entries(takeaway.byHunch).filter(([k]) => GUESS_KEY_RE.test(k))),
        }
      : {}),
    teaser: takeaway?.teaser ?? "",
  };
  return { hook, screens, close };
}

/** Next card (node-kind, not planned) after `nodeId` in map.topo (reading order), or undefined. */
export function nextCardInOrder(map: Pick<CompiledMap, "nodes" | "topo">, nodeId: NodeId): NodeId | undefined {
  const i = map.topo.indexOf(nodeId);
  if (i < 0) return undefined;
  for (const id of map.topo.slice(i + 1)) {
    const n = map.nodes[id];
    if (n && n.kind === "node" && n.status !== "planned") return id;
  }
  return undefined;
}

/** Misconception ids an interaction or item tags (choice options and onWrong entries). */
export function taggedMisconceptions(ix: Interaction | HookInteraction | Item): Set<string> {
  const out = new Set<string>();
  if (ix.kind === "choice") for (const o of ix.options) if (o.misconception) out.add(o.misconception);
  for (const w of Object.values(ix.onWrong ?? {})) if (w.misconception) out.add(w.misconception);
  return out;
}

/**
 * Where a revisit opens: the first beat whose interaction tags a misconception that one of the missed
 * items tags, else beat 0.
 */
export function revisitScreen(node: Pick<PackNode, "screens" | "items">, missedItemIds: readonly string[]): number {
  const missed = new Set<string>();
  for (const id of missedItemIds) {
    const item = node.items.find((i) => i.id === id);
    if (item) for (const m of taggedMisconceptions(item)) missed.add(m);
  }
  if (missed.size === 0) return 0;
  const i = node.screens.findIndex((s) => {
    if (!s.interaction) return false;
    for (const m of taggedMisconceptions(s.interaction)) if (missed.has(m)) return true;
    return false;
  });
  return i < 0 ? 0 : i;
}
