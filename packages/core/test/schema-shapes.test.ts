import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import packJson from "../fixtures/mini-pack/pack.json";
import progressJson from "../fixtures/progress.json";
import {
  API_ROUTES,
  AskEvent,
  BackdropId,
  CompiledPack,
  CREATE_SIZES,
  CROC_MAX_WORDS,
  CROC_NAME,
  CreateRequest,
  DEFAULT_SETTINGS,
  ExportFile,
  Item,
  JobStage,
  LOCAL_NUMBER_EXPLAIN,
  LocalNumbers,
  MapFile,
  MapNodeEntry,
  NodeProgress,
  NodeState,
  PackManifest,
  PackNode,
  PackProgress,
  ROUTE_KEYS,
  RunEvent,
  RunKind,
  RunPhase,
  Screen,
  Settings,
  SettingsPatch,
  StartRunBody,
} from "../src/index";
import { testCard } from "./support/pack";

const dir = join(import.meta.dir, "../fixtures/mini-pack");
const yaml = (rel: string) => parse(readFileSync(join(dir, rel), "utf8"));

describe("fixtures parse", () => {
  test("mini-pack sources, compiled pack and progress", () => {
    expect(PackManifest.safeParse(yaml("pack.yaml")).error?.issues ?? []).toEqual([]);
    expect(MapFile.safeParse(yaml("map.yaml")).error?.issues ?? []).toEqual([]);
    for (const f of readdirSync(join(dir, "nodes")))
      expect(PackNode.safeParse(yaml(`nodes/${f}`)).error?.issues ?? []).toEqual([]);
    expect(CompiledPack.safeParse(packJson).error?.issues ?? []).toEqual([]);
    expect(PackProgress.safeParse(progressJson).error?.issues ?? []).toEqual([]);
  });

  test("progress.json covers lit, lit, a lit gate, done, a ready gate and planned", () => {
    const p = PackProgress.parse(progressJson);
    expect(Object.fromEntries(Object.values(p.views).map((v) => [v.id, v.state]))).toEqual({
      units: "lit",
      "unit-conversion": "lit",
      "checkpoint-basics": "lit",
      speed: "done",
      "checkpoint-trip": "ready",
      "average-speed": "planned",
    });
    expect(p.nodes["checkpoint-basics"]?.source).toBe("checkpoint");
    expect(p.views.speed?.brightness).toBe(0);
  });
});

describe("cards", () => {
  test("a read-only beat (no interaction, no reveal) parses", () => {
    expect(Screen.safeParse({ id: "s2", blocks: [{ type: "story", text: "Read me." }] }).success).toBe(true);
  });

  test("a card needs a close with a teaser; 1–3 beats parse, 4 don't", () => {
    const card = testCard("x");
    expect(PackNode.safeParse(card).success).toBe(true);
    const { close: _c, ...noClose } = card;
    expect(PackNode.safeParse(noClose).success).toBe(false);
    expect(PackNode.safeParse({ ...card, close: { text: "x" } }).success).toBe(false);
    const beat = card.screens[1];
    expect(PackNode.safeParse({ ...card, screens: [beat, beat, beat, beat] }).success).toBe(false);
  });

  test("byGuess keys must look like guess keys", () => {
    const card = testCard("x");
    expect(PackNode.safeParse({ ...card, close: { ...card.close, byGuess: { "Bad Key": "x" } } }).success).toBe(false);
  });

  test("a revision-2 card fails as a strict object (sayIt, coldOpen, cards, hook.reveal, role)", () => {
    const card = testCard("x");
    const unknown = (v: unknown) =>
      PackNode.safeParse(v).error?.issues.some((i) => i.code === "unrecognized_keys") ?? false;
    expect(unknown({ ...card, sayIt: { prompt: "x" } })).toBe(true);
    expect(unknown({ ...card, coldOpen: card.hook })).toBe(true);
    expect(unknown({ ...card, cards: [] })).toBe(true);
    expect(PackNode.safeParse({ ...card, hook: { ...card.hook, reveal: "x" } }).success).toBe(false);
    expect(
      PackNode.safeParse({ ...card, screens: [{ ...card.screens[0], role: "teach" }, card.screens[1]] }).success,
    ).toBe(false);
  });

  test("items: use is checkpoint | relight; placement is gone; callback is allowed", () => {
    const base = { id: "i1", kind: "numeric", level: "apply", difficulty: 2, prompt: "1+1?", answer: 2 };
    expect(Item.safeParse({ ...base, use: ["checkpoint", "relight"], callback: true }).success).toBe(true);
    expect(Item.safeParse({ ...base, use: ["check"] }).success).toBe(false);
    expect(Item.safeParse({ ...base, placement: true }).success).toBe(false);
  });
});

