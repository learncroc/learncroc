/**
 * Installed packs: list, compiled pack, assets (regex + realpath, MIME allowlist, sandbox CSP),
 * opened marks, removal (progress kept), registry installs (SSE) and sandbox frame registration.
 */
import { readFileSync, statSync } from "node:fs";
import { AssetPath, type InstallEvent, NodeId, PackId, type RouteRes, SemVer } from "@learncroc/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { ServerContext } from "../context";
import { apiError, conflict, invalid, notFound, optionalVersionQuery, packParam, readBody, router } from "../http";
import { enrichSummaries } from "../learner/progress";
import { scanHtml } from "../packs/validate";
import { FRAME_TTL_MS, wrapFrameDocument } from "../sandbox/listener";
import { assetHeaders, assetMime } from "../security/assets";
import { getServices } from "../services";
import { sseResponse } from "../sse";

const InstallBody = z.object({ id: PackId, version: SemVer.optional(), registry: z.string().min(1).optional() });
const FrameBody = z.object({
  packId: PackId,
  asset: AssetPath.optional(),
  nodeId: NodeId.optional(),
  generated: z.boolean().optional(),
});

export function packRoutes(ctx: ServerContext): Hono {
  const svc = getServices(ctx);
  const r = router();

  r.get("/packs", async (c) => {
    const body: RouteRes<"GET /packs"> = await enrichSummaries(svc, await svc.packs.list());
    return c.json(body);
  });

  r.post("/packs/install", async (c) => {
    const body = await readBody(c, InstallBody);
    const registry = body.registry ?? "builtin";
    const { registry: client } = svc;
    if (!client) throw conflict("this server has no pack store");
    if (!svc.settings.get().registries.includes(registry))
      throw invalid(`registry ${registry} is not configured in settings`);
    return sseResponse<InstallEvent>(
      async (w) => {
        try {
          await client.install({ id: body.id, registry, ...(body.version ? { version: body.version } : {}) }, (e) =>
            w.send(e),
          );
        } catch {
          /* the terminal error event was already sent */
        }
      },
      (err) => ({ type: "error", code: "invalid_pack", message: (err as Error).message }),
      { signal: c.req.raw.signal },
    );
  });

  r.post("/frames", async (c) => {
    const body = await readBody(c, FrameBody);
    let html: string;
    if (body.generated) {
      // A pocket map's generated toy: the node's generated-html visual, stored inline in pack.json.
      if (!body.nodeId) throw invalid("generated frames need a nodeId");
      const pack = await svc.packs.get(body.packId);
      const node = pack.nodes[body.nodeId];
      if (!node) throw notFound(`no stop ${body.nodeId} in ${body.packId}`);
      const visual = [node.visual, ...node.screens.map((s) => s.visual)].find((v) => v?.kind === "generated-html");
      if (visual?.kind !== "generated-html") throw notFound(`stop ${body.nodeId} has no generated toy`);
      html = visual.html;
    } else {
      const asset = body.asset;
      if (!asset) throw invalid("asset or generated is required");
      if (!asset.startsWith("assets/interactive/") || !asset.endsWith(".html"))
        throw invalid("frames serve html interactives under assets/interactive/");
      if (!svc.store) throw conflict("this server has no pack store");
      const file = await svc.store.assetFile(body.packId, asset, { allowHtml: true });
      if (!file) throw notFound(`no ${asset} in ${body.packId}`);
      html = readFileSync(file, "utf8");
    }
    const problems = scanHtml(html);
    if (problems.length) throw invalid(`interactive refused: ${problems.join("; ")}`);
    const now = Date.now();
    const token = svc.frames.register(wrapFrameDocument(html), now);
    const res: RouteRes<"POST /frames"> = {
      url: `http://127.0.0.1:${ctx.port + 1}/frame/${token}`,
      expiresAt: now + FRAME_TTL_MS,
    };
    return c.json(res);
  });

  r.get("/packs/:id", async (c) => {
    const id = packParam(c);
    const version = optionalVersionQuery(c);
    const body: RouteRes<"GET /packs/:id"> = await svc.packs.get(id, version);
    return c.json(body);
  });

  r.get("/packs/:id/assets/*", async (c) => {
    const id = packParam(c);
    const prefix = `/packs/${id}/assets/`;
    const path = new URL(c.req.url).pathname;
    const at = path.indexOf(prefix);
    let asset: string;
    try {
      asset = decodeURIComponent(path.slice(at + prefix.length));
    } catch {
      return apiError(c, "not_found", "no such asset");
    }
    const version = optionalVersionQuery(c);
    const mime = assetMime(asset);
    if (!mime || !svc.store) return apiError(c, "not_found", "no such asset");
    const file = await svc.store.assetFile(id, asset, version ? { version } : {});
    if (!file) return apiError(c, "not_found", "no such asset");
    const size = statSync(file).size;
    return new Response(Bun.file(file), { headers: assetHeaders(mime, size) });
  });

  r.post("/packs/:id/opened", async (c) => {
    const res: RouteRes<"POST /packs/:id/opened"> = await svc.learn.markOpened(packParam(c));
    return c.json(res);
  });

  r.delete("/packs/:id", async (c) => {
    const id = packParam(c);
    const version = optionalVersionQuery(c);
    if (!svc.store) throw conflict("this server has no pack store");
    const now = svc.clock.now();
    await svc.repo.tx(async (repo) => {
      for (const run of await repo.openRuns({ packId: id }))
        if (!version || run.packVersion === version) await repo.putRun({ ...run, finishedAt: now });
    });
    if (!svc.store.uninstall(id, version)) throw notFound(`pack "${id}" is not installed`);
    const res: RouteRes<"DELETE /packs/:id"> = { ok: true };
    return c.json(res);
  });

  return r;
}
