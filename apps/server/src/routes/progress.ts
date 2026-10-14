/** Progress, logbook, field notes and the local numbers: thin wrappers over core's services. Responses carry `now`. */
import type { RouteRes } from "@learncroc/core";
import type { Hono } from "hono";
import type { ServerContext } from "../context";
import { optionalPackQuery, packParam, router } from "../http";
import { getServices } from "../services";

export function progressRoutes(ctx: ServerContext): Hono {
  const svc = getServices(ctx);
  const r = router();

  r.get("/progress", async (c) => {
    const body: RouteRes<"GET /progress"> = await svc.learn.progressSummary();
    return c.json(body);
  });

  r.get("/progress/:packId", async (c) => {
    const body: RouteRes<"GET /progress/:packId"> = await svc.learn.packProgress(packParam(c, "packId"));
    return c.json(body);
  });

  r.get("/logbook", async (c) => {
    const packId = optionalPackQuery(c);
    const body: RouteRes<"GET /logbook"> = await svc.learn.logbook(packId ? { packId } : {});
    return c.json(body);
  });

  r.get("/notes", async (c) => {
    const packId = optionalPackQuery(c);
    const body: RouteRes<"GET /notes"> = await svc.learn.fieldNotes(packId ? { packId } : {});
    return c.json(body);
  });

  r.get("/numbers", async (c) => {
    const body: RouteRes<"GET /numbers"> = await svc.learn.numbers();
    return c.json(body);
  });

  return r;
}
