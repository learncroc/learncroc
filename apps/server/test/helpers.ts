/**
 * Test helpers: a temp LEARNCROC_HOME with the fixture pack installed, and a request helper that
 * behaves like the browser (Host, Sec-Fetch-Site, Origin on writes, and the session cookie).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Clock } from "@learncroc/core";
import { createApp } from "../src/app";
import { compilePackDir } from "../src/packs/compile";
import { PackStore } from "../src/packs/store";

// Tests never see the developer's real AI keys.
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LEARNCROC_AI_BASE_URL"]) delete process.env[k];

export const FIXTURE_DIR = resolve(import.meta.dir, "../../../packages/core/fixtures/mini-pack");
export const PORT = 4747;
export const HOST = `127.0.0.1:${PORT}`;
export const ORIGIN = `http://${HOST}`;

export function tempHome(prefix = "lm-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export async function storeWithFixture(home: string): Promise<PackStore> {
  const store = new PackStore({ home });
  const pack = await compilePackDir(FIXTURE_DIR);
  store.install(PackStore.filesFromSource(pack, FIXTURE_DIR), {
    source: "builtin",
    registry: "builtin",
    tier: "official",
  });
  return store;
}

export interface TestApp {
  home: string;
  store: PackStore;
  token: string;
  app: ReturnType<typeof createApp>["app"];
  ctx: ReturnType<typeof createApp>["ctx"];
  /** Browser-like request (same-origin fetch, Origin on writes). */
  req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  json<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
}

export async function testApp(
  opts: { dev?: boolean; test?: boolean; clock?: Clock; home?: string } = {},
): Promise<TestApp> {
  const home = opts.home ?? tempHome();
  const store = await storeWithFixture(home);
  const token = "t".repeat(64);
  const { app, ctx } = createApp({
    home,
    port: PORT,
    dev: opts.dev ?? false,
    test: opts.test ?? true,
    packs: store,
    sessionToken: token,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(`http://${HOST}/api${path}`, {
      method,
      headers: {
        host: HOST,
        "sec-fetch-site": "same-origin",
        cookie: `lm_session=${token}`,
        ...(method === "GET" || method === "HEAD" ? {} : { origin: ORIGIN }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    home,
    store,
    token,
    app,
    ctx,
    req,
    async json<T>(method: string, path: string, body?: unknown) {
      const res = await req(method, path, body);
      return { status: res.status, body: (await res.json()) as T };
    },
  };
}

/** A fixed, settable clock. */
export function fixedClock(start = Date.UTC(2026, 9, 20, 9, 0, 0)): Clock & { t: number; advance(ms: number): void } {
  return {
    t: start,
    now() {
      return this.t;
    },
    advance(ms: number) {
      this.t += ms;
    },
  };
}
