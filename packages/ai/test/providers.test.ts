import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { AnthropicProvider } from "../src/providers/anthropic";
import { FakeProvider } from "../src/providers/fake";
import { createProvider } from "../src/providers/index";
import { OllamaProvider } from "../src/providers/ollama";
import { chatUrl, OpenAiCompatibleProvider } from "../src/providers/openai-compatible";
import { extractJson, stripThink, ThinkFilter } from "../src/providers/shared";
import type { TextRequest } from "../src/types";
import { settings } from "./helpers";

const models = { fast: "m-fast", smart: "m-smart", deep: "m-deep" };
const req: TextRequest = {
  feature: "ask",
  tier: "smart",
  effort: "low",
  system: [{ text: "be brief", cache: "1h" }],
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 100,
};

type Call = { url: string; body: Record<string, unknown> };
function mockFetch(handler: (c: Call) => Response): { f: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
    const body = typeof raw === "string" && raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const c = { url, body };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  return { f, calls };
}

const sse = (lines: string[]) =>
  new Response(lines.map((l) => `data: ${l}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });

async function collect(it: AsyncIterable<{ text: string } | { thinking: true }>) {
  let text = "";
  let thinking = false;
  for await (const c of it) {
    if ("text" in c) text += c.text;
    else thinking = true;
  }
  return { text, thinking };
}

describe("shared helpers", () => {
  test("think blocks are stripped from whole replies and from streams", () => {
    expect(stripThink('<think>hmm</think>{"a":1}')).toBe('{"a":1}');
    const f = new ThinkFilter();
    const parts = ["Hel", "lo <thi", "nk>secret</th", "ink> world"].map((p) => f.push(p));
    expect(parts.map((p) => p.text).join("")).toBe("Hello  world");
    expect(parts.some((p) => p.thinking)).toBe(true);
  });
  test("JSON is extracted from fences and prose", () => {
    expect(extractJson('Sure:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here {"b":[1,2]} done')).toEqual({ b: [1, 2] });
  });
  test("chat URLs accept a base with or without /v1", () => {
    expect(chatUrl("https://api.example.com", "/chat/completions")).toBe("https://api.example.com/v1/chat/completions");
    expect(chatUrl("http://localhost:1234/v1/", "/models")).toBe("http://localhost:1234/v1/models");
  });
});

describe("OpenAI-compatible", () => {
  test("streams text and reports usage", async () => {
    const { f, calls } = mockFetch(() =>
      sse([
        JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }),
        JSON.stringify({ choices: [{ delta: { content: " there?" } }] }),
        JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
        "[DONE]",
      ]),
    );
    let usage: unknown;
    const p = new OpenAiCompatibleProvider({
      models,
      baseUrl: "https://x.test",
      apiKey: "sk-test-123456789",
      fetch: f,
    });
    const out = await collect(p.streamText({ ...req, onUsage: (u) => (usage = u) }));
    expect(out.text).toBe("Hello there?");
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(calls[0]?.url).toBe("https://x.test/v1/chat/completions");
    expect(calls[0]?.body.model).toBe("m-smart");
  });

  test("structured output falls back to JSON mode and repairs once", async () => {
    let n = 0;
    const { f, calls } = mockFetch(({ body }) => {
      n++;
      if ((body.response_format as { type: string }).type === "json_schema") return new Response("no", { status: 400 });
      const content = n === 2 ? '{"answer":"seven"}' : '{"answer":7}';
      return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    });
    const p = new OpenAiCompatibleProvider({ models, baseUrl: "https://x.test", fetch: f });
    const out = await p.generateObject({ ...req, schema: z.object({ answer: z.number() }), schemaName: "A" });
    expect(out.value).toEqual({ answer: 7 });
    expect(out.usage.inputTokens).toBe(10);
    expect(calls.length).toBe(3);
  });
});

describe("Ollama", () => {
  test("sets num_ctx, sends the JSON schema and strips think tags", async () => {
    const { f, calls } = mockFetch(() =>
      Response.json({
        message: { content: '<think>reasoning</think>{"answer":3}' },
        prompt_eval_count: 9,
        eval_count: 4,
      }),
    );
    const p = new OllamaProvider({ models, fetch: f });
    const out = await p.generateObject({
      ...req,
      feature: "create",
      schema: z.object({ answer: z.number() }),
      schemaName: "A",
    });
    expect(out.value.answer).toBe(3);
    const body = calls[0]?.body as { options: { num_ctx: number }; format: { type: string } };
    expect(body.options.num_ctx).toBe(32768);
    expect(body.format.type).toBe("object");
  });

  test("streams NDJSON", async () => {
    const lines = [
      { message: { content: "Hi" } },
      { message: { content: " you?" } },
      { done: true, prompt_eval_count: 1, eval_count: 2 },
    ];
    const { f } = mockFetch(() => new Response(lines.map((l) => JSON.stringify(l)).join("\n")));
    const out = await collect(new OllamaProvider({ models, fetch: f }).streamText(req));
    expect(out.text).toBe("Hi you?");
  });
});

describe("Anthropic", () => {
  test("structured output: parse, usage with cache reads, effort and the refusal fallback on Sonnet", async () => {
    const { f, calls } = mockFetch(() =>
      Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: '{"answer":42}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 },
      }),
    );
    const p = new AnthropicProvider({
      models: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5", deep: "claude-opus-5-5" },
      apiKey: "sk-ant-test",
      fetch: f,
    });
    const out = await p.generateObject({
      ...req,
      feature: "create",
      effort: "medium",
      schema: z.object({ answer: z.number() }),
      schemaName: "A",
    });
    expect(out.value).toEqual({ answer: 42 });
    expect(out.usage).toEqual({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 80 });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.fallbacks).toBe("default");
    // JSON calls run without thinking where the model allows it (Sonnet 5.5: between_tools).
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect((body.output_config as { effort: string }).effort).toBe("medium");
    const sys = body.system as { cache_control?: { ttl?: string } }[];
    expect(sys[0]?.cache_control?.ttl).toBe("1h");
  });

  test("a schema too large for strict decoding falls back to plain JSON, validated and repaired", async () => {
    let n = 0;
    const msg = (text: string) =>
      Response.json({
        id: `msg_g${n}`,
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    const { f, calls } = mockFetch(() => {
      n++;
      if (n === 1)
        return Response.json(
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "The compiled grammar is too large, which would cause performance issues.",
            },
          },
          { status: 400 },
        );
      if (n === 2) return msg('```json\n{"answer":"x"}\n```');
      return msg('{"answer":7}');
    });
    const p = new AnthropicProvider({
      models: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5", deep: "claude-opus-5-5" },
      apiKey: "sk-ant-test",
      fetch: f,
    });
    const schema = z.object({ answer: z.number() });
    const out = await p.generateObject({ ...req, tier: "fast", feature: "create", schema, schemaName: "BigDraft" });
    expect(out.value).toEqual({ answer: 7 });
    expect(out.usage.outputTokens).toBe(10);
    expect(calls).toHaveLength(3);
    const loose = calls[1]?.body as { output_config?: { format?: unknown }; system: { text: string }[] };
    expect(loose.output_config?.format).toBeUndefined();
    expect(loose.system.at(-1)?.text).toContain("JSON Schema");
    // Later calls for the same schema skip the strict attempt.
    const again = await p.generateObject({ ...req, tier: "fast", feature: "create", schema, schemaName: "BigDraft" });
    expect(again.value).toEqual({ answer: 7 });
    expect(calls).toHaveLength(4);
  });

  test("a refusal becomes a refusal error", async () => {
    const { f } = mockFetch(() =>
      Response.json({
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [],
        stop_reason: "refusal",
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      }),
    );
    const p = new AnthropicProvider({
      models: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5", deep: "claude-opus-5-5" },
      apiKey: "sk-ant-test",
      fetch: f,
    });
    await expect(
      p.generateObject({ ...req, tier: "fast", schema: z.object({ a: z.number() }), schemaName: "A" }),
    ).rejects.toMatchObject({ code: "refusal" });
  });
});

describe("provider factory", () => {
  test("none, missing keys and missing models give no provider", () => {
    expect(createProvider({ settings: settings({ provider: "none" }).ai })).toBeNull();
    expect(createProvider({ settings: settings({ provider: "anthropic" }).ai })).toBeNull();
    expect(createProvider({ settings: settings({ provider: "ollama" }).ai })).toBeNull();
    expect(createProvider({ settings: settings({ provider: "anthropic" }).ai, apiKey: "sk-ant-x" })?.id).toBe(
      "anthropic",
    );
    expect(createProvider({ settings: settings({ provider: "none" }).ai, fake: true })).toBeInstanceOf(FakeProvider);
  });
});
