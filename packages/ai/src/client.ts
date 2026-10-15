/**
 * One way to call a model: rate limit, monthly cap, tier/effort from the prompt file, usage priced
 * into the spend meter, and the last payload kept for "What did I send?". Every feature goes through
 * this, so the guards on cost and privacy can't be skipped.
 */
import type { AiFeature, ChatTurn, Effort, ModelTier, SystemBlock, Usage } from "@learncroc/core";
import type { ZodType } from "zod";
import { type PromptId, prompt, systemBlocks } from "./prompts";
import type { AIProvider } from "./types";
import type { UsageMeter } from "./usage";

export interface SentRecord {
  feature: AiFeature;
  at: number;
  payload: { provider: string; model: string; system: string[]; messages: ChatTurn[] };
}

export interface AiClientEnv {
  provider: AIProvider;
  /** The provider id used for pricing ("anthropic", "ollama", "openai-compatible", "fake"). */
  providerId: string;
  models: Record<ModelTier, string>;
  meter?: UsageMeter;
  capUsd?: number;
  /** Count each call against the per-minute rate limit (default true). Jobs admit once per job instead. */
  rateLimit?: boolean;
  now(): number;
  /** "What did I send?" */
  onSent?(r: SentRecord): void;
  /** Every priced call (jobs sum their own usage). */
  onUsage?(feature: AiFeature, usage: Usage, usd: number): void;
}

export interface CallOptions {
  feature: AiFeature;
  promptId: PromptId;
  vars?: Record<string, string | number>;
  /** Replaces the default [house style, stage prompt] system blocks. */
  system?: SystemBlock[];
  /** Extra system blocks after the defaults. */
  extraSystem?: SystemBlock[];
  houseStyle?: boolean;
  messages: ChatTurn[];
  tier?: ModelTier;
  effort?: Effort;
  maxTokens?: number;
  signal?: AbortSignal;
}

export class AiClient {
  constructor(readonly env: AiClientEnv) {}

  private prepare(o: CallOptions) {
    const p = prompt(o.promptId);
    const tier = o.tier ?? p.tier;
    const system =
      o.system ??
      systemBlocks(o.promptId, o.vars, {
        houseStyle: o.houseStyle ?? true,
        ...(o.extraSystem ? { extra: o.extraSystem } : {}),
      });
    if (this.env.rateLimit !== false) this.env.meter?.admit();
    if (this.env.meter && this.env.capUsd !== undefined) this.env.meter.checkCap(this.env.capUsd, this.env.providerId);
    const model = this.env.models[tier];
    this.env.onSent?.({
      feature: o.feature,
      at: this.env.now(),
      payload: { provider: this.env.providerId, model, system: system.map((s) => s.text), messages: o.messages },
    });
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    return {
      req: {
        feature: o.feature,
        tier,
        effort: o.effort ?? p.effort,
        system,
        messages: o.messages,
        maxTokens: o.maxTokens ?? p.maxTokens,
        onUsage: (u: Usage) => {
          usage = u;
        },
      },
      finish: () => {
        const usd = this.env.meter?.record(o.feature, this.env.providerId, model, usage) ?? 0;
        this.env.onUsage?.(o.feature, usage, usd);
        return { usage, usd };
      },
    };
  }

  async object<T>(
    o: CallOptions & { schema: ZodType<T>; schemaName: string },
  ): Promise<{ value: T; usage: Usage; usd: number }> {
    const { req, finish } = this.prepare(o);
    try {
      const out = await this.env.provider.generateObject(
        { ...req, schema: o.schema, schemaName: o.schemaName },
        o.signal,
      );
      req.onUsage(out.usage);
      return { value: out.value, ...finish() };
    } catch (e) {
      finish();
      throw e;
    }
  }

  /** Streamed text; returns usage when the stream ends. */
  async *text(o: CallOptions): AsyncGenerator<{ text: string } | { thinking: true }, { usage: Usage; usd: number }> {
    const { req, finish } = this.prepare(o);
    try {
      for await (const chunk of this.env.provider.streamText(req, o.signal)) yield chunk;
    } catch (e) {
      finish();
      throw e;
    }
    return finish();
  }

  /** A whole text reply (guards need the full text before anything is shown). */
  async textAll(o: CallOptions): Promise<{ text: string; usage: Usage; usd: number; thinking: boolean }> {
    let text = "";
    let thinking = false;
    const it = this.text(o);
    while (true) {
      const r = await it.next();
      if (r.done) return { text, thinking, ...r.value };
      if ("text" in r.value) text += r.value.text;
      else thinking = true;
    }
  }

  /** Streamed structured output (accumulated JSON text). Falls back to one non-streamed call. */
  async *objectStream<T>(
    o: CallOptions & { schema: ZodType<T>; schemaName: string },
  ): AsyncGenerator<{ partialJson: string }, { usage: Usage; usd: number }> {
    if (!this.env.provider.streamObject) {
      const out = await this.object(o);
      yield { partialJson: JSON.stringify(out.value) };
      return { usage: out.usage, usd: out.usd };
    }
    const { req, finish } = this.prepare(o);
    try {
      for await (const chunk of this.env.provider.streamObject(
        { ...req, schema: o.schema, schemaName: o.schemaName },
        o.signal,
      )) {
        yield chunk;
      }
    } catch (e) {
      finish();
      throw e;
    }
    return finish();
  }
}
