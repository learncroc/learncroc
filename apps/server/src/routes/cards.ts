/**
 * Cards: thin wrappers over core's card services (list with text, due, create, edit/suspend,
 * delete, FSRS review, CSV/Markdown export). /cards/due and /cards/export come before /cards/:id.
 */
import { CardState, Grade, Markdown, NodeId, PackId, type RouteRes } from "@learncroc/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { ServerContext } from "../context";
import { invalid, notFound, optionalPackQuery, readBody, router } from "../http";
import { getServices } from "../services";

const Text = Markdown.min(1).max(2000);
const CreateBody = z.object({
  packId: PackId,
  nodeId: NodeId.optional(),
  front: Text,
  back: Text,
  source: z.enum(["session", "manual"]),
});
const PatchBody = z.object({ front: Text.optional(), back: Text.optional(), suspended: z.boolean().optional() });
const ReviewBody = z
  .object({ grade: Grade.optional(), correct: z.boolean().optional(), ms: z.number().nonnegative().optional() })
  .refine((b): boolean => b.grade !== undefined || b.correct !== undefined, "grade or correct is required");
const Kind = CardState.shape.kind;

const cardId = (raw: string | undefined): string => {
  if (!raw || raw.length > 300 || !/^(node|card|user):/.test(raw)) throw notFound("no such card");
  return raw;
};

export function cardRoutes(ctx: ServerContext): Hono {
  const svc = getServices(ctx);
  const r = router();

  r.get("/cards", async (c) => {
    const packId = optionalPackQuery(c);
    const kindRaw = c.req.query("kind");
    const kind = kindRaw ? Kind.safeParse(kindRaw) : undefined;
    if (kind && !kind.success) throw invalid("invalid kind");
    const body: RouteRes<"GET /cards"> = await svc.learn.listCards({
      ...(packId ? { packId } : {}),
      ...(kind?.data ? { kind: kind.data } : {}),
    });
    return c.json(body);
  });

  r.get("/cards/due", async (c) => {
    const packId = optionalPackQuery(c);
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) throw invalid("invalid limit");
    const body: RouteRes<"GET /cards/due"> = await svc.learn.dueCards({
      ...(packId ? { packId } : {}),
      ...(limit ? { limit } : {}),
    });
    return c.json(body);
  });

  r.get("/cards/export", async (c) => {
    const format = c.req.query("format");
    if (format !== "csv" && format !== "md") throw invalid("format must be csv or md");
    const packId = optionalPackQuery(c);
    const text = await svc.learn.exportCards({ format, ...(packId ? { packId } : {}) });
    const date = new Date(svc.clock.now()).toISOString().slice(0, 10);
    c.header("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="learncroc-cards-${date}.${format}"`);
    return c.body(text);
  });

  r.post("/cards", async (c) => {
    const body: RouteRes<"POST /cards"> = await svc.learn.createCard(await readBody(c, CreateBody));
    return c.json(body);
  });

  r.patch("/cards/:id", async (c) => {
    const id = cardId(c.req.param("id"));
    const body: RouteRes<"PATCH /cards/:id"> = await svc.learn.patchCard(id, await readBody(c, PatchBody));
    return c.json(body);
  });

  r.delete("/cards/:id", async (c) => {
    const body: RouteRes<"DELETE /cards/:id"> = await svc.learn.deleteCard(cardId(c.req.param("id")));
    return c.json(body);
  });

  r.post("/cards/:id/review", async (c) => {
    const id = cardId(c.req.param("id"));
    const body: RouteRes<"POST /cards/:id/review"> = await svc.learn.reviewCard(id, await readBody(c, ReviewBody));
    return c.json(body);
  });

  return r;
}
