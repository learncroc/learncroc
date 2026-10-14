/**
 * Anthropic adapter (official @anthropic-ai/sdk). Everything provider-specific stays in here:
 * adaptive thinking (never disabled, never a thinking budget), effort per call, prompt caching on
 * stable system blocks, structured outputs through zod, stop_reason checks, the server-side refusal
 * fallback on Sonnet and Opus, and usage reporting (including cache reads) for the spend meter.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Effort, SystemBlock, Usage } from "@learncroc/core";
import { type ZodType, z } from "zod";
import { AiError, toAiError } from "../errors";
import type { AIProvider, ObjectRequest, TextRequest } from "../types";
import { fillMissing, type ProviderConfig } from "./shared";

type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Sonnet and Opus generation calls get the server-side refusal fallback; Haiku has none. */
function supportsFallback(model: string): boolean {
  return /^claude-(sonnet|opus)-5-5/.test(model);
}

function system(blocks: SystemBlock[]): Anthropic.Beta.Messages.BetaTextBlockParam[] {
  return blocks.map((b) => ({
    type: "text" as const,
    text: b.text,
    ...(b.cache
      ? { cache_control: { type: "ephemeral" as const, ...(b.cache === "1h" ? { ttl: "1h" as const } : {}) } }
      : {}),
  }));
}

function usageOf(m: Pick<BetaMessage, "usage">): Usage {
  const u = m.usage;
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    ...(u.cache_read_input_tokens ? { cacheReadTokens: u.cache_read_input_tokens } : {}),
    ...(u.cache_creation_input_tokens ? { cacheWriteTokens: u.cache_creation_input_tokens } : {}),
  };
}

/**
 * Schemas whose strict grammar the API refused ("compiled grammar is too large"). Calls for these
 * go out unconstrained with the JSON Schema in the system prompt, then zod validation and one
 * repair turn. Remembered for the life of the process so only the first call pays for the refusal.
 */
const looseSchemas = new Set<string>();

/**
 * JSON generation runs without thinking where the model allows it (Haiku 5.5 and Sonnet 5.5, at
 * effort high or below, which is every effort a prompt file can set). Thinking roughly doubles the
 * time per card, and on the loose JSON path it can spend the whole max_tokens before the JSON
 * starts. Other models keep their default.
 */
function thinkingOff(model: string): Pick<BetaParams, "thinking"> {
  if (/^claude-haiku-5-5/.test(model)) return { thinking: { type: "disabled" } };
  if (/^claude-sonnet-5-5/.test(model)) return { thinking: { type: "between_tools" } };
  return {};
}

function isGrammarTooLarge(e: unknown): boolean {
  const status = typeof e === "object" && e !== null && "status" in e ? Number((e as { status: unknown }).status) : 0;
  const msg = e instanceof Error ? e.message : String(e);
  return status === 400 && /grammar is too large|schema is too (large|complex)|too many strict/i.test(msg);
}

function schemaInstruction(schema: ZodType<unknown>, name: string): SystemBlock {
  let json: unknown;
  try {
    json = z.toJSONSchema(schema, { unrepresentable: "any" });
  } catch {
    json = {};
  }
  return {
    text: `Reply with one JSON object named ${name} and nothing else: no prose, no code fences. It must conform to this JSON Schema:\n${JSON.stringify(json)}`,
  };
}

/** The JSON object inside a reply that may carry code fences or a sentence around it. */
export function jsonFromText(text: string): string {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(a.cacheReadTokens || b.cacheReadTokens
      ? { cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) }
      : {}),
    ...(a.cacheWriteTokens || b.cacheWriteTokens
      ? { cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) }
      : {}),
  };
}

