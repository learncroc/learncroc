/**
 * Card-shape and gate-wiring checks: the revision-3 structure every pack must have. One implementation,
 * shared by `learncroc lint` (L001, L001b, L005, L006, L011, L023, L024, L025) and `bun run validate:pack`,
 * so the two can never disagree about a card's shape.
 *
 * Cards: word caps (cardWords is the only counter), 2–3 beats with ≥ 1 real action (not a quiz on the
 * beat's own text), interaction ⇔ reveal, a hook that doesn't give the close away, a close that answers
 * the hook and names the guess, and an item bank with enough new situations for a checkpoint.
 * Gates: covers name playable ancestor cards, every playable card is covered, the map ends in a
 * checkpoint, cards per checkpoint within the profile's range, enough fresh items for a retry, reading
 * order, and sampler planned entries only beyond the final checkpoint.
 */
import { allowedGuessKeys } from "../card";
import { checkpointCovers, checkpointPool, defaultCheckpointSize, earlierCards, gateGraph } from "../checkpoint";
import { cardWords, closeTextWords, plainText } from "../compile/text";
import { ancestors, childrenOf, dagOf, descendants, findCycle } from "../dag";
import type { Block, Item, LintProfile, MapFile, PackNode, Screen } from "../schema/index";
import { words } from "../words";
import { containsRun, contentWords, longestSharedRun, numbersIn, sharedRunText, tokens } from "./overlap";
import { PROFILES, type RuleId } from "./rules";

export interface ShapeIssue {
  rule: RuleId;
  severity: "error" | "warn";
  file: string;
  path: (string | number)[];
  message: string;
}

/** Word caps per card part (L001) and the card length band (L001b; soft band for curated and sampler). */
export const CARD_CAPS = {
  hook: 30,
  /** A beat as Moss tells it: lead-in + verbatim passage + plain words (+ closing line) + its action. */
  beat: 300,
  close: 60,
  teaser: 20,
  /** Beat and item prompts. */
  prompt: 40,
  reveal: 50,
  /** A source passage quoted in a beat (verbatim), and the length to aim for. */
  passage: 120,
  passageMin: 40,
  /** One Moss line (lead-in, closing line). */
  moss: 35,
  /** Moss's plain-words line after a passage. */
  plain: 80,
  min: 100,
  max: 800,
  softMin: 250,
  softMax: 650,
} as const;

/**
 * The map's first card on article maps (teach-first, phase 1): the article's opening and the questions
 * the map answers. It teaches nothing new and grades nothing, so it has its own small shape check.
 */
export const INTRO_NODE_ID = "intro";

/** A beat action "answerable by quoting the beat" shares a run of this many words with its blocks (L006). */
export const QUOTE_RUN = 6;
/** A transfer item "reads like recall" when its prompt shares a run of this many words with the card (L011). */
export const RECALL_RUN = 8;

type Sev = "error" | "warn" | null;
type Path = (string | number)[];

const strict = (profile: LintProfile) => profile === "curated" || profile === "sampler";

/** Readable text of story, callout and quote blocks (the explanation a beat action could quote). */
function blockText(blocks: readonly Block[] | undefined): string {
  return (blocks ?? [])
    .map((b) => (b.type === "story" || b.type === "callout" || b.type === "quote" ? b.text : ""))
    .join(" ");
}

// ── interactivity (L006)

const MANIPULATIONS = new Set(["widget", "html", "order", "match", "estimate"]);

/** A beat whose action is a manipulation: widget, html, order, match, estimate, or numeric with a canvas. */
export function isManipulation(node: PackNode, s: Screen): boolean {
  const ix = s.interaction;
  if (!ix) return false;
  if (MANIPULATIONS.has(ix.kind)) return true;
  return ix.kind === "numeric" && !!(s.visual || node.visual);
}

/** The correct answer of a choice, text or cloze action as text (empty for other kinds). */
function answerTextOf(ix: NonNullable<Screen["interaction"]> | Item): string {
  switch (ix.kind) {
    case "choice": {
      const right = new Set(Array.isArray(ix.answer) ? ix.answer : [ix.answer]);
      return ix.options
        .filter((o) => right.has(o.id))
        .map((o) => o.text)
        .join(" ");
    }
    case "text":
      return ix.accept[0] ?? "";
    case "cloze":
      return ix.text.replace(/\{\{([^}]+)\}\}/g, (_, k: string) => ix.blanks[k.trim()]?.accept[0] ?? " ");
    default:
      return "";
  }
}

