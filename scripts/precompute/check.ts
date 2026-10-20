#!/usr/bin/env bun
/**
 * bun scripts/precompute/check.ts [pack-dir…]   (default: packs/how-llms-work and every packs/_pocket/<slug>)
 *
 * Content checks for the flagship pack and the pocket-map gallery that a schema alone can't see:
 * the card shape and gate wiring (core `cardShapeIssues` / `gateShapeIssues`, the same checks
 * `validate:pack` runs), the card loop (the close names every wrong guess, "Why…?" hooks close with
 * "because", teasers end in "?", reading order, a callback item opening each section, enough fresh
 * checkpoint items per section), misconception routing, answer keys, parametric items, visuals, the
 * illustration contract for SVGs, and number provenance (every precomputed widget points at a data
 * file whose `meta` names the model and script version).
 *
 * It mirrors the subset of `learncroc lint` that content authors trip on, so the packs can be held to
 * the bar before the full linter lands. Exit code 1 on any error.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  cardShapeIssues,
  cardWords,
  checkpointPool,
  compileExpr,
  defaultCheckpointSize,
  gateGraph,
  gateShapeIssues,
  MapFile,
  PackManifest,
  PackNode,
  plainText,
  sections,
  words,
} from "@learncroc/core";
import { parse } from "yaml";

export interface Issue {
  severity: "error" | "warn" | "info";
  file: string;
  rule: string;
  message: string;
}

type Profile = "curated" | "sampler" | "community" | "pocket";

const VOLUME: Record<Profile, { misconceptions: number; nonChoice: number }> = {
  curated: { misconceptions: 2, nonChoice: 1 },
  sampler: { misconceptions: 2, nonChoice: 1 },
  community: { misconceptions: 1, nonChoice: 0 },
  pocket: { misconceptions: 1, nonChoice: 1 },
};

/** Hand-written packs hold the card loop to errors; generated and community packs get warnings. */
const STRICT: Record<Profile, boolean> = { curated: true, sampler: true, community: false, pocket: false };
/** Title cap (L005 companion: short titles that name the idea, not the answer). */
const TITLE_MAX_WORDS = 6;
const norm = (t: string) =>
  plainText(t)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const BANNED = [/learning styles?/i, /\bstreaks?\b/i, /\bXP\b/, /great job/i, /most people/i, /!!/];
const EMOJI = /\p{Extended_Pictographic}/u;
/** Model-numbers the widgets can carry. */
const PRECOMPUTED_SOURCES = new Set(["illustrative", "precomputed:gpt2"]);

type Json = unknown;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Resolve `{ $data: "data/x.json#/ptr" }` the way the compiler does. */
function resolveData(value: Json, dir: string, refs: Set<string>): Json {
  if (Array.isArray(value)) return value.map((v) => resolveData(v, dir, refs));
  if (!isObj(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$data" && typeof value.$data === "string") {
    const [file, ptr = ""] = value.$data.split("#");
    refs.add(file as string);
    let target: unknown = JSON.parse(readFileSync(join(dir, file as string), "utf8"));
    for (const raw of ptr.split("/").slice(1)) {
      const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      target = isObj(target) || Array.isArray(target) ? (target as Obj)[key] : undefined;
    }
    if (target === undefined) throw new Error(`$data pointer not found: ${value.$data}`);
    return target;
  }
  const out: Obj = {};
  for (const [k, v] of Object.entries(value)) out[k] = resolveData(v, dir, refs);
  return out;
}

/** Every string in a value, for the banned-phrase scan. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) if (k !== "$data" && k !== "asset") strings(x, out);
  return out;
}

/** Every widget ref ({ id, v, props }) inside a value, with a path for messages. */
function widgetRefs(v: unknown, path = "", out: { path: string; ref: Obj }[] = []): { path: string; ref: Obj }[] {
  if (Array.isArray(v)) {
    for (const [i, x] of v.entries()) widgetRefs(x, `${path}/${i}`, out);
  } else if (isObj(v)) {
    if (typeof v.id === "string" && "props" in v && "v" in v) out.push({ path, ref: v });
    for (const [k, x] of Object.entries(v)) widgetRefs(x, `${path}/${k}`, out);
  }
  return out;
}

function ancestors(map: { nodes: Record<string, { requires: string[] }> }, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(map.nodes[id]?.requires ?? [])];
  while (stack.length) {
    const n = stack.pop() as string;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(map.nodes[n]?.requires ?? []));
  }
  return seen;
}

