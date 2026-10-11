/**
 * Pack-level lint rules: the graph and its checkpoints (L007, L024), banned words (L012), assets (L013),
 * theme (L014), review status (L017), html interactives (L020), audio (L021), production share (L022),
 * plus the manifest entry point.
 */
import { checkpointIds, gateGraph } from "../checkpoint";
import { childrenOf, dagOf, findCycle, missingRequires } from "../dag";
import { ASSET_PATH_RE, type CompiledPack, type PackNode } from "../schema/index";
import { words } from "../words";
import { gateShapeIssues } from "./card-shape";
import {
  contrastRatio,
  DARK_GROUND_MAX_L,
  LIGHT_GROUND_MIN_L,
  lightness,
  lineColourProblem,
  MIN_INK_CONTRAST,
  suggestLineColour,
} from "./color";
import { emit, type LintContext } from "./context";

export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_HTML_BYTES = 64 * 1024;

// ── L007: the graph

export function lintGraph(ctx: LintContext): void {
  const map = ctx.map;
  const dag = dagOf(map.nodes);
  for (const m of missingRequires(dag))
    emit(
      ctx,
      "L007",
      "error",
      "map.yaml",
      ["nodes", m.node, "requires"],
      `"${m.node}" requires unknown entry "${m.requires}"`,
    );
  const cycle = findCycle(dag);
  if (cycle) emit(ctx, "L007", "error", "map.yaml", ["nodes"], `cycle: ${cycle.join(" → ")}`);
  const status = (id: string) => map.nodes[id]?.status ?? "playable";
  for (const [id, e] of Object.entries(map.nodes)) {
    if (e.requires.length > 4)
      emit(
        ctx,
        "L007",
        "error",
        "map.yaml",
        ["nodes", id, "requires"],
        `"${id}" has ${e.requires.length} prerequisites (max 4)`,
      );
    if (status(id) === "playable")
      for (const r of e.requires)
        if (status(r) === "planned")
          emit(ctx, "L007", "error", "map.yaml", ["nodes", id, "requires"], `playable "${id}" requires planned "${r}"`);
    if (new Set(e.requires).size !== e.requires.length)
      emit(ctx, "L007", "error", "map.yaml", ["nodes", id, "requires"], "duplicate prerequisite");
    if (e.requires.includes(id))
      emit(ctx, "L007", "error", "map.yaml", ["nodes", id, "requires"], `"${id}" requires itself`);
  }
  if (cycle) return;
  for (const i of gateShapeIssues(map, ctx.profile)) emit(ctx, i.rule, i.severity, i.file, i.path, i.message);
  // Choice of path: the first section offers ≥ 2 roots, or ≥ 2 cards that open after the first root.
  const g = gateGraph(map.nodes);
  const firstGate = checkpointIds(g).find((id) => status(id) === "playable");
  const firstSection = new Set(firstGate ? g.topo.slice(0, g.topo.indexOf(firstGate)) : g.topo);
  const playable = Object.keys(map.nodes).filter(
    (id) => status(id) === "playable" && (map.nodes[id]?.kind ?? "node") === "node",
  );
  const roots = playable.filter((id) => (map.nodes[id]?.requires.length ?? 0) === 0);
  const sectionCards = playable.filter((id) => firstSection.has(id));
  if (sectionCards.length >= 4 && roots.length < 2) {
    const kids = childrenOf(dag);
    const first = roots[0];
    const opened = first
      ? (kids[first] ?? []).filter((k) => map.nodes[k]?.requires.length === 1 && status(k) === "playable")
      : [];
    if (opened.length < 2)
      emit(
        ctx,
        "L007",
        ctx.rules.choiceOfPath,
        "map.yaml",
        ["nodes"],
        "give the learner a choice: ≥ 2 roots, or ≥ 2 cards that open after the first root (B3)",
      );
  }
  if (roots.length === 0 && playable.length) emit(ctx, "L007", "error", "map.yaml", ["nodes"], "no playable root card");
  for (const line of map.lines) {
    if (!Object.values(map.nodes).some((n) => n.line === line.id))
      emit(ctx, "L007", "warn", "map.yaml", ["lines"], `line "${line.id}" has no cards`);
  }
}

// ── manifest entry points

