/**
 * Content rules for the Spanish and persuasion packs, checked in tests.
 *
 * This mirrors the lint rules that matter for hand-written content (the card shape and gate wiring
 * through core `cardShapeIssues` / `gateShapeIssues`, interaction mix, routing, answers that grade, DAG
 * shape, theme contrast, production share, accent tolerance, audio coverage) so the packs stay clean
 * before the full revision-3 lint lands. When it lands, these tests should keep passing alongside it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cardShapeIssues,
  gateShapeIssues,
  type Interaction,
  type Item,
  MapFile,
  type MapFile as MapFileT,
  PackManifest,
  type PackManifest as PackManifestT,
  PackNode,
  type PackNode as PackNodeT,
  words,
} from "@learncroc/core";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import { parse } from "yaml";

export interface RuleIssue {
  rule: string;
  file: string;
  message: string;
}

export interface LoadedPack {
  dir: string;
  manifest: PackManifestT;
  map: MapFileT;
  nodes: Map<string, PackNodeT>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

export function loadPack(dir: string): LoadedPack {
  const yaml = (rel: string) => parse(readFileSync(join(dir, rel), "utf8"));
  const manifest = PackManifest.parse(yaml("pack.yaml"));
  const map = MapFile.parse(yaml("map.yaml"));
  const nodes = new Map<string, PackNodeT>();
  for (const f of readdirSync(join(dir, "nodes")).filter((n) => n.endsWith(".yaml"))) {
    const n = PackNode.parse(yaml(`nodes/${f}`));
    nodes.set(n.id, n);
  }
  if (existsSync(join(dir, "bosses")) || existsSync(join(dir, "toy.yaml")))
    throw new Error(`${dir}: bosses/ and toy.yaml were removed in revision 3; run \`learncroc migrate\``);
  return { dir, manifest, map, nodes };
}

const PROFILE = {
  curated: { nonChoiceScreens: 1 },
  sampler: { nonChoiceScreens: 1 },
  community: { nonChoiceScreens: 0 },
  pocket: { nonChoiceScreens: 1 },
} as const;

const BANNED = [/learning style/i, /\bstreak/i, /\bXP\b/, /great job/i, /most people/i, /!!/];
const EMOJI = /\p{Extended_Pictographic}/u;

// ── dag helpers

export function ancestors(map: MapFileT, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(map.nodes[id]?.requires ?? [])];
  while (stack.length) {
    const n = stack.pop() as string;
    if (out.has(n)) continue;
    out.add(n);
    stack.push(...(map.nodes[n]?.requires ?? []));
  }
  return out;
}

function hasCycle(map: MapFileT): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const r of map.nodes[id]?.requires ?? []) if (visit(r)) return true;
    state.set(id, 2);
    return false;
  };
  return Object.keys(map.nodes).some(visit);
}

// ── colour helpers (theme lint)

const hexRgb = (h: string) =>
  [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(h: string): number {
  const [r, g, b] = hexRgb(h).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
function lab(h: string): [number, number, number] {
  const [r, g, b] = hexRgb(h).map(linear) as [number, number, number];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
/** CIEDE2000 colour difference. */
export function deltaE2000(c1: string, c2: string): number {
  const [L1, a1, b1] = lab(c1);
  const [L2, a2, b2] = lab(c2);
  const rad = Math.PI / 180;
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (x: number, y: number) => (x === 0 && y === 0 ? 0 : (Math.atan2(y, x) / rad + 360) % 360);
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  let dh = h2p - h1p;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = L2 - L1;
  const dC = C2p - C1p;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * rad) / 2);
  const Lb = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hb = h1p + h2p;
  if (C1p * C2p !== 0) {
    hb = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
    if (Math.abs(h1p - h2p) > 180 && h1p + h2p >= 360) hb -= 360;
  }
  const T =
    1 -
    0.17 * Math.cos((hb - 30) * rad) +
    0.24 * Math.cos(2 * hb * rad) +
    0.32 * Math.cos((3 * hb + 6) * rad) -
    0.2 * Math.cos((4 * hb - 63) * rad);
  const dTh = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTh * rad) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
export const lightnessL = (h: string) => lab(h)[0];

// ── text normalisation (mirrors the grader's normalize options)

export function normalizeAnswer(s: string, opts: readonly string[] = ["case", "punct", "space"]): string {
  let t = s.normalize("NFC");
  if (opts.includes("case")) t = t.toLowerCase();
  if (opts.includes("accents")) t = t.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  if (opts.includes("punct")) t = t.replace(/[\p{P}\p{S}]/gu, " ");
  if (opts.includes("space")) t = t.replace(/\s+/g, " ").trim();
  return t;
}

