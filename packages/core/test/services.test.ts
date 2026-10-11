import { describe, expect, test } from "bun:test";
import {
  type AiPorts,
  type AnswerValue,
  type AttemptResult,
  type CompiledPack,
  createServices,
  createTryServices,
  expectedInteraction,
  type LearnServices,
  lightNodeCard,
  MemoryRepo,
  offlineAiPorts,
  type RunState,
  runNode,
  ServiceError,
  solutionOf,
  staticPackSource,
  type TryBundle,
} from "../src/index";
import { DAY, fixturePack, testClock } from "./support/pack";
import { fakeWidgets } from "./support/widgets";

function setup(opts: { ai?: AiPorts; pack?: CompiledPack } = {}) {
  const pack = opts.pack ?? fixturePack();
  const repo = new MemoryRepo();
  const clock = testClock();
  let n = 0;
  const svc = createServices({
    repo,
    packs: staticPackSource([pack]),
    clock,
    widgets: fakeWidgets,
    fuzz: false,
    newId: () => `id-${++n}`,
    ...(opts.ai ? { ai: opts.ai } : {}),
  });
  return { svc, repo, clock, pack };
}

/** A correct (or deliberately wrong) answer for whatever the run is waiting for. */
function answerFor(run: RunState, pack: CompiledPack, right = true): AnswerValue {
  const exp = expectedInteraction(run, pack);
  if (!exp) throw new Error(`nothing to answer in ${run.cursor.phase}`);
  const node = runNode(run, pack);
  const wrong: AnswerValue = { kind: "idk" };
  switch (exp.phase) {
    case "hook":
      return right ? (solutionOf((node as NonNullable<typeof node>).hook.interaction) as AnswerValue) : wrong;
    case "screen": {
      const ix = node?.screens[run.cursor.screen ?? 0]?.interaction;
      if (!ix) throw new Error("screen");
      return right ? (solutionOf(ix) as AnswerValue) : wrong;
    }
    case "card":
      throw new Error("card");
    case "checkpoint":
    case "relight": {
      const ref = run.current?.ref;
      const item = pack.nodes[ref?.nodeId ?? ""]?.items.find((i) => i.id === ref?.itemId);
      if (!item) throw new Error("item");
      if (!right) return wrong;
      if (item.kind === "explain") return { kind: "explain", text: item.exemplar, selfRating: "got-it" };
      return solutionOf(item, run.current?.vars ? { vars: run.current.vars } : {}) as AnswerValue;
    }
  }
}

async function answer(svc: LearnServices, run: RunState, pack: CompiledPack, right = true): Promise<AttemptResult> {
  const exp = expectedInteraction(run, pack);
  if (!exp) throw new Error("nothing expected");
  return svc.attempt(run.id, {
    nodeId: exp.nodeId,
    interactionId: exp.interactionId,
    phase: exp.phase,
    answer: answerFor(run, pack, right),
    ms: 1000,
  });
}

/** Answer (and advance past read-only beats) until the run reaches its close or done. */
async function playThrough(
  svc: LearnServices,
  run: RunState,
  pack: CompiledPack,
  right: (r: RunState) => boolean = () => true,
): Promise<RunState> {
  let r = run;
  for (let guard = 0; guard < 40; guard++) {
    if (expectedInteraction(r, pack)) r = (await answer(svc, r, pack, right(r))).run;
    else if (r.cursor.phase === "screen") r = (await svc.advance(r.id, { screen: r.cursor.screen ?? 0 })).run;
    else break;
  }
  return r;
}

async function close(
  svc: LearnServices,
  pack: CompiledPack,
  target: string,
  right: (r: RunState) => boolean = () => true,
) {
  const run = await playThrough(
    svc,
    (await svc.startRun({ kind: "card", packId: pack.manifest.id, target })).run,
    pack,
    right,
  );
  return svc.finish(run.id);
}

