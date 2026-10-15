/**
 * Errors the AI layer raises. `code` is an ApiErrorCode so routes can map them straight to responses.
 */
import type { AiFallback, ApiErrorCode } from "@learncroc/core";

export type AiErrorCode = Extract<
  ApiErrorCode,
  "ai_not_configured" | "rate_limited" | "cap_reached" | "provider_error" | "refusal" | "invalid"
>;

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly fallback?: AiFallback,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export const isAiError = (e: unknown): e is AiError => e instanceof AiError;

/** Mask anything that looks like an API key before a message is logged or returned. */
export function redact(s: string): string {
  return s
    .replace(/\b(sk-[A-Za-z0-9_-]{2})[A-Za-z0-9_-]{8,}([A-Za-z0-9]{4})\b/g, "$1…$2")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1…");
}

/** Normalise a thrown value into an AiError (provider SDK errors, fetch failures, timeouts). */
export function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Error && e.name === "AbortError") return new AiError("provider_error", "request cancelled");
  const status = typeof e === "object" && e !== null && "status" in e ? Number((e as { status: unknown }).status) : 0;
  const msg = redact(e instanceof Error ? e.message : String(e));
  if (status === 401 || status === 403)
    return new AiError("provider_error", `the provider rejected the key (${status})`);
  if (status === 429) return new AiError("rate_limited", "the provider is rate limiting requests", undefined, true);
  if (status >= 500) return new AiError("provider_error", `provider error ${status}: ${msg}`, undefined, true);
  return new AiError("provider_error", msg || "provider error");
}
