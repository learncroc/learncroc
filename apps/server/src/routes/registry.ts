/**
 * The marketplace: GET /registry merges every configured registry (builtin + https), and
 * GET /registry/:id/try serves a TryBundle for "Try the first card".
 */
import type { RouteRes } from "@learncroc/core";
import type { Hono } from "hono";
import type { ServerContext } from "../context";
import { conflict, invalid, notFound, packParam, router } from "../http";
import { RegistryNotFoundError } from "../registry/client";
import { UrlRefusedError } from "../security/url-guard";
import { getServices } from "../services";

export function registryRoutes(ctx: ServerContext): Hono {
  const svc = getServices(ctx);
  const r = router();

  r.get("/registry", async (c) => {
    if (!svc.registry) throw conflict("this server has no pack store");
    const body: RouteRes<"GET /registry"> = await svc.registry.view(
      svc.settings.get().registries,
      c.req.query("refresh") === "1",
    );
    return c.json(body);
  });

  r.get("/registry/:id/try", async (c) => {
    const id = packParam(c);
    const registry = c.req.query("registry") || "builtin";
    if (!svc.registry) throw conflict("this server has no pack store");
    if (!svc.settings.get().registries.includes(registry)) throw invalid(`registry ${registry} is not configured`);
    try {
      const body: RouteRes<"GET /registry/:id/try"> = await svc.registry.tryBundle(id, registry);
      return c.json(body);
    } catch (e) {
      if (e instanceof RegistryNotFoundError) throw notFound(e.message);
      if (e instanceof UrlRefusedError) throw invalid(e.message);
      throw e;
    }
  });

  return r;
}