/** Illustration contract for authored SVGs. */
export function checkSvg(svg: string): string[] {
  const out: string[] = [];
  if (!/viewBox="0 0 (800 500|320 200)"/.test(svg)) out.push('viewBox must be "0 0 800 500" or "0 0 320 200"');
  if (!/<title[\s>]/.test(svg) || !/<desc[\s>]/.test(svg)) out.push("needs <title> and <desc>");
  if (/<script|\son[a-z]+=|javascript:|<foreignObject|xlink:href="http|href="http/i.test(svg))
    out.push("scripts, event handlers, foreignObject and remote references are not allowed");
  for (const m of svg.matchAll(/\b(fill|stroke)="([^"]+)"/g)) {
    const val = m[2] as string;
    if (val !== "none" && !/^var\(--(w-[1-5]|ink|lumen|sea)\)$/.test(val))
      out.push(`${m[1]}="${val}": colours only through the theme variables`);
  }
  for (const m of svg.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)) {
    if (Number(m[1]) < 14) out.push(`font-size ${m[1]} is below 14 px`);
  }
  for (const m of svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) {
    const n = words(m[1] as string);
    if (n > 4) out.push(`label "${m[1]}" is longer than 4 words`);
  }
  return out;
}

export function checkPack(dirArg: string): Issue[] {
  try {
    return checkPackUnsafe(dirArg);
  } catch (e) {
    return [{ severity: "error", file: dirArg, rule: "parse", message: (e as Error).message.split("\n")[0] ?? "" }];
  }
}

