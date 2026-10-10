import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  buildRelightQueue,
  type Item,
  lightNodeCard,
  type RelightCandidate,
  relightDue,
  relightGrade,
} from "../src/index";
import { DAY } from "./support/pack";

const KINDS = ["choice", "numeric", "text", "order"] as const;

function item(id: string, kind: (typeof KINDS)[number], parametric: boolean): Item {
  const common = { id, prompt: `${id}?`, level: "apply" as const, difficulty: 3 as const };
  switch (kind) {
    case "choice":
      return {
        ...common,
        kind,
        options: [
          { id: "a", text: "a" },
          { id: "b", text: "b" },
        ],
        answer: "a",
      };
    case "numeric":
      return parametric
        ? { ...common, kind, answer: 2, prompt: "{n}?", params: { vars: { n: [2, 3, 4, 5] }, answerExpr: "n" } }
        : { ...common, kind, answer: 1 };
    case "text":
      return { ...common, kind, accept: ["x"] };
    case "order":
      return { ...common, kind, items: ["a", "b"], answer: [0, 1] };
  }
}

const candidate = fc
  .record({
    items: fc.array(fc.record({ kind: fc.constantFrom(...KINDS), parametric: fc.boolean() }), {
      minLength: 1,
      maxLength: 6,
    }),
    lastCount: fc.integer({ min: 0, max: 6 }),
    r: fc.double({ min: 0, max: 0.84, noNaN: true }),
  })
  .map(({ items, lastCount, r }) => ({ items, lastCount, r }));

function build(
  raw: { items: { kind: (typeof KINDS)[number]; parametric: boolean }[]; lastCount: number; r: number }[],
): RelightCandidate[] {
  return raw.map((c, n) => {
    const items = c.items.map((x, i) => item(`i${i}`, x.kind, x.parametric && x.kind === "numeric"));
    const lastCheck = items.slice(0, Math.min(c.lastCount, items.length)).map((i) => i.id);
    return {
      packId: n % 2 ? "pack-b" : "pack-a",
      nodeId: `n${n}`,
      node: { items },
      retrievability: c.r,
      lastCheck,
      lastKinds: items.filter((i) => lastCheck.includes(i.id)).map((i) => i.kind),
      lastVars: Object.fromEntries(
        items.filter((i) => i.params && lastCheck.includes(i.id)).map((i) => [i.id, { n: 2 }]),
      ),
    };
  });
}

describe("relight interleaving (property tests)", () => {
  test("no two consecutive items from one node when more than one node is due", () => {
    fc.assert(
      fc.property(
        fc.array(candidate, { minLength: 2, maxLength: 7 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer(),
        (raw, limit, seed) => {
          const q = buildRelightQueue(build(raw), { limit, seed });
          expect(q.length).toBeLessThanOrEqual(Math.max(limit, 0) * 3);
          for (let i = 1; i < q.length; i++) {
            const a = q[i - 1]?.ref;
            const b = q[i]?.ref;
            expect(`${a?.packId}/${a?.nodeId}`).not.toBe(`${b?.packId}/${b?.nodeId}`);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test("never repeats an item from the node's last check when a fresh or parametric item exists", () => {
    fc.assert(
      fc.property(fc.array(candidate, { minLength: 1, maxLength: 6 }), fc.integer(), (raw, seed) => {
        const cands = build(raw);
        const q = buildRelightQueue(cands, { limit: 8, seed });
        for (const e of q) {
          const c = cands.find((x) => x.nodeId === e.ref.nodeId) as RelightCandidate;
          const last = new Set(c.lastCheck ?? []);
          const avoidable = c.node.items.some((i) => !last.has(i.id) || i.params);
          const it = c.node.items.find((i) => i.id === e.ref.itemId) as Item;
          if (avoidable && last.has(it.id)) expect(it.params).toBeDefined();
        }
        // No item twice in one session.
        const keys = q.map((e) => `${e.ref.nodeId}/${e.ref.itemId}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 300 },
    );
  });

  test("parametric items get fresh numbers; at most 3 items per node; most faded first", () => {
    const cands = build([
      { items: [{ kind: "numeric", parametric: true }], lastCount: 1, r: 0.5 },
      {
        items: [
          { kind: "text", parametric: false },
          { kind: "order", parametric: false },
          { kind: "choice", parametric: false },
          { kind: "numeric", parametric: false },
        ],
        lastCount: 0,
        r: 0.2,
      },
    ]);
    const q = buildRelightQueue(cands, { limit: 8, seed: 1 });
    const p = q.find((e) => e.ref.nodeId === "n0");
    expect(p?.vars).toBeDefined();
    expect(p?.vars?.n).not.toBe(2);
    expect(q.filter((e) => e.ref.nodeId === "n1").length).toBeLessThanOrEqual(3);
    expect(q[0]?.ref.nodeId).toBe("n1");
    expect(buildRelightQueue(cands, { limit: 8, seed: 1 })).toEqual(q);
    expect(buildRelightQueue([], { limit: 8, seed: 1 })).toEqual([]);
  });

  test("a different format from last time comes first", () => {
    const [c] = build([
      {
        items: [
          { kind: "choice", parametric: false },
          { kind: "text", parametric: false },
          { kind: "order", parametric: false },
        ],
        lastCount: 0,
        r: 0.3,
      },
    ]);
    if (!c) throw new Error("candidate");
    const q = buildRelightQueue([{ ...c, lastKinds: ["choice", "order"] }], { limit: 1, seed: 5 });
    expect(q.map((e) => e.ref.itemId)).toEqual(["i1"]);
  });

  test("grades: all right → Good, one miss → Hard, majority wrong → Again", () => {
    expect(relightGrade([true, true, true])).toBe(3);
    expect(relightGrade([true, false, true])).toBe(2);
    expect(relightGrade([true, false])).toBe(2);
    expect(relightGrade([false, false, true])).toBe(1);
    expect(relightGrade([false])).toBe(1);
  });

  test("due node cards: fading or due within a day, most faded first", () => {
    const t0 = Date.UTC(2026, 0, 1);
    const a = lightNodeCard("p", "a", t0, 3, { fuzz: false }).card;
    const b = lightNodeCard("p", "b", t0 + 5 * DAY, 3, { fuzz: false }).card;
    const due = relightDue([a, b], t0 + 6 * DAY, { fuzz: false }, 0);
    expect(due.map((d) => d.card.nodeId)).toEqual(["a"]);
    expect(relightDue([a, b], t0 + 30 * DAY, { fuzz: false }, 0).map((d) => d.card.nodeId)).toEqual(["a", "b"]);
  });
});
