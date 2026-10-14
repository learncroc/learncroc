/** GET /health: version, home, AI state, pack count, and whether this server runs in --dev. */
import { LEARNCROC_VERSION, type RouteRes } from "@learncroc/core";
import type { Hono } from "hono";
import type { ServerContext } from "../context";
import { router } from "../http";
import { getServices } from "../services";

export function healthRoutes(ctx: ServerContext): Hono {
  const svc = getServices(ctx);
  const r = router();
  r.get("/health", async (c) => {
    const body: RouteRes<"GET /health"> = {
      ok: true,
      version: LEARNCROC_VERSION,
      home: ctx.home,
      aiConfigured: await ctx.ai.configured(),
      packs: (await svc.packs.list()).length,
      // `dev` lets the web show invalid packs (with their reason) only in --dev (DR-26).
      dev: ctx.dev,
    };
    return c.json(body);
  });
  return r;
}
