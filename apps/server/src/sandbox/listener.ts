/**
 * The sandbox origin (PLAN D30, §17): a second listener on 127.0.0.1:<port+1> serving only
 * GET /frame/:token — one-time HTML documents registered in memory by the main server via
 * POST /api/frames (pack html interactives and generated toys, wrapped with the bridge script).
 * No cookie, no API; any other Host, method or path is a 404. Tokens are single-use and expire
 * after 60 s if unused.
 */
import { frameCsp, wrapFrameDocument } from "@learncroc/widgets/sandbox/bridge";

export interface FrameDoc {
  html: string;
  expiresAt: number;
}

export const FRAME_TTL_MS = 60_000;
const MAX_PENDING = 500;

/**
 * Backing map shared by FrameStore instances created without their own, so the frames route and
 * the sandbox listener meet even when they are wired separately. Tokens are 128-bit random.
 */
const sharedDocs = new Map<string, FrameDoc>();

export class FrameStore {
  constructor(private readonly docs: Map<string, FrameDoc> = sharedDocs) {}

  /** Register a document; returns its single-use token (expires after 60 s if unused). */
  register(html: string, now: number = Date.now()): string {
    this.sweep(now);
    const token = crypto.randomUUID().replace(/-/g, "");
    this.docs.set(token, { html, expiresAt: now + FRAME_TTL_MS });
    return token;
  }

  /** Take (and remove) a document. */
  take(token: string, now: number = Date.now()): FrameDoc | undefined {
    const doc = this.docs.get(token);
    this.docs.delete(token);
    return doc && doc.expiresAt > now ? doc : undefined;
  }

  private sweep(now: number): void {
    for (const [t, d] of this.docs) if (d.expiresAt <= now) this.docs.delete(t);
    while (this.docs.size >= MAX_PENDING) {
      const first = this.docs.keys().next().value;
      if (first === undefined) break;
      this.docs.delete(first);
    }
  }
}

/** Frame CSP and document wrapper come from the bridge so host, lint and server agree. */
export { frameCsp, wrapFrameDocument };

export interface SandboxServer {
  url: string;
  stop(): void;
}

/** Answer one sandbox request (exported for tests). */
export function handleSandboxRequest(
  req: Request,
  opts: { port: number; mainPort: number; frames: FrameStore; now?: number },
): Response {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  const host = `127.0.0.1:${opts.port}`;
  if (req.headers.get("host") !== host) return notFound();
  const url = new URL(req.url);
  const m = /^\/frame\/([a-f0-9]{32})$/.exec(url.pathname);
  if (req.method !== "GET" || !m || url.search) return notFound();
  const doc = opts.frames.take(m[1] as string, opts.now);
  if (!doc) return notFound();
  return new Response(doc.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": frameCsp(opts.mainPort),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}

export function startSandbox(opts: {
  port: number;
  mainPort: number;
  frames: FrameStore;
  bind?: string;
}): SandboxServer {
  const server = Bun.serve({
    hostname: opts.bind ?? "127.0.0.1",
    port: opts.port,
    fetch: (req) => handleSandboxRequest(req, opts),
  });
  return { url: `http://127.0.0.1:${opts.port}`, stop: () => server.stop(true) };
}