function checkPackUnsafe(dirArg: string): Issue[] {
  const dir = resolve(dirArg);
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], file: string, rule: string, message: string) =>
    issues.push({ severity, file, rule, message });
  const err = (file: string, rule: string, message: string) => add("error", file, rule, message);
  const warn = (file: string, rule: string, message: string) => add("warn", file, rule, message);

  const manifest = PackManifest.parse(parse(readFileSync(join(dir, "pack.yaml"), "utf8")));
  const lang = manifest.lang;
  const profile = manifest.profile as Profile;
  const vol = VOLUME[profile];
  const map = MapFile.parse(parse(readFileSync(join(dir, "map.yaml"), "utf8")));
  const dataRefs = new Set<string>();

  const scan = (file: string, value: unknown) => {
    for (const s of strings(value)) {
      for (const re of BANNED) if (re.test(s)) err(file, "L012", `banned phrase ${re} in "${s.slice(0, 60)}"`);
      if (EMOJI.test(s)) err(file, "L012", `emoji in "${s.slice(0, 60)}"`);
      if (/!(\s|$)/.test(s)) err(file, "voice", `exclamation mark in "${s.slice(0, 60)}"`);
    }
  };
  scan("pack.yaml", manifest);
  scan("map.yaml", map);

  const cap = (file: string, rule: string, what: string, text: unknown, max: number) => {
    const n = typeof text === "number" ? text : words(str(text), lang);
    if (n > max) err(file, rule, `${what}: ${n} words (max ${max})`);
  };

  // ── map: DAG, roots, lines in use
  const ids = Object.keys(map.nodes);
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (done.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    for (const r of map.nodes[id]?.requires ?? []) if (!visit(r)) return false;
    visiting.delete(id);
    done.add(id);
    return true;
  };
  for (const id of ids) if (!visit(id)) err("map.yaml", "L007", `cycle through "${id}"`);
  const roots = ids.filter((id) => (map.nodes[id]?.requires.length ?? 0) === 0);
  if (roots.length < 2 && profile !== "pocket" && profile !== "sampler") warn("map.yaml", "L007", "fewer than 2 roots");
  for (const [id, n] of Object.entries(map.nodes)) {
    if (n.requires.length > 4) err("map.yaml", "L007", `"${id}" has in-degree > 4`);
    if (n.status !== "planned")
      for (const r of n.requires)
        if (map.nodes[r]?.status === "planned") err("map.yaml", "L007", `playable "${id}" requires planned "${r}"`);
  }
  for (const line of map.lines)
    if (!Object.values(map.nodes).some((n) => n.line === line.id))
      warn("map.yaml", "map", `line "${line.id}" has no cards`);
  for (const i of gateShapeIssues(map, profile)) add(i.severity, i.file, i.rule, i.message);

  // ── nodes
  const nodes = new Map<string, ReturnType<typeof PackNode.parse>>();
  const nodesDir = join(dir, "nodes");
  for (const f of existsSync(nodesDir) ? readdirSync(nodesDir).filter((n) => n.endsWith(".yaml")) : []) {
    const rel = `nodes/${f}`;
    const raw = parse(readFileSync(join(nodesDir, f), "utf8"));
    const node = PackNode.parse(resolveData(raw, dir, dataRefs));
    nodes.set(node.id, node);
    scan(rel, raw);
    const anc = ancestors(map, node.id);

    // L001 / L001b / L006 / L011 / L023: the card shape
    for (const i of cardShapeIssues(node.id, node, profile, lang)) add(i.severity, rel, i.rule, i.message);
    for (const s of node.screens) {
      for (const [k, a] of Object.entries(s.alts ?? {})) cap(rel, "L002", `${s.id} alt ${k}`, a, 60);
      cap(rel, "L002", `${s.id} feedbackRight`, str(s.interaction?.feedbackRight), 20);
    }
    checkCardLoop(rel, node, profile, add);
    const w = cardWords(node, lang);
    add(
      "info",
      rel,
      "words",
      `${w.total} learner-facing words, ${node.screens.length} beats, ${node.items.length} items`,
    );

    // L002
    for (const [id, m] of Object.entries(node.misconceptions)) cap(rel, "L002", `misconception ${id} hint`, m.hint, 30);
    for (const c of node.flashcards ?? []) {
      cap(rel, "L002", `flashcard ${c.id} front`, c.front, 20);
      cap(rel, "L002", `flashcard ${c.id} back`, c.back, 25);
    }
    if (node.underTheHood) cap(rel, "L002", "underTheHood", node.underTheHood.body, 200);
    if (node.toy) cap(rel, "L002", "toy prompt", node.toy.prompt, 20);
    for (const q of node.faq ?? []) cap(rel, "L002", `faq "${q.q}"`, q.a, 60);
    if ((node.faq?.length ?? 0) > 3) err(rel, "L002", "at most 3 FAQ entries");
    for (const it of node.items) {
      cap(rel, "L002", `${it.id} why`, str(it.why), 25);
      cap(rel, "L002", `${it.id} feedbackRight`, str(it.feedbackRight), 20);
      cap(rel, "L001", `${it.id} prompt`, it.prompt, 40);
    }

    // ids share one namespace
    const seen = new Set<string>();
    const ids = [
      node.hook.interaction.id,
      ...node.screens.flatMap((s) => (s.interaction ? [s.interaction.id] : [])),
      ...node.items.map((i) => i.id),
      ...(node.flashcards ?? []).map((c) => c.id),
    ];
    for (const id of ids) {
      if (seen.has(id)) err(rel, "ids", `duplicate interaction/item/flashcard id "${id}"`);
      seen.add(id);
    }

    // L004 pictures
    for (const s of node.screens) {
      const hasVisual =
        s.visual || s.interaction?.kind === "widget" || s.interaction?.kind === "html" || node.visual !== undefined;
      if (!hasVisual) err(rel, "L004", `${s.id} has no picture`);
    }

    // L005 hook doesn't contain the answer
    const hookI = node.hook.interaction;
    if (hookI.kind === "choice") {
      const ans = hookI.options.find((o) => o.id === hookI.answer);
      if (ans && words(ans.text) > 1 && hookI.prompt.toLowerCase().includes(ans.text.toLowerCase()))
        err(rel, "L005", "hook prompt contains the answer text");
    }

    // L008 misconception routing
    const mids = new Set(Object.keys(node.misconceptions));
    for (const [id, m] of Object.entries(node.misconceptions))
      if (m.upstream !== undefined && !anc.has(m.upstream))
        err(rel, "L008", `${id}: upstream "${m.upstream}" is not an ancestor`);
    const checkMis = (where: string, id: string | undefined) => {
      if (id !== undefined && !mids.has(id)) err(rel, "L008", `${where}: unknown misconception "${id}"`);
    };
    const interactions: { where: string; i: Obj }[] = [
      { where: "hook", i: node.hook.interaction as Obj },
      ...node.screens.flatMap((s) => (s.interaction ? [{ where: s.id, i: s.interaction as Obj }] : [])),
      ...node.items.map((i) => ({ where: i.id, i: i as Obj })),
    ];
    for (const { where, i } of interactions) {
      for (const o of arr(i.options)) if (isObj(o)) checkMis(`${where} option`, o.misconception as string | undefined);
      for (const [k, w] of Object.entries(isObj(i.onWrong) ? i.onWrong : {})) {
        if (isObj(w)) {
          checkMis(`${where} onWrong ${k}`, w.misconception as string | undefined);
          cap(rel, "L002", `${where} onWrong ${k} feedback`, str(w.feedback), 25);
        }
      }
      for (const fb of [i.fallback, i.offline]) {
        if (isObj(fb))
          for (const o of arr(fb.options))
            if (isObj(o)) checkMis(`${where} fallback`, o.misconception as string | undefined);
      }
    }

    // L009 answers
    const checkAnswer = (where: string, i: Obj) => {
      if (i.kind === "choice") {
        const opts = arr(i.options).map((o) => str(isObj(o) ? o.id : ""));
        const answers = Array.isArray(i.answer) ? (i.answer as string[]) : [str(i.answer)];
        for (const a of answers) if (!opts.includes(a)) err(rel, "L009", `${where}: answer "${a}" is not an option`);
        if (new Set(opts).size !== opts.length) err(rel, "L009", `${where}: duplicate option ids`);
        const texts = arr(i.options).map((o) =>
          str(isObj(o) ? o.text : "")
            .toLowerCase()
            .replace(/[.]/g, ""),
        );
        if (opts.length === 2 && texts.every((t) => ["true", "false", "yes", "no"].includes(t.trim())))
          err(rel, "L018", `${where}: True/False item`);
      }
      if (i.kind === "order") {
        const n = arr(i.items).length;
        const a = arr(i.answer) as number[];
        if (a.length !== n || [...a].sort((x, y) => x - y).some((v, k) => v !== k))
          err(rel, "L009", `${where}: order answer is not a permutation`);
      }
      if (i.kind === "match") {
        for (const p of arr(i.answer) as [number, number][]) {
          if (p[0] >= arr(i.left).length || p[1] >= arr(i.right).length)
            err(rel, "L009", `${where}: match pair out of range`);
        }
      }
      if (i.kind === "estimate" && isObj(i.scale)) {
        const a = Number(i.answer);
        if (a < Number(i.scale.min) || a > Number(i.scale.max)) err(rel, "L009", `${where}: answer outside the scale`);
      }
      for (const fb of [i.fallback, i.offline]) if (isObj(fb)) checkAnswer(`${where} fallback`, fb);
    };
    for (const { where, i } of interactions) checkAnswer(where, i);

    // parametric items
    for (const it of node.items) {
      if (!it.params) {
        if (/\{[a-z]\w*\}/i.test(it.prompt)) err(rel, "L009", `${it.id}: prompt has {vars} but no params`);
        continue;
      }
      if (it.kind !== "numeric" && it.kind !== "estimate") err(rel, "L009", `${it.id}: params on a ${it.kind} item`);
      const f = compileExpr(it.params.answerExpr);
      const names = Object.keys(it.params.vars);
      for (const n of names) if (!it.prompt.includes(`{${n}}`)) err(rel, "L009", `${it.id}: prompt doesn't use {${n}}`);
      const first = Object.fromEntries(names.map((n) => [n, it.params?.vars[n]?.[0] as number]));
      const a = f(first);
      const stated = it.kind === "numeric" || it.kind === "estimate" ? it.answer : Number.NaN;
      if (!(Math.abs(a - stated) <= 1e-9))
        err(rel, "L009", `${it.id}: answerExpr gives ${a} for the default instance, answer says ${stated}`);
      const combos = names.reduce<Record<string, number>[]>(
        (acc, n) => acc.flatMap((c) => (it.params?.vars[n] ?? []).map((v) => ({ ...c, [n]: v }))),
        [{}],
      );
      for (const c of combos)
        if (!Number.isFinite(f(c))) err(rel, "L009", `${it.id}: non-finite for ${JSON.stringify(c)}`);
    }

    // L011 / L018 mix (item and transfer counts are part of the card shape above)
    const choiceShare = node.items.filter((i) => i.kind === "choice").length / Math.max(1, node.items.length);
    if (choiceShare > 0.4) err(rel, "L018", `${Math.round(choiceShare * 100)}% of items are choice (max 40%)`);
    const nonChoice = node.screens.filter(
      (s) => s.interaction && s.interaction.kind !== "choice" && s.interaction.kind !== "explain",
    ).length;
    if (nonChoice < vol.nonChoice)
      warn(rel, "L018", `${nonChoice} beats with a non-choice action (≥ ${vol.nonChoice})`);
    if (Object.keys(node.misconceptions).length < vol.misconceptions)
      err(rel, "L011", `fewer than ${vol.misconceptions} misconceptions`);
    for (const it of node.items) {
      if (it.kind !== "choice") continue;
      for (const o of it.options) {
        const correct = Array.isArray(it.answer) ? it.answer.includes(o.id) : it.answer === o.id;
        if (!correct && !o.misconception) warn(rel, "L011", `${it.id}: distractor "${o.id}" has no misconception`);
      }
    }

    // L019 choice on a widget canvas acts out
    for (const s of node.screens) {
      const canvas = s.visual ?? node.visual;
      if (s.interaction?.kind === "choice" && canvas?.kind === "widget") {
        for (const o of s.interaction.options)
          if (!o.visualState) err(rel, "L019", `${s.id}: option "${o.id}" has no visualState on a widget canvas`);
      }
    }

    // sources referenced by screens exist
    const srcIds = new Set(node.sources.map((s) => s.id));
    if (node.sources.length === 0) err(rel, "sources", "no sources");
    for (const s of node.screens)
      for (const id of s.src ?? [])
        if (!srcIds.has(id) && !/^p\d+$/.test(id)) err(rel, "sources", `${s.id} cites unknown source "${id}"`);
    for (const id of node.underTheHood?.sources ?? [])
      if (!srcIds.has(id)) err(rel, "sources", `underTheHood cites unknown source "${id}"`);

    // number provenance
    for (const { path, ref } of widgetRefs(raw)) checkSource(rel, path, ref, dir, err);
    if (!node.status || node.status !== "draft") err(rel, "L017", "nodes are draft until a human signs them off");
  }

  // ── playable map nodes have files
  for (const [id, n] of Object.entries(map.nodes)) {
    if (n.status === "planned" || n.kind === "checkpoint") continue;
    if (!nodes.has(id)) err("map.yaml", "files", `playable "${id}" has no node file`);
  }

  // ── the card loop across the map: reading order, callbacks, fresh checkpoint items
  checkMapLoop(map, nodes, profile, add);

  // ── revision-2 leftovers
  for (const gone of ["bosses", "toy.yaml"])
    if (existsSync(join(dir, gone)))
      err(gone, "files", "bosses/ and toy.yaml were removed in revision 3; run `learncroc migrate`");

  // ── data files carry provenance
  for (const ref of dataRefs) {
    const data = JSON.parse(readFileSync(join(dir, ref), "utf8")) as Obj;
    const meta = isObj(data.meta) ? data.meta : undefined;
    if (!meta || !str(meta.model) || !str(meta.script) || !str(meta.generatedAt))
      err(ref, "provenance", "data files need meta.model, meta.script and meta.generatedAt");
  }

  // ── assets: illustration contract
  const imgDir = join(dir, "assets");
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  for (const file of existsSync(imgDir) ? walk(imgDir) : []) {
    if (!file.endsWith(".svg")) continue;
    for (const m of checkSvg(readFileSync(file, "utf8"))) err(relative(dir, file), "svg", m);
  }

  return issues;
}