export function lintManifest(ctx: LintContext): void {
  const m = ctx.manifest;
  const nodes = ctx.sources.nodes;
  const entry = m.entry;
  if (entry.suggestedStart && !nodes[entry.suggestedStart])
    emit(
      ctx,
      "L009",
      "error",
      "pack.yaml",
      ["entry", "suggestedStart"],
      `suggestedStart "${entry.suggestedStart}" isn't a playable card`,
    );
  if (m.publisher === "learncroc" && m.profile !== "curated" && m.profile !== "sampler")
    emit(
      ctx,
      "L017",
      "error",
      "pack.yaml",
      ["profile"],
      'packs published by "learncroc" use the curated or sampler profile',
    );
  for (const [id, lm] of Object.entries(m.theme.landmarks ?? {})) {
    if (!ctx.map.nodes[id])
      emit(ctx, "L009", "warn", "pack.yaml", ["theme", "landmarks", id], `landmark for unknown entry "${id}"`);
    if (words(lm.name, ctx.lang) > 3)
      emit(ctx, "L002", "error", "pack.yaml", ["theme", "landmarks", id, "name"], "landmark names are ≤ 3 words");
  }
  if (words(m.tagline ?? "", ctx.lang) > 15)
    emit(ctx, "L002", "error", "pack.yaml", ["tagline"], "tagline is ≤ 15 words");
}

// ── L012: banned words

const BANNED: Record<string, { re: RegExp; label: string }[]> = {
  en: [
    { re: /\blearning styles?\b/i, label: "learning style" },
    { re: /\bstreaks?\b/i, label: "streak" },
    { re: /\bXP\b/, label: "XP" },
    { re: /\bgreat job\b/i, label: "Great job" },
    { re: /\bmost people\b/i, label: "Most people" },
  ],
  es: [
    { re: /\bestilos? de aprendizaje\b/i, label: "estilo de aprendizaje" },
    { re: /\brachas?\b/i, label: "racha" },
    { re: /\bXP\b/, label: "XP" },
    { re: /\bbuen trabajo\b/i, label: "buen trabajo" },
    { re: /\bla mayor[ií]a de la gente\b/i, label: "la mayoría de la gente" },
  ],
};
const EMOJI_RE = /\p{Extended_Pictographic}/u;
/** Keys whose strings are code, ids or paths, not learner-facing words. */
const NOT_TEXT = new Set([
  "id",
  "asset",
  "src",
  "expr",
  "answerExpr",
  "upstream",
  "misconception",
  "kind",
  "type",
  "role",
  "lang",
  "tex",
  "source",
  "url",
  "cacheKey",
  "prompt_id",
]);

export function lintBannedWords(ctx: LintContext): void {
  const primary = ctx.lang.slice(0, 2).toLowerCase();
  const lists = [...(BANNED.en ?? []), ...(primary === "en" ? [] : (BANNED[primary] ?? []))];
  const files: { file: string; value: unknown }[] = [
    { file: "pack.yaml", value: ctx.sources.manifest?.value },
    ...Object.entries(ctx.sources.nodes).map(([id, f]) => ({ file: `nodes/${id}.yaml`, value: f.value })),
  ];
  for (const { file, value } of files) {
    const walk = (v: unknown, path: (string | number)[], key: string) => {
      if (typeof v === "string") {
        if (NOT_TEXT.has(key)) return;
        for (const b of lists) if (b.re.test(v)) emit(ctx, "L012", "error", file, path, `banned phrase "${b.label}"`);
        if (EMOJI_RE.test(v)) emit(ctx, "L012", "error", file, path, "no emoji in learner-facing text");
        if (v.includes("!!")) emit(ctx, "L012", "error", file, path, 'no "!!"');
      } else if (Array.isArray(v))
        v.forEach((x, i) => {
          walk(x, [...path, i], key);
        });
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k], k);
    };
    walk(value, [], "");
  }
}

// ── L013: assets

function collectAssets(value: unknown, path: (string | number)[], out: { asset: string; path: (string | number)[] }[]) {
  if (Array.isArray(value))
    value.forEach((v, i) => {
      collectAssets(v, [...path, i], out);
    });
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (
        (k === "asset" || k === "src" || k === "background" || k === "avatar" || k === "audio") &&
        typeof v === "string"
      )
        out.push({ asset: v, path: [...path, k] });
      else collectAssets(v, [...path, k], out);
    }
  }
}

