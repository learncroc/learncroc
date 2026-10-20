/**
 * Request guard for /api:
 *
 * - Host must be 127.0.0.1:<port> or localhost:<port> (plus the Vite hosts on 5173 under --dev).
 *   This is the DNS-rebinding guard.
 * - Cross-site requests (Sec-Fetch-Site: cross-site | same-site) are refused outright.
 * - The per-launch session cookie `lm_session` (HttpOnly, SameSite=Strict) is set on any request
 *   that passes the Host check and carries Sec-Fetch-Site: same-origin | none; such a request is
 *   also allowed through. Otherwise the cookie must be present and match.
 * - State-changing methods with an Origin header must come from an allowed origin.
 * - GET /api/health answers without a cookie (readiness probes, `learncroc` checking for a running
 *   server); it still needs a good Host and is never cross-site.
 *
 * Every response gets nosniff and no-referrer; CORS is never enabled.
 */
import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "lm_session";

export interface GuardOptions {
  port: number;
  /** Also allow localhost:5173 / 127.0.0.1:5173 (Vite proxy with changeOrigin: false). */
  dev: boolean;
  /** Random per launch. */
  sessionToken: string;
}

/** Host header values the server accepts. */
export function allowedHosts(opts: Pick<GuardOptions, "port" | "dev">): string[] {
  const hosts = [`127.0.0.1:${opts.port}`, `localhost:${opts.port}`];
  if (opts.dev) hosts.push("127.0.0.1:5173", "localhost:5173");
  return hosts;
}

export function allowedOrigins(opts: Pick<GuardOptions, "port" | "dev">): string[] {
  return allowedHosts(opts).map((h) => `http://${h}`);
}

function tokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function securityGuard(opts: GuardOptions): MiddlewareHandler {
  const hosts = new Set(allowedHosts(opts));
  const origins = new Set(allowedOrigins(opts));
  return async (c, next) => {
    const forbid = (message: string) => c.json({ error: "forbidden" as const, message }, 403);
    const host = (c.req.header("host") ?? "").toLowerCase();
    if (!hosts.has(host)) return forbid("bad Host header");
    const site = c.req.header("sec-fetch-site");
    if (site === "cross-site" || site === "same-site") return forbid("cross-site request");
    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== "null" && !origins.has(origin.toLowerCase())) return forbid("bad Origin");
    if (origin === "null") return forbid("opaque Origin");

    const cookie = getCookie(c, SESSION_COOKIE);
    const hasCookie = cookie !== undefined && tokensEqual(cookie, opts.sessionToken);
    const trustedFetch = site === "same-origin" || site === "none";
    const path = new URL(c.req.url).pathname;
    const isHealth = c.req.method === "GET" && /\/health\/?$/.test(path);

    if (!hasCookie && !trustedFetch && !isHealth) return forbid("missing session");
    if (STATE_CHANGING.has(c.req.method) && origin === undefined && !hasCookie)
      return forbid("state-changing request without Origin or session");

    if (trustedFetch && !hasCookie) {
      setCookie(c, SESSION_COOKIE, opts.sessionToken, { httpOnly: true, sameSite: "Strict", path: "/" });
    }
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
    return undefined;
  };
}
