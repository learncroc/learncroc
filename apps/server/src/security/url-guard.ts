/**
 * URL guard (PLAN §17): every registry, pack URL and tryUrl must be https (or http to loopback in
 * --dev). Hosts that are, or resolve to, private, loopback, link-local or metadata addresses are
 * refused, redirects are re-checked hop by hop, and relative URLs keep the base's scheme and origin.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UrlRefusedError extends Error {
  constructor(
    readonly url: string,
    reason: string,
  ) {
    super(`refused URL ${url}: ${reason}`);
    this.name = "UrlRefusedError";
  }
}

export interface UrlGuardOptions {
  /** --dev: allow http to loopback (local test registries). */
  dev?: boolean;
  /** Tests: resolve names without DNS. */
  resolve?: (host: string) => Promise<string[]>;
}

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

export function isLoopback(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) return v4[0] === 127;
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6.startsWith("::ffff:127.");
}

/** Private, loopback, link-local (incl. 169.254.169.254 metadata), CGNAT, multicast and reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) {
    const [a = 0, b = 0] = v4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6.startsWith("::ffff:")) {
    const mapped = v6.slice(7);
    return ipv4Parts(mapped) ? isPrivateAddress(mapped) : true;
  }
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff")
  );
}

const LOOPBACK_NAMES = new Set(["localhost", "localhost.", "127.0.0.1", "[::1]"]);

/**
 * Synchronous checks (scheme, credentials, literal addresses). Returns the parsed URL.
 * Use `checkUrl` before fetching: it also resolves the host.
 */
export function checkUrlSyntax(raw: string, opts: UrlGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRefusedError(raw, "not a valid absolute URL");
  }
  if (url.username || url.password) throw new UrlRefusedError(raw, "credentials in URL");
  const host = url.hostname.toLowerCase();
  const loopbackName = LOOPBACK_NAMES.has(host) || LOOPBACK_NAMES.has(url.host.toLowerCase());
  if (url.protocol === "http:") {
    const literal = host.replace(/^\[|\]$/g, "");
    if (!(opts.dev && (loopbackName || (isIP(literal) && isLoopback(literal)))))
      throw new UrlRefusedError(raw, "only https URLs are allowed");
    return url;
  }
  if (url.protocol !== "https:") throw new UrlRefusedError(raw, `scheme ${url.protocol} is not allowed`);
  const literal = host.replace(/^\[|\]$/g, "");
  if (loopbackName) throw new UrlRefusedError(raw, "loopback host");
  if (isIP(literal) && isPrivateAddress(literal)) throw new UrlRefusedError(raw, "private address");
  if (host.endsWith(".local") || host.endsWith(".internal") || !host.includes("."))
    throw new UrlRefusedError(raw, "local host name");
  return url;
}

/** Full check including DNS: every address the host resolves to must be public (dev http loopback excepted). */
export async function checkUrl(raw: string, opts: UrlGuardOptions = {}): Promise<URL> {
  const url = checkUrlSyntax(raw, opts);
  if (url.protocol === "http:") return url; // dev loopback, already verified
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return url;
  const addrs = opts.resolve
    ? await opts.resolve(host)
    : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (addrs.length === 0) throw new UrlRefusedError(raw, "host does not resolve");
  for (const a of addrs) if (isPrivateAddress(a)) throw new UrlRefusedError(raw, `host resolves to private ${a}`);
  return url;
}

/**
 * Resolve a URL found inside a remote document (index.json `url`/`tryUrl`). Relative URLs resolve
 * against the base and must keep its scheme and origin; absolute URLs must pass the guard on their own.
 */
export function resolveRemoteUrl(ref: string, base: string, opts: UrlGuardOptions = {}): string {
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//");
  if (!isAbsolute) {
    const b = new URL(base);
    const out = new URL(ref, b);
    if (out.protocol !== b.protocol || out.origin !== b.origin)
      throw new UrlRefusedError(ref, "relative URL escapes origin");
    return out.toString();
  }
  return checkUrlSyntax(ref.startsWith("//") ? `https:${ref}` : ref, opts).toString();
}

export interface GuardedFetchOptions extends UrlGuardOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  onProgress?: (received: number, total: number) => void;
  fetchImpl?: typeof fetch;
}

/** Fetch through the guard: manual redirects (each hop re-checked), a timeout and a size cap. */
export async function guardedFetch(
  raw: string,
  opts: GuardedFetchOptions = {},
): Promise<{ url: string; bytes: Uint8Array; headers: Headers }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const max = opts.maxBytes ?? 50 * 1024 * 1024;
  let current = raw;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    await checkUrl(current, opts);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    opts.signal?.addEventListener("abort", () => ctrl.abort());
    try {
      const res = await doFetch(current, { redirect: "manual", signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`redirect without location from ${current}`);
        const next = new URL(loc, current).toString();
        current = next;
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} from ${current}`);
      const total = Number(res.headers.get("content-length") ?? 0);
      if (total > max) throw new Error(`response too large (${total} bytes)`);
      const chunks: Uint8Array[] = [];
      let received = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > max) {
            await reader.cancel();
            throw new Error(`response too large (> ${max} bytes)`);
          }
          chunks.push(value);
          opts.onProgress?.(received, total || received);
        }
      }
      const bytes = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) {
        bytes.set(c, off);
        off += c.byteLength;
      }
      return { url: current, bytes, headers: res.headers };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`too many redirects from ${raw}`);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
