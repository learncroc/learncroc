/**
 * Runs (the server is authoritative) and relight: thin HTTP wrappers over core's run services.
 * Every response carries the reduced RunState and `now`.
 *
 * - `POST /runs` starts (or resumes) a card run (`mode` play/replay/again, `from` for a revisit), a
 *   checkpoint run, or a try-run ("Try the first card": a registry TryBundle played on a throwaway
 *   in-memory store that writes nothing). Ids are checked and the target must exist with the right
 *   kind before any run work.
 * - `POST /runs/:runId/advance` moves past a read-only beat (`screen` 0..2) or card (`card`).
 * - `POST /runs/:runId/finish` takes an empty body. The first card close of a learner's life marks
 *   `settings.firstRun` completed (the `/` redirect reads it).
 *
 * Open runs pin their pack version so updates and GC never pull it from under them.
 */
import {
  AnswerValue,
  AttemptInput,
  ItemId,
  type LearnServices,
  NODE_ID_RE,
  PACK_ID_RE,
  PackId,
  type RouteRes,
  StartRunBody,
  type TryBundle,
} from "@learncroc/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { ServerContext } from "../context";
import { invalid, notFound, readBody, router } from "../http";
import { isReminderTime, relightCalendar } from "../notify/ics";
import { RegistryNotFoundError } from "../registry/client";
import { UrlRefusedError } from "../security/url-guard";
import { getServices } from "../services";

const RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ScratchBody = z.object({ scratch: z.record(z.string(), z.unknown()) });
const HintBody = z.object({ interactionId: ItemId, answer: AnswerValue.optional() });
const AdvanceBody = z
  .object({ screen: z.number().int().min(0).max(2).optional(), card: z.number().int().min(0).optional() })
  .refine((b): boolean => (b.screen === undefined) !== (b.card === undefined), "send exactly one of screen, card");
const FinishBody = z.object({}).strict().optional();
const RelightBody = z.object({ packId: PackId.optional(), limit: z.number().int().min(1).max(30).optional() });

export function runRoutes(ctx: ServerContext): Hono {
  const svc = getServices(ctx);
  const r = router();

  const runParam = (raw: string | undefined): string => {
    if (!raw || !RUN_ID_RE.test(raw)) throw notFound("no such run");
    return raw;
  };
  /** The services a run lives in: its try-run sandbox, or the learner's data. */
  const servicesFor = (runId: string): LearnServices => svc.tryRuns.get(runId) ?? svc.learn;
  const pin = (run: { id: string; packId: string; packVersion: string }) => {
    if (svc.store && run.packId !== "*" && run.packVersion !== "*") svc.store.pin(run.packId, run.packVersion, run.id);
  };
  const release = (runId: string) => {
    svc.store?.unpin(runId);
    svc.tryRuns.end(runId);
  };

  r.post("/runs", async (c) => {
    const body = await readBody(c, StartRunBody);
    if (body.kind === "try") {
      if (!svc.registry) throw invalid("this server has no registry");
      if (!svc.settings.get().registries.includes(body.registry))
        throw invalid(`registry ${body.registry} is not configured`);
      let bundle: TryBundle;
      try {
        bundle = await svc.registry.tryBundle(body.packId, body.registry);
      } catch (e) {
        if (e instanceof RegistryNotFoundError) throw notFound(e.message);
        if (e instanceof UrlRefusedError) throw invalid(e.message);
        throw e;
      }
      const session = svc.tryRuns.begin(bundle);
      const res: RouteRes<"POST /runs"> = await session.services.startRun(body);
      session.adopt(res.run.id);
      return c.json(res);
    }
    if (!PACK_ID_RE.test(body.packId)) throw invalid("invalid pack id");
    if (!NODE_ID_RE.test(body.target)) throw invalid("invalid target");
    if (body.kind === "card" && body.from !== undefined && !NODE_ID_RE.test(body.from)) throw invalid("invalid from");
    const pack = await svc.packs.get(body.packId);
    const entry = pack.map.nodes[body.target];
    if (!entry) throw notFound(`no "${body.target}" in ${body.packId}`);
    const want = body.kind === "card" ? "node" : "checkpoint";
    if (entry.kind !== want) throw invalid(`"${body.target}" is not a ${body.kind}`);
    if (body.kind === "card" && body.from !== undefined && pack.map.nodes[body.from]?.kind !== "checkpoint")
      throw invalid(`"${body.from}" is not a checkpoint`);
    const res: RouteRes<"POST /runs"> = await svc.learn.startRun(body);
    if (!res.resumed) pin(res.run);
    return c.json(res);
  });

  r.get("/runs/:runId", async (c) => {
    const runId = runParam(c.req.param("runId"));
    const res: RouteRes<"GET /runs/:runId"> = await servicesFor(runId).getRun(runId);
    return c.json(res);
  });

  r.patch("/runs/:runId", async (c) => {
    const runId = runParam(c.req.param("runId"));
    const { scratch } = await readBody(c, ScratchBody);
    const res: RouteRes<"PATCH /runs/:runId"> = await servicesFor(runId).patchScratch(runId, scratch);
    return c.json(res);
  });

  r.post("/runs/:runId/attempts", async (c) => {
    const runId = runParam(c.req.param("runId"));
    const input = await readBody(c, AttemptInput);
    const res: RouteRes<"POST /runs/:runId/attempts"> = await servicesFor(runId).attempt(runId, input);
    return c.json(res);
  });

  r.post("/runs/:runId/hint", async (c) => {
    const runId = runParam(c.req.param("runId"));
    const body = await readBody(c, HintBody);
    const res: RouteRes<"POST /runs/:runId/hint"> = await servicesFor(runId).hint(runId, body);
    return c.json(res);
  });

  r.post("/runs/:runId/advance", async (c) => {
    const runId = runParam(c.req.param("runId"));
    const body = await readBody(c, AdvanceBody);
    const res: RouteRes<"POST /runs/:runId/advance"> = await servicesFor(runId).advance(runId, body);
    return c.json(res);
  });

  r.post("/runs/:runId/finish", async (c) => {
    const runId = runParam(c.req.param("runId"));
    await readBody(c, FinishBody);
    const isTry = svc.tryRuns.get(runId) !== undefined;
    const res: RouteRes<"POST /runs/:runId/finish"> = await servicesFor(runId).finish(runId);
    release(runId);
    if (!isTry && res.kind === "card" && res.doneNow.length > 0) svc.settings.markFirstRun(res.now);
    return c.json(res);
  });

  r.post("/runs/:runId/abandon", async (c) => {
    const runId = runParam(c.req.param("runId"));
    const res: RouteRes<"POST /runs/:runId/abandon"> = await servicesFor(runId).abandon(runId);
    release(runId);
    return c.json(res);
  });

  r.post("/relight", async (c) => {
    const body = await readBody(c, RelightBody);
    const res: RouteRes<"POST /relight"> = await svc.learn.relight(body);
    return c.json(res);
  });

  r.get("/relight/calendar.ics", (c) => {
    const time = c.req.query("time") ?? svc.settings.get().learning.reminder.time;
    if (!isReminderTime(time)) throw invalid("time must be HH:MM");
    c.header("Content-Type", "text/calendar; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="learncroc-relight.ics"');
    return c.body(relightCalendar({ time, now: svc.clock.now(), url: `http://127.0.0.1:${ctx.port}/relight` }));
  });

  return r;
}
