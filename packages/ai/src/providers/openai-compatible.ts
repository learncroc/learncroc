/**
 * OpenAI-compatible adapter: fetch to {baseUrl}/v1/chat/completions. Covers OpenAI, OpenRouter,
 * LM Studio, vLLM and llama.cpp. Structured output uses response_format json_schema where the
 * server supports it, else JSON mode, then zod validation and one repair round.
 */
import type { ChatTurn, Usage } from "@learncroc/core";
import { AiError } from "../errors";
import type { AIProvider, ObjectRequest, TextRequest } from "../types";
import {
  ensureOk,
  generateWithRepair,
  jsonSchemaOf,
  lines,
  type ProviderConfig,
  systemText,
  ThinkFilter,
  timedFetch,
} from "./shared";

interface ChatChunk {
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}
interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: ChatChunk["usage"];
}

function usageOf(u: ChatChunk["usage"]): Usage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    ...(u?.prompt_tokens_details?.cached_tokens ? { cacheReadTokens: u.prompt_tokens_details.cached_tokens } : {}),
  };
}

/** "https://api.openai.com" and "https://api.openai.com/v1" both work. */
export function chatUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return /\/v\d+$/.test(base) ? `${base}${path}` : `${base}/v1${path}`;
}

export class OpenAiCompatibleProvider implements AIProvider {
  readonly id = "openai-compatible" as const;
  readonly capabilities = { structuredOutput: true, caching: false, streaming: true, maxContext: 128_000 };
  private jsonSchemaSupported = true;
  private readonly f: typeof fetch;

  constructor(private readonly config: ProviderConfig) {
    if (!config.baseUrl) throw new AiError("ai_not_configured", "no base URL for the OpenAI-compatible server", "none");
    this.f = config.fetch ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
    };
  }

  private messages(req: TextRequest, turns: ChatTurn[] = req.messages) {
    return [
      { role: "system", content: systemText(req.system) },
      ...turns.map((m) => ({ role: m.role, content: m.content })),
    ];
  }

  async *streamText(req: TextRequest, signal?: AbortSignal): AsyncIterable<{ text: string } | { thinking: true }> {
    const res = await timedFetch(
      this.f,
      chatUrl(this.config.baseUrl as string, "/chat/completions"),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.models[req.tier],
          messages: this.messages(req),
          max_tokens: req.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        }),
      },
      this.config.timeoutMs ?? 120_000,
      signal,
    );
    await ensureOk(res, "the chat server");
    if (!res.body) throw new AiError("provider_error", "empty stream");
    const filter = new ThinkFilter();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let sawText = false;
    for await (const line of lines(res.body)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") break;
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(data) as ChatChunk;
      } catch {
        continue;
      }
      if (chunk.usage) usage = usageOf(chunk.usage);
      const delta = chunk.choices?.[0]?.delta;
      if ((delta?.reasoning_content || delta?.reasoning) && !sawText) yield { thinking: true };
      if (delta?.content) {
        const out = filter.push(delta.content);
        if (out.thinking && !sawText) yield { thinking: true };
        if (out.text) {
          sawText = true;
          yield { text: out.text };
        }
      }
    }
    req.onUsage?.(usage);
  }

  private async complete(req: TextRequest, turns: ChatTurn[], format: unknown, signal?: AbortSignal) {
    const res = await timedFetch(
      this.f,
      chatUrl(this.config.baseUrl as string, "/chat/completions"),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.models[req.tier],
          messages: this.messages(req, turns),
          max_tokens: req.maxTokens,
          response_format: format,
        }),
      },
      this.config.timeoutMs ?? 300_000,
      signal,
    );
    return res;
  }

  async generateObject<T>(req: ObjectRequest<T>, signal?: AbortSignal): Promise<{ value: T; usage: Usage }> {
    const schema = jsonSchemaOf(req.schema);
    const out = await generateWithRepair(req, async (turns) => {
      let res = this.jsonSchemaSupported
        ? await this.complete(
            req,
            turns,
            { type: "json_schema", json_schema: { name: req.schemaName, schema, strict: false } },
            signal,
          )
        : undefined;
      if (!res || res.status === 400 || res.status === 422) {
        // The server doesn't support json_schema: fall back to JSON mode with the schema in the prompt.
        this.jsonSchemaSupported = false;
        const withSchema: ChatTurn[] = [
          ...turns.slice(0, -1),
          {
            role: "user",
            content: `${turns.at(-1)?.content ?? ""}\n\nReturn JSON matching this JSON Schema:\n${JSON.stringify(schema)}`,
          },
        ];
        res = await this.complete(req, withSchema, { type: "json_object" }, signal);
      }
      await ensureOk(res, "the chat server");
      const body = (await res.json()) as ChatResponse;
      return { text: body.choices?.[0]?.message?.content ?? "", usage: usageOf(body.usage) };
    });
    req.onUsage?.(out.usage);
    return out;
  }

  async listModels(): Promise<string[]> {
    const res = await timedFetch(
      this.f,
      chatUrl(this.config.baseUrl as string, "/models"),
      { headers: this.headers() },
      10_000,
    );
    await ensureOk(res, "the model list");
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id).sort();
  }
}