// ── local graders for widgets whose spec grader may still be a placeholder

function gradeWidget(id: string, props: Obj, goal: Obj, solution: unknown): string | undefined {
  const sol = isObj(solution) ? solution : {};
  switch (id) {
    case "tile-builder": {
      const tiles = new Set((props.tiles as Obj[]).map((t) => t.id as string));
      const accept = goal.accept as string[][];
      for (const seq of accept) for (const t of seq) if (!tiles.has(t)) return `goal uses unknown tile "${t}"`;
      for (const seq of accept) if (new Set(seq).size !== seq.length) return "a tile id appears twice in one sequence";
      const seq = sol.sequence as string[] | undefined;
      if (!seq || !accept.some((a) => a.join("\u0000") === seq.join("\u0000")))
        return "solution is not an accepted sequence";
      return undefined;
    }
    case "listen": {
      if (!props.tts && !props.src) return "listen needs tts or src";
      if (goal.kind === "type") {
        const norm = (goal.normalize as string[] | undefined) ?? ["case", "punct", "space"];
        const ok = (goal.accept as string[]).some(
          (a) => normalizeAnswer(a, norm) === normalizeAnswer(String(sol.text ?? ""), norm),
        );
        return ok ? undefined : "solution text is not accepted";
      }
      if (goal.kind === "choice") {
        if (!(props.options as string[] | undefined)?.includes(goal.answer as string))
          return "choice answer not in options";
        return sol.choice === goal.answer ? undefined : "solution choice is wrong";
      }
      return undefined;
    }
    case "ab-compare":
      return sol.pick === goal.answer ? undefined : "solution pick doesn't match";
    case "dialogue": {
      const nodes = new Map((props.nodes as Obj[]).map((n) => [n.id as string, n]));
      if (!nodes.has(props.start as string)) return "start node missing";
      for (const n of nodes.values()) {
        for (const c of (n.choices as Obj[] | undefined) ?? []) {
          if (c.next !== null && !nodes.has(c.next as string))
            return `choice points to missing node "${String(c.next)}"`;
        }
        const reply = n.reply as Obj | undefined;
        if (reply && (!nodes.has(reply.next as string) || !nodes.has(reply.else as string)))
          return `reply on "${String(n.id)}" points to a missing node`;
      }
      const path = sol.path as string[] | undefined;
      if (!path || path[0] !== props.start) return "solution path must start at start";
      let good = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const from = nodes.get(path[i] as string);
        const to = path[i + 1];
        const choice = ((from?.choices as Obj[] | undefined) ?? []).find((c) => c.next === to);
        const reply = from?.reply as Obj | undefined;
        if (choice) {
          if (choice.good) good++;
        } else if (!reply || reply.next !== to) return `solution path has no step ${String(path[i])} → ${String(to)}`;
        if (!choice && reply) {
          const typed = (sol.typed as Record<string, string> | undefined)?.[path[i] as string];
          const norm = (reply.normalize as string[] | undefined) ?? ["case", "punct", "space"];
          if (
            !typed ||
            !(reply.accept as string[]).some((a) => normalizeAnswer(a, norm) === normalizeAnswer(typed, norm))
          )
            return `solution typed reply at "${String(path[i])}" is not accepted`;
        }
      }
      if (sol.goodCount !== good)
        return `solution goodCount ${String(sol.goodCount)} ≠ ${good} good choices on the path`;
      const last = path[path.length - 1] as string;
      if (sol.endedAt !== last) return "solution endedAt must be the last node of the path";
      if (goal.kind === "reach" && !(goal.endings as string[]).includes(last))
        return "solution doesn't reach an ending";
      if (goal.kind === "good-choices" && good < (goal.min as number)) return "solution has too few good choices";
      return undefined;
    }
    default: {
      const spec = widgetSpecRegistry.get(id as never);
      if (!spec) return `unknown widget ${id}`;
      const p = spec.props.safeParse(props);
      const g = spec.goal?.safeParse(goal);
      const a = spec.answer.safeParse(solution);
      if (!p.success || !g?.success || !a.success) return "props, goal or solution don't parse";
      const errors = spec.validate(p.data, g.data);
      if (errors.length) return errors.join("; ");
      const r = spec.grade({ props: p.data, goal: g.data, answer: a.data });
      if (!r.correct && !r.feedback?.includes("not implemented")) return "solution does not grade correct";
      return undefined;
    }
  }
}