/**
 * A choice, text or cloze action that can be answered by quoting its own beat's blocks: the prompt with
 * its answer shares a run of ≥ QUOTE_RUN normalised words with the blocks, and the answer is in them.
 * A "pick what happens next" choice asked before the explanation (empty blocks) never quotes.
 */
export function quotesItsBeat(s: Screen): boolean {
  const ix = s.interaction;
  if (!ix || (ix.kind !== "choice" && ix.kind !== "text" && ix.kind !== "cloze")) return false;
  const blocks = tokens(blockText(s.blocks));
  if (!blocks.length) return false;
  const answer = tokens(answerTextOf(ix));
  if (ix.kind === "cloze") return longestSharedRun(answer, blocks) >= QUOTE_RUN;
  if (!answer.length || !containsRun(blocks, answer)) return false;
  return longestSharedRun([...tokens(ix.prompt), ...answer], blocks) >= QUOTE_RUN;
}

// ── new situations (L011, L024)

/** Token lists of everything the card itself says: hook, beats, close. */
function cardTexts(node: PackNode): string[][] {
  const out = [tokens(blockText(node.hook.blocks)), tokens(node.hook.interaction.prompt)];
  for (const s of node.screens) {
    out.push(tokens(blockText(s.blocks)));
    if (s.interaction) out.push(tokens(s.interaction.prompt));
    if (s.reveal) out.push(tokens(s.reveal.text));
  }
  out.push(tokens(node.close.text));
  for (const v of Object.values(node.close.byGuess ?? {})) out.push(tokens(v));
  return out.filter((t) => t.length);
}

/**
 * A bank item that restates the card instead of presenting a new situation: its prompt shares a run of
 * ≥ RECALL_RUN words with the hook, a beat or the close, or its options reuse a beat's options verbatim.
 */
export function readsLikeRecall(node: PackNode, item: Item): boolean {
  const p = tokens(item.prompt);
  if (cardTexts(node).some((t) => longestSharedRun(p, t) >= RECALL_RUN)) return true;
  if (item.kind !== "choice") return false;
  const mine = new Set(item.options.map((o) => tokens(o.text).join(" ")));
  return node.screens.some((s) => {
    if (s.interaction?.kind !== "choice") return false;
    const theirs = s.interaction.options.map((o) => tokens(o.text).join(" "));
    const shared = theirs.filter((t) => mine.has(t)).length;
    return shared >= 2 && (shared === theirs.length || shared === mine.size);
  });
}

/** Items a checkpoint can ask from this card that present a new situation (transfer items that read like recall don't count). */
export function checkpointEligible(node: PackNode): Item[] {
  return checkpointPool(node).filter((i) => i.level !== "transfer" || !readsLikeRecall(node, i));
}

// ── the hook (L005)

