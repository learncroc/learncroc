/**
 * The service worker (PLAN §4 PWA), built to `sw.js` at the app's base.
 *
 * Local app (served by the learncroc server): caches the app shell so an installed Learncroc opens
 * instantly, and when the local server isn't running it shows a calm page saying how to start it.
 * The API is never cached: learner state always comes from the server.
 *
 * Static demo (`bun run build:static` defines __LM_STATIC__, __LM_BASE__, __LM_BUILD__ and
 * __LM_PRECACHE__): every file of the build is precached at install, including the lazily-loaded
 * widget view chunks and the compiled builtin packs with their assets, so the demo keeps playing
 * offline after the first load, even on a card whose widget chunk was never fetched. Navigations
 * fall back to the cached shell; the in-browser API needs no network.
 *
 * Registered by registerServiceWorker() in api/pwa.ts.
 */

interface ExtendableEventLike extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): void;
}
interface SwScope {
  readonly location: Location;
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", fn: (e: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", fn: (e: FetchEventLike) => void): void;
}

declare const self: SwScope;

/** Build-time constants (static demo only; absent from the local app's worker). */
declare const __LM_STATIC__: boolean | undefined;
declare const __LM_BASE__: string | undefined;
declare const __LM_BUILD__: string | undefined;
declare const __LM_PRECACHE__: readonly string[] | undefined;

const STATIC = typeof __LM_STATIC__ !== "undefined" && __LM_STATIC__ === true;
const BASE = typeof __LM_BASE__ !== "undefined" ? __LM_BASE__ : "/";
const BUILD = typeof __LM_BUILD__ !== "undefined" ? __LM_BUILD__ : "v1";
/** Paths relative to BASE ("index.html", "assets/index-abc.js", "static-packs/climate-science.json", …). */
const PRECACHE: readonly string[] = typeof __LM_PRECACHE__ !== "undefined" ? __LM_PRECACHE__ : [];

const VERSION = STATIC ? `learncroc-demo-${BUILD}` : "learncroc-shell-v1";
const SHELL = STATIC ? [BASE, ...PRECACHE.map((p) => `${BASE}${p}`)] : ["/", "/manifest.webmanifest", "/icon.svg"];
const SHELL_KEY = STATIC ? `${BASE}index.html` : "/";

export const OFFLINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Learncroc isn't running</title>
<style>
  :root{color-scheme:dark light}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14132e;color:#ecebfa;
       font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  main{max-width:30rem;padding:2rem}
  h1{font-size:1.5rem;font-weight:600;margin:0 0 .75rem}
  code{background:#232249;padding:.15rem .4rem;border-radius:.375rem;font-size:.95em}
  p{margin:.5rem 0;color:#b6b4da}
  button{margin-top:1.25rem;font:inherit;padding:.5rem 1rem;border-radius:.5rem;border:1px solid #4a4990;background:#1d1c3d;color:#ecebfa;cursor:pointer}
  button:focus-visible{outline:2px solid #7fe3d5;outline-offset:2px}
</style></head>
<body><main>
  <h1>Learncroc isn't running</h1>
  <p>Your maps and progress are safe on this computer. Start the app in a terminal:</p>
  <p><code>npx learncroc</code></p>
  <p>Then come back to this tab.</p>
  <button type="button" onclick="location.reload()">Try again</button>
</main></body></html>`;

const isApi = (url: URL) => url.pathname === "/api" || url.pathname.startsWith("/api/");
const isHashedAsset = (url: URL) => url.pathname.startsWith(`${BASE}assets/`);
const isStaticPack = (url: URL) => url.pathname.startsWith(`${BASE}static-packs/`);

async function precache(): Promise<void> {
  const cache = await caches.open(VERSION);
  // A few at a time: a static demo precaches a few hundred files.
  const queue = [...new Set(SHELL)];
  const worker = async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      try {
        const res = await fetch(path, { cache: "no-cache" });
        if (res.ok) await cache.put(path, res);
      } catch {
        /* offline or the server is down during install; the file fills in on the next visit */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

async function navigate(req: Request): Promise<Response> {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(SHELL_KEY, res.clone());
    return res;
  } catch {
    const shell = await cache.match(SHELL_KEY);
    // The demo's shell works offline (its API runs in the page). The local app's shell can't do
    // anything without the server, so explain how to start it.
    if (STATIC && shell) return shell;
    return new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function cacheFirst(req: Request): Promise<Response> {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: STATIC });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") await cache.put(req, res.clone());
  return res;
}

self.addEventListener("install", (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== VERSION && k.startsWith(STATIC ? "learncroc-demo-" : ""))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || (!STATIC && isApi(url))) return;
  if (!url.pathname.startsWith(BASE)) return;
  if (req.mode === "navigate") {
    e.respondWith(navigate(req));
    return;
  }
  if (isHashedAsset(url) || (STATIC && (isStaticPack(url) || PRECACHE.includes(url.pathname.slice(BASE.length)))))
    e.respondWith(cacheFirst(req));
});
