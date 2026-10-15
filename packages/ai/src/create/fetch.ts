/**
 * Article fetch with an SSRF guard (PLAN §15.5 step 1): http(s) only, DNS resolved and checked
 * against private, loopback and link-local ranges, 10 s timeout, ≤ 5 redirects each re-guarded,
 * ≤ 5 MB. Articles are untrusted data from here on.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class FetchRefused extends Error {
  constructor(
    message: string,
    readonly code: "url_refused" | "fetch_failed" | "too_long" = "url_refused",
  ) {
    super(message);
    this.name = "FetchRefused";
  }
}

function v4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  const [a = 0, b = 0] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Expand an IPv6 literal to its 8 16-bit groups (dotted IPv4 tails included); null when malformed. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const b = dotted.slice(1).map(Number) as [number, number, number, number];
    if (b.some((x) => x > 255)) return null;
    s = `${s.slice(0, dotted.index)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h: string | undefined) => (h ? h.split(":") : []);
  const head = part(halves[0]);
  const tail = part(halves[1]);
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail].map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? Number.parseInt(g, 16) : Number.NaN,
  );
  return groups.length === 8 && groups.every((g) => Number.isFinite(g)) ? groups : null;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function v6Private(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const zero96 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // ::, ::1, IPv4-compatible ::a.b.c.d and IPv4-mapped ::ffff:a.b.c.d (URL parsing writes both in hex).
  if (zero96 && (g5 === 0 || g5 === 0xffff)) return g5 === 0 && g6 === 0 ? true : v4Private(v4From(g6, g7));
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48 reach IPv4 through a translator.
  if (g0 === 0x64 && g1 === 0xff9b) return true;
  // 6to4 2002::/16 embeds an IPv4 address; Teredo 2001:0::/32 hides one.
  if (g0 === 0x2002) return v4Private(v4From(g1, g2));
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return true;
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00;
}

/** True for addresses an article fetch must never reach. */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  const kind = isIP(bare);
  if (kind === 4) return v4Private(bare);
  if (kind === 6) return v6Private(bare);
  return true;
}

export interface GuardOptions {
  /** Tests only: allow loopback (a local fixture server). */
  allowPrivate?: boolean;
  resolve?: (host: string) => Promise<string[]>;
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

/** Throws FetchRefused unless the URL is http(s) and resolves only to public addresses. */
export async function guardUrl(raw: string, opts: GuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefused("That doesn't look like a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchRefused("Only http and https links work.");
  if (url.username || url.password) throw new FetchRefused("Links with a username or password aren't allowed.");
  if (opts.allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchRefused("Local and private addresses are blocked.");
  }
  let addrs: string[];
  try {
    addrs = isIP(host) ? [host] : await (opts.resolve ?? defaultResolve)(host);
  } catch {
    throw new FetchRefused(`Couldn't find ${host}.`, "fetch_failed");
  }
  if (addrs.length === 0 || addrs.some(isPrivateAddress))
    throw new FetchRefused("Local and private addresses are blocked.");
  return url;
}

export interface FetchedPage {
  url: string;
  contentType: string;
  body: string;
}

export interface FetchOptions extends GuardOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
}

export async function fetchArticle(raw: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const f = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let url = await guardUrl(raw, opts);
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await f(url.toString(), {
          redirect: "manual",
          signal: ctl.signal,
          headers: {
            "user-agent": "learncroc/0.1 (+https://github.com/learncroc/learncroc; article maps)",
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          },
        });
      } catch {
        throw new FetchRefused(
          ctl.signal.aborted ? "The page took too long to load." : "Couldn't load that page.",
          "fetch_failed",
        );
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= (opts.maxRedirects ?? 5)) throw new FetchRefused("Too many redirects.", "fetch_failed");
        url = await guardUrl(new URL(res.headers.get("location") as string, url).toString(), opts);
        continue;
      }
      if (!res.ok) throw new FetchRefused(`The page answered ${res.status}.`, "fetch_failed");
      const contentType = (res.headers.get("content-type") ?? "text/html").toLowerCase();
      if (!/text\/html|application\/xhtml|text\/plain/.test(contentType)) {
        throw new FetchRefused(
          "That link isn't a web page (PDFs aren't supported yet). Paste the text instead.",
          "fetch_failed",
        );
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) throw new FetchRefused("That page is over 5 MB.", "too_long");
      const body = await readCapped(res, maxBytes);
      return { url: url.toString(), contentType, body };
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchRefused("That page is over 5 MB.", "too_long");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}