const MD_ASSET_LINK = /\]\(\s*(?:\.?\/)?assets\//i;
const MD_REMOTE_IMAGE = /!\[[^\]]*\]\(\s*(?:https?:)?\/\//i;

export async function lintAssets(ctx: LintContext): Promise<void> {
  const refs: { file: string; asset: string; path: (string | number)[] }[] = [];
  const add = (file: string, value: unknown) => {
    const found: { asset: string; path: (string | number)[] }[] = [];
    collectAssets(value, [], found);
    for (const f of found) refs.push({ file, ...f });
  };
  add("pack.yaml", ctx.sources.manifest?.value);
  for (const [id, f] of Object.entries(ctx.sources.nodes)) add(`nodes/${id}.yaml`, f.value);
  const files = new Set(ctx.sources.files);
  const checked = new Set<string>();
  for (const r of refs) {
    if (/^(https?:)?\/\//i.test(r.asset) || r.asset.startsWith("data:")) {
      emit(
        ctx,
        "L013",
        "error",
        r.file,
        r.path,
        `remote or inline asset "${r.asset.slice(0, 60)}": assets must be files in the pack`,
      );
      continue;
    }
    if (!ASSET_PATH_RE.test(r.asset) || r.asset.split("/").includes("..")) {
      emit(ctx, "L013", "error", r.file, r.path, `"${r.asset}" isn't an allowed asset path`);
      continue;
    }
    if (!files.has(r.asset)) {
      emit(ctx, "L013", "error", r.file, r.path, `asset not found: ${r.asset}`);
      continue;
    }
    if (checked.has(r.asset)) continue;
    checked.add(r.asset);
    if (ctx.fs.isInside && !(await ctx.fs.isInside(r.asset)))
      emit(ctx, "L013", "error", r.file, r.path, `${r.asset} resolves outside the pack`);
    const size = (await ctx.fs.size(r.asset)) ?? 0;
    const limit = r.asset.endsWith(".html") ? MAX_HTML_BYTES : MAX_ASSET_BYTES;
    if (size > limit) emit(ctx, "L013", "error", r.file, r.path, `${r.asset} is ${size} bytes (max ${limit})`);
    if (r.asset.endsWith(".svg") && ctx.sanitizeSvg) {
      const svg = await ctx.fs.readText(r.asset);
      if (ctx.sanitizeSvg(svg) !== svg)
        emit(
          ctx,
          "L013",
          "error",
          r.file,
          r.path,
          `${r.asset} changes when sanitised (scripts, handlers or foreign content)`,
        );
    }
    if (r.asset.endsWith(".html")) await lintHtmlAsset(ctx, r.file, r.path, r.asset);
  }
  let audio = 0;
  for (const f of ctx.sources.files) {
    if (!f.startsWith("assets/")) continue;
    if (!ASSET_PATH_RE.test(f) || (f.endsWith(".html") && !f.startsWith("assets/interactive/")))
      emit(
        ctx,
        "L013",
        "error",
        f,
        "",
        `"${f}" isn't an allowed asset (lowercase name; svg, png, webp, mp3, ogg, or html under assets/interactive/)`,
      );
    if (/\.(mp3|ogg)$/.test(f)) audio += (await ctx.fs.size(f)) ?? 0;
  }
  if (audio > MAX_AUDIO_BYTES)
    emit(ctx, "L013", "error", "assets/", "", `${audio} bytes of audio (max ${MAX_AUDIO_BYTES})`);
  // Markdown links into assets/ and remote images.
  for (const [id, f] of Object.entries(ctx.sources.nodes)) {
    const walk = (v: unknown, path: (string | number)[]) => {
      if (typeof v === "string") {
        if (MD_ASSET_LINK.test(v))
          emit(ctx, "L013", "error", `nodes/${id}.yaml`, path, "Markdown may not link into assets/");
        if (MD_REMOTE_IMAGE.test(v))
          emit(ctx, "L013", "error", `nodes/${id}.yaml`, path, "no remote images in Markdown");
      } else if (Array.isArray(v))
        v.forEach((x, i) => {
          walk(x, [...path, i]);
        });
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
    };
    walk(f.value, []);
  }
}

// ── L020: html interactives

const NETWORK_RE = [
  { re: /\bfetch\s*\(/, what: "fetch(" },
  { re: /\bXMLHttpRequest\b/, what: "XMLHttpRequest" },
  { re: /\bWebSocket\b/, what: "WebSocket" },
  { re: /\bEventSource\b/, what: "EventSource" },
  { re: /\bimport\s*\(/, what: "import(" },
  { re: /\bsendBeacon\b/, what: "sendBeacon" },
  { re: /\b(?:src|href|action)\s*=\s*["']?\s*(?:https?:)?\/\//i, what: "a remote src/href" },
  { re: /url\(\s*["']?\s*(?:https?:)?\/\//i, what: "a remote CSS url()" },
  { re: /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i, what: "a remote @import" },
];

/** Problems with an html interactive's source (also used for generated-html toys). */
export function htmlProblems(html: string): string[] {
  const out: string[] = [];
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > MAX_HTML_BYTES) out.push(`${bytes} bytes (max ${MAX_HTML_BYTES})`);
  for (const n of NETWORK_RE) if (n.re.test(html)) out.push(`uses ${n.what}`);
  if (!/\blm\s*\.\s*report\s*\(/.test(html))
    out.push("never calls lm.report(value), so it can't be graded or answered");
  return out;
}

async function lintHtmlAsset(ctx: LintContext, file: string, path: (string | number)[], asset: string): Promise<void> {
  const html = await ctx.fs.readText(asset);
  for (const p of htmlProblems(html)) emit(ctx, "L020", "error", file, path, `${asset}: ${p}`);
}

export function lintGeneratedHtml(ctx: LintContext): void {
  for (const [id, f] of Object.entries(ctx.sources.nodes)) {
    const walk = (v: unknown, path: (string | number)[]) => {
      if (Array.isArray(v))
        v.forEach((x, i) => {
          walk(x, [...path, i]);
        });
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (o.kind === "generated-html" && typeof o.html === "string")
          for (const p of htmlProblems(o.html)) emit(ctx, "L020", "error", `nodes/${id}.yaml`, [...path, "html"], p);
        for (const [k, x] of Object.entries(o)) walk(x, [...path, k]);
      }
    };
    walk(f.value, []);
  }
}

// ── L014: theme

export function lintTheme(ctx: LintContext): void {
  const t = ctx.manifest.theme;
  const sev = ctx.rules.theme;
  const L = lightness(t.ground);
  if (t.mode === "dark" && L >= DARK_GROUND_MAX_L)
    emit(
      ctx,
      "L014",
      sev,
      "pack.yaml",
      ["theme", "ground"],
      `a dark ground needs L* < ${DARK_GROUND_MAX_L} (is ${L.toFixed(1)})`,
    );
  if (t.mode === "light" && L <= LIGHT_GROUND_MIN_L)
    emit(
      ctx,
      "L014",
      sev,
      "pack.yaml",
      ["theme", "ground"],
      `a light ground needs L* > ${LIGHT_GROUND_MIN_L} (is ${L.toFixed(1)})`,
    );
  if (t.ink && contrastRatio(t.ink, t.ground) < MIN_INK_CONTRAST)
    emit(
      ctx,
      "L014",
      sev,
      "pack.yaml",
      ["theme", "ink"],
      `ink needs ≥ ${MIN_INK_CONTRAST}:1 on the ground (is ${contrastRatio(t.ink, t.ground).toFixed(2)}:1)`,
    );
  t.lines.forEach((hex, i) => {
    const p = lineColourProblem(hex, t.ground, t.mode);
    if (!p) return;
    const reasons = [
      ...(p.contrast < 3 ? [`contrast ${p.contrast.toFixed(2)}:1 (needs ≥ 3:1)`] : []),
      ...(p.near ? [`ΔE2000 ${p.near.deltaE.toFixed(1)} from ${p.near.token} (needs ≥ 15)`] : []),
    ];
    const suggestion = suggestLineColour(hex, t.ground, t.mode);
    emit(ctx, "L014", sev, "pack.yaml", ["theme", "lines", i], `line colour ${hex}: ${reasons.join(", ")}`, {
      ...(suggestion ? { example: `lines[${i}]: "${suggestion}"   # nearest passing colour` } : {}),
    });
  });
}

// ── L017: review status

export function lintReviews(ctx: LintContext): void {
  const reviews = ctx.sources.lock?.value?.reviews ?? [];
  const covered = (path: string) => reviews.some((r) => r.files.includes("*") || r.files.includes(path));
  const sev = ctx.rules.reviewed;
  if (ctx.manifest.status === "reviewed" && !covered("pack.yaml"))
    emit(
      ctx,
      "L017",
      sev,
      "pack.yaml",
      ["status"],
      'status "reviewed" needs a human review covering pack.yaml in pack.lock.yaml',
    );
  for (const [id, f] of Object.entries(ctx.sources.nodes)) {
    const path = `nodes/${id}.yaml`;
    if (f.value?.status === "reviewed" && !covered(path))
      emit(
        ctx,
        "L017",
        sev,
        path,
        ["status"],
        `status "reviewed" needs a human review covering ${path} in pack.lock.yaml`,
      );
  }
  if (ctx.manifest.publisher === "learncroc") {
    const drafts = Object.entries(ctx.sources.nodes).filter(([, f]) => f.value?.status === "draft").length;
    if (drafts)
      emit(
        ctx,
        "L017",
        "warn",
        "pack.yaml",
        ["status"],
        `${drafts} draft node(s): the app shows "AI-drafted, review pending"`,
      );
  }
}

// ── L021 / L022: language packs

export function lintLanguage(ctx: LintContext, pack?: CompiledPack): void {
  const target = ctx.manifest.targetLang;
  const nodes: [string, PackNode][] = pack
    ? Object.entries(pack.nodes)
    : Object.entries(ctx.sources.nodes).flatMap(([id, f]) => (f.value ? [[id, f.value] as [string, PackNode]] : []));
  // L021: rendered audio where it matters. Without a src but with text and a lang the player falls back to
  // the device voice (speechSynthesis), so that only warns; with neither there is nothing to play.
  const hasTts = (o: Record<string, unknown>) => {
    const t = o.tts as { text?: unknown; lang?: unknown } | undefined;
    return !!t && typeof t.text === "string" && t.text.trim() !== "" && typeof t.lang === "string" && t.lang !== "";
  };
  for (const [id, node] of nodes) {
    const file = `nodes/${id}.yaml`;
    const walk = (v: unknown, path: (string | number)[]) => {
      if (Array.isArray(v))
        v.forEach((x, k) => {
          walk(x, [...path, k]);
        });
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const audio =
          o.type === "audio"
            ? { what: "audio block", o }
            : o.id === "listen" && o.props && typeof o.props === "object"
              ? { what: "listen widget", o: o.props as Record<string, unknown> }
              : undefined;
        if (audio && typeof audio.o.src !== "string") {
          // A listen widget with neither is already an L010 error (its own validate).
          if (!hasTts(audio.o)) {
            if (o.type === "audio")
              emit(
                ctx,
                "L021",
                "error",
                file,
                path,
                "audio block has no rendered src and no tts text and lang: nothing to play",
              );
          } else if (target && ctx.profile === "curated")
            emit(
              ctx,
              "L021",
              "warn",
              file,
              path,
              `${audio.what} has no rendered src, so it falls back to the device voice`,
            );
        }
        for (const [k, x] of Object.entries(o)) walk(x, [...path, k]);
      }
    };
    walk(node, []);
  }
  // L022: ≥ 50% production items in curated language packs.
  if (target && ctx.profile === "curated") {
    const all = nodes.flatMap(([, n]) => n.items);
    const production = all.filter(
      (i) =>
        i.kind === "text" ||
        i.kind === "cloze" ||
        (i.kind === "widget" && i.widget.id === "tile-builder") ||
        (i.kind === "widget" &&
          i.widget.id === "listen" &&
          (i.widget.goal as { kind?: string } | undefined)?.kind === "type"),
    ).length;
    if (all.length && production / all.length < 0.5)
      emit(
        ctx,
        "L022",
        "error",
        "pack.yaml",
        ["targetLang"],
        `${Math.round((production / all.length) * 100)}% of items are production (needs ≥ 50%)`,
      );
  }
}
