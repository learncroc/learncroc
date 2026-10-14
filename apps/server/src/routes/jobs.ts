/**
 * Create-job streams: GET /api/jobs/:jobId/events (SSE; past events are replayed on reconnect),
 * DELETE /api/jobs/:jobId (cancel; a half-built map is removed).
 *
 * Two companion routes serve the surveying view: GET /api/jobs/:jobId/article (the extracted
 * paragraphs and the job's pack id for the reader pane, only while the job runs; the text is never
 * stored) and
 * POST /api/jobs/:jobId/toy-check (the browser's verdict after running the generated toy in a
 * hidden sandbox frame).
 */
import type { JobEvent, RouteRes } from "@learncroc/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { ServerContext } from "../context";
import { notFound, readBody, router } from "../http";
import { sseResponse } from "../sse";
import { runtimeFor } from "./ai";

const JOB_ID_RE = /^job-[a-z0-9]+-[a-f0-9]{8}$/;
const ToyCheck = z.object({ ok: z.boolean(), reason: z.string().max(200).optional() });

export function jobRoutes(ctx: ServerContext): Hono {
  const r = router();
  const job = (id: string | undefined) => {
    if (!id || !JOB_ID_RE.test(id)) throw notFound("unknown job");
    const j = runtimeFor(ctx).jobs.get(id);
    if (!j) throw notFound("unknown job");
    return j;
  };

  r.get("/jobs/:jobId/events", (c) => {
    const j = job(c.req.param("jobId"));
    const jobs = runtimeFor(ctx).jobs;
    return sseResponse<JobEvent>(
      (w) =>
        new Promise<void>((resolve) => {
          let unsubscribe: () => void = () => {};
          unsubscribe = jobs.subscribe(j.id, (e) => {
            w.send(e);
            if (e.type === "done" || e.type === "error") {
              unsubscribe();
              resolve();
            }
          });
          void w.closed.then(() => {
            unsubscribe();
            resolve();
          });
        }),
      (err) => ({
        type: "error",
        stage: "plan",
        code: "provider_error",
        message: String((err as Error)?.message ?? err),
      }),
      { signal: c.req.raw.signal },
    );
  });

  r.delete("/jobs/:jobId", (c) => {
    const j = job(c.req.param("jobId"));
    runtimeFor(ctx).jobs.cancel(j.id);
    const body: RouteRes<"DELETE /jobs/:jobId"> = { ok: true };
    return c.json(body);
  });

  r.get("/jobs/:jobId/article", (c) => {
    const j = job(c.req.param("jobId"));
    if (!j.article) throw notFound("the article is only kept while the map is being built");
    return c.json({
      packId: j.packId,
      title: j.article.title,
      ...(j.article.site ? { site: j.article.site } : {}),
      paragraphs: j.article.paragraphs,
    });
  });

  r.post("/jobs/:jobId/toy-check", async (c) => {
    const j = job(c.req.param("jobId"));
    const body = await readBody(c, ToyCheck);
    const heard = runtimeFor(ctx).reportToy(j.id, { ok: body.ok, ...(body.reason ? { reason: body.reason } : {}) });
    return c.json({ ok: heard });
  });

  return r;
}
