/**
 * Per-card lint rules: the card shape (L001, L001b, L005, L006, L011, L023 via card-shape.ts), extras caps
 * (L002), interactions (L003), pictures (L004), misconceptions (L008), answers (L009), widgets
 * (L010), interaction mix (L018) and canvas acting (L019).
 */

import { plainText } from "../compile/text";
import { ancestors, dagOf } from "../dag";
import { GradeError, gradeHtmlGoal, gradeInteraction, gradeWidget, solutionOf } from "../grade";
import { checkParams } from "../params";
import type { Markdown, PackNode, VisualState, WidgetRef } from "../schema/index";
import { words } from "../words";
import { cardShapeIssues, INTRO_NODE_ID } from "./card-shape";
import { type AnyInteraction, emit, type LintContext, nodeInteractions, nodeWidgets, screenCanvas } from "./context";

export { isDefinition } from "./card-shape";

const CAP = {
  cardFront: 20,
  cardBack: 25,
  feedbackRight: 20,
  onWrong: 25,
  alt: 60,
  hint: 30,
  underTheHood: 200,
  toyPrompt: 20,
  faq: 60,
  why: 25,
  note: 8,
} as const;

const CONTINUE_RE = /^(continue|next|ok|okay|got it|i understand|understood|ready|let'?s go|go on|i see)[.!]?$/i;
const TRUE_FALSE = [
  ["true", "false"],
  ["yes", "no"],
  ["verdadero", "falso"],
  ["sí", "no"],
  ["si", "no"],
  ["vrai", "faux"],
  ["oui", "non"],
];

export function lintNode(ctx: LintContext, id: string, node: PackNode): void {
  const file = `nodes/${id}.yaml`;
  const lang = ctx.lang;
  const w = (s: string | undefined) => (s ? words(s, lang) : 0);
  const cap = (n: number, max: number, path: (string | number)[], what: string) => {
    if (n > max) emit(ctx, "L002", "error", file, path, `${what}: ${n} words (max ${max})`);
  };

  // ── the card shape (also checked by validate:pack)
  for (const i of cardShapeIssues(id, node, ctx.profile, lang))
    emit(ctx, i.rule, i.severity, i.file, i.path, i.message);

  // ── L002: caps on the extras
  for (const r of nodeInteractions(node)) {
    cap(w(r.ix.feedbackRight), CAP.feedbackRight, [...r.path, "feedbackRight"], "feedbackRight");
    for (const [k, ow] of Object.entries(r.ix.onWrong ?? {}))
      cap(w(ow.feedback), CAP.onWrong, [...r.path, "onWrong", k, "feedback"], "onWrong feedback");
    if (r.item) cap(w(r.item.why), CAP.why, [...r.path, "why"], "item why");
  }
  (node.flashcards ?? []).forEach((c, i) => {
    cap(w(c.front), CAP.cardFront, ["flashcards", i, "front"], `flashcard ${c.id} front`);
    cap(w(c.back), CAP.cardBack, ["flashcards", i, "back"], `flashcard ${c.id} back`);
  });
  node.screens.forEach((s, i) => {
    for (const [k, v] of Object.entries(s.alts ?? {}))
      cap(w(v), CAP.alt, ["screens", i, "alts", k], `beat ${s.id} alt "${k}"`);
  });
  for (const [k, m] of Object.entries(node.misconceptions))
    cap(w(m.hint), CAP.hint, ["misconceptions", k, "hint"], `misconception ${k} hint`);
  if (node.underTheHood) cap(w(node.underTheHood.body), CAP.underTheHood, ["underTheHood", "body"], "underTheHood");
  if (node.toy) cap(w(node.toy.prompt), CAP.toyPrompt, ["toy", "prompt"], "toy prompt");
  (node.faq ?? []).forEach((f, i) => {
    cap(w(f.a), CAP.faq, ["faq", i, "a"], "faq answer");
  });
  if ((node.faq?.length ?? 0) > 3) emit(ctx, "L002", "warn", file, ["faq"], `${node.faq?.length} FAQ entries (max 3)`);
  const notes: { state: VisualState; path: (string | number)[] }[] = [];
  node.screens.forEach((s, i) => {
    if (s.reveal?.visualState)
      notes.push({ state: s.reveal.visualState, path: ["screens", i, "reveal", "visualState"] });
    if (s.interaction?.kind === "choice")
      s.interaction.options.forEach((o, j) => {
        if (o.visualState)
          notes.push({ state: o.visualState, path: ["screens", i, "interaction", "options", j, "visualState"] });
      });
  });
  for (const n of notes) cap(w(n.state.note), CAP.note, [...n.path, "note"], "canvas note");

  // ── L003: real interactions, no "continue"
  for (const r of nodeInteractions(node)) {
    if (r.ix.kind !== "choice") continue;
    r.ix.options.forEach((o, j) => {
      if (CONTINUE_RE.test(plainText(o.text)))
        emit(
          ctx,
          "L003",
          "error",
          file,
          [...r.path, "options", j],
          `option "${o.text}" is a continue button, not a choice`,
        );
    });
    const answer = Array.isArray(r.ix.answer) ? r.ix.answer : [r.ix.answer];
    if (answer.length === r.ix.options.length && r.ix.options.length > 1)
      emit(
        ctx,
        "L003",
        "error",
        file,
        [...r.path, "answer"],
        "every option is correct, so the choice needs no thinking",
      );
  }

  // The intro card is the source's opening and the map's questions: no picture, misconceptions or mix rules.
  const intro = id === INTRO_NODE_ID;

  // ── L004: a picture on every beat, alt text everywhere
  node.screens.forEach((s, i) => {
    if (intro) return;
    const has = s.visual || s.interaction?.kind === "widget" || s.interaction?.kind === "html" || node.visual;
    if (!has)
      emit(ctx, "L004", "error", file, ["screens", i], `beat ${s.id} has no picture (add a visual or a card visual)`);
  });
  const leaning = node.screens.filter(
    (s) => !s.visual && s.interaction?.kind !== "widget" && s.interaction?.kind !== "html",
  );
  if (node.visual && leaning.length >= 2)
    emit(
      ctx,
      "L004",
      "warn",
      file,
      ["screens"],
      `beats ${leaning.map((s) => s.id).join(", ")} all lean on the card visual: give each idea its own picture or canvas state`,
    );
  const alts: { alt: string; path: (string | number)[] }[] = [];
  if (node.visual) alts.push({ alt: node.visual.alt, path: ["visual", "alt"] });
  if (node.hook.visual) alts.push({ alt: node.hook.visual.alt, path: ["hook", "visual", "alt"] });
  node.screens.forEach((s, i) => {
    if (s.visual) alts.push({ alt: s.visual.alt, path: ["screens", i, "visual", "alt"] });
    if (s.interaction?.kind === "html")
      alts.push({ alt: s.interaction.alt, path: ["screens", i, "interaction", "alt"] });
  });
  (node.flashcards ?? []).forEach((c, i) => {
    if (c.visual) alts.push({ alt: c.visual.alt, path: ["flashcards", i, "visual", "alt"] });
  });
  for (const a of alts) {
    if (!a.alt.trim()) emit(ctx, "L004", "error", file, a.path, "empty alt text", { fixable: true });
    else if (/^todo\b/i.test(a.alt.trim()))
      emit(ctx, "L004", "warn", file, a.path, "alt text is still a TODO placeholder");
  }

  // ── L009: lotsGuess names an option (the rest of L005 lives in card-shape.ts)
  {
    const ix = node.hook.interaction;
    if (
      ix.kind === "choice" &&
      node.hook.lotsGuess !== undefined &&
      !ix.options.some((o) => o.id === node.hook.lotsGuess)
    )
      emit(ctx, "L009", "error", file, ["hook", "lotsGuess"], `lotsGuess "${node.hook.lotsGuess}" isn't an option id`);
  }

  // ── shared id namespace
  const ids = new Map<string, string>();
  const claim = (iid: string | undefined, path: string) => {
    if (!iid) return;
    const prev = ids.get(iid);
    if (prev) emit(ctx, "L009", "error", file, path, `id "${iid}" is used twice (also at ${prev})`);
    else ids.set(iid, path);
  };
  claim(node.hook.interaction.id, "/hook/interaction/id");
  node.screens.forEach((s, i) => {
    claim(s.interaction?.id, `/screens/${i}/interaction/id`);
  });
  node.items.forEach((it, i) => {
    claim(it.id, `/items/${i}/id`);
  });
  (node.flashcards ?? []).forEach((c, i) => {
    claim(c.id, `/flashcards/${i}/id`);
  });

  // ── L008: misconceptions resolve
  const dag = dagOf(ctx.map.nodes);
  const anc = ancestors(dag, id);
  for (const [k, m] of Object.entries(node.misconceptions)) {
    if (m.upstream !== undefined && (!anc.has(m.upstream) || ctx.map.nodes[m.upstream]?.kind === "checkpoint"))
      emit(
        ctx,
        "L008",
        "error",
        file,
        ["misconceptions", k, "upstream"],
        `upstream "${m.upstream}" isn't an ancestor card of "${id}"`,
      );
  }
  const mid = (m: string | undefined, path: (string | number)[]) => {
    if (m !== undefined && !Object.hasOwn(node.misconceptions, m))
      emit(ctx, "L008", "error", file, path, `unknown misconception "${m}"`);
  };
  for (const r of nodeInteractions(node)) {
    if (r.ix.kind === "choice")
      r.ix.options.forEach((o, j) => {
        mid(o.misconception, [...r.path, "options", j, "misconception"]);
      });
    for (const [k, ow] of Object.entries(r.ix.onWrong ?? {}))
      mid(ow.misconception, [...r.path, "onWrong", k, "misconception"]);
  }
  const nMis = Object.keys(node.misconceptions).length;
  if (!intro && nMis < ctx.rules.misconceptions)
    emit(
      ctx,
      "L011",
      "error",
      file,
      ["misconceptions"],
      `${nMis} misconceptions (the ${ctx.profile} profile needs ≥ ${ctx.rules.misconceptions})`,
    );

  // ── L009: answers valid, solutions grade correct
  for (const r of nodeInteractions(node)) lintAnswer(ctx, file, r.ix, r.path);

  // ── L010 + graded widget solutions (L009)
  for (const u of nodeWidgets(node))
    lintWidget(ctx, file, u.ref, u.path, { graded: u.graded, solution: u.solution, states: u.states });

  // ── L011: untagged distractors
  for (const r of nodeInteractions(node)) {
    if (r.ix.kind !== "choice" || r.where === "fallback" || r.where === "offline") continue;
    const answer = new Set(Array.isArray(r.ix.answer) ? r.ix.answer : [r.ix.answer]);
    r.ix.options.forEach((o, j) => {
      if (!answer.has(o.id) && !o.misconception && !r.ix.onWrong?.[o.id]?.misconception)
        emit(
          ctx,
          "L011",
          "warn",
          file,
          [...r.path, "options", j],
          `distractor "${plainText(o.text)}" isn't tagged with a misconception`,
          {
            example: `- { id: ${o.id}, text: "…", misconception: <id from misconceptions> }`,
          },
        );
    });
  }

  // ── L018: interaction mix
  const doing = node.screens.filter(
    (s) => s.interaction && s.interaction.kind !== "choice" && s.interaction.kind !== "explain",
  ).length;
  if (!intro && doing < ctx.rules.nonChoiceScreens)
    emit(
      ctx,
      "L018",
      ctx.rules.nonChoiceSeverity,
      file,
      ["screens"],
      `${doing} beats with a non-choice action (needs ≥ ${ctx.rules.nonChoiceScreens})`,
    );
  const items = node.items;
  const choices = items.filter((i) => i.kind === "choice").length;
  if (items.length && choices / items.length > 0.4 + 1e-9)
    emit(
      ctx,
      "L018",
      ctx.rules.choiceShare,
      file,
      ["items"],
      `${Math.round((choices / items.length) * 100)}% of items are choice (max 40%)`,
    );
  for (const r of nodeInteractions(node)) {
    if (r.ix.kind !== "choice" || r.ix.options.length !== 2) continue;
    const texts = r.ix.options
      .map((o) =>
        plainText(o.text)
          .toLowerCase()
          .replace(/[.!?]$/, ""),
      )
      .sort();
    if (TRUE_FALSE.some((pair) => [...pair].sort().join("|") === texts.join("|")))
      emit(
        ctx,
        "L018",
        "error",
        file,
        r.path,
        "true/false items aren't allowed: ask for a number, an order or a sentence instead",
      );
  }

  // ── L019: choice options act out on a widget canvas
  node.screens.forEach((s, i) => {
    if (s.interaction?.kind !== "choice" || !screenCanvas(node, s)) return;
    s.interaction.options.forEach((o, j) => {
      if (!o.visualState)
        emit(
          ctx,
          "L019",
          ctx.rules.visualState,
          file,
          ["screens", i, "interaction", "options", j],
          `option "${plainText(o.text)}" doesn't set visualState on the canvas`,
        );
    });
  });
}

/** L009 for one interaction. */
export function lintAnswer(
  ctx: LintContext,
  file: string,
  ix: AnyInteraction,
  path: readonly (string | number)[],
): void {
  const p = [...path] as (string | number)[];
  const err = (sub: (string | number)[], msg: string) => emit(ctx, "L009", "error", file, [...p, ...sub], msg);
  switch (ix.kind) {
    case "choice": {
      const ids = ix.options.map((o) => o.id);
      if (new Set(ids).size !== ids.length) err(["options"], "duplicate option ids");
      const answer = Array.isArray(ix.answer) ? ix.answer : [ix.answer];
      if (Array.isArray(ix.answer) && !ix.multi) err(["answer"], "an array answer needs multi: true");
      if (ix.multi && !Array.isArray(ix.answer)) err(["answer"], "multi: true needs an array answer");
      for (const a of answer) if (!ids.includes(a)) err(["answer"], `answer "${a}" isn't an option id`);
      break;
    }
    case "numeric":
      if ((ix.tolerance ?? 0) < 0) err(["tolerance"], "tolerance must be ≥ 0");
      break;
    case "estimate":
      if (ix.accept.factor === undefined && ix.accept.abs === undefined) err(["accept"], "accept needs factor or abs");
      if (ix.accept.factor !== undefined && ix.accept.factor < 1) err(["accept", "factor"], "factor must be ≥ 1");
      if (ix.accept.abs !== undefined && ix.accept.abs < 0) err(["accept", "abs"], "abs must be ≥ 0");
      if (ix.scale.min >= ix.scale.max) err(["scale"], "scale.min must be < scale.max");
      if (ix.answer < ix.scale.min || ix.answer > ix.scale.max) err(["answer"], "the answer is outside the scale");
      if (ix.scale.log && ix.scale.min <= 0) err(["scale", "min"], "a log scale needs min > 0");
      break;
    case "text":
      if (!ix.accept.some((a) => a.trim())) err(["accept"], "accept needs a non-empty answer");
      break;
    case "order": {
      const n = ix.items.length;
      const sorted = [...ix.answer].sort((a, b) => a - b);
      if (ix.answer.length !== n || sorted.some((v, i) => v !== i))
        err(["answer"], `answer must be a permutation of 0…${n - 1}`);
      break;
    }
    case "match":
      for (const [l, r] of ix.answer) {
        if (l < 0 || l >= ix.left.length || r < 0 || r >= ix.right.length)
          err(["answer"], `pair [${l}, ${r}] is out of range`);
      }
      if (new Set(ix.answer.map(([l]) => l)).size !== ix.answer.length) err(["answer"], "a left item is matched twice");
      break;
    case "cloze": {
      const refs = new Set([...ix.text.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => (m[1] as string).trim()));
      for (const k of Object.keys(ix.blanks))
        if (!refs.has(k)) err(["blanks", k], `blank "${k}" isn't used in the text`);
      for (const r of refs) if (!Object.hasOwn(ix.blanks, r)) err(["text"], `{{${r}}} has no blank`);
      for (const [k, b] of Object.entries(ix.blanks))
        if (!b.accept.length) err(["blanks", k, "accept"], "a blank needs accepted answers");
      break;
    }
    case "html": {
      const sol = ix.solution;
      const ok =
        typeof sol === "string" ||
        typeof sol === "number" ||
        typeof sol === "boolean" ||
        (Array.isArray(sol) && sol.every((x) => typeof x === "string"));
      if (!ok) err(["solution"], "an html solution is a string, number, boolean or string[]");
      else if (!gradeHtmlGoal(ix.goal, sol as string).correct) err(["solution"], "the solution doesn't meet the goal");
      if (ix.goal.kind === "range" && ix.goal.min > ix.goal.max) err(["goal"], "range min > max");
      break;
    }
    case "explain":
      if (ix.minHits > ix.keyPoints.length)
        err(["minHits"], `minHits ${ix.minHits} > ${ix.keyPoints.length} key points`);
      break;
    case "widget":
      break;
  }
  if ("params" in ix && ix.params) {
    for (const e of checkParams(ix as Parameters<typeof checkParams>[0])) err(["params"], e);
  }
  // Every built-in answer must grade correct against itself (catches unit/normalisation slips).
  if (ix.kind !== "widget" && ix.kind !== "html" && ix.kind !== "explain") {
    const sol = solutionOf(ix);
    try {
      if (sol && !gradeInteraction(ix, sol, { lang: ctx.lang }).correct)
        err(["answer"], "the authored answer doesn't grade correct");
    } catch {
      // reported above
    }
  }
}

/** L010 for one widget reference (+ L009 for graded solutions). */
export function lintWidget(
  ctx: LintContext,
  file: string,
  ref: WidgetRef,
  path: readonly (string | number)[],
  opts: { graded: boolean; solution?: unknown; states?: { state: VisualState; path: readonly (string | number)[] }[] },
  rule: "L009" = "L009",
): void {
  const p = [...path] as (string | number)[];
  const declared = ctx.manifest.widgets[ref.id];
  if (declared === undefined)
    emit(ctx, "L010", "error", file, [...p, "id"], `widget "${ref.id}" isn't listed in pack.yaml widgets`);
  else if (declared !== ref.v)
    emit(ctx, "L010", "error", file, [...p, "v"], `widget "${ref.id}" is v${ref.v} here but v${declared} in pack.yaml`);
  if (ref.v !== 1)
    emit(ctx, "L010", "error", file, [...p, "v"], `widget "${ref.id}" has no major version ${ref.v} (v0.1 ships v1)`);
  if (opts.graded && ref.goal === undefined)
    emit(ctx, "L010", "error", file, [...p, "goal"], `a graded widget needs a goal`);
  if (!ctx.widgets) return;
  const spec = ctx.widgets.get(ref.id);
  if (!spec) {
    emit(ctx, "L010", "error", file, [...p, "id"], `unknown widget "${ref.id}"`);
    return;
  }
  const props = spec.props.safeParse(ref.props);
  if (!props.success) {
    for (const iss of props.error.issues)
      emit(ctx, "L010", "error", file, [...p, "props", ...(iss.path as (string | number)[])], `props: ${iss.message}`);
    return;
  }
  let goal: unknown;
  if (ref.goal !== undefined) {
    if (!spec.goal) {
      emit(ctx, "L010", "error", file, [...p, "goal"], `widget "${ref.id}" is explore-only and takes no goal`);
    } else {
      const g = spec.goal.safeParse(ref.goal);
      if (!g.success) {
        for (const iss of g.error.issues)
          emit(
            ctx,
            "L010",
            "error",
            file,
            [...p, "goal", ...(iss.path as (string | number)[])],
            `goal: ${iss.message}`,
          );
        return;
      }
      goal = g.data;
    }
  }
  try {
    for (const e of spec.validate(props.data, goal)) emit(ctx, "L010", "error", file, p, e);
  } catch (e) {
    emit(ctx, "L010", "error", file, p, `validate() failed: ${(e as Error).message}`);
  }
  for (const s of opts.states ?? []) {
    if (!s.state.props) continue;
    const merged = spec.props.safeParse({ ...(ref.props as object), ...s.state.props });
    if (!merged.success)
      emit(
        ctx,
        "L010",
        "error",
        file,
        [...(s.path as (string | number)[]), "props"],
        `visualState props don't fit "${ref.id}": ${merged.error.issues[0]?.message}`,
      );
  }
  if (opts.graded && goal !== undefined) {
    if (opts.solution === undefined) {
      emit(ctx, rule, "error", file, p, "a graded widget needs a solution");
      return;
    }
    try {
      const r = gradeWidget(ref, opts.solution, ctx.widgets);
      if (!r.correct) emit(ctx, rule, "error", file, p, `the solution doesn't grade correct for "${ref.id}"`);
    } catch (e) {
      if (e instanceof GradeError) emit(ctx, rule, "error", file, p, e.message);
      else throw e;
    }
  }
}

/** Markdown strings of a card that a learner reads, close and byGuess included (banned words, links). */
export function nodeMarkdown(node: PackNode): { text: Markdown; path: (string | number)[] }[] {
  const out: { text: Markdown; path: (string | number)[] }[] = [];
  const walk = (v: unknown, path: (string | number)[]) => {
    if (typeof v === "string") out.push({ text: v, path });
    else if (Array.isArray(v))
      v.forEach((x, i) => {
        walk(x, [...path, i]);
      });
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  walk(node, []);
  return out;
}
