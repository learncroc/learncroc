import { describe, expect, test } from "bun:test";
import { SkeletonStream } from "../src/create/skeleton";
import { layoutMap } from "../src/layout";

const node = (id: string, requires: string[] = [], paras = ["p1"]) => ({
  id,
  title: `${id} title here and more`,
  landmark: "Pond",
  objective: `Explain ${id}`,
  keyPoints: [`${id} one`, `${id} two`],
  paras,
  hookIdea: `${id} surprises`,
  misconceptions: [{ id: "m one", label: "wrong" }],
  caution: null,
  requires,
});

describe("streamed skeleton", () => {
  test("emits each node as soon as it closes, then edges; normalises ids and drops cycles", () => {
    const doc = {
      title: "A map",
      gist: "Gist",
      palette: ["#112233", "#445566", "bad", "#778899", "#AABBCC"],
      nodes: [node("Alpha"), node("beta", ["Alpha"]), node("gamma", ["beta", "missing"], ["p9", "p2"])],
      edges: [
        { from: "Alpha", to: "beta" },
        { from: "gamma", to: "Alpha" },
        { from: "Alpha", to: "gamma" },
      ],
    };
    const json = JSON.stringify(doc);
    const s = new SkeletonStream(["p1", "p2", "p3"], 5);
    const seen: string[] = [];
    // Feed in small chunks, the way a provider streams.
    for (let i = 20; i < json.length; i += 20) {
      for (const u of s.push(json.slice(0, i)))
        seen.push(u.kind === "node" ? `node:${u.node.id}` : u.kind === "edge" ? `edge:${u.from}>${u.to}` : "meta");
    }
    for (const u of s.push(json, true))
      seen.push(u.kind === "node" ? `node:${u.node.id}` : u.kind === "edge" ? `edge:${u.from}>${u.to}` : "meta");
    expect(seen.indexOf("node:alpha")).toBeLessThan(seen.indexOf("node:beta"));
    expect(seen.indexOf("node:beta")).toBeLessThan(seen.indexOf("node:gamma"));
    expect(seen).toContain("edge:alpha>beta");
    expect(seen).toContain("edge:alpha>gamma");
    expect(seen).not.toContain("edge:gamma>alpha");
    const r = s.result();
    expect(r.nodes.map((n) => n.id)).toEqual(["alpha", "beta", "gamma"]);
    expect(r.nodes[2]?.paras).toEqual(["p2"]);
    expect(r.nodes[0]?.title.split(" ").length).toBeLessThanOrEqual(4);
    expect(r.palette).toBeUndefined();
  });

  test("caps the number of stops at the requested depth", () => {
    const s = new SkeletonStream(["p1"], 3);
    s.push(
      JSON.stringify({
        title: "t",
        gist: "g",
        palette: [],
        nodes: [node("a"), node("b"), node("c"), node("d")],
        edges: [],
      }),
      true,
    );
    expect(s.result().nodes.length).toBe(3);
  });
});

describe("provisional layout", () => {
  test("columns follow prerequisite depth; edges between lines are interchanges or transfers", () => {
    const { layout, topo } = layoutMap([
      { id: "a", requires: [] },
      { id: "b", requires: [] },
      { id: "c", requires: ["a", "b"] },
      { id: "d", requires: ["c"] },
    ]);
    expect(topo).toEqual(["a", "b", "c", "d"]);
    expect(layout.nodes.c?.col).toBe(1);
    expect(layout.nodes.d?.col).toBe(2);
    expect(layout.edges.find((e) => e.from === "b" && e.to === "c")?.kind).toBe("interchange");
    const xy = Object.values(layout.nodes).map((n) => `${n.x},${n.y}`);
    expect(new Set(xy).size).toBe(xy.length);
  });
});
