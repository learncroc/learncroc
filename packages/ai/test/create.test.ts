import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CompiledPack,
  cardShapeIssues,
  gateShapeIssues,
  type JobEvent,
  type MapFile,
  sectionSizes,
} from "@learncroc/core";
import { pickHook, wholeSentences } from "../src/create/card";
import { placeCheckpoints } from "../src/create/pack";
import { runCreateJob } from "../src/create/pipeline";
import { ToyValidator } from "../src/create/toy";
import { fakeBeatCard } from "../src/providers/fake-content";
import { clock, fakeClient, tempHome } from "./helpers";

const ARTICLE = readFileSync(join(import.meta.dir, "fixtures", "article.md"), "utf8");

async function build(size: "short" | "standard" = "short") {
  const events: JobEvent[] = [];
  const packs: CompiledPack[] = [];
  const client = fakeClient();
  await runCreateJob({
    jobId: "j1",
    packId: "pm-abcdefghij",
    request: { source: { kind: "text", text: ARTICLE, title: "Spaced practice" }, size, familiarity: "none" },
    client,
    home: tempHome(),
    now: () => clock.now(),
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
    toyValidator: new ToyValidator(),
    usage: () => ({ usage: { inputTokens: 0, outputTokens: 0 }, usd: 0 }),
    writePack: (p) => packs.push(p),
  });
  return { events, packs };
}

/** The compiled map as a map file, for the gate lint. */
function mapFileOf(pack: CompiledPack): MapFile {
  const nodes: MapFile["nodes"] = {};
  for (const id of pack.map.topo) {
    const n = pack.map.nodes[id];
    if (!n) continue;
    nodes[id] = {
      requires: n.requires,
      line: n.line,
      kind: n.kind,
      ...(n.kind === "checkpoint" && n.covers ? { covers: n.covers } : {}),
    };
  }
  return { lines: pack.map.lines, nodes };
}

