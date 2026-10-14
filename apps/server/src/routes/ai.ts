/**
 * /api/ai/*: status, key test, models, the spend meter, "What did I send?", Ask (SSE, mode decided
 * here from run state), cards from a session and cost estimates. With no key or local model the
 * feature routes answer 409 ai_not_configured with the offline fallback the UI should take, except
 * Ask: Moss always answers, from the card's own notes when AI is off (core `offlineCrocReply`).
 * In an open checkpoint or Relight question every ask is a hint and is recorded on the run first,
 * so Moss and the hint button share one cap of 2.
 */

import { type AiRuntime, createAiRuntime, isAiError, isAiRuntime, toAiError } from "@learncroc/ai";
import {
  AiFeature,
  type AskEvent,
  AskRequest,
  CROC_MAX_WORDS,
  CreateRequest,
  type CrocContext,
  offlineCrocReply,
  type RouteRes,
  type RunState,
  words,
} from "@learncroc/core";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { ServerContext } from "../context";
import { apiError, invalid, readBody, router } from "../http";
import { getServices } from "../services";
import { sseResponse } from "../sse";

const runtimes = new WeakMap<ServerContext, AiRuntime>();

/**
 * The AI runtime for this server: the one passed as `ai` to createServer when it is a runtime,
 * otherwise one built here over the server's own settings store and clock.
 */
export function runtimeFor(ctx: ServerContext): AiRuntime {
  if (isAiRuntime(ctx.ai)) return ctx.ai;
  const hit = runtimes.get(ctx);
  if (hit) return hit;
  const svc = getServices(ctx);
  const rt = createAiRuntime({
    home: ctx.home,
    clock: svc.clock,
    config: { settings: () => svc.settings.get(), key: () => svc.settings.aiKey()?.key },
    log: (m) => console.error(`[learncroc] ${m}`),
  });
  runtimes.set(ctx, rt);
  return rt;
}

/** AiError → ApiError response (409 ai_not_configured, 429 cap/rate, 502 provider/refusal). */
export function aiProblem(
  c: Context,
  e: unknown,
  fallback: "authored-faq" | "authored-hint" | "item-bank" | "self-check" | "none",
) {
  if (isAiError(e)) return apiError(c, e.code, e.message, e.fallback ?? fallback);
  const err = toAiError(e);
  return apiError(c, err.code, err.message, fallback);
}

const CardsBody = z.object({ runId: z.string().min(1).max(100) });

export function aiRoutes(ctx: ServerContext): Hono {
  const r = router();
  const deps = () => {
    const svc = getServices(ctx);
    return { packs: svc.packs, repo: svc.repo };
  };

  r.get("/ai/status", async (c) => {
    const body: RouteRes<"GET /ai/status"> = await runtimeFor(ctx).status();
    return c.json(body);
  });

  r.post("/ai/test", async (c) => {
    const body: RouteRes<"POST /ai/test"> = await runtimeFor(ctx).test();
    return c.json(body);
  });

  r.get("/ai/models", async (c) => {
    const body: RouteRes<"GET /ai/models"> = await runtimeFor(ctx).listModels();
    return c.json(body);
  });

  r.get("/ai/usage", (c) => {
    const body: RouteRes<"GET /ai/usage"> = runtimeFor(ctx).usage();
    return c.json(body);
  });

  r.get("/ai/last-sent", (c) => {
    const raw = c.req.query("feature");
    const feature = raw ? AiFeature.safeParse(raw) : undefined;
    if (feature && !feature.success) throw invalid("unknown feature");
    const body: RouteRes<"GET /ai/last-sent"> = runtimeFor(ctx).lastSent(feature?.data);
    return c.json(body);
  });

  r.post("/ai/ask", async (c) => {
    const req = await readBody(c, AskRequest);
    const svc = getServices(ctx);
    const rt = runtimeFor(ctx);
    let run: RunState | null = req.runId ? await svc.repo.run(req.runId) : null;
    if (run && run.packId !== req.packId && run.packId !== "*") run = null;
    await svc.learn.noteCrocAsk({ chip: req.intent !== undefined && req.intent !== "ask" }).catch(() => undefined);
    // Every ask inside an open checkpoint or Relight question is a hint, and it counts (cap 2).
    let hintLevel: 0 | 1 | 2 | undefined;
    if (run && run.finishedAt === undefined && (run.kind === "checkpoint" || run.kind === "relight") && run.current) {
      const out = await svc.learn.crocHint(run.id);
      hintLevel = out.level;
      run = out.run;
    }
    if (!(await rt.configured())) {
      const pack = await svc.packs.get(req.packId).catch(() => null);
      if (!pack) throw invalid(`pack "${req.packId}" is not installed`);
      return sseResponse<AskEvent>(
        async (w) => {
          for (const e of offlineAsk(req, pack, run, hintLevel)) w.send(e);
        },
        (err) => ({ type: "error", code: "invalid", message: String(err), fallback: "authored-faq" }),
      );
    }
    let events: AsyncGenerator<AskEvent>;
    try {
      events = await rt.ask(req, deps(), c.req.raw.signal);
    } catch (e) {
      return aiProblem(c, e, "authored-faq");
    }
    return sseResponse<AskEvent>(
      async (w) => {
        for await (const e of events) w.send(e);
      },
      (err) => {
        const e = toAiError(err);
        return { type: "error", code: e.code, message: e.message, fallback: "authored-faq" };
      },
      { signal: c.req.raw.signal },
    );
  });

  r.post("/ai/cards", async (c) => {
    const { runId } = await readBody(c, CardsBody);
    try {
      const body: RouteRes<"POST /ai/cards"> = { cards: await runtimeFor(ctx).cards(runId, deps()) };
      return c.json(body);
    } catch (e) {
      return aiProblem(c, e, "none");
    }
  });

  r.post("/ai/estimate", async (c) => {
    const req = await readBody(c, CreateRequest);
    const rt = runtimeFor(ctx);
    if (!rt.current())
      return apiError(c, "ai_not_configured", "Article maps use AI. Add a key or a local model in Settings.", "none");
    const body: RouteRes<"POST /ai/estimate"> = rt.estimate(req);
    return c.json(body);
  });

  return r;
}