type Add = (severity: Issue["severity"], file: string, rule: string, message: string) => void;

/** One card's close and teaser: every wrong guess named, "because" for "Why…?", a teaser that asks. */
function checkCardLoop(file: string, node: PackNode, profile: Profile, add: Add): void {
  const strict = STRICT[profile];
  const sev = strict ? "error" : "warn";
  const { close, hook } = node;
  const ix = hook.interaction;
  const by = close.byGuess ?? {};
  const variants = [close.text, ...Object.values(by)];
  const usesGuess = close.text.includes("{guess}");

  if (words(node.title) > TITLE_MAX_WORDS)
    add(sev, file, "L005", `title "${node.title}" is over ${TITLE_MAX_WORDS} words`);
  if (ix.kind === "choice") {
    const right = new Set(Array.isArray(ix.answer) ? ix.answer : [ix.answer]);
    for (const o of ix.options) {
      if (right.has(o.id)) continue;
      const named = by[o.id] ?? by.wrong;
      if (named === undefined && !usesGuess)
        add(sev, file, "L023", `the close never names the guess "${o.id}": add byGuess.${o.id} ("You picked *…*")`);
      else if (
        by[o.id] !== undefined &&
        !norm(by[o.id] as string).includes(norm(o.text).split(" ").slice(0, 3).join(" "))
      )
        add("warn", file, "L023", `byGuess.${o.id} doesn't quote the option ("You picked *${o.text}*")`);
    }
  } else if (!usesGuess && by.wrong === undefined && !(by.under !== undefined && by.over !== undefined)) {
    add(sev, file, "L023", `a ${ix.kind} hook's close needs {guess}, byGuess.wrong, or byGuess.under and .over`);
  }
  if (by.idk === undefined) add(strict ? "error" : "warn", file, "L023", "byGuess.idk is missing (for “No idea yet”)");
  if (/\bwhy\b/i.test(plainText(ix.prompt)))
    for (const v of variants)
      if (!/\bbecause\b/i.test(v))
        add("warn", file, "L023", `a "Why…?" hook: this close should say "because": "${plainText(v).slice(0, 50)}…"`);
  if (!close.teaser.trim().endsWith("?")) add("warn", file, "L023", "the teaser should end with a question mark");
  if (strict && !/==[^=]+==/.test(close.text)) add("warn", file, "L023", "close.text has no ==key phrase==");
  if (checkpointPool(node).length < 2)
    add("error", file, "L011", "fewer than 2 checkpoint-eligible items (apply or transfer, not explain)");
}

