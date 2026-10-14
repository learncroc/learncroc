/**
 * Helpers shared by the fetch-based providers (OpenAI-compatible, Ollama): JSON Schema from zod,
 * tolerant JSON extraction, think-tag stripping and the parse → validate → repair loop.
 */
import type { ChatTurn, ModelTier, SystemBlock, Usage } from "@learncroc/core";
import { type ZodType, z } from "zod";
import { AiError } from "../errors";
import type { ObjectRequest } from "../types";

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  /** Resolved model per tier. */
  models: Record<ModelTier, string>;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /** Request timeout (ms); default 120 s, 300 s for create calls. */
  timeoutMs?: number;
}

/** JSON Schema (draft 2020-12) for a zod schema, without the $schema key some servers reject. */
export function jsonSchemaOf(schema: ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/** Remove <think>…</think> blocks (reasoning models served by Ollama, vLLM, llama.cpp). */
export function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "");
}

/** Pull the first JSON value out of a model reply (code fences, prose before or after). */
export function extractJson(text: string): unknown {
  const t = stripThink(text).trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const body = fenced ? (fenced[1] as string).trim() : t;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.search(/[[{]/);
    if (start < 0) throw new AiError("provider_error", "the model did not return JSON");
    const open = body[start] as string;
    const close = open === "{" ? "}" : "]";
    const end = body.lastIndexOf(close);
    if (end <= start) throw new AiError("provider_error", "the model returned incomplete JSON");
    return JSON.parse(body.slice(start, end + 1));
  }
}

/** Describe zod issues compactly for a repair message. */
export function issuesText(error: z.ZodError, max = 12): string {
  return error.issues
    .slice(0, max)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

/** System blocks flattened for providers without block-level caching. */
export function systemText(blocks: SystemBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined
      ? { cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) }
      : {}),
    ...(a.cacheWriteTokens !== undefined || b.cacheWriteTokens !== undefined
      ? { cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) }
      : {}),
  };
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

type SchemaDef = { type: string; shape?: Record<string, unknown>; element?: unknown; innerType?: unknown };
const defOf = (schema: unknown): SchemaDef | undefined => (schema as { _zod?: { def?: SchemaDef } })?._zod?.def;

/**
 * Unconstrained JSON often leaves out keys the model considers empty (a choice action's `steps`).
 * Absent nullable keys become null and absent arrays become [], so only real gaps reach the repair
 * round; host code still checks the content.
 */
export function fillMissing(schema: unknown, value: unknown): unknown {
  const def = defOf(schema);
  if (!def) return value;
  switch (def.type) {
    case "nullable":
      return value === undefined ? null : fillMissing(def.innerType, value);
    case "optional":
      return value === undefined ? value : fillMissing(def.innerType, value);
    case "array":
      if (value === undefined) return [];
      return Array.isArray(value) ? value.map((v) => fillMissing(def.element, v)) : value;
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
      for (const [k, sub] of Object.entries(def.shape ?? {})) {
        const filled = fillMissing(sub, out[k]);
        if (filled !== undefined) out[k] = filled;
      }
      return out;
    }
    default:
      return value;
  }
}

/**
 * Raw JSON call → zod validation → one repair round with the exact issues. Used by providers that
 * can't guarantee schema-valid output (JSON mode, local models).
 */
export async function generateWithRepair<T>(
  req: ObjectRequest<T>,
  callRaw: (messages: ChatTurn[]) => Promise<{ text: string; usage: Usage }>,
): Promise<{ value: T; usage: Usage }> {
  let usage = ZERO_USAGE;
  let messages = req.messages;
  for (let round = 0; round < 2; round++) {
    const res = await callRaw(messages);
    usage = addUsage(usage, res.usage);
    let json: unknown;
    let problem: string;
    try {
      json = fillMissing(req.schema, extractJson(res.text));
      const parsed = req.schema.safeParse(json);
      if (parsed.success) return { value: parsed.data, usage };
      problem = issuesText(parsed.error);
    } catch (e) {
      problem = e instanceof Error ? e.message : "not valid JSON";
    }
    messages = [
      ...req.messages,
      { role: "assistant", content: res.text.slice(0, 20_000) },
      {
        role: "user",
        content: `That JSON does not match the ${req.schemaName} schema:\n${problem}\nReturn the full corrected JSON only.`,
      },
    ];
  }
  throw new AiError("provider_error", `the model's ${req.schemaName} output failed validation twice`, undefined, true);
}

/** fetch with a timeout that also honours the caller's signal. */
export async function timedFetch(
  f: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => ctl.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await f(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (signal?.aborted) throw new AiError("provider_error", "request cancelled");
    throw new AiError("provider_error", `could not reach ${new URL(url).host}: ${e instanceof Error ? e.message : e}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Throw an AiError for a non-2xx provider response, with a redacted body excerpt. */
export async function ensureOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  let body = "";
  try {
    body = (await res.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  const err = new AiError(
    res.status === 429 ? "rate_limited" : "provider_error",
    `${what} returned ${res.status}${body ? `: ${body}` : ""}`,
    undefined,
    res.status === 429 || res.status >= 500,
  );
  Object.assign(err, { status: res.status });
  throw err;
}

/** Iterate the lines of a streamed body (SSE or NDJSON). */
export async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        yield buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
      if (done) {
        if (buf.trim()) yield buf;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Turns a stream of text deltas into visible text, hiding <think>…</think> spans and reporting
 * them as a thinking signal (local reasoning models).
 */
export class ThinkFilter {
  private inThink = false;
  private pending = "";
  push(delta: string): { text: string; thinking: boolean } {
    let s = this.pending + delta;
    this.pending = "";
    let out = "";
    let thinking = false;
    while (s.length > 0) {
      if (this.inThink) {
        const end = s.indexOf("</think>");
        thinking = true;
        if (end < 0) {
          this.pending = s.slice(-7);
          return { text: out, thinking };
        }
        s = s.slice(end + 8);
        this.inThink = false;
      } else {
        const start = s.indexOf("<think>");
        if (start < 0) {
          const partial = /<t?h?i?n?k?$/.exec(s);
          const keep = partial && partial[0].length > 0 && "<think>".startsWith(partial[0]) ? partial[0].length : 0;
          out += s.slice(0, s.length - keep);
          this.pending = s.slice(s.length - keep);
          return { text: out, thinking };
        }
        out += s.slice(0, start);
        s = s.slice(start + 7);
        this.inThink = true;
        thinking = true;
      }
    }
    return { text: out, thinking };
  }
}