const OFFLINE_FREE_TEXT =
  "Without an AI key I can only use what's written for this card. Try a button above, or add a key in Settings.";

/** Moss with AI off: the reply comes from the card's own notes, streamed in a few deltas. */
function offlineAsk(
  req: AskRequest,
  pack: Parameters<typeof offlineCrocReply>[0]["pack"],
  run: RunState | null,
  hintLevel: 0 | 1 | 2 | undefined,
): AskEvent[] {
  const intent = req.intent ?? "ask";
  const open = run !== null && run.finishedAt === undefined;
  let cc: CrocContext;
  if (open && run && hintLevel !== undefined && run.current) {
    const ref = run.current.ref;
    const item = pack.nodes[ref.nodeId]?.items.find((i) => i.id === ref.itemId);
    cc = {
      pack,
      nodeId: ref.nodeId,
      mode: "hint",
      intent: "hint",
      ...(item ? { item: { ref, item, ...(run.current.vars ? { vars: run.current.vars } : {}), hintLevel } } : {}),
      question: req.question,
    };
  } else {
    const nodeId = req.nodeId ?? (run?.kind === "card" ? run.target : undefined);
    const beforeGuess = open && run?.kind === "card" && run.cursor.phase === "hook" && !run.guess;
    cc = {
      pack,
      ...(nodeId && pack.nodes[nodeId] ? { nodeId } : {}),
      ...(req.screenId ? { screenId: req.screenId } : {}),
      mode: beforeGuess ? "hint" : "full",
      intent: beforeGuess ? "hint" : intent,
      question: req.question,
    };
  }
  const reply = offlineCrocReply(cc);
  const freeTextMiss = cc.mode === "full" && intent === "ask" && cc.nodeId !== undefined && reply.basis !== "faq";
  const text = freeTextMiss ? OFFLINE_FREE_TEXT : reply.text;
  const node = cc.nodeId ? pack.nodes[cc.nodeId] : undefined;
  const parts = text.match(/\S+\s*/g) ?? [text];
  const deltas: AskEvent[] = [];
  for (let i = 0; i < parts.length; i += 6) deltas.push({ type: "delta", text: parts.slice(i, i + 6).join("") });
  return [
    {
      type: "sent",
      mode: cc.mode,
      source: "offline",
      ...(hintLevel !== undefined ? { hintLevel } : {}),
      payloadSummary: {
        ...(node ? { node: node.title } : {}),
        ...(req.screenId ? { screen: req.screenId } : {}),
        lastAnswers: 0,
        prereqs: 0,
        tokensApprox: 0,
      },
    },
    ...deltas,
    {
      type: "done",
      threadId: req.threadId ?? crypto.randomUUID(),
      messageId: Date.now(),
      words: Math.min(words(text), CROC_MAX_WORDS),
    },
  ];
}