// ── the checker

export function checkPack(pack: LoadedPack): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const { manifest, map } = pack;
  const profile = PROFILE[manifest.profile];
  const lang = manifest.lang;
  const target = manifest.targetLang;
  const w = (s: string | undefined, l = lang) => (s ? words(s, l) : 0);
  const issue = (rule: string, file: string, message: string) => issues.push({ rule, file, message });

  // Theme (L014).
  const t = manifest.theme;
  const L = lightnessL(t.ground);
  if (t.mode === "light" ? L <= 88 : L >= 25) issue("L014", "pack.yaml", `ground L* ${L.toFixed(1)} out of range`);
  for (const c of t.lines) {
    if (contrast(c, t.ground) < 3) issue("L014", "pack.yaml", `${c} contrast < 3:1 vs ground`);
    for (const ref of ["#FFC23D", "#E5793F", "#12877A"])
      if (deltaE2000(c, ref) < 15) issue("L014", "pack.yaml", `${c} within ΔE 15 of ${ref}`);
  }

  // DAG (L007).
  if (hasCycle(map)) issue("L007", "map.yaml", "cycle");
  for (const [id, e] of Object.entries(map.nodes)) {
    if (e.requires.length > 4) issue("L007", "map.yaml", `${id} has in-degree > 4`);
    if (e.status !== "planned")
      for (const r of e.requires)
        if (map.nodes[r]?.status === "planned") issue("L007", "map.yaml", `planned ${r} is a prerequisite of ${id}`);
  }
  // Gates: covers, every card covered, the map ends in a checkpoint, cadence, sampler planned beyond the end.
  if (!hasCycle(map)) for (const i of gateShapeIssues(map, manifest.profile)) issue(i.rule, i.file, i.message);

  // Nodes.
  let packItems = 0;
  let packProduction = 0;
  for (const [id, node] of pack.nodes) {
    const file = `nodes/${id}.yaml`;
    const anc = ancestors(map, id);
    const misIds = new Set(Object.keys(node.misconceptions));
    // The card shape: beats, word caps, close and teaser, guess keys, items and transfer items.
    for (const i of cardShapeIssues(id, node, manifest.profile, target ?? lang)) issue(i.rule, file, i.message);

    if (words(node.title) > 6) issue("title", file, "title over 6 words");
    if (node.estMinutes < 2 || node.estMinutes > 4) issue("estMinutes", file, "estMinutes outside 2–4");
    if (misIds.size < 2) issue("L011", file, "fewer than 2 misconceptions");
    for (const [mid, m] of Object.entries(node.misconceptions)) {
      if (w(m.hint) > 30) issue("L002", file, `hint ${mid} over 30 words`);
      if (m.upstream !== undefined && !anc.has(m.upstream))
        issue("L008", file, `${mid}: upstream ${m.upstream} is not an ancestor`);
    }

    const ids = new Set<string>();
    const claim = (iid: string | undefined) => {
      if (!iid) return;
      if (ids.has(iid)) issue("ids", file, `duplicate id ${iid}`);
      ids.add(iid);
    };
    const checkMis = (m: string | undefined, where: string) => {
      if (m && !misIds.has(m)) issue("L008", file, `${where}: unknown misconception ${m}`);
    };

    const checkInteraction = (it: Interaction | Item | Obj, where: string, isHook = false): void => {
      const x = it as Obj & { kind: string; id?: string; prompt: string };
      claim(x.id);
      if (w(x.prompt) > 40) issue("L001", file, `${where}: prompt over 40 words`);
      if (w(x.feedbackRight as string | undefined) > 20) issue("L002", file, `${where}: feedbackRight over 20 words`);
      if (w(x.why as string | undefined) > 25) issue("L002", file, `${where}: why over 25 words`);
      for (const [k, ow] of Object.entries((x.onWrong as Record<string, Obj> | undefined) ?? {})) {
        checkMis(ow.misconception as string | undefined, `${where} onWrong ${k}`);
        if (k !== "default" && ["cloze", "match", "widget", "html"].includes(x.kind))
          issue("onWrong", file, `${where}: onWrong "${k}" is never consulted (${x.kind} grades with "default" only)`);
        if (w(ow.feedback as string | undefined) > 25) issue("L002", file, `${where}: onWrong feedback over 25 words`);
      }
      checkAnswer(x, where, isHook);
    };

    const checkAnswer = (x: Obj & { kind: string }, where: string, isHook: boolean): void => {
      switch (x.kind) {
        case "choice": {
          const opts = x.options as { id: string; text: string; misconception?: string }[];
          const optIds = opts.map((o) => o.id);
          const answers = Array.isArray(x.answer) ? (x.answer as string[]) : [x.answer as string];
          for (const a of answers) if (!optIds.includes(a)) issue("L009", file, `${where}: answer ${a} not an option`);
          for (const o of opts) {
            checkMis(o.misconception, `${where} option ${o.id}`);
            if (!answers.includes(o.id) && !o.misconception)
              issue("L011", file, `${where}: distractor ${o.id} untagged`);
          }
          const texts = opts.map((o) => normalizeAnswer(o.text));
          if (
            opts.length === 2 &&
            (texts.every((s) => ["true", "false"].includes(s)) || texts.every((s) => ["yes", "no"].includes(s)))
          )
            issue("L018", file, `${where}: True/False item`);
          if (isHook) {
            if (opts.length < 3 || opts.length > 4) issue("G3", file, `${where}: hook needs 3–4 options`);
            const ans = opts.find((o) => o.id === answers[0]);
            if (ans && normalizeAnswer(String(x.prompt)).includes(normalizeAnswer(ans.text)))
              issue("L005", file, `${where}: hook prompt contains the answer`);
          }
          break;
        }
        case "order": {
          const n = (x.items as unknown[]).length;
          const a = [...(x.answer as number[])].sort((p, q) => p - q);
          if (a.length !== n || a.some((v, i) => v !== i))
            issue("L009", file, `${where}: order answer is not a permutation`);
          break;
        }
        case "match": {
          const l = (x.left as unknown[]).length;
          const r = (x.right as unknown[]).length;
          for (const [a, b] of x.answer as [number, number][])
            if (a < 0 || a >= l || b < 0 || b >= r) issue("L009", file, `${where}: match pair out of range`);
          break;
        }
        case "cloze": {
          const blanks = Object.keys(x.blanks as Obj);
          const used = [...String(x.text).matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
          if (blanks.sort().join() !== [...new Set(used)].sort().join())
            issue("L009", file, `${where}: cloze blanks mismatch`);
          if (target) checkCoreAccents(x.normalize, where);
          break;
        }
        case "text":
          if (target && x.lang === target) checkCoreAccents(x.normalize, where);
          break;
        case "explain": {
          const kp = x.keyPoints as unknown[];
          if ((x.minHits as number) > kp.length) issue("L009", file, `${where}: minHits > keyPoints`);
          if (w(x.exemplar as string) > 30) issue("L002", file, `${where}: exemplar over 30 words`);
          checkInteraction(x.offline as Obj, `${where} offline`);
          break;
        }
        case "widget": {
          const ref = x.widget as Obj;
          if (!isObj(ref.goal)) issue("L009", file, `${where}: widget interaction without goal`);
          else {
            const err = gradeWidget(ref.id as string, ref.props as Obj, ref.goal, x.solution);
            if (err) issue("L009", file, `${where}: ${ref.id}: ${err}`);
            checkWidgetLang(ref, where);
          }
          checkInteraction(x.fallback as Obj, `${where} fallback`);
          break;
        }
      }
    };

    /** Widget graders (listen, dialogue) accept accent slips only when "accents" is normalised away. */
    const checkAccents = (accept: string[], normalize: unknown, where: string) => {
      const norm = (normalize as string[] | undefined) ?? [];
      if (accept.some((a) => /[^\p{ASCII}]/u.test(a)) && !norm.includes("accents"))
        issue("accents", file, `${where}: Spanish answer with accents but no "accents" normalisation`);
    };
    /**
     * The core grader always accepts accent slips on text and cloze, and adds a gentle "Mind the accents"
     * note unless "accents" is normalised away, which would silence it.
     */
    const checkCoreAccents = (normalize: unknown, where: string) => {
      if (((normalize as string[] | undefined) ?? []).includes("accents"))
        issue("accents", file, `${where}: "accents" normalisation hides the gentle accent note`);
    };

    const checkWidgetLang = (ref: Obj, where: string) => {
      const props = ref.props as Obj;
      const goal = ref.goal as Obj | undefined;
      if (ref.id === "listen") {
        if (!isObj(props.tts) && !props.src) issue("audio", file, `${where}: listen without tts or src`);
        if (target && isObj(props.tts) && props.tts.lang !== target)
          issue("audio", file, `${where}: listen tts lang ≠ ${target}`);
        if (target && goal?.kind === "type") checkAccents(goal.accept as string[], goal.normalize, where);
      }
      if (ref.id === "dialogue" && target) {
        const c = props.character as Obj;
        if (c.lang && c.lang !== target) issue("audio", file, `${where}: dialogue character lang ≠ ${target}`);
        for (const n of props.nodes as Obj[]) {
          const reply = n.reply as Obj | undefined;
          if (reply) checkAccents(reply.accept as string[], reply.normalize, `${where} reply ${String(n.id)}`);
        }
      }
    };

    // Hook.
    checkInteraction(node.hook.interaction, "hook", true);

    // Beats.
    let nonChoice = 0;
    for (const s of node.screens) {
      const where = `beat ${s.id}`;
      const it = s.interaction;
      if (s.reveal && w(s.reveal.text) > 50) issue("L001", file, `${where}: reveal over 50 words`);
      for (const [k, v] of Object.entries(s.alts ?? {}))
        if (w(v) > 60) issue("L002", file, `${where}: alt ${k} over 60`);
      const canvasIsWidget =
        it?.kind === "widget" || it?.kind === "html" || (s.visual ?? node.visual)?.kind === "widget";
      if (it?.kind !== "widget" && it?.kind !== "html" && !s.visual && !node.visual)
        issue("L004", file, `${where}: no picture`);
      if (it?.kind === "choice" && canvasIsWidget)
        for (const o of it.options)
          if (!o.visualState) issue("L019", file, `${where}: option ${o.id} lacks visualState`);
      if (it && it.kind !== "choice" && it.kind !== "explain") nonChoice++;
      if (it) checkInteraction(it, where);
    }
    if (nonChoice < profile.nonChoiceScreens)
      issue("L018", file, `${nonChoice} beats with a non-choice action, need ${profile.nonChoiceScreens}`);

    // Items.
    const items = node.items;
    const choices = items.filter((i) => i.kind === "choice").length;
    if (choices / items.length > 0.4) issue("L018", file, `choice share ${choices}/${items.length} > 40%`);
    for (const it of items) checkInteraction(it, `item ${it.id}`);
    const production = items.filter(
      (i) =>
        i.kind === "text" ||
        i.kind === "cloze" ||
        (i.kind === "widget" &&
          (i.widget.id === "tile-builder" ||
            (i.widget.id === "listen" && (i.widget.goal as Obj | undefined)?.kind === "type"))),
    ).length;
    packItems += items.length;
    packProduction += production;

    // Flashcards, toy, under the hood, FAQ.
    for (const c of node.flashcards ?? []) {
      claim(c.id);
      if (w(c.front) > 20) issue("L002", file, `flashcard ${c.id} front over 20`);
      if (w(c.back) > 25) issue("L002", file, `flashcard ${c.id} back over 25`);
    }
    if (node.toy && w(node.toy.prompt) > 20) issue("L002", file, "toy prompt over 20");
    if (node.underTheHood && w(node.underTheHood.body) > 200) issue("L002", file, "under the hood over 200");
    for (const f of node.faq ?? []) if (w(f.a) > 60) issue("L002", file, "faq answer over 60");
    if ((node.faq ?? []).length > 3) issue("L002", file, "more than 3 FAQ entries");

    if (node.sources.length === 0) issue("sources", file, "no sources");
  }

  if (target && manifest.profile === "curated" && packProduction / packItems < 0.5)
    issue("L022", "pack", `production items ${packProduction}/${packItems} < 50%`);

  // Banned phrases and exclamation marks in every authored string.
  for (const rel of ["pack.yaml", "map.yaml", ...[...pack.nodes.keys()].map((n) => `nodes/${n}.yaml`)]) {
    const text = readFileSync(join(pack.dir, rel), "utf8");
    for (const re of BANNED) if (re.test(text)) issue("L012", rel, `banned phrase ${re}`);
    if (EMOJI.test(text)) issue("L012", rel, "emoji");
    if (/[!¡]/.test(text.replace(/^#.*$/gm, ""))) issue("voice", rel, "exclamation mark");
  }
  return issues;
}

/** Interaction ids and kinds per node, for tests that need the raw counts. */
export function productionShare(pack: LoadedPack): { production: number; items: number } {
  let production = 0;
  let items = 0;
  for (const node of pack.nodes.values()) {
    for (const i of node.items) {
      items++;
      if (
        i.kind === "text" ||
        i.kind === "cloze" ||
        (i.kind === "widget" &&
          (i.widget.id === "tile-builder" ||
            (i.widget.id === "listen" && (i.widget.goal as Obj | undefined)?.kind === "type")))
      )
        production++;
    }
  }
  return { production, items };
}
