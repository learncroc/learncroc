import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AttemptRow,
  type CompiledPack,
  CompiledPack as CompiledPackSchema,
  DEFAULT_SETTINGS,
  type RunState,
  type Settings,
} from "@learncroc/core";
import fixture from "@learncroc/core/fixtures/mini-pack/pack.json";
import { AiClient } from "../src/client";
import { type FakeOptions, FakeProvider } from "../src/providers/fake";
import type { UsageMeter } from "../src/usage";

export const pack: CompiledPack = CompiledPackSchema.parse(fixture);

export function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "lm-ai-test-"));
}

export function settings(over: Partial<Settings["ai"]> = {}): Settings {
  return { ...structuredClone(DEFAULT_SETTINGS), ai: { ...DEFAULT_SETTINGS.ai, provider: "anthropic", ...over } };
}

export const clock = {
  t: Date.UTC(2026, 9, 20, 9),
  now() {
    return this.t;
  },
};

export function fakeClient(opts: FakeOptions = {}, meter?: UsageMeter): AiClient {
  return new AiClient({
    provider: new FakeProvider({ delayMs: 0, thinkMs: 0, ...opts }),
    providerId: "fake",
    models: { fast: "fake-fast", smart: "fake-smart", deep: "fake-deep" },
    now: () => clock.now(),
    ...(meter ? { meter } : {}),
  });
}

export function run(over: Partial<RunState> = {}): RunState {
  return {
    id: "r1",
    kind: "card",
    packId: pack.manifest.id,
    packVersion: pack.manifest.version,
    target: "units",
    cursor: { phase: "screen", screen: 0 },
    queue: [],
    hints: {},
    assisted: [],
    seed: 1,
    startedAt: clock.now(),
    ...over,
  };
}

export function attempt(interactionId: string, over: Partial<AttemptRow> = {}): AttemptRow {
  return {
    runId: "r1",
    packId: pack.manifest.id,
    nodeId: "units",
    interactionId,
    phase: "screen",
    answer: { kind: "idk" },
    correct: false,
    score: 0,
    creditedScore: 0,
    counted: false,
    hintLevel: 0,
    assisted: false,
    ms: 1000,
    at: clock.now(),
    ...over,
  };
}
