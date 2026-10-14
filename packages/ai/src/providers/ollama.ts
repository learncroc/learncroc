/**
 * Ollama adapter: fetch to /api/chat with `format: <JSON Schema>`, num_ctx set explicitly (the
 * default context silently truncates long prompts) and <think> blocks stripped. No feature caps.
 */
import type { Usage } from "@learncroc/core";
import { DEFAULT_OLLAMA_URL } from "../models";
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

interface OllamaChunk {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** 16k for runtime features, 32k for create and build (whole articles). */
export function numCtxFor(feature: TextRequest["feature"]): number {
  return feature === "create" || feature === "build" ? 32_768 : 16_384;
}

export class OllamaProvider implements AIProvider {
  readonly id = "ollama" as const;
  readonly capabilities = { structuredOutput: true, caching: false, streaming: true, maxContext: 32_768 };
  private readonly f: typeof fetch;
  private readonly base: string;

  constructor(private readonly config: ProviderConfig) {
    this.f = config.fetch ?? fetch;
    this.base = (config.baseUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  }

  private body(req: TextRequest, stream: boolean, format?: unknown, turns = req.messages) {
    return JSON.stringify({
      model: this.config.models[req.tier],
      messages: [{ role: "system", content: systemText(req.system) }, ...turns],
      stream,
      ...(format ? { format } : {}),
      options: { num_ctx: numCtxFor(req.feature), num_predict: req.maxTokens },
    });
  }

  async *streamText(req: TextRequest, signal?: AbortSignal): AsyncIterable<{ text: string } | { thinking: true }> {
    const res = await timedFetch(
      this.f,
      `${this.base}/api/chat`,
      { method: "POST", headers: { "content-type": "application/json" }, body: this.body(req, true) },
      this.config.timeoutMs ?? 180_000,
      signal,
    );
    await ensureOk(res, "Ollama");
    if (!res.body) return;
    const filter = new ThinkFilter();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let sawText = false;
    for await (const line of lines(res.body)) {
      if (!line.trim()) continue;
      let chunk: OllamaChunk;
      try {
        chunk = JSON.parse(line) as OllamaChunk;
      } catch {
        continue;
      }
      if (chunk.message?.thinking && !sawText) yield { thinking: true };
      if (chunk.message?.content) {
        const out = filter.push(chunk.message.content);
        if (out.thinking && !sawText) yield { thinking: true };
        if (out.text) {
          sawText = true;
          yield { text: out.text };
        }
      }
      if (chunk.done) usage = { inputTokens: chunk.prompt_eval_count ?? 0, outputTokens: chunk.eval_count ?? 0 };
    }
    req.onUsage?.(usage);
  }

  async generateObject<T>(req: ObjectRequest<T>, signal?: AbortSignal): Promise<{ value: T; usage: Usage }> {
    const schema = jsonSchemaOf(req.schema);
    const out = await generateWithRepair(req, async (turns) => {
      const res = await timedFetch(
        this.f,
        `${this.base}/api/chat`,
        { method: "POST", headers: { "content-type": "application/json" }, body: this.body(req, false, schema, turns) },
        this.config.timeoutMs ?? 300_000,
        signal,
      );
      await ensureOk(res, "Ollama");
      const body = (await res.json()) as OllamaChunk;
      return {
        text: body.message?.content ?? "",
        usage: { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0 },
      };
    });
    req.onUsage?.(out.usage);
    return out;
  }

  async listModels(): Promise<string[]> {
    return listOllamaModels(this.base, this.f);
  }
}

export async function listOllamaModels(baseUrl = DEFAULT_OLLAMA_URL, f: typeof fetch = fetch): Promise<string[]> {
  const res = await timedFetch(f, `${baseUrl.replace(/\/+$/, "")}/api/tags`, {}, 5_000);
  await ensureOk(res, "Ollama");
  const body = (await res.json()) as { models?: { name: string }[] };
  return (body.models ?? []).map((m) => m.name).sort();
}

/** True when an Ollama server answers on the default local port (auto-detection for Settings). */
export async function detectOllama(f: typeof fetch = fetch, baseUrl = DEFAULT_OLLAMA_URL): Promise<boolean> {
  try {
    const res = await timedFetch(f, `${baseUrl}/api/tags`, {}, 800);
    return res.ok;
  } catch {
    return false;
  }
}
