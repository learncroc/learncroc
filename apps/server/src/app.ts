/**
 * The server composition root. createApp() builds the Hono app with every router mounted under /api;
 * createServer() also listens on 127.0.0.1:<port> and starts the sandbox origin on <port + 1>.
 */
import { type AiPorts, type Clock, offlineAiPorts, type PackSource, systemClock } from "@learncroc/core";
import { Hono } from "hono";
import type { ServerContext } from "./context";
import { ensureHome } from "./home";
import { apiError } from "./http";
import { FixturePackSource } from "./packs/fixture-source";
import { aiRoutes } from "./routes/ai";
import { cardRoutes } from "./routes/cards";
import { createRoutes } from "./routes/create";
import { healthRoutes } from "./routes/health";
import { jobRoutes } from "./routes/jobs";
import { packRoutes } from "./routes/packs";
import { progressRoutes } from "./routes/progress";
import { registryRoutes } from "./routes/registry";
import { runRoutes } from "./routes/runs";
import { settingsRoutes } from "./routes/settings";
import { systemRoutes } from "./routes/system";
import { testRoutes } from "./routes/test-clock";
import { FrameStore, type SandboxServer, startSandbox } from "./sandbox/listener";
import { securityGuard } from "./security/guard";

export interface CreateAppOptions {
  home: string;
  port: number;
  /** AI seam; defaults to the offline ports (every AI feature takes its fallback path). */
  ai?: AiPorts;
  dev?: boolean;
  test?: boolean;
  packs?: PackSource;
  clock?: Clock;
  /** Random per launch; generated when omitted. */
  sessionToken?: string;
}

export function createApp(opts: CreateAppOptions): { app: Hono; ctx: ServerContext; frames: FrameStore } {
  const ctx: ServerContext = {
    home: opts.home,
    port: opts.port,
    dev: opts.dev ?? false,
    test: opts.test ?? false,
    ai: opts.ai ?? offlineAiPorts,
    packs: opts.packs ?? new FixturePackSource(),
    clock: opts.clock ?? systemClock,
  };
  const frames = new FrameStore();
  const api = new Hono();
  api.use("*", securityGuard({ port: ctx.port, dev: ctx.dev, sessionToken: opts.sessionToken ?? crypto.randomUUID() }));
  for (const routes of [
    healthRoutes,
    systemRoutes,
    packRoutes,
    registryRoutes,
    progressRoutes,
    runRoutes,
    cardRoutes,
    settingsRoutes,
    aiRoutes,
    createRoutes,
    jobRoutes,
    testRoutes,
  ]) {
    api.route("/", routes(ctx));
  }
  api.notFound((c) => apiError(c, "not_found", `no route for ${c.req.method} ${new URL(c.req.url).pathname}`));

  const app = new Hono();
  app.route("/api", api);
  app.notFound((c) => apiError(c, "not_found", "not found"));
  return { app, ctx, frames };
}

export interface RunningServer {
  url: string;
  sandboxUrl: string;
  app: Hono;
  stop(): void;
}

/** createServer({ home, port, ai }) — start the main listener and the sandbox origin. */
export function createServer(opts: CreateAppOptions): RunningServer {
  ensureHome(opts.home);
  const { app, frames } = createApp(opts);
  const server = Bun.serve({ hostname: "127.0.0.1", port: opts.port, fetch: app.fetch, idleTimeout: 0 });
  let sandbox: SandboxServer | undefined;
  try {
    sandbox = startSandbox({ port: opts.port + 1, mainPort: opts.port, frames });
  } catch (e) {
    server.stop(true);
    throw e;
  }
  return {
    url: `http://127.0.0.1:${opts.port}`,
    sandboxUrl: sandbox.url,
    app,
    stop() {
      sandbox?.stop();
      server.stop(true);
    },
  };
}