function textOf(m: BetaMessage): string {
  return m.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function checkStop(m: BetaMessage, what: string): void {
  if (m.stop_reason === "refusal") {
    throw new AiError("refusal", `the model declined this ${what}`, "none");
  }
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly capabilities = { structuredOutput: true, caching: true, streaming: true, maxContext: 1_000_000 };
  private readonly client: Anthropic;

  constructor(private readonly config: ProviderConfig) {
    if (!config.apiKey) throw new AiError("ai_not_configured", "no Anthropic key", "none");
    this.client = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: 2,
      timeout: config.timeoutMs ?? 300_000,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
  }

  private params(req: TextRequest, structured = false): BetaParams {
    const model = this.config.models[req.tier];
    const effort: Effort = req.effort;
    const fallback = req.feature !== "ask" && req.feature !== "test" && supportsFallback(model);
    return {
      model,
      max_tokens: req.maxTokens,
      system: system(req.system),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      output_config: { effort },
      ...(structured ? thinkingOff(model) : {}),
      ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    };
  }

  async *streamText(req: TextRequest, signal?: AbortSignal): AsyncIterable<{ text: string } | { thinking: true }> {
    let stream: ReturnType<Anthropic["beta"]["messages"]["stream"]>;
    try {
      stream = this.client.beta.messages.stream(this.params(req), signal ? { signal } : {});
    } catch (e) {
      throw toAiError(e);
    }
    let sawText = false;
    try {
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "thinking" && !sawText) {
          yield { thinking: true };
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          sawText = true;
          yield { text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      req.onUsage?.(usageOf(final));
      checkStop(final, "reply");
    } catch (e) {
      throw toAiError(e);
    }
  }

  async generateObject<T>(req: ObjectRequest<T>, signal?: AbortSignal): Promise<{ value: T; usage: Usage }> {
    if (looseSchemas.has(req.schemaName)) return this.looseObject(req, signal);
    let maxTokens = req.maxTokens;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const msg = await this.client.beta.messages.parse(
          {
            ...this.params({ ...req, maxTokens }, true),
            output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
          },
          signal ? { signal } : {},
        );
        const usage = usageOf(msg);
        req.onUsage?.(usage);
        checkStop(msg, req.schemaName);
        if (msg.stop_reason === "max_tokens") {
          maxTokens = Math.min(maxTokens * 2, 64_000);
          continue;
        }
        const parsed = req.schema.safeParse(msg.parsed_output);
        if (!parsed.success)
          throw new AiError("provider_error", `${req.schemaName}: output failed validation`, undefined, true);
        return { value: parsed.data, usage };
      } catch (e) {
        if (isGrammarTooLarge(e)) {
          looseSchemas.add(req.schemaName);
          return this.looseObject(req, signal);
        }
        throw toAiError(e);
      }
    }
    throw new AiError("provider_error", `${req.schemaName}: output was cut off twice`, undefined, true);
  }

  /** Unconstrained JSON for schemas too large for strict decoding: validate, then one repair turn. */
  private async looseObject<T>(req: ObjectRequest<T>, signal?: AbortSignal): Promise<{ value: T; usage: Usage }> {
    const base = this.params({ ...req, maxTokens: Math.max(req.maxTokens, 16_000) }, true);
    const sys = system([...req.system, schemaInstruction(req.schema, req.schemaName)]);
    const messages = [...base.messages];
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    for (let attempt = 0; attempt < 2; attempt++) {
      let msg: BetaMessage;
      try {
        msg = await this.client.beta.messages.create({ ...base, system: sys, messages }, signal ? { signal } : {});
      } catch (e) {
        throw toAiError(e);
      }
      usage = addUsage(usage, usageOf(msg));
      req.onUsage?.(usage);
      checkStop(msg, req.schemaName);
      const text = textOf(msg);
      let problem: string;
      try {
        const parsed = req.schema.safeParse(fillMissing(req.schema, JSON.parse(jsonFromText(text))));
        if (parsed.success) return { value: parsed.data, usage };
        problem = parsed.error.issues
          .slice(0, 12)
          .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n");
      } catch {
        problem =
          msg.stop_reason === "max_tokens"
            ? "- the JSON was cut off; be more concise"
            : "- the reply was not valid JSON";
      }
      messages.push(
        { role: "assistant", content: text || "{}" },
        {
          role: "user",
          content: `That ${req.schemaName} JSON has problems:\n${problem}\nReturn the whole corrected JSON object only.`,
        },
      );
    }
    throw new AiError("provider_error", `${req.schemaName}: output failed validation`, undefined, true);
  }

  async *streamObject<T>(req: ObjectRequest<T>, signal?: AbortSignal): AsyncIterable<{ partialJson: string }> {
    const loose = looseSchemas.has(req.schemaName);
    let text = "";
    try {
      const stream = this.client.beta.messages.stream(
        loose
          ? {
              ...this.params(req, true),
              system: system([...req.system, schemaInstruction(req.schema, req.schemaName)]),
            }
          : {
              ...this.params(req, true),
              output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
            },
        signal ? { signal } : {},
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
          const json = loose ? text.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/, "") : text;
          if (json) yield { partialJson: json };
        }
      }
      const final = await stream.finalMessage();
      req.onUsage?.(usageOf(final));
      checkStop(final, req.schemaName);
      if (final.stop_reason === "max_tokens") {
        throw new AiError("provider_error", `${req.schemaName}: output was cut off`, undefined, true);
      }
    } catch (e) {
      if (!loose && text === "" && isGrammarTooLarge(e)) {
        looseSchemas.add(req.schemaName);
        yield* this.streamObject(req, signal);
        return;
      }
      throw toAiError(e);
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const ids: string[] = [];
      for await (const m of this.client.models.list()) ids.push(m.id);
      return ids;
    } catch (e) {
      throw toAiError(e);
    }
  }
}