/** Map-wide loop checks: YAML order = reading order, a callback item opening each section, fresh retries. */
function checkMapLoop(map: MapFile, nodes: Map<string, PackNode>, profile: Profile, add: Add): void {
  const strict = STRICT[profile];
  const g = gateGraph(map.nodes);
  const keys = Object.keys(map.nodes);
  const firstOff = keys.findIndex((id, i) => g.topo[i] !== id);
  if (firstOff >= 0)
    add(
      "warn",
      "map.yaml",
      "L025",
      `YAML key order isn't the reading order from "${keys[firstOff]}" (topo has "${g.topo[firstOff]}"): teasers follow topo`,
    );
  for (const sec of sections(g)) {
    const first = sec.cards[0];
    const firstNode = first ? nodes.get(first) : undefined;
    if (firstNode && !firstNode.items.some((i) => i.callback))
      add(
        strict ? "error" : "warn",
        `nodes/${first}.yaml`,
        "callback",
        `first card of the section behind "${sec.checkpoint}": add one item with callback: true that recalls its hook`,
      );
    const size = map.nodes[sec.checkpoint]?.size ?? defaultCheckpointSize(sec.cards.length);
    const eligible = sec.cards.reduce(
      (n, id) => n + (nodes.get(id) ? checkpointPool(nodes.get(id) as PackNode).length : 0),
      0,
    );
    if (eligible < 2 * size)
      add(
        "warn",
        "map.yaml",
        "L024",
        `"${sec.checkpoint}" asks ${size} questions but its cards hold ${eligible} eligible items (want ≥ ${2 * size} for a fresh retry)`,
      );
  }
}

