/**
 * The fake provider (LEARNCROC_FAKE_AI=1): deterministic answers built from each call's <input>
 * block, streamed with small delays so the UI's thinking and streaming states are visible.
 * Tests override `text` / `object` to script specific replies (leaks, refusals, broken toys).
 */
import type { Usage } from "@learncroc/core";
import { AiError } from "../errors";
import type { AiInput } from "../inputs";
import { readInputBlock } from "../prompts";
import { words } from "../text";
import type { AIProvider, ObjectRequest, TextRequest } from "../types";
import * as content from "./fake-content";

export interface FakeOptions {
  /** Delay between streamed chunks (ms). Default 18; tests use 0. */
  delayMs?: number;
  /** Delay before the first chunk, shown as "thinking". Default 250. */
  thinkMs?: number;
  /** Script a text reply; return undefined for the default. */
  text?: (req: TextRequest, input: AiInput | undefined) => string | undefined;
  /** Script an object; return undefined for the default. */
  object?: (schemaName: string, input: AiInput | undefined, req: ObjectRequest<unknown>) => unknown;
  /** Record of every request (tests inspect payloads). */
  log?: { feature: string; schemaName?: string; system: string; user: string }[];
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function lastUser(req: TextRequest): string {
  return [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
}

function inputOf(req: TextRequest): AiInput | undefined {
  for (const m of [...req.messages].reverse()) {
    const v = readInputBlock(m.content);
    if (v && typeof v === "object" && "kind" in v) return v as AiInput;
  }
  return undefined;
}

function usageFor(req: TextRequest, out: string): Usage {
  const inTok = Math.ceil((req.system.map((s) => s.text).join(" ").length + lastUser(req).length) / 4);
  return { inputTokens: inTok, outputTokens: Math.ceil(out.length / 4) };
}

export function defaultFakeObject(input: AiInput | undefined): unknown {
  switch (input?.kind) {
    case "create-skeleton":
      return content.fakeSkeleton(input);
    case "create-card":
      return content.fakeCard(input);
    case "card-judge":
      return content.fakeJudge(input);
    case "card-teaser":
      return content.fakeTeaser(input);
    case "create-figure":
      return content.fakeFigure(input);
    case "grade":
      return content.fakeGrade(input);
    case "hint":
      return content.fakeHint(input);
    case "quiz-variant":
      return content.fakeVariant(input);
    case "solve":
      return content.fakeSolve(input);
    case "cards":
      return content.fakeCards(input);
    case "author-plan":
      return content.fakeAuthorPlan(input);
    case "author-node":
      return content.fakeAuthorNode(input);
    case "author-practice":
      return content.fakeAuthorPractice(input);
    default:
      return undefined;
  }
}

export class FakeProvider implements AIProvider {
  readonly id = "fake" as const;
  readonly capabilities = { structuredOutput: true, caching: false, streaming: true, maxContext: 1_000_000 };

  constructor(private readonly opts: FakeOptions = {}) {}

  private record(req: TextRequest, schemaName?: string) {
    this.opts.log?.push({
      feature: req.feature,
      ...(schemaName ? { schemaName } : {}),
      system: req.system.map((s) => s.text).join("\n\n"),
      user: lastUser(req),
    });
  }

  async *streamText(req: TextRequest, signal?: AbortSignal): AsyncIterable<{ text: string } | { thinking: true }> {
    this.record(req);
    const input = inputOf(req);
    const scripted = this.opts.text?.(req, input);
    const out =
      scripted ?? (input?.kind === "croc" ? content.fakeCroc(input) : "Try this: the current task, then ask again.");
    yield { thinking: true };
    await sleep(this.opts.thinkMs ?? 250);
    const parts = out.match(/\S+\s*/g) ?? [];
    for (const p of parts) {
      if (signal?.aborted) throw new AiError("provider_error", "request cancelled");
      yield { text: p };
      await sleep(this.opts.delayMs ?? 18);
    }
    req.onUsage?.(usageFor(req, out));
  }

  async generateObject<T>(req: ObjectRequest<T>, signal?: AbortSignal): Promise<{ value: T; usage: Usage }> {
    this.record(req, req.schemaName);
    const input = inputOf(req);
    const raw = this.opts.object?.(req.schemaName, input, req as ObjectRequest<unknown>) ?? defaultFakeObject(input);
    if (raw === undefined) throw new AiError("provider_error", `fake provider has no fixture for ${req.schemaName}`);
    await sleep(Math.min(this.opts.thinkMs ?? 250, 400));
    if (signal?.aborted) throw new AiError("provider_error", "request cancelled");
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new AiError("provider_error", `fake ${req.schemaName} fixture failed validation`);
    const usage = usageFor(req, JSON.stringify(raw));
    req.onUsage?.(usage);
    return { value: parsed.data, usage };
  }

  async *streamObject<T>(req: ObjectRequest<T>, signal?: AbortSignal): AsyncIterable<{ partialJson: string }> {
    this.record(req, req.schemaName);
    const input = inputOf(req);
    const raw = this.opts.object?.(req.schemaName, input, req as ObjectRequest<unknown>) ?? defaultFakeObject(input);
    if (raw === undefined) throw new AiError("provider_error", `fake provider has no fixture for ${req.schemaName}`);
    const json = JSON.stringify(raw);
    await sleep(this.opts.thinkMs ?? 250);
    // Chunk at a size that makes nodes arrive one by one, like a real streamed skeleton.
    const step = Math.max(24, Math.ceil(json.length / 60));
    for (let i = step; i < json.length + step; i += step) {
      if (signal?.aborted) throw new AiError("provider_error", "request cancelled");
      yield { partialJson: json.slice(0, i) };
      await sleep((this.opts.delayMs ?? 18) * 3);
    }
    req.onUsage?.(usageFor(req, json));
  }

  async listModels(): Promise<string[]> {
    return ["fake-fast", "fake-smart", "fake-deep"];
  }
}

/** Word count helper re-exported for tests that script replies. */
export const fakeWords = words;
