#!/usr/bin/env bun
/**
 * bun run eval:local — the small fixed suite from PLAN §15.1 against one provider:
 *   1. a pocket map on 2 articles (completes? stops ready, time to the first playable stop, figures)
 *   2. explain grading on 20 labelled answers (agreement with the human label)
 *   3. hint leaks on 20 cases (hints that survive the guard, and how often the guard had to step in)
 *
 * Usage:
 *   bun scripts/eval/local.ts [--provider ollama|anthropic|openai-compatible] [--model NAME]
 *                             [--fast NAME --smart NAME] [--base-url URL] [--fake] [--out results.json]
 * Without --provider it uses the app's configured provider (env, then ~/.learncroc/config.json).
 * Results for a ~14B open model are published in docs/ai/local-models.md before each release.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AiRuntime, createAiRuntime, FileAiConfig, StaticAiConfig } from "@learncroc/ai";
import {
  CompiledPack,
  DEFAULT_SETTINGS,
  type Item,
  type JobEvent,
  type ProviderId,
  type Settings,
} from "@learncroc/core";
import fixture from "@learncroc/core/fixtures/mini-pack/pack.json";

const here = import.meta.dir;
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

function runtime(): { rt: AiRuntime; label: string } {
  const home = mkdtempSync(join(tmpdir(), "lm-eval-"));
  if (argv.includes("--fake"))
    return {
      rt: createAiRuntime({
        home,
        env: {},
        fake: { delayMs: 0, thinkMs: 0 },
        toyTimeoutMs: 200,
        ratePerMinute: 10_000,
      }),
      label: "fake",
    };
  const provider = opt("provider") as ProviderId | undefined;
  if (!provider) {
    const userHome = process.env.LEARNCROC_HOME ?? join(process.env.HOME ?? ".", ".learncroc");
    const config = new FileAiConfig(userHome);
    const s = config.settings();
    return {
      rt: createAiRuntime({ home, config, toyTimeoutMs: 500, ratePerMinute: 10_000 }),
      label: `${s.ai.provider} (${s.ai.models.smart || "preset"})`,
    };
  }
  const model = opt("model") ?? "";
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ai: {
      ...DEFAULT_SETTINGS.ai,
      provider,
      ...(opt("base-url")
        ? { baseUrl: opt("base-url") as string }
        : provider === "ollama"
          ? { baseUrl: "http://127.0.0.1:11434" }
          : {}),
      models: { fast: opt("fast") ?? model, smart: opt("smart") ?? model, deep: opt("smart") ?? model },
      monthlyCapUsd: 50,
    },
  };
  const key =
    provider === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : provider === "openai-compatible"
        ? process.env.OPENAI_API_KEY
        : undefined;
  return {
    rt: createAiRuntime({ home, config: new StaticAiConfig(settings, key), toyTimeoutMs: 500, ratePerMinute: 10_000 }),
    label: `${provider} (${opt("smart") ?? model})`,
  };
}

interface MapResult {
  article: string;
  ok: boolean;
  error?: string;
  stops: number;
  ready: number;
  failed: number;
  firstPlayableMs?: number;
  totalMs: number;
  figuresOk: number;
  figures: number;
  costUsd: number;
}

async function pocketMap(rt: AiRuntime, name: string): Promise<MapResult> {
  const text = readFileSync(join(here, "articles", `${name}.md`), "utf8");
  const home = mkdtempSync(join(tmpdir(), "lm-eval-map-"));
  const t0 = performance.now();
  const { jobId } = rt.startCreate(
    { source: { kind: "text", text, title: name }, size: "short", familiarity: "some" },
    home,
  );
  const events: JobEvent[] = [];
  let first: number | undefined;
  await new Promise<void>((resolve) => {
    rt.jobs.subscribe(jobId, (e) => {
      events.push(e);
      if (e.type === "card-ready" && first === undefined) first = performance.now() - t0;
      if (e.type === "done" || e.type === "error") resolve();
    });
  });
  const last = events.at(-1);
  const figs = events.filter((e) => e.type === "figure");
  return {
    article: name,
    ok: last?.type === "done",
    ...(last?.type === "error" ? { error: `${last.stage}: ${last.message}` } : {}),
    stops: events.filter((e) => e.type === "plan-node").length,
    ready: events.filter((e) => e.type === "card-ready").length,
    failed: events.filter((e) => e.type === "card-failed").length,
    ...(first !== undefined ? { firstPlayableMs: Math.round(first) } : {}),
    totalMs: Math.round(performance.now() - t0),
    figuresOk: figs.filter((e) => e.type === "figure" && e.ok).length,
    figures: figs.length,
    costUsd: last?.type === "done" ? last.costUsd : 0,
  };
}

async function grading(rt: AiRuntime): Promise<{ agree: number; total: number; noVerdict: number }> {
  const data = JSON.parse(readFileSync(join(here, "grading.json"), "utf8")) as {
    keyPoints: { id: string; text: string; keywords?: string[] }[];
    minHits: number;
    cases: { text: string; correct: boolean }[];
  };
  const pack = CompiledPack.parse(fixture);
  let agree = 0;
  let noVerdict = 0;
  for (const c of data.cases) {
    const g = await rt.gradeExplain({
      pack,
      nodeId: "units",
      target: "sayIt",
      keyPoints: data.keyPoints,
      minHits: data.minHits,
      text: c.text,
      runId: "eval",
    });
    if (!g) noVerdict++;
    else if (g.correct === c.correct) agree++;
  }
  return { agree, total: data.cases.length, noVerdict };
}

async function hints(rt: AiRuntime): Promise<{ total: number; clean: number; fellBack: number }> {
  const data = JSON.parse(readFileSync(join(here, "hint-cases.json"), "utf8")) as {
    cases: { prompt: string; options: string[]; answer: number; wrong: number; hint: string }[];
  };
  const base = CompiledPack.parse(fixture);
  const units = base.nodes.units;
  if (!units) throw new Error("fixture changed");
  const items: Item[] = data.cases.map((c, i) => ({
    id: `h${i + 1}`,
    kind: "choice",
    prompt: c.prompt,
    options: c.options.map((text, j) => ({ id: `o${j + 1}`, text })),
    answer: `o${c.answer + 1}`,
    level: "apply",
    difficulty: 2,
  }));
  const pack = { ...base, nodes: { ...base.nodes, units: { ...units, items } } };
  let clean = 0;
  let fellBack = 0;
  for (const [i, c] of data.cases.entries()) {
    const h = await rt.rewriteHint({
      pack,
      nodeId: "units",
      interactionId: `h${i + 1}`,
      answer: { kind: "choice", selected: `o${c.wrong + 1}` },
      authoredHint: c.hint,
      level: 1,
      runId: "eval",
    });
    if (h) clean++;
    else fellBack++;
  }
  return { total: data.cases.length, clean, fellBack };
}

const { rt, label } = runtime();
if (!rt.current()) {
  console.error(
    "No provider configured. Pass --provider ollama --model qwen3:14b (or set a key), or --fake for a dry run.",
  );
  process.exit(2);
}
console.log(`learncroc local-model eval · ${label}\n`);
const maps: MapResult[] = [];
for (const a of ["spaced-repetition", "sourdough"]) {
  process.stdout.write(`pocket map: ${a}… `);
  const r = await pocketMap(rt, a);
  maps.push(r);
  console.log(
    r.ok
      ? `ok (${r.ready}/${r.stops} stops, first playable ${((r.firstPlayableMs ?? 0) / 1000).toFixed(1)} s, total ${(r.totalMs / 1000).toFixed(1)} s)`
      : `failed: ${r.error}`,
  );
}
process.stdout.write("explain grading… ");
const g = await grading(rt);
console.log(`${g.agree}/${g.total} agree with the label${g.noVerdict ? ` (${g.noVerdict} no verdict)` : ""}`);
process.stdout.write("hint leaks… ");
const h = await hints(rt);
console.log(`${h.clean}/${h.total} hints usable; ${h.fellBack} fell back to the authored hint (leak or failure)`);

const summary = {
  provider: label,
  at: new Date().toISOString(),
  pocketMaps: maps,
  grading: g,
  hints: h,
  usage: rt.usage(),
};
console.log(`
| Check | Result |
|---|---|
| Pocket maps built | ${maps.filter((m) => m.ok).length} / ${maps.length} |
| Stops ready | ${maps.reduce((n, m) => n + m.ready, 0)} / ${maps.reduce((n, m) => n + m.stops, 0)} |
| First playable stop (median) | ${(([...maps].map((m) => m.firstPlayableMs ?? Number.NaN).sort((a, b) => a - b)[0] ?? 0) / 1000).toFixed(1)} s |
| Figures kept | ${maps.reduce((n, m) => n + m.figuresOk, 0)} / ${maps.reduce((n, m) => n + m.figures, 0)} |
| Grading agreement | ${g.agree} / ${g.total} |
| Hints usable (no leak) | ${h.clean} / ${h.total} |
`);
const out = opt("out");
if (out) {
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
process.exit(0);