function checkSource(
  file: string,
  path: string,
  ref: Obj,
  dir: string,
  err: (file: string, rule: string, message: string) => void,
): void {
  const props = isObj(ref.props) ? ref.props : {};
  const source = props.source ?? props.dataSource;
  if (["probability-bars", "attention-weights", "embedding-plane"].includes(str(ref.id))) {
    if (!PRECOMPUTED_SOURCES.has(str(source)))
      err(file, "numbers", `${path}: source must be illustrative or precomputed:gpt2`);
    if (source === "precomputed:gpt2") {
      const hasData = JSON.stringify(props).includes('"$data"');
      if (!hasData) err(file, "numbers", `${path}: precomputed numbers must come from data/ via $data`);
    }
  }
  if (ref.id === "plot" && !["formula", "sources", "illustrative"].includes(str(source)))
    err(file, "numbers", `${path}: plot needs a dataSource`);
  void dir;
}

/** Default targets: the flagship pack and every gallery pocket map. */
export function defaultTargets(root: string): string[] {
  const out = [join(root, "packs/how-llms-work")];
  const pocket = join(root, "packs/_pocket");
  if (existsSync(pocket))
    for (const d of readdirSync(pocket).sort()) if (existsSync(join(pocket, d, "pack.yaml"))) out.push(join(pocket, d));
  return out.filter((d) => existsSync(join(d, "pack.yaml")));
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../..");
  const verbose = process.argv.includes("--verbose");
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dirs = args.length ? args : defaultTargets(root);
  let errors = 0;
  for (const d of dirs) {
    const issues = checkPack(d);
    const e = issues.filter((i) => i.severity === "error").length;
    const w = issues.filter((i) => i.severity === "warn").length;
    errors += e;
    console.log(`${basename(d)}: ${e} errors, ${w} warnings`);
    for (const i of issues.filter((x) => verbose || x.severity !== "info"))
      console.log(`  ${i.severity.padEnd(5)} ${i.rule.padEnd(10)} ${i.file}: ${i.message}`);
  }
  process.exit(errors ? 1 : 0);
}
