/**
 * Start a full learncroc server: the API (createApp) plus, outside /api, the built web app
 * (apps/web/dist, SPA fallback, strict CSP); the sandbox origin on port + 1; first-run seeding of
 * the bundled packs; the session-token file for the CLI; and the opt-in reminder loop.
 *
 * In --dev the source packs under packs/ are compiled on the fly (and watched) instead of seeded.
 * With LEARNCROC_TEST=1 the core fixture mini-pack is bundled too, so end-to-end tests can play it.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { type AiPorts, type Clock, LEARNCROC_VERSION } from "@learncroc/core";
import { createApp } from "./app";
import { ensureHome, homePaths } from "./home";
import { startReminderLoop } from "./notify/reminder";
import { discoverSourcePacks, REPO_PACKS_DIR, type SourcePackDir } from "./packs/discover";
import { type SeedReport, seedPacks } from "./packs/seed";
import { PackStore } from "./packs/store";
import { runtimeFor } from "./routes/ai";
import { type SandboxServer, startSandbox } from "./sandbox/listener";
import { allowedHosts } from "./security/guard";
import { getServices } from "./services";
import { readJson, writeJsonAtomic } from "./util/fs";

/** The core fixture pack (two sections, two checkpoints), bundled only in test mode. */
export const MINI_PACK_DIR = resolve(import.meta.dir, "../../../packages/core/fixtures/mini-pack");

/** apps/web/dist next to this package (bun run build). */
export const WEB_DIST_DIR = resolve(import.meta.dir, "../../web/dist");

export interface StartOptions {
  home: string;
  port: number;
  dev?: boolean;
  test?: boolean;
  ai?: AiPorts;
  clock?: Clock;
  /** Built web app; default apps/web/dist. Missing folder → a small "build the app first" page. */
  staticDir?: string;
  /** Bundled source packs; default the repo's packs/. */
  packsDir?: string;
  /** Extra source folders served live (learncroc play <dir>). */
  playDirs?: SourcePackDir[];
  /** Seed bundled packs on start (default true outside --dev). */
  seed?: boolean;
  /** Start the reminder loop (default true). */
  reminders?: boolean;
  log?: (msg: string) => void;
  /** Reload open app pages when played or dev packs change (default: on when playDirs are given). */
  liveReload?: boolean;
  /** Listen address (default 127.0.0.1). Only containers change it. */
  bind?: string;
}