describe("map and manifest", () => {
  test("checkpoint entries with covers and size parse; size is 3–5", () => {
    const e = { requires: ["a"], line: "l", kind: "checkpoint", covers: ["a"], size: 4 };
    expect(MapNodeEntry.safeParse(e).success).toBe(true);
    expect(MapNodeEntry.safeParse({ ...e, size: 6 }).success).toBe(false);
    expect(MapNodeEntry.safeParse({ ...e, kind: "boss" }).success).toBe(false);
  });

  test("manifest: schema 2, no guide, gateName and backdrop", () => {
    const m = yaml("pack.yaml");
    expect(PackManifest.safeParse({ ...m, schema: 1 }).success).toBe(false);
    expect(PackManifest.safeParse({ ...m, guide: { id: "g" } }).success).toBe(false);
    expect(PackManifest.safeParse({ ...m, entry: { placement: true } }).success).toBe(false);
    expect(PackManifest.safeParse({ ...m, theme: { ...m.theme, backdrop: "circuit-board" } }).success).toBe(true);
    expect(PackManifest.safeParse({ ...m, theme: { ...m.theme, terminusName: "x" } }).success).toBe(false);
  });

  test("BackdropId has the 16 backdrops", () => {
    expect(BackdropId.options).toEqual([
      "circuit-board",
      "factory-floor",
      "light-cones",
      "ice-core",
      "cable-globe",
      "staff-town",
      "iberia-road",
      "agora",
      "mountain",
      "fairground",
      "case-board",
      "prism",
      "sketchbook",
      "transit-grid",
      "terrain",
      "none",
    ]);
  });
});

