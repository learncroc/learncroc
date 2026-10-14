/**
 * POST /api/create: start a pocket-map job (fetch → plan → stops → figures → toy → write) and
 * return at once; the surveying view follows GET /api/jobs/:jobId/events.
 */
import { CreateRequest, type RouteRes } from "@learncroc/core";
import type { Hono } from "hono";
import type { ServerContext } from "../context";
import { invalid, readBody, router } from "../http";
import { getServices } from "../services";
import { aiProblem, runtimeFor } from "./ai";

const MAX_TEXT_CHARS = 200_000;

export function createRoutes(ctx: ServerContext): Hono {
  const r = router();

  r.post("/create", async (c) => {
    const req = await readBody(c, CreateRequest);
    if (req.source.kind === "url") {
      let u: URL;
      try {
        u = new URL(req.source.url);
      } catch {
        throw invalid("That doesn't look like a web address.");
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") throw invalid("Only http and https links work.");
    } else if (req.source.text.length > MAX_TEXT_CHARS) {
      throw invalid("That text is too long. Paste one section at a time.");
    }
    const svc = getServices(ctx);
    const store = svc.store;
    try {
      const body: RouteRes<"POST /create"> = runtimeFor(ctx).startCreate(
        req,
        ctx.home,
        store
          ? {
              // Pocket maps install through the pack store: validated, atomic, listed, cache-invalidated.
              writePack: (pack, assets, readme) => {
                const files = new Map<string, Uint8Array>();
                const enc = new TextEncoder();
                files.set("pack.json", enc.encode(JSON.stringify(pack)));
                files.set("README.md", enc.encode(readme));
                for (const [path, svg] of Object.entries(assets)) files.set(path, enc.encode(svg));
                store.install(files, { tier: "local", source: "create" }, { expectId: pack.manifest.id });
              },
              removePack: (packId) => {
                store.uninstall(packId);
              },
            }
          : {},
      );
      return c.json(body);
    } catch (e) {
      return aiProblem(c, e, "none");
    }
  });

  return r;
}
