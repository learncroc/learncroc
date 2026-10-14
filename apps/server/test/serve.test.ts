/**
 * The full server: first-run seeding of bundled packs, the built web app with SPA fallback and the
 * app CSP, the API, the sandbox origin, and the session file the CLI uses.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homePaths } from "../src/home";
import { readSession, type StartedServer, startServer } from "../src/serve";
import { FIXTURE_DIR, tempHome } from "./helpers";

const port = 41000 + Math.floor(Math.random() * 4000) * 2;
const home = tempHome("lm-serve-");
const web = tempHome("lm-web-");
writeFileSync(
  join(web, "index.html"),
  '<!doctype html><div id="root"></div><script type="module" src="/assets/app.js"></script>',
);
mkdirSync(join(web, "assets"));
writeFileSync(join(web, "assets", "app.js"), "console.log('app')");
writeFileSync(join(web, "manifest.webmanifest"), "{}");

let server: StartedServer;
const base = `http://127.0.0.1:${port}`;

describe("startServer", async () => {
  server = await startServer({
    home,
    port,
    staticDir: web,
    packsDir: resolve(FIXTURE_DIR, ".."),
    reminders: false,
  });
  afterAll(() => server.stop());

  test("seeds the bundled packs on first run", async () => {
    expect(server.seed?.installed).toEqual(["mini-pack@0.1.0"]);
    expect(server.store.readInstalled().packs["mini-pack"]?.versions["0.1.0"]?.source).toBe("builtin");
    const health = await (await fetch(`${base}/api/health`)).json();
    expect(health).toMatchObject({ ok: true, packs: 1 });
  });

  test("serves the app shell with the strict CSP and SPA fallback", async () => {
    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(index.headers.get("content-security-policy")).toContain(`frame-src http://127.0.0.1:${port + 1}`);
    expect(await index.text()).toContain('id="root"');
    const route = await fetch(`${base}/p/mini-pack/run/units`);
    expect(route.status).toBe(200);
    expect(route.headers.get("content-type")).toContain("text/html");
    const js = await fetch(`${base}/assets/app.js`);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    const escaped = await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`);
    expect(await escaped.text()).not.toContain("root:");
    expect((await fetch(`${base}/%2e%2e/%2e%2e/etc/hosts.txt`)).status).toBe(404);
    const evil = await fetch(`${base}/`, { headers: { host: "evil.example" } });
    expect(evil.status).toBe(403);
  });

  test("a browser's first API call gets the session cookie; the CLI uses the session file", async () => {
    const res = await fetch(`${base}/api/packs`, { headers: { "sec-fetch-site": "same-origin" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("lm_session=");
    const s = readSession(home);
    expect(s?.port).toBe(port);
    const cli = await fetch(`${base}/api/packs`, { headers: { cookie: `lm_session=${s?.token}` } });
    expect(cli.status).toBe(200);
    expect((await fetch(`${base}/api/packs`)).status).toBe(403);
  });

  test("the sandbox origin listens on port + 1 and answers only /frame/:token", async () => {
    expect((await fetch(`http://127.0.0.1:${port + 1}/`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port + 1}/frame/${"a".repeat(32)}`)).status).toBe(404);
  });

  test("a second start skips seeding when nothing changed; stop removes the session file", async () => {
    server.stop();
    expect(existsSync(homePaths(home).session)).toBe(false);
    server = await startServer({ home, port, staticDir: web, packsDir: resolve(FIXTURE_DIR, ".."), reminders: false });
    expect(server.seed).toBeUndefined();
    expect((await (await fetch(`${base}/api/health`)).json()).packs).toBe(1);
  });

  test("without a built app, / explains how to build it", async () => {
    const p2 = port + 2;
    const s2 = await startServer({
      home: tempHome(),
      port: p2,
      staticDir: tempHome(),
      packsDir: tempHome(),
      reminders: false,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${p2}/`);
      expect(res.status).toBe(503);
      expect(await res.text()).toContain("bun run build");
    } finally {
      s2.stop();
    }
  });
});
