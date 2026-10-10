import { describe, expect, test } from "bun:test";
import {
  type AttemptInput,
  type CompiledPack,
  createRun,
  currentInteractionId,
  expectedInteraction,
  type GradeResult,
  type ItemRef,
  RunError,
  type RunEvent,
  type RunState,
  RunState as RunStateSchema,
  reduceRun,
} from "../src/index";
import { fixturePack } from "./support/pack";

const T = Date.UTC(2026, 9, 20, 9);
const RIGHT: GradeResult = { correct: true, score: 1 };
const WRONG: GradeResult = { correct: false, score: 0 };
const ref = (nodeId: string, itemId: string): ItemRef => ({ packId: "mini-pack", nodeId, itemId });

/** Applies events the way the server does, and checks a client replaying the same event agrees. */
function play(run: RunState, pack: CompiledPack | null, events: RunEvent[]): RunState {
  let state = run;
  for (const [i, e] of events.entries()) {
    const server = reduceRun(state, pack, e, T + i);
    const wire = JSON.parse(JSON.stringify(state)) as RunState;
    const client = reduceRun(
      wire,
      pack ? (JSON.parse(JSON.stringify(pack)) as CompiledPack) : null,
      JSON.parse(JSON.stringify(e)) as RunEvent,
      T + i,
    );
    expect(JSON.parse(JSON.stringify(client))).toEqual(JSON.parse(JSON.stringify(server)));
    expect(RunStateSchema.safeParse(server).success).toBe(true);
    state = server;
  }
  return state;
}

function att(
  run: RunState,
  pack: CompiledPack | null,
  grade: GradeResult,
  next?: RunState["current"],
  extra: Partial<AttemptInput> = {},
): RunEvent {
  const exp = expectedInteraction(run, pack);
  if (!exp) throw new Error(`nothing expected in ${run.cursor.phase}`);
  return {
    type: "attempt",
    input: {
      nodeId: exp.nodeId,
      interactionId: exp.interactionId,
      phase: exp.phase,
      answer: { kind: "idk" },
      ms: 100,
      ...extra,
    },
    grade,
    counted: false,
    credited: grade.score,
    ...(next ? { next } : {}),
  };
}

/** Step one event at a time, computing each from the state before it. */
function walk(run: RunState, pack: CompiledPack | null, steps: ((r: RunState) => RunEvent)[]): RunState {
  let s = run;
  for (const step of steps) s = play(s, pack, [step(s)]);
  return s;
}