describe("article map create job (fake provider)", () => {
  test("builds a lint-clean map of cards with a checkpoint at the end", async () => {
    const { events, packs } = await build();
    const error = events.find((e) => e.type === "error");
    expect(error).toBeUndefined();
    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.cards).toBe(5);

    const pack = packs.at(-1) as CompiledPack;
    expect(pack.provisional).toBeUndefined();
    expect(pack.manifest.profile).toBe("pocket");
    expect(pack.manifest.entry.suggestedStart).toBeDefined();
    for (const line of pack.map.lines) expect(line.outcome.length).toBeGreaterThan(0);

    const checkpoints = Object.values(pack.map.nodes).filter((n) => n.kind === "checkpoint");
    expect(checkpoints.map((c) => c.id)).toEqual(["cp-1"]);
    // The intro card comes first; the first checkpoint covers it alongside its 5 cards.
    expect(checkpoints[0]?.covers).toEqual(["intro", ...Object.keys(pack.nodes).filter((id) => id !== "intro")]);
    expect(pack.map.topo[0]).toBe("intro");
    expect(pack.manifest.entry.suggestedStart).toBe("intro");
    expect(checkpoints[0]?.status).toBe("playable");
    for (const n of Object.values(pack.map.nodes)) if (n.kind === "node") expect(n.gate).toBe("cp-1");

    for (const node of Object.values(pack.nodes)) {
      const errors = cardShapeIssues(node.id, node, "pocket", "en").filter((i) => i.severity === "error");
      expect(errors).toEqual([]);
      if (node.id !== "intro") expect(node.close.byGuess?.idk).toBeDefined();
    }
    const gateErrors = gateShapeIssues(mapFileOf(pack), "pocket", pack.nodes).filter((i) => i.severity === "error");
    expect(gateErrors).toEqual([]);
    expect(events.some((e) => e.type === "plan-checkpoint" && e.checkpoint.id === "cp-1")).toBe(true);
  });

  test("the intro quotes the article's opening word for word and each stop is told by Moss around passages", async () => {
    const { packs } = await build();
    const pack = packs.at(-1) as CompiledPack;
    const intro = pack.nodes.intro;
    expect(intro?.screens).toHaveLength(1);
    const quote = intro?.screens[0]?.blocks.find((b) => b.type === "quote");
    expect(quote?.type === "quote" && ARTICLE.replace(/\s+/g, " ").includes(quote.text)).toBe(true);
    expect(intro?.screens[0]?.blocks[0]).toMatchObject({ type: "story", text: expect.stringContaining("I'm Moss") });
    const firstStop = pack.map.topo.find((id) => id !== "intro" && pack.map.nodes[id]?.kind === "node") as string;
    expect(pack.map.nodes[firstStop]?.requires).toEqual(["intro"]);
    for (const node of Object.values(pack.nodes)) {
      if (node.id === "intro") continue;
      // Teach beats carry a verbatim passage between Moss's lines; the last beat is the Check.
      const teach = node.screens.filter((s) => s.blocks.some((b) => b.type === "quote"));
      expect(teach.length).toBeGreaterThanOrEqual(1);
      for (const s of teach) {
        const q = s.blocks.find((b) => b.type === "quote");
        expect(q?.type === "quote" && ARTICLE.replace(/\s+/g, " ").includes(q.text)).toBe(true);
        expect(s.blocks[0]?.type).toBe("story");
      }
      expect(node.screens.at(-1)?.interaction?.kind).toBe("choice");
      expect(node.faq?.length).toBeGreaterThan(0);
    }
  });

  test("publishes the map before the last card is ready, with no toy stage", async () => {
    const { events } = await build();
    const layout = events.findIndex((e) => e.type === "layout");
    const ready = events.flatMap((e, i) => (e.type === "card-ready" ? [i] : []));
    expect(layout).toBeGreaterThanOrEqual(0);
    expect(ready.length).toBe(5);
    expect(layout).toBeLessThan(ready.at(-1) as number);
    expect(events.some((e) => e.type === "stage" && (e.stage as string) === "toy")).toBe(false);
  });

  test("checkpoints every 4–6 cards gate the next section", () => {
    const cards = Array.from({ length: 9 }, (_, i) => ({ id: `c${i + 1}`, requires: i ? [`c${i}`] : [] }));
    const { requires, checkpoints } = placeCheckpoints(cards);
    expect(checkpoints.map((c) => c.covers.length)).toEqual(sectionSizes(9, [4, 6]));
    expect(checkpoints.map((c) => c.id)).toEqual(["cp-1", "cp-2"]);
    expect(checkpoints[0]?.requires).toEqual(["c5"]);
    expect(requires.c6).toEqual(["c5", "cp-1"]);
    expect(requires.c7).toEqual(["c6"]);
  });

  test("a hook whose long options break the 30-word cap is skipped for one that fits", () => {
    const draft = fakeBeatCard({
      kind: "create-card",
      node: {
        id: "a",
        title: "Memory",
        landmark: "Pond",
        objective: "Explain memory",
        keyPoints: ["Spacing reviews slows forgetting"],
        paras: ["p1"],
        hookIdea: "Why spacing works",
        hookStyle: "surprise",
        misconceptions: [{ id: "m1", label: "Cramming works best" }],
        caution: null,
        requires: [],
      },
      index: 1,
      total: 1,
      next: null,
      articleTitle: "Memory",
      paragraphs: [
        { id: "p1", text: "Spacing reviews slows forgetting, so short sessions spread out beat one long one." },
      ],
      familiarity: "none",
    });
    const long = "a much longer option that runs on for many many words";
    const hooks = draft.hooks.map((h, i) =>
      i === 1 ? { ...h, options: h.options.map((o) => ({ ...o, text: long })) } : h,
    );
    expect(pickHook({ ...draft, hooks }, { preferStyle: "surprise" })).toBe(0);
    expect(pickHook(draft, { preferStyle: "surprise" })).toBe(1);
    expect(pickHook({ ...draft, hooks }, { hook: 1 })).toBe(1);
  });

  test("a short passage grows to whole sentences of its paragraph, still word for word", () => {
    const para = {
      id: "p1",
      text: "Ebbinghaus tested himself for years. He found most of it faded within a day. The loss slowed after that. The shape is now called the forgetting curve: a steep drop, then a long, shallow tail.",
    };
    const out = wholeSentences("found most of it faded", para, 20, 120);
    expect(out.startsWith("He found most of it faded within a day.")).toBe(true);
    expect(out.split(/\s+/).length).toBeGreaterThanOrEqual(20);
    expect(para.text.includes(out)).toBe(true);
    expect(wholeSentences("not in the paragraph at all", para, 20, 120)).toBe("not in the paragraph at all");
  });
});
