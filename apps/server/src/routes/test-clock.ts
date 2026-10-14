/** POST /_test/clock pins (or, with null, releases) the server clock. Only with LEARNCROC_TEST=1. */
import type { RouteRes } from "@learncroc/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { ServerContext } from "../context";
import { apiError, readBody, router } from "../http";
import { getServices } from "../services";

const Body = z.object({ now: z.number().int().nonnegative().nullable() });

export function testRoutes(ctx: ServerContext): Hono {
  const r = router();
  r.post("/_test/clock", async (c) => {
    if (!ctx.test) return apiError(c, "not_found", "not found");
    const { now } = await readBody(c, Body);
    getServices(ctx).clock.set(now);
    const res: RouteRes<"POST /_test/clock"> = { ok: true };
    return c.json(res);
  });
  return r;
}