describe("run reducer", () => {
  const pack = fixturePack();

  test("card: hook → beat with an action (a miss stays) → read-only beat (advance) → beat → close → finish", () => {
    const run = createRun({ id: "r1", kind: "card", pack, target: "unit-conversion", now: T, seed: 7 });
    expect(run.cursor).toEqual({ phase: "hook" });
    expect(currentInteractionId(run, pack)).toBe("hook-q");
    const afterHook = play(run, pack, [att(run, pack, WRONG, undefined, { confidence: 3 })]);
    expect(afterHook.guess).toMatchObject({ interactionId: "hook-q", correct: false, confidence: 3 });
    expect(afterHook.cursor).toEqual({ phase: "screen", screen: 0 });
    const missed = play(afterHook, pack, [att(afterHook, pack, WRONG)]);
    expect(missed.cursor).toEqual({ phase: "screen", screen: 0 });
    const s1 = play(missed, pack, [att(missed, pack, RIGHT)]);
    expect(s1.cursor).toEqual({ phase: "screen", screen: 1 });
    // Beat 2 is read-only: nothing to answer, only advance.
    expect(expectedInteraction(s1, pack)).toBeNull();
    expect(() => reduceRun(s1, pack, { type: "advance", screen: 0 }, T)).toThrow(RunError);
    const s2 = play(s1, pack, [{ type: "advance", screen: 1 }]);
    expect(s2.cursor).toEqual({ phase: "screen", screen: 2 });
    expect(() => reduceRun(s2, pack, { type: "advance", screen: 2 }, T)).toThrow(RunError);
    expect(() => reduceRun(s2, pack, { type: "finish" }, T)).toThrow(RunError);
    const close = play(s2, pack, [att(s2, pack, RIGHT)]);
    expect(close.cursor).toEqual({ phase: "close" });
    expect(expectedInteraction(close, pack)).toBeNull();
    const done = play(close, pack, [{ type: "finish" }]);
    expect(done).toMatchObject({ finishedAt: T, cursor: { phase: "done" } });
    expect(() => reduceRun(done, pack, { type: "abandon" }, T)).toThrow(RunError);
  });

  test("hints, assists and scratch; the worked solution (hint 3) lets a beat move on", () => {
    const run = createRun({ id: "r2", kind: "card", pack, target: "units", now: T, seed: 1 });
    const s0 = play(run, pack, [att(run, pack, RIGHT)]);
    const withScratch = play(s0, pack, [{ type: "scratch", scratch: { "s1-q": { a: 1 } } }]);
    const hinted = play(withScratch, pack, [
      { type: "hint", interactionId: "s1-q", level: 1 },
      { type: "hint", interactionId: "s1-q", level: 3 },
      { type: "hint", interactionId: "s1-q", level: 2 },
      { type: "assist", interactionId: "s1-q" },
      { type: "assist", interactionId: "s1-q" },
    ]);
    expect(hinted.hints["s1-q"]).toBe(3);
    expect(hinted.assisted).toEqual(["s1-q"]);
    const moved = play(hinted, pack, [att(hinted, pack, WRONG)]);
    expect(moved.cursor).toMatchObject({ phase: "screen", screen: 1, scratch: { "s1-q": { a: 1 } } });
  });

  test("a pinned guess (replay) starts at beat 0; from and replay are kept", () => {
    const guess = { interactionId: "hook-q", answer: { kind: "choice" as const, selected: "minutes" }, correct: false };
    const run = createRun({
      id: "r3",
      kind: "card",
      pack,
      target: "units",
      now: T,
      seed: 1,
      guess,
      replay: true,
      from: "checkpoint-basics",
    });
    expect(run).toMatchObject({
      guess,
      replay: true,
      from: "checkpoint-basics",
      cursor: { phase: "screen", screen: 0 },
    });
  });

  test("errors: wrong phase, wrong interaction, unknown card", () => {
    const run = createRun({ id: "r4", kind: "card", pack, target: "units", now: T, seed: 1 });
    const bad = att(run, pack, RIGHT);
    if (bad.type !== "attempt") throw new Error("attempt");
    expect(() => reduceRun(run, pack, { ...bad, input: { ...bad.input, phase: "screen" } }, T)).toThrow(RunError);
    expect(() => reduceRun(run, pack, { ...bad, input: { ...bad.input, interactionId: "s1-q" } }, T)).toThrow(RunError);
    expect(() => createRun({ id: "x", kind: "card", pack, target: "checkpoint-basics", now: T, seed: 1 })).toThrow(
      RunError,
    );
  });

  test("checkpoint: one shot per question, done after the last, finish only in done", () => {
    const q = (nodeId: string, itemId: string) => ({ ref: ref(nodeId, itemId) });
    const run = createRun({
      id: "c1",
      kind: "checkpoint",
      pack,
      target: "checkpoint-basics",
      now: T,
      seed: 1,
      current: q("units", "i2"),
      size: 3,
    });
    expect(run).toMatchObject({ cursor: { phase: "checkpoint", item: 0 }, size: 3, queue: [ref("units", "i2")] });
    expect(() => reduceRun(run, pack, { type: "finish" }, T)).toThrow(RunError);
    const end = walk(run, pack, [
      (r) => att(r, pack, WRONG, q("unit-conversion", "i1")),
      (r) => att(r, pack, RIGHT, q("units", "i4")),
      (r) => att(r, pack, RIGHT),
    ]);
    expect(end.cursor).toEqual({ phase: "done", item: 3 });
    expect(end.current).toBeUndefined();
    expect(end.queue).toHaveLength(3);
    expect(play(end, pack, [{ type: "finish" }]).finishedAt).toBe(T);
    expect(() =>
      createRun({ id: "c2", kind: "checkpoint", pack, target: "checkpoint-basics", now: T, seed: 1 }),
    ).toThrow(RunError);
  });

  test("relight: one item at a time while next is given; cross-pack relight has no pack; finish any time", () => {
    const first = { ref: ref("units", "i1") };
    const run = createRun({ id: "rl", kind: "relight", pack: null, now: T, seed: 2, current: first });
    expect(run).toMatchObject({ packId: "*", packVersion: "*", cursor: { phase: "relight", item: 0 } });
    const end = walk(run, null, [(r) => att(r, null, RIGHT, { ref: ref("speed", "i1") }), (r) => att(r, null, WRONG)]);
    expect(end.cursor.phase).toBe("done");
    const early = play(run, null, [{ type: "finish" }]);
    expect(early.finishedAt).toBe(T);
  });
});
