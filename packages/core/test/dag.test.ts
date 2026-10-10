import { describe, expect, test } from "bun:test";
import {
  ancestorDepths,
  ancestors,
  childrenOf,
  type Dag,
  descendants,
  downsets,
  findCycle,
  induced,
  isDownset,
  missingRequires,
  topoSort,
  upstreamPath,
} from "../src/dag";

const diamond: Dag = { a: [], b: ["a"], c: ["a"], d: ["b", "c"], e: ["d"] };

describe("dag", () => {
  test("topological order is stable and follows graph order on ties", () => {
    expect(topoSort(diamond)).toEqual({ order: ["a", "b", "c", "d", "e"] });
    expect(topoSort({ x: [], y: [], z: ["y"], w: ["x"] }).order).toEqual(["x", "y", "z", "w"]);
    // Insertion order of a child before its parent doesn't matter.
    expect(topoSort({ child: ["root"], root: [] }).order).toEqual(["root", "child"]);
  });

  test("cycle detection", () => {
    expect(findCycle(diamond)).toBeNull();
    const cyclic: Dag = { a: ["c"], b: ["a"], c: ["b"], d: [] };
    const cycle = findCycle(cyclic);
    expect(cycle).not.toBeNull();
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(["a", "b", "c"]));
    const sorted = topoSort(cyclic);
    expect(sorted.cycle?.length).toBeGreaterThan(0);
    expect(sorted.order).toEqual(["d"]);
    expect(findCycle({ self: ["self"] })).toEqual(["self", "self"]);
  });

  test("unknown requirements are reported, not followed", () => {
    expect(missingRequires({ a: ["ghost"], b: ["a"] })).toEqual([{ node: "a", requires: "ghost" }]);
    expect(topoSort({ a: ["ghost"], b: ["a"] }).order).toEqual(["a", "b"]);
  });

  test("ancestors, descendants, depths and children", () => {
    expect(ancestors(diamond, "e")).toEqual(new Set(["d", "b", "c", "a"]));
    expect(descendants(diamond, "a")).toEqual(new Set(["b", "c", "d", "e"]));
    expect(ancestorDepths(diamond, "e")).toEqual(
      new Map([
        ["d", 1],
        ["b", 2],
        ["c", 2],
        ["a", 3],
      ]),
    );
    expect(childrenOf(diamond).a).toEqual(["b", "c"]);
    expect(ancestors(diamond, "a").size).toBe(0);
  });

  test("upstream path walks prerequisites", () => {
    expect(upstreamPath(diamond, "e", "a")).toEqual(["e", "d", "b", "a"]);
    expect(upstreamPath(diamond, "e", "e")).toEqual(["e"]);
    expect(upstreamPath(diamond, "a", "e")).toBeNull();
  });

  test("downsets: chains, antichains, closure", () => {
    expect(downsets({ a: [], b: ["a"], c: ["b"] })).toHaveLength(4);
    expect(downsets({ a: [], b: [], c: [], d: [] })).toHaveLength(16);
    const ds = downsets(diamond) ?? [];
    for (const s of ds) expect(isDownset(diamond, new Set(s))).toBe(true);
    // {}, {a}, {a,b}, {a,c}, {a,b,c}, {a,b,c,d}, {a,b,c,d,e}
    expect(ds).toHaveLength(7);
    expect(downsets({ a: [], b: [], c: [], d: [], e: [] }, 10)).toBeNull();
    expect(() => downsets({ a: ["b"], b: ["a"] })).toThrow(/cycle/);
  });

  test("induced subgraph bridges through removed nodes", () => {
    const g = induced(diamond, new Set(["a", "d", "e"]));
    expect(g).toEqual({ a: [], d: ["a"], e: ["d"] });
  });
});