describe("services on MemoryRepo", () => {
  test("a card run: hook (started) → beats → close → finish writes done, unlocks the next card and names it", async () => {
    const { svc, pack, repo } = setup();
    const start = await svc.startRun({ kind: "card", packId: "mini-pack", target: "units" });
    expect(start).toMatchObject({ resumed: false, run: { kind: "card", cursor: { phase: "hook" } } });
    expect((await svc.startRun({ kind: "card", packId: "mini-pack", target: "units" })).resumed).toBe(true);
    // An open run with no guess yet isn't "in progress" on the map.
    expect((await svc.packProgress("mini-pack")).views.units?.state).toBe("ready");
    const hook = await svc.attempt(start.run.id, {
      nodeId: "units",
      interactionId: "hook-q",
      phase: "hook",
      answer: { kind: "choice", selected: "minutes" },
      confidence: 3,
      ms: 500,
    });
    expect(hook).toMatchObject({ correct: false, counted: false, plotTwist: true });
    expect((await repo.progress("mini-pack")).units?.status).toBe("started");
    expect((await svc.packProgress("mini-pack")).views.units?.state).toBe("in-progress");
    const miss = await answer(svc, hook.run, pack, false);
    expect(miss.solution).toBeUndefined();
    expect(miss.run.cursor.screen).toBe(0);
    const run = await playThrough(svc, miss.run, pack);
    expect(run.cursor.phase).toBe("close");
    const summary = await svc.finish(run.id);
    expect(summary).toMatchObject({
      kind: "card",
      passed: true,
      doneNow: ["units"],
      litNow: [],
      unlocked: ["unit-conversion"],
      next: { nodeId: "unit-conversion", kind: "node" },
      counted: 0,
    });
    const after = await svc.packProgress("mini-pack");
    expect(after.views.units).toMatchObject({ state: "done", brightness: 0 });
    expect(after.nodeCards.units).toBeUndefined();
    expect((await repo.attempts({ runId: run.id })).every((a) => !a.counted)).toBe(true);
  });

  test("a read-only beat moves on with advance; the wrong index is a conflict", async () => {
    const { svc, pack } = setup();
    await close(svc, pack, "units");
    const start = await svc.startRun({ kind: "card", packId: "mini-pack", target: "unit-conversion" });
    let r = (await answer(svc, start.run, pack)).run;
    r = (await answer(svc, r, pack)).run;
    expect(r.cursor).toEqual({ phase: "screen", screen: 1 });
    await expect(svc.advance(r.id, { screen: 0 })).rejects.toThrow(ServiceError);
    const moved = await svc.advance(r.id, { screen: 1 });
    expect(moved.run.cursor).toEqual({ phase: "screen", screen: 2 });
    await expect(svc.advance(r.id, { screen: 2 })).rejects.toThrow(ServiceError);
    const done = await svc.finish((await playThrough(svc, moved.run, pack)).id);
    expect(done.next).toEqual({ nodeId: "checkpoint-basics", kind: "checkpoint" });
  });

  test("closed cards replay: the old guess is pinned, nothing is written; again asks the hook fresh", async () => {
    const { svc, pack, repo } = setup();
    await close(svc, pack, "units", (r) => r.cursor.phase !== "hook");
    const before = await repo.progress("mini-pack");
    const replay = await svc.startRun({ kind: "card", packId: "mini-pack", target: "units", mode: "replay" });
    expect(replay.run).toMatchObject({
      replay: true,
      cursor: { phase: "screen", screen: 0 },
      guess: { correct: false },
    });
    const summary = await svc.finish((await playThrough(svc, replay.run, pack)).id);
    expect(summary.doneNow).toEqual([]);
    expect(await repo.progress("mini-pack")).toEqual(before);
    const again = await svc.startRun({ kind: "card", packId: "mini-pack", target: "units", mode: "again" });
    expect(again.run).toMatchObject({ replay: true, cursor: { phase: "hook" } });
    expect(again.run.guess).toBeUndefined();
  });

  test("hints on a beat: authored ladder, level 3 shows the worked answer; the second miss shows it and moves on", async () => {
    const { svc, pack } = setup();
    const start = await svc.startRun({ kind: "card", packId: "mini-pack", target: "units" });
    const r = (await answer(svc, start.run, pack)).run;
    const s2 = (await answer(svc, r, pack)).run;
    expect(s2.cursor.screen).toBe(1);
    const h1 = await svc.hint(s2.id, { interactionId: "s2-q", answer: { kind: "numeric", value: 2 } });
    expect(h1).toMatchObject({ level: 1, source: "authored" });
    expect(h1.hint).toContain("Check the units");
    const h2 = await svc.hint(s2.id, { interactionId: "s2-q" });
    expect(h2.level).toBe(2);
    const h3 = await svc.hint(s2.id, { interactionId: "s2-q" });
    expect(h3.level).toBe(3);
    expect(h3.hint).toContain("120");
    await expect(svc.hint(s2.id, { interactionId: "s1-q" })).rejects.toThrow(ServiceError);
    await expect(svc.crocHint(s2.id)).rejects.toThrow(ServiceError);
  });

  test("the second miss on a beat applies the worked answer and the next answer moves on", async () => {
    const { svc, pack } = setup();
    const start = await svc.startRun({ kind: "card", packId: "mini-pack", target: "units" });
    const r = (await answer(svc, start.run, pack)).run;
    const m1 = await answer(svc, r, pack, false);
    const m2 = await answer(svc, m1.run, pack, false);
    expect(m2.run.hints["s1-q"]).toBe(3);
    expect(m2.solution).toBeDefined();
    const m3 = await answer(svc, m2.run, pack, false);
    expect(m3.run.cursor.screen).toBe(1);
  });

  test("conflicts: locked cards, checkpoints before their cards, kinds that don't match the target", async () => {
    const { svc, pack } = setup();
    await expect(svc.startRun({ kind: "card", packId: "mini-pack", target: "speed" })).rejects.toThrow(/isn't open/);
    await expect(svc.startRun({ kind: "card", packId: "mini-pack", target: "average-speed" })).rejects.toThrow(
      ServiceError,
    );
    await expect(svc.startRun({ kind: "card", packId: "mini-pack", target: "checkpoint-basics" })).rejects.toThrow(
      /not a card/,
    );
    await expect(
      svc.startRun({ kind: "checkpoint", packId: "mini-pack", target: "checkpoint-basics" }),
    ).rejects.toThrow(/Finish the cards/);
    await expect(svc.startRun({ kind: "card", packId: "mini-pack", target: "Bad Id" })).rejects.toThrow(ServiceError);
    const run = (await svc.startRun({ kind: "card", packId: "mini-pack", target: "units" })).run;
    await expect(svc.finish(run.id)).rejects.toThrow(ServiceError);
    await expect(svc.patchScratch(run.id, { x: "y".repeat(70_000) })).rejects.toThrow(ServiceError);
    expect(await svc.abandon(run.id)).toEqual({ ok: true });
    void pack;
  });

  test("a ready checkpoint starts with its plan", async () => {
    const { svc, pack } = setup();
    await close(svc, pack, "units");
    await close(svc, pack, "unit-conversion");
    expect((await svc.packProgress("mini-pack")).views["checkpoint-basics"]?.state).toBe("ready");
    const cp = await svc.startRun({ kind: "checkpoint", packId: "mini-pack", target: "checkpoint-basics" });
    expect(cp.run).toMatchObject({ kind: "checkpoint", size: 3, cursor: { phase: "checkpoint", item: 0 } });
  });

  test("Relight: lit cards that fade come back mixed; relit later counts as durable", async () => {
    const { svc, pack, repo, clock } = setup();
    const now = clock.now();
    for (const id of ["units", "unit-conversion"]) {
      await repo.putProgress("mini-pack", {
        nodeId: id,
        status: "lit",
        source: "checkpoint",
        litAt: now,
        theta: 0,
        relightsOk: 0,
      });
      await repo.putCard(lightNodeCard("mini-pack", id, now, 3, { fuzz: false }).card);
    }
    const nothing = await svc.relight({});
    expect(nothing).toMatchObject({ nothingDue: true, items: [] });
    clock.advance(20 * DAY);
    expect((await svc.packProgress("mini-pack")).views.units?.state).toBe("fading");
    const r = await svc.relight({ limit: 8 });
    expect(r.items.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < r.items.length; i++) expect(r.items[i]?.ref.nodeId).not.toBe(r.items[i - 1]?.ref.nodeId);
    const run = await playThrough(svc, r.run, pack);
    const summary = await svc.finish(run.id);
    expect(summary.relit?.map((x) => x.grade)).toEqual([3, 3]);
    const after = await svc.packProgress("mini-pack");
    expect(after.views.units).toMatchObject({ state: "lit", durable: true });
  });

  test("flashcards, logbook, summary and opened", async () => {
    const { svc, pack, repo } = setup();
    await close(svc, pack, "units");
    const sum = await svc.progressSummary();
    expect(sum.packs["mini-pack"]).toMatchObject({ done: 1, lit: 0, playable: 3, finished: false });
    const card = await svc.createCard({ packId: "mini-pack", front: "Q", back: "A", source: "manual" });
    expect((await svc.listCards({ kind: "user" })).map((c) => c.id)).toEqual([card.id]);
    expect(await svc.markOpened("mini-pack")).toEqual({ ok: true });
    expect((await svc.packProgress("mini-pack")).lastOpenedAt).toBeDefined();
    const log = await svc.logbook({});
    expect(log.badges).toEqual([]);
    expect(log.usedToThink).toEqual([]);
    await repo.putProgress("mini-pack", {
      nodeId: "units",
      status: "lit",
      source: "checkpoint",
      theta: 0,
      relightsOk: 0,
    });
    expect((await svc.logbook({})).usedToThink).toEqual([]);
    expect((await svc.numbers()).cardCompletion).toEqual({ opened: 1, closed: 1 });
  });

  test("try-runs play the first card in a throwaway store", async () => {
    const pack = fixturePack();
    const bundle: TryBundle = {
      manifest: pack.manifest,
      map: pack.map,
      node: pack.nodes.units as NonNullable<typeof pack.nodes.units>,
    };
    const svc = createTryServices(bundle, { clock: testClock(), widgets: fakeWidgets });
    const start = await svc.startRun({ kind: "try", registry: "builtin", packId: "mini-pack" });
    expect(start.run).toMatchObject({ kind: "card", target: "units" });
    expect(start.tryPack?.manifest.id).toBe("mini-pack");
    const run = await playThrough(svc, start.run, start.tryPack as CompiledPack);
    const summary = await svc.finish(run.id);
    expect(summary).toMatchObject({ passed: true, doneNow: ["units"] });
  });

  test("AI ports: a hint rewrite on a beat marks help", async () => {
    const ai: AiPorts = { ...offlineAiPorts, configured: async () => true, rewriteHint: async () => "Rewritten." };
    const { svc, pack } = setup({ ai });
    const start = await svc.startRun({ kind: "card", packId: "mini-pack", target: "units" });
    const r = (await answer(svc, start.run, pack)).run;
    const h = await svc.hint(r.id, { interactionId: "s1-q" });
    expect(h).toMatchObject({ hint: "Rewritten.", source: "ai" });
    expect(h.run.assisted).toEqual(["s1-q"]);
  });
});
