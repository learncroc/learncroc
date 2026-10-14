/**
 * Small HTTP helpers shared by routers: typed JSON errors, body validation and param checks
 * (CONTRACTS §11).
 */
import { type ApiError, type ApiErrorCode, NODE_ID_RE, PACK_ID_RE, SEMVER_RE } from "@learncroc/core";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType } from "zod";

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  ai_not_configured: 409,
  engine_mismatch: 409,
  install_failed: 409,
  rate_limited: 429,
  cap_reached: 429,
  not_implemented: 501,
  provider_error: 502,
  refusal: 502,
};

export function apiError(c: Context, error: ApiErrorCode, message: string, fallback?: ApiError["fallback"]) {
  const body: ApiError = fallback ? { error, message, fallback } : { error, message };
  return c.json(body, STATUS[error]);
}

/** 501 for routes whose handler hasn't landed yet. */
export function notImplemented(c: Context) {
  return apiError(c, "not_implemented", `${c.req.method} ${c.req.routePath} is not implemented yet`);
}

export const isPackId = (s: string | undefined): s is string => s !== undefined && PACK_ID_RE.test(s);
export const isNodeId = (s: string | undefined): s is string => s !== undefined && NODE_ID_RE.test(s);
export const isSemVer = (s: string | undefined): s is string => s !== undefined && SEMVER_RE.test(s);

/** A thrown error that routers turn into an ApiError response. */
export class HttpProblem extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly fallback?: ApiError["fallback"],
  ) {
    super(message);
    this.name = "HttpProblem";
  }
}

export const invalid = (message: string) => new HttpProblem("invalid", message);
export const notFound = (message: string) => new HttpProblem("not_found", message);
export const conflict = (message: string) => new HttpProblem("conflict", message);

const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Parse and validate a JSON body. Throws HttpProblem("invalid") with the first issue. */
export async function readBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw invalid("request body too large");
  const text = await c.req.text();
  if (text.length > MAX_BODY_BYTES) throw invalid("request body too large");
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw invalid("body is not valid JSON");
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const iss = r.error.issues[0];
    throw invalid(`${iss?.path.length ? `${iss.path.join(".")}: ` : ""}${iss?.message ?? "invalid body"}`);
  }
  return r.data;
}

export function packParam(c: Context, name = "id"): string {
  const v = c.req.param(name);
  if (!isPackId(v)) throw invalid(`invalid pack id`);
  return v;
}

export function optionalPackQuery(c: Context, name = "packId"): string | undefined {
  const v = c.req.query(name);
  if (v === undefined || v === "") return undefined;
  if (!isPackId(v)) throw invalid(`invalid ${name}`);
  return v;
}

export function optionalVersionQuery(c: Context): string | undefined {
  const v = c.req.query("version");
  if (v === undefined || v === "") return undefined;
  if (!isSemVer(v)) throw invalid("invalid version");
  return v;
}

/** Map thrown errors to ApiError responses; anything unexpected is logged and answered with a 500. */
export function handleProblem(c: Context, e: unknown): Response {
  if (e instanceof HttpProblem) return apiError(c, e.code, e.message, e.fallback);
  const name = (e as Error | undefined)?.name;
  if (name === "PackNotFoundError") return apiError(c, "not_found", (e as Error).message);
  if (name === "PackFormatError") return apiError(c, "conflict", (e as Error).message);
  if (name === "ServiceError") {
    const err = e as Error & { code: ApiErrorCode };
    return apiError(c, err.code, err.message);
  }
  if (name === "RunError") {
    const err = e as Error & { code: string };
    return apiError(c, err.code === "not_found" ? "not_found" : "conflict", err.message);
  }
  console.error(`[learncroc] ${c.req.method} ${new URL(c.req.url).pathname}:`, e);
  const body: ApiError = { error: "invalid", message: "internal error" };
  return c.json(body, 500);
}

/** A router whose thrown HttpProblems become ApiError responses. */
export function router(): Hono {
  const r = new Hono();
  r.onError((e, c) => handleProblem(c, e));
  return r;
}