describe("learner contracts", () => {
  test("RunKind, RunPhase and NodeState are exact", () => {
    expect(RunKind.options).toEqual(["card", "checkpoint", "relight"]);
    expect(RunPhase.options).toEqual(["hook", "screen", "close", "checkpoint", "relight", "done"]);
    expect(NodeState.options).toEqual([
      "locked",
      "ready",
      "in-progress",
      "done",
      "lit",
      "fading",
      "planned",
      "building",
    ]);
    expect(NodeProgress.shape.status.options).toEqual(["started", "done", "lit"]);
  });

  test("advance is a run event; stuck events are gone", () => {
    expect(RunEvent.safeParse({ type: "advance", screen: 1 }).success).toBe(true);
    expect(RunEvent.safeParse({ type: "stuck-open", stuckRunId: "x" }).success).toBe(false);
  });

  test("StartRunBody: card (mode, from), checkpoint, try; no quiz or node", () => {
    const ok = (v: unknown) => StartRunBody.safeParse(v).success;
    expect(ok({ kind: "card", packId: "mini-pack", target: "units" })).toBe(true);
    expect(ok({ kind: "card", packId: "mini-pack", target: "units", mode: "replay", from: "checkpoint-basics" })).toBe(
      true,
    );
    expect(ok({ kind: "card", packId: "mini-pack", target: "units", mode: "later" })).toBe(false);
    expect(ok({ kind: "checkpoint", packId: "mini-pack", target: "checkpoint-basics" })).toBe(true);
    expect(ok({ kind: "try", registry: "builtin", packId: "mini-pack" })).toBe(true);
    expect(ok({ kind: "quiz", packId: "mini-pack", nodeIds: [] })).toBe(false);
    expect(ok({ kind: "node", packId: "mini-pack", target: "units" })).toBe(false);
  });

  test("AskEvent sent carries mode, source and the hint level", () => {
    const sent = {
      type: "sent",
      mode: "hint",
      source: "offline",
      hintLevel: 2,
      payloadSummary: { lastAnswers: 0, prereqs: 0, tokensApprox: 0 },
    };
    expect(AskEvent.safeParse(sent).success).toBe(true);
    expect(AskEvent.safeParse({ ...sent, mode: "socratic" }).success).toBe(false);
    expect(AskEvent.safeParse({ ...sent, hintLevel: 3 }).success).toBe(false);
  });

  test("create: size short | standard | thorough with card ranges; job stages", () => {
    const req = { source: { kind: "text", text: "x", title: "x" }, familiarity: "none" };
    expect(CreateRequest.safeParse({ ...req, size: "short" }).success).toBe(true);
    expect(CreateRequest.safeParse(req).success).toBe(true);
    expect(CREATE_SIZES).toEqual({ short: [3, 5], standard: [6, 8], thorough: [9, 12] });
    expect(JobStage.options).toEqual(["fetch", "extract", "plan", "cards", "figures", "checkpoints", "write"]);
  });

  test("settings: croc reactions, sound.offered, firstRun.completedAt; no guessGate or placement", () => {
    const s = Settings.parse(DEFAULT_SETTINGS);
    expect(s.croc).toEqual({ reactions: "chatty" });
    expect(s.sound.offered).toBe(false);
    expect(s.firstRun).toEqual({ completed: false });
    expect("guessGate" in s.ai).toBe(false);
    expect("placement" in s.learning).toBe(false);
    expect(SettingsPatch.safeParse({ croc: { reactions: "quiet" }, sound: { offered: true } }).success).toBe(true);
  });

  test("export v2 may carry the local numbers; every number has an explanation", () => {
    const numbers = {
      nextDayExplain: { asked: 0, right: 0 },
      checkpointFirstTry: { attempted: 0, passedFirstTry: 0, perPack: {} },
      maps: { started: 0, finished: 0 },
      cameBack: { activeDays: 0, returned: 0 },
      linkToFirstCard: { medianSec: null, samples: 0, byModel: {} },
      cardCompletion: { opened: 0, closed: 0 },
      cardMinutes: { median: null, samples: 0 },
      workedAnswers: { beats: 0, needed: 0 },
      mostMissed: [],
      checkpointHints: { questions: 0, hinted: 0 },
      crocAsks: { chips: 0, freeText: 0 },
      relightPerWeek: { sessions: 0, weeks: 0 },
      now: 0,
    };
    expect(LocalNumbers.safeParse(numbers).success).toBe(true);
    expect(Object.keys(LOCAL_NUMBER_EXPLAIN).sort()).toEqual(
      Object.keys(numbers)
        .filter((k) => k !== "now")
        .sort(),
    );
    const file = {
      format: "learncroc-export",
      version: 2,
      exportedAt: "2026-10-20",
      tables: {},
      settings: {
        ...DEFAULT_SETTINGS,
        ai: { provider: "none", models: DEFAULT_SETTINGS.ai.models, tutorTier: "smart", monthlyCapUsd: 5 },
      },
      numbers,
    };
    expect(ExportFile.safeParse(file).error?.issues ?? []).toEqual([]);
    expect(ExportFile.safeParse({ ...file, version: 1 }).success).toBe(false);
  });
});

describe("routes and constants", () => {
  test("advance and numbers exist; stuck and placement are gone", () => {
    expect(ROUTE_KEYS).toBe(API_ROUTES);
    expect(API_ROUTES).toContain("POST /runs/:runId/advance");
    expect(API_ROUTES).toContain("GET /numbers");
    expect(API_ROUTES.some((r) => r.includes("stuck") || r.includes("placement"))).toBe(false);
  });

  test("the croc is Moss", () => {
    expect(CROC_NAME).toBe("Moss");
    expect(CROC_MAX_WORDS).toBe(75);
  });
});
