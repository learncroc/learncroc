import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type CardState, newCard, type RunState } from "@learncroc/core";
import { SqliteRepo } from "../src/db/sqlite-repo";
import { tempHome } from "./helpers";

const card = (id: string, due: number, kind: CardState["kind"] = "flashcard"): CardState => ({
  ...newCard({ id, packId: "mini-pack", nodeId: "units", kind, now: due }),
  due,
});

const run = (id: string, finishedAt?: number): RunState => ({
  id,
  kind: "card",
  packId: "mini-pack",
  packVersion: "0.1.0",
  target: "units",
  cursor: { phase: "hook" },
  queue: [],
  hints: {},
  assisted: [],
  seed: 1,
  startedAt: 1,
  ...(finishedAt ? { finishedAt } : {}),
});

describe("SqliteRepo", () => {
  test("progress, cards, runs, attempts, ratings, notes and kv round-trip", async () => {
    const repo = SqliteRepo.open(join(tempHome(), "learncroc.db"));
    await repo.putProgress("mini-pack", { nodeId: "units", status: "lit", source: "run", theta: 0.2, relightsOk: 0 });
    expect((await repo.progress("mini-pack")).units?.status).toBe("lit");
    await repo.putCard(card("card:mini-pack:units:a", 100));
    await repo.putCard(card("card:mini-pack:units:b", 300));
    await repo.putCard({ ...card("card:mini-pack:units:c", 50), suspended: true });
    expect((await repo.cards({ dueBefore: 200 })).map((c) => c.id)).toEqual(["card:mini-pack:units:a"]);
    expect((await repo.cards({ packId: "mini-pack", kind: "flashcard" })).length).toBe(3);
    await repo.deleteCard("card:mini-pack:units:b");
    expect((await repo.cards({})).length).toBe(2);
    await repo.putRun(run("r1"));
    await repo.putRun(run("r2", 5));
    expect((await repo.openRuns({ packId: "mini-pack" })).map((r) => r.id)).toEqual(["r1"]);
    expect((await repo.run("r2"))?.finishedAt).toBe(5);
    expect(await repo.run("nope")).toBeNull();
    const id = await repo.addAttempt({
      runId: "r1",
      packId: "mini-pack",
      nodeId: "units",
      interactionId: "hook-q",
      phase: "hook",
      answer: { kind: "idk" },
      correct: false,
      score: 0,
      creditedScore: 0,
      counted: false,
      hintLevel: 0,
      assisted: false,
      ms: 10,
      at: 1,
    });
    expect((await repo.attempts({ runId: "r1" }))[0]?.id).toBe(id);
    await repo.putItemRating("mini-pack", "units", "i1", 0.4);
    expect(await repo.itemRatings("mini-pack", "units")).toEqual({ i1: 0.4 });
    await repo.putFieldNote({
      id: "n1",
      packId: "mini-pack",
      nodeId: "units",
      title: "T",
      myWords: "w",
      litAt: 2,
      durable: false,
    });
    expect((await repo.fieldNotes({ packId: "mini-pack" })).length).toBe(1);
    await repo.setKv("k", { a: 1 });
    expect(await repo.kv("k")).toEqual({ a: 1 });
    await repo.setKv("k", undefined);
    expect(await repo.kv("k")).toBeUndefined();
    repo.close();
  });

  test("tx commits, rolls back on error, and serialises concurrent transactions", async () => {
    const repo = SqliteRepo.open(":memory:");
    await expect(
      repo.tx(async (r) => {
        await r.setKv("a", 1);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await repo.kv("a")).toBeUndefined();
    const order: string[] = [];
    await Promise.all([
      repo.tx(async (r) => {
        order.push("t1 start");
        await new Promise((res) => setTimeout(res, 20));
        await r.setKv("x", 1);
        order.push("t1 end");
      }),
      repo.tx(async (r) => {
        order.push("t2 start");
        await r.setKv("x", 2);
        order.push("t2 end");
      }),
    ]);
    expect(order).toEqual(["t1 start", "t1 end", "t2 start", "t2 end"]);
    expect(await repo.kv("x")).toBe(2);
    repo.close();
  });

  test("export → import into a fresh database; reset clears one pack only", async () => {
    const a = SqliteRepo.open(":memory:");
    await a.putCard(card("card:mini-pack:units:a", 100));
    await a.putCard({ ...card("user:1", 100, "user"), packId: "other-pack", nodeId: null });
    await a.putProgress("mini-pack", { nodeId: "units", status: "lit", source: "run", theta: 0, relightsOk: 0 });
    await a.setKv("opened:mini-pack", 5);
    const b = SqliteRepo.open(":memory:");
    const counts = await b.importTables(await a.exportTables());
    expect(counts).toMatchObject({ card: 2, node_progress: 1 });
    expect((await b.exportTables()).card.length).toBe(2);
    await a.resetPack("mini-pack");
    expect((await a.cards({})).map((c) => c.id)).toEqual(["user:1"]);
    expect(await a.progress("mini-pack")).toEqual({});
    expect(await a.kv("opened:mini-pack")).toBeUndefined();
  });
});