export interface StartedServer {
  url: string;
  sandboxUrl: string;
  store: PackStore;
  seed?: SeedReport;
  stop(): void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

export function appCsp(port: number): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src http://127.0.0.1:${port + 1}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const NOT_BUILT = `<!doctype html><html lang="en"><meta charset="utf-8"><title>learncroc</title>
<body style="font-family:system-ui;background:#14132e;color:#ecebfa;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="max-width:32rem"><h1 style="font-weight:600">The app isn't built yet</h1>
<p>Run <code>bun run build</code> in the repository, then reload. The API is running at <code>/api</code>.</p></main></body></html>`;

/** Same-origin paths of the live-reload channel (`learncroc play`). */
export const LIVE_RELOAD_SCRIPT = "/__learncroc/live-reload.js";
export const LIVE_RELOAD_EVENTS = "/__learncroc/live-reload";

const LIVE_RELOAD_JS = `// learncroc play: reload the page when the pack being played changes on disk.
const events = new EventSource(${JSON.stringify(LIVE_RELOAD_EVENTS)});
events.addEventListener("change", () => location.reload());
`;

/** Add the live-reload script to an app page (a same-origin script, so the strict CSP still holds). */
async function withLiveReload(file: string): Promise<string> {
  const page = await Bun.file(file).text();
  const tag = `<script type="module" src="${LIVE_RELOAD_SCRIPT}"></script>`;
  return page.includes("</head>") ? page.replace("</head>", `${tag}</head>`) : `${page}${tag}`;
}

/**
 * The live-reload channel: a script and a server-sent event stream that says `change` (debounced)
 * whenever a played pack's sources change. Same Host rules as the app; cross-site requests refused.
 */
export function liveReloadChannel(
  store: Pick<PackStore, "onChange">,
  opts: { port: number; dev: boolean; debounceMs?: number },
): (req: Request) => Response | null {
  return (req) => {
    const { pathname } = new URL(req.url);
    if (pathname !== LIVE_RELOAD_SCRIPT && pathname !== LIVE_RELOAD_EVENTS) return null;
    const host = (req.headers.get("host") ?? "").toLowerCase();
    const site = req.headers.get("sec-fetch-site");
    if (!allowedHosts(opts).includes(host) || site === "cross-site" || site === "same-site")
      return new Response("Forbidden", { status: 403 });
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (pathname === LIVE_RELOAD_SCRIPT)
      return new Response(LIVE_RELOAD_JS, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    const enc = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const send = (chunk: string) => {
          try {
            controller.enqueue(enc.encode(chunk));
          } catch {
            cleanup();
          }
        };
        const off = store.onChange((packId) => {
          clearTimeout(timer);
          timer = setTimeout(() => send(`event: change\ndata: ${JSON.stringify(packId)}\n\n`), opts.debounceMs ?? 150);
        });
        const ping = setInterval(() => send(": ping\n\n"), 25_000);
        cleanup = () => {
          off();
          clearTimeout(timer);
          clearInterval(ping);
        };
        send(": live\n\n");
      },
      cancel() {
        cleanup();
      },
    });
    req.signal?.addEventListener("abort", () => cleanup());
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

/** Serve one static request from the built app (exported for tests). */
export async function serveStatic(
  req: Request,
  opts: { dir: string; port: number; dev: boolean; liveReload?: boolean },
): Promise<Response> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (!allowedHosts({ port: opts.port, dev: opts.dev }).includes(host))
    return new Response("Forbidden", { status: 403, headers });
  if (req.method !== "GET" && req.method !== "HEAD")
    return new Response("Method not allowed", { status: 405, headers });
  const page = async (file: string) => html(opts.liveReload ? await withLiveReload(file) : Bun.file(file));
  const html = (body: BodyInit, status = 200) =>
    new Response(body, {
      status,
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": appCsp(opts.port),
        "Cache-Control": "no-cache",
      },
    });
  const index = join(opts.dir, "index.html");
  if (!existsSync(index)) return html(NOT_BUILT, 503);
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url).pathname);
  } catch {
    return new Response("Bad request", { status: 400, headers });
  }
  if (path.includes("\0") || path.includes("\\")) return new Response("Bad request", { status: 400, headers });
  const root = resolve(opts.dir);
  const file = resolve(root, `.${path}`);
  if ((file === root || file.startsWith(root + sep)) && existsSync(file) && statSync(file).isFile()) {
    const ext = extname(file).toLowerCase();
    if (ext === ".html") return page(file);
    const immutable = path.startsWith("/assets/");
    return new Response(Bun.file(file), {
      headers: {
        ...headers,
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        ...(path === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}),
      },
    });
  }
  // SPA fallback for app routes; missing files with an extension are real 404s.
  if (extname(path)) return new Response("Not found", { status: 404, headers });
  return page(index);
}

/** A stamp of the bundled sources + app version: seeding is skipped when nothing changed. */
function seedStamp(dirs: SourcePackDir[]): string {
  const h = createHash("sha256").update(LEARNCROC_VERSION);
  for (const d of dirs) {
    h.update(d.dir);
    const walk = (p: string) => {
      for (const name of readdirSync(p).sort()) {
        if (name.startsWith(".")) continue;
        const f = join(p, name);
        const st = statSync(f);
        if (st.isDirectory()) walk(f);
        else h.update(`${f}:${st.size}:${st.mtimeMs}`);
      }
    };
    try {
      walk(d.dir);
    } catch {
      /* vanished */
    }
  }
  return h.digest("hex");
}

export async function startServer(opts: StartOptions): Promise<StartedServer> {
  const log = opts.log ?? (() => {});
  const dev = opts.dev ?? false;
  const paths = ensureHome(opts.home);
  const sources = discoverSourcePacks(opts.packsDir ?? REPO_PACKS_DIR);
  if (opts.test && existsSync(join(MINI_PACK_DIR, "pack.yaml")))
    sources.push({ name: "mini-pack", dir: MINI_PACK_DIR, kind: "pack" });
  const devDirs = [...(dev ? sources : []), ...(opts.playDirs ?? [])];
  const store = new PackStore({ home: opts.home, devDirs, watch: devDirs.length > 0 });

  let seed: SeedReport | undefined;
  if (opts.seed ?? !dev) {
    const stampFile = join(paths.root, ".seeded");
    const stamp = seedStamp(sources);
    const prev = (() => {
      try {
        return (readJson(stampFile) as { stamp?: string } | undefined)?.stamp;
      } catch {
        return undefined;
      }
    })();
    if (store.isFresh() || prev !== stamp) {
      seed = await seedPacks(store, sources);
      for (const e of seed.errors) log(`pack not seeded: ${e.dir}: ${e.message.split("\n")[0]}`);
      if (seed.installed.length) log(`installed ${seed.installed.join(", ")}`);
      writeJsonAtomic(stampFile, { stamp, at: new Date().toISOString() });
    }
  }

  const sessionToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const { app, ctx, frames } = createApp({
    home: opts.home,
    port: opts.port,
    dev,
    test: opts.test ?? false,
    packs: store,
    sessionToken,
    ...(opts.ai ? { ai: opts.ai } : {}),
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
  ctx.frames = frames;
  const svc = getServices(ctx);
  // Without injected ports, the learner services use the AI runtime the AI routes use (settings and
  // key from this home; LEARNCROC_FAKE_AI=1 for tests): explain grading and hint rewrites.
  if (!opts.ai) ctx.ai = runtimeFor(ctx);
  const staticDir = opts.staticDir ?? WEB_DIST_DIR;
  const liveReload = opts.liveReload ?? (opts.playDirs?.length ?? 0) > 0;
  const reloadChannel = liveReload ? liveReloadChannel(store, { port: opts.port, dev }) : null;

  const server = Bun.serve({
    hostname: opts.bind ?? "127.0.0.1",
    port: opts.port,
    idleTimeout: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/api" || pathname.startsWith("/api/")) return app.fetch(req);
      return reloadChannel?.(req) ?? serveStatic(req, { dir: staticDir, port: opts.port, dev, liveReload });
    },
  });
  let sandbox: SandboxServer;
  try {
    sandbox = startSandbox({
      port: opts.port + 1,
      mainPort: opts.port,
      frames,
      ...(opts.bind ? { bind: opts.bind } : {}),
    });
  } catch (e) {
    server.stop(true);
    throw e;
  }
  writeJsonAtomic(paths.session, { port: opts.port, token: sessionToken, pid: process.pid }, 0o600);
  const stopReminders =
    opts.reminders === false
      ? () => {}
      : startReminderLoop({
          settings: () => svc.settings.get(),
          now: () => svc.clock.now(),
          lastSent: () => svc.repo.kv<string>("reminder:last"),
          markSent: (d) => svc.repo.setKv("reminder:last", d),
        });

  let stopped = false;
  return {
    url: `http://127.0.0.1:${opts.port}`,
    sandboxUrl: sandbox.url,
    store,
    ...(seed ? { seed } : {}),
    stop() {
      if (stopped) return;
      stopped = true;
      stopReminders();
      sandbox.stop();
      server.stop(true);
      store.close();
      try {
        const cur = readJson(paths.session) as { pid?: number } | undefined;
        if (cur?.pid === process.pid) rmSync(paths.session, { force: true });
      } catch {
        /* already gone */
      }
      svc.repo.close();
    },
  };
}

/** The running server's session (for the CLI), if its file exists and parses. */
export function readSession(home: string): { port: number; token: string; pid: number } | null {
  try {
    const raw = JSON.parse(readFileSync(homePaths(home).session, "utf8")) as {
      port?: unknown;
      token?: unknown;
      pid?: unknown;
    };
    if (typeof raw.port === "number" && typeof raw.token === "string" && typeof raw.pid === "number")
      return { port: raw.port, token: raw.token, pid: raw.pid };
  } catch {
    /* none */
  }
  return null;
}