/** "What is a token?", "Define entropy.", "A token is a…": a definition, not a puzzle (heuristic). */
export function isDefinition(prompt: string): boolean {
  const p = prompt.trim();
  if (/^define\b/i.test(p)) return true;
  if (/^(what is|what's|what are)\s+(a |an |the )?[\p{L}-]+(\s[\p{L}-]+)?\s*\?$/iu.test(p)) return true;
  return !p.endsWith("?") && /^[\p{L}\s-]{1,40}\b(is|are) (a|an|the)\b/iu.test(p);
}

function hookIssues(node: PackNode, lang: string, push: (sev: Sev, rule: RuleId, path: Path, msg: string) => void) {
  const ix = node.hook.interaction;
  const places: { where: string; text: string; path: Path }[] = [
    { where: "title", text: node.title, path: ["title"] },
    ...(node.tagline ? [{ where: "tagline", text: node.tagline, path: ["tagline"] }] : []),
    ...(node.hook.blocks ?? []).flatMap((b, i) =>
      b.type === "story" || b.type === "callout" || b.type === "quote"
        ? [{ where: "hook text", text: b.text, path: ["hook", "blocks", i] as Path }]
        : [],
    ),
    { where: "hook prompt", text: ix.prompt, path: ["hook", "interaction", "prompt"] },
  ];
  if (ix.kind === "choice") {
    const right = new Set(Array.isArray(ix.answer) ? ix.answer : [ix.answer]);
    const opts = ix.options.map((o) => ({ o, t: tokens(o.text) }));
    for (const place of places) {
      const t = tokens(place.text);
      const named = opts.filter((x) => contentWords(x.t, lang).length && containsRun(t, x.t));
      // A fair comparison names the alternatives too ("90 minutes or 2 hours?").
      if (named.some((x) => !right.has(x.o.id))) continue;
      const given = named.find(
        (x) =>
          right.has(x.o.id) &&
          (contentWords(x.t, lang).length >= 2 || (place.where === "hook prompt" && plainText(x.o.text).length >= 4)),
      );
      if (given)
        push("error", "L005", place.path, `the ${place.where} gives the answer away ("${plainText(given.o.text)}")`);
    }
  } else if (ix.kind === "estimate" && Math.abs(ix.answer) > 1) {
    for (const place of places)
      if (numbersIn(place.text).some((n) => n === ix.answer))
        push("error", "L005", place.path, `the ${place.where} contains the estimate's answer (${ix.answer})`);
  }
  if (isDefinition(plainText(ix.prompt)))
    push(
      "warn",
      "L005",
      ["hook", "interaction", "prompt"],
      "the hook reads like a definition; open with a puzzle the learner can guess at",
    );
  const close = contentWords(tokens(node.close.text), lang);
  for (const place of places.slice(0, node.tagline ? 2 : 1)) {
    const mine = contentWords(tokens(place.text), lang);
    if (longestSharedRun(mine, close) >= 3)
      push(
        "warn",
        "L005",
        place.path,
        `the ${place.where} shares "${sharedRunText(mine, close)}" with close.text, so it gives the close away`,
      );
  }
}

// ── the close (L023)

function closeIssues(
  node: PackNode,
  profile: LintProfile,
  lang: string,
  push: (sev: Sev, rule: RuleId, path: Path, msg: string) => void,
) {
  const close = node.close;
  const ix = node.hook.interaction;
  const by = close.byGuess ?? {};
  if (!close.text.trim()) push("error", "L023", ["close", "text"], "close.text is empty");
  if (!close.teaser.trim())
    push("error", "L023", ["close", "teaser"], "close.teaser is empty: open the next card's hook");
  else if (!plainText(close.teaser).endsWith("?"))
    push("warn", "L023", ["close", "teaser"], "the teaser should end with a question that pulls into the next card");
  const allowed = allowedGuessKeys(ix);
  for (const k of Object.keys(by))
    if (!allowed.has(k))
      push(
        "error",
        "L023",
        ["close", "byGuess", k],
        `byGuess key "${k}" doesn't fit this hook (allowed: ${[...allowed].join(", ")})`,
      );
  const textGuess = close.text.includes("{guess}");
  if (textGuess && by.idk === undefined)
    push(
      "error",
      "L023",
      ["close", "byGuess"],
      "close.text uses {guess}, so byGuess.idk is required (for “No idea yet”)",
    );

  // Names the guess.
  const sev = PROFILES[profile].closeNamesGuess;
  const has = (k: string) => Object.hasOwn(by, k);
  if (ix.kind === "choice" && !ix.multi) {
    const right = new Set(Array.isArray(ix.answer) ? ix.answer : [ix.answer]);
    for (const o of ix.options)
      if (!right.has(o.id) && !has(o.id) && !has("wrong") && !textGuess)
        push(
          sev,
          "L023",
          ["close", "byGuess"],
          `the close never names the guess "${plainText(o.text)}": add byGuess.${o.id}, byGuess.wrong or {guess} in close.text`,
        );
  } else if (!textGuess && !has("wrong") && !(has("under") && has("over"))) {
    push(
      sev,
      "L023",
      ["close"],
      `the close never names the guess: add {guess} to close.text or byGuess.wrong${ix.kind === "estimate" ? " (or byGuess.under and byGuess.over)" : ""}`,
    );
  }
  if (lang.toLowerCase().startsWith("en") && /^why\b/i.test(plainText(ix.prompt))) {
    const variants: [Path, string][] = [
      [["close", "text"], close.text],
      ...Object.entries(by).map(([k, v]): [Path, string] => [["close", "byGuess", k], v]),
    ];
    for (const [path, v] of variants)
      if (!/\bbecause\b/i.test(v)) push("warn", "L023", path, 'the hook asks "Why…?", so the close says "because"');
  }
  if (strict(profile) && !/==[^=\n]+==/.test(close.text))
    push("warn", "L023", ["close", "text"], "close.text has no ==highlight== on the line that answers the hook");
}

/** Shape checks for one card file. */
export function cardShapeIssues(id: string, node: PackNode, profile: LintProfile, lang: string): ShapeIssue[] {
  const file = `nodes/${id}.yaml`;
  const out: ShapeIssue[] = [];
  const push = (severity: Sev, rule: RuleId, path: Path, message: string) => {
    if (severity) out.push({ rule, severity, file, path, message });
  };
  const err = (rule: RuleId, path: Path, message: string) => push("error", rule, path, message);
  const rules = PROFILES[profile];
  if (id === INTRO_NODE_ID) {
    introShapeIssues(node, lang, push);
    return out;
  }

  // L006: 2–3 beats, ≥ 1 with an action, interaction ⇔ reveal, unique ids, ≤ 1 read-only beat.
  const [min, max] = rules.screens;
  const n = node.screens.length;
  if (n < min || n > max) err("L006", ["screens"], `${n} beats (a card has ${min}–${max})`);
  const actions = node.screens.filter((s) => s.interaction);
  if (!actions.length)
    err("L006", ["screens"], "no beat has an action: give at least one beat an interaction and a reveal");
  const seen = new Set<string>();
  node.screens.forEach((s, i) => {
    if (s.interaction && !s.reveal)
      err("L006", ["screens", i, "reveal"], `beat ${s.id} has an interaction but no reveal`);
    if (!s.interaction && s.reveal)
      err(
        "L006",
        ["screens", i, "reveal"],
        `beat ${s.id} has a reveal but no interaction (a read-only beat has neither)`,
      );
    if (seen.has(s.id)) err("L006", ["screens", i, "id"], `duplicate beat id "${s.id}"`);
    seen.add(s.id);
  });
  if (n - actions.length > 1)
    push("warn", "L006", ["screens"], "more than one read-only beat: let the learner do something");
  // No read-then-quiz: one action must be a manipulation or a question the beat's text doesn't answer.
  if (actions.length && actions.every((s) => quotesItsBeat(s)))
    push(
      strict(profile) ? "error" : "warn",
      "L006",
      ["screens"],
      "every action can be answered by quoting its own beat: make one a manipulation (widget, order, estimate…) or ask what happens next before the explanation",
    );

  // L001 / L001b: word caps.
  const w = cardWords(node, lang);
  if (w.hook.total > CARD_CAPS.hook) err("L001", ["hook"], `hook: ${w.hook.total} words (max ${CARD_CAPS.hook})`);
  w.screens.forEach((s, i) => {
    if (s.total > CARD_CAPS.beat) err("L001", ["screens", i], `beat ${s.id}: ${s.total} words (max ${CARD_CAPS.beat})`);
    if (s.prompt > CARD_CAPS.prompt)
      err(
        "L001",
        ["screens", i, "interaction", "prompt"],
        `beat ${s.id} prompt: ${s.prompt} words (max ${CARD_CAPS.prompt})`,
      );
    if (s.reveal > CARD_CAPS.reveal)
      err("L001", ["screens", i, "reveal", "text"], `beat ${s.id} reveal: ${s.reveal} words (max ${CARD_CAPS.reveal})`);
  });
  const closeCap = (text: string, path: Path, what: string) => {
    const cw = closeTextWords(text, lang);
    if (cw > CARD_CAPS.close) err("L001", path, `${what}: ${cw} words (max ${CARD_CAPS.close})`);
  };
  closeCap(node.close.text, ["close", "text"], "close");
  for (const [k, v] of Object.entries(node.close.byGuess ?? {}))
    closeCap(v, ["close", "byGuess", k], `close for "${k}"`);
  if (w.teaser > CARD_CAPS.teaser)
    err("L001", ["close", "teaser"], `teaser: ${w.teaser} words (max ${CARD_CAPS.teaser})`);
  node.items.forEach((it, i) => {
    const pw = words(it.prompt, lang);
    if (pw > CARD_CAPS.prompt)
      err("L001", ["items", i, "prompt"], `item ${it.id} prompt: ${pw} words (max ${CARD_CAPS.prompt})`);
  });
  if (w.total < CARD_CAPS.min || w.total > CARD_CAPS.max)
    err("L001b", [], `${w.total} learner-facing words (a card has ${CARD_CAPS.min}–${CARD_CAPS.max})`);
  else if (strict(profile) && (w.total < CARD_CAPS.softMin || w.total > CARD_CAPS.softMax))
    push(
      "warn",
      "L001b",
      [],
      `${w.total} learner-facing words (aim for ${CARD_CAPS.softMin}–${CARD_CAPS.softMax}, about 3 minutes)`,
    );

  // L005: the hook.
  hookIssues(node, lang, push);

  // L023: the close.
  closeIssues(node, profile, lang, push);

  // L011: enough items, enough transfer, enough new situations for a checkpoint.
  if (node.items.length < rules.items)
    err("L011", ["items"], `${node.items.length} items (the ${profile} profile needs ≥ ${rules.items})`);
  const transfer = node.items.filter((i) => i.level === "transfer").length;
  if (transfer < rules.transferItems)
    err("L011", ["items"], `${transfer} transfer items (the ${profile} profile needs ≥ ${rules.transferItems})`);
  node.items.forEach((it, i) => {
    if (it.level === "transfer" && readsLikeRecall(node, it))
      push(
        "warn",
        "L011",
        ["items", i],
        `item ${it.id} reads like recall: a transfer item presents a situation the card didn't show`,
      );
  });
  const eligible = checkpointEligible(node).length;
  if (eligible < 2)
    err(
      "L011",
      ["items"],
      `${eligible} checkpoint-eligible items (apply or transfer, not explain, in a new situation): a checkpoint needs ≥ 2`,
    );
  return out;
}

/** The intro card: one read-only screen with the source's opening, a close and a teaser; no items. */
function introShapeIssues(
  node: PackNode,
  lang: string,
  push: (sev: Sev, rule: RuleId, path: Path, msg: string) => void,
): void {
  const err = (rule: RuleId, path: Path, message: string) => push("error", rule, path, message);
  if (node.screens.length !== 1) err("L006", ["screens"], `the intro has ${node.screens.length} screens (exactly 1)`);
  node.screens.forEach((s, i) => {
    if (s.interaction || s.reveal) err("L006", ["screens", i], "the intro grades nothing: no interaction, no reveal");
  });
  if (!node.screens.some((s) => s.blocks.some((b) => b.type === "quote")))
    push("warn", "L006", ["screens"], "the intro quotes the source's opening");
  const w = cardWords(node, lang);
  w.screens.forEach((s, i) => {
    if (s.total > CARD_CAPS.beat) err("L001", ["screens", i], `intro screen: ${s.total} words (max ${CARD_CAPS.beat})`);
  });
  if (closeTextWords(node.close.text, lang) > CARD_CAPS.close)
    err("L001", ["close", "text"], `close: ${closeTextWords(node.close.text, lang)} words (max ${CARD_CAPS.close})`);
  if (!node.close.teaser.trim()) err("L023", ["close", "teaser"], "close.teaser is empty: open the first stop");
  if (w.teaser > CARD_CAPS.teaser)
    err("L001", ["close", "teaser"], `teaser: ${w.teaser} words (max ${CARD_CAPS.teaser})`);
  if (node.items.length > 0) push("warn", "L011", ["items"], "the intro asks nothing: its items are never used");
}

/**
 * Gate wiring checks over map.yaml: L024 (checkpoints), L025 (reading order) and the sampler rule (L007).
 * With `nodes`, also checks that each checkpoint has enough eligible items for a fresh retry.
 */
export function gateShapeIssues(
  map: MapFile,
  profile: LintProfile,
  nodes?: Readonly<Record<string, PackNode | undefined>>,
): ShapeIssue[] {
  const out: ShapeIssue[] = [];
  const push = (rule: RuleId, severity: Sev, path: Path, message: string) => {
    if (severity) out.push({ rule, severity, file: "map.yaml", path, message });
  };
  const err = (rule: RuleId, path: Path, message: string) => push(rule, "error", path, message);
  const dag = dagOf(map.nodes);
  if (findCycle(dag)) return out;
  const rules = PROFILES[profile];
  const g = gateGraph(map.nodes);
  const kind = (id: string) => map.nodes[id]?.kind ?? "node";
  const status = (id: string) => map.nodes[id]?.status ?? "playable";
  // The intro card asks nothing, so it never counts toward a section's size or needs a checkpoint.
  const playableCards = g.topo.filter((id) => kind(id) === "node" && status(id) === "playable" && id !== INTRO_NODE_ID);
  const gates = g.topo.filter((id) => kind(id) === "checkpoint" && status(id) === "playable");
  const [min, max] = rules.checkpointEvery;

  for (const [id, e] of Object.entries(map.nodes)) {
    if (kind(id) !== "checkpoint" && (e.covers || e.size !== undefined))
      err("L024", ["nodes", id], `"${id}" isn't a checkpoint, so it can't have covers or size`);
    if (kind(id) === "checkpoint" && status(id) === "planned" && (!e.title || !e.teaser))
      err("L024", ["nodes", id], `planned checkpoint "${id}" needs a title and a teaser`);
  }
  const coveredBy = new Map<string, string[]>();
  gates.forEach((cp, index) => {
    const e = map.nodes[cp];
    const anc = ancestors(dag, cp);
    for (const c of e?.covers ?? []) {
      if (!map.nodes[c]) err("L024", ["nodes", cp, "covers"], `covers unknown card "${c}"`);
      else if (kind(c) !== "node" || status(c) !== "playable")
        err("L024", ["nodes", cp, "covers"], `"${c}" isn't a playable card`);
      else if (!anc.has(c)) err("L024", ["nodes", cp, "covers"], `"${c}" isn't an ancestor of checkpoint "${cp}"`);
    }
    const covers = checkpointCovers(g, cp).filter((c) => c !== INTRO_NODE_ID);
    for (const c of covers) coveredBy.set(c, [...(coveredBy.get(c) ?? []), cp]);
    const smallFinal = gates.length === 1 && playableCards.length < min && covers.length === playableCards.length;
    if (!smallFinal && (covers.length < min || covers.length > max))
      push(
        "L024",
        rules.checkpointSeverity,
        ["nodes", cp],
        `checkpoint "${cp}" covers ${covers.length} cards (the ${profile} profile wants ${min}–${max} per checkpoint)`,
      );
    if (index > 0 && earlierCards(g, cp).length === 0)
      push(
        "L024",
        "warn",
        ["nodes", cp],
        `checkpoint "${cp}" has no earlier card to bring back (it should follow an earlier section)`,
      );
    if (nodes && covers.length) {
      const size = e?.size ?? defaultCheckpointSize(covers.length);
      const pool = covers.reduce((t, c) => {
        const node = nodes[c];
        return t + (node ? checkpointEligible(node).length : 0);
      }, 0);
      if (pool < 2 * size)
        push(
          "L024",
          "warn",
          ["nodes", cp],
          `checkpoint "${cp}" asks ${size} questions but its cards have ${pool} eligible items (≥ ${2 * size} keeps a retry fresh)`,
        );
    }
  });
  const kids = childrenOf(dag);
  for (const c of playableCards) {
    const by = coveredBy.get(c);
    if (by && by.length > 1)
      push("L024", "warn", ["nodes", c], `card "${c}" is covered by ${by.length} checkpoints (${by.join(", ")})`);
    if (by) continue;
    const sink = !(kids[c] ?? []).some((k) => status(k) === "playable");
    err(
      "L024",
      ["nodes", c],
      sink
        ? `the map ends in a checkpoint: add one that requires "${c}"`
        : `card "${c}" is never covered by a checkpoint, so it could never light`,
    );
  }

  // L025: YAML key order is the reading order (topo; key order breaks ties).
  const keys = Object.keys(map.nodes);
  const at = new Map(keys.map((k, i) => [k, i]));
  keys.forEach((id, i) => {
    const late = (map.nodes[id]?.requires ?? []).find((r) => (at.get(r) ?? -1) > i);
    if (late)
      push(
        "L025",
        "warn",
        ["nodes", id],
        `"${id}" is listed before "${late}", which it requires: list map.yaml nodes in the order a learner meets them`,
      );
  });

  if (profile === "sampler") {
    // The final playable checkpoint: one with no playable checkpoint after it.
    const finals = gates.filter((cp) => ![...descendants(dag, cp)].some((d) => gates.includes(d)));
    const beyond = new Set(finals.flatMap((cp) => [...descendants(dag, cp)]));
    for (const id of Object.keys(map.nodes))
      if (status(id) === "planned" && !beyond.has(id))
        err("L007", ["nodes", id], `sampler: planned "${id}" must sit beyond the final checkpoint`);
  }
  return out;
}
