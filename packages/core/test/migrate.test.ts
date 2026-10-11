import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  type CardState,
  detectSchema,
  lightNodeCard,
  MapFile,
  MemoryRepo,
  migrateCards,
  migratePack,
  migrateProgress,
  type NodeProgress,
  PackManifest,
  PackNode,
} from "../src/index";
import { fixturePack } from "./support/pack";

const REV2 = join(import.meta.dir, "fixtures/rev2-pack");
/** The frozen revision-2 pack's YAML files (pack-relative path → text). */
function rev2Files(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ["pack.yaml", "map.yaml", "pack.lock.yaml", "toy.yaml"]) out[f] = readFileSync(join(REV2, f), "utf8");
  for (const sub of ["nodes", "bosses"])
    for (const f of readdirSync(join(REV2, sub))) out[`${sub}/${f}`] = readFileSync(join(REV2, sub, f), "utf8");
  return out;
}

const p = (nodeId: string, status: NodeProgress["status"] = "lit", litAt = 1): NodeProgress => ({
  nodeId,
  status,
  source: "run",
  litAt,
  theta: 0,
  relightsOk: 0,
});

describe("migrateProgress", () => {
  test("renamed nodes keep their progress; deleted nodes go to the archive", () => {
    const oldPack = fixturePack();
    const newPack = fixturePack();
    const speed = newPack.nodes.speed as PackNode;
    delete newPack.nodes.speed;
    newPack.nodes.velocity = { ...speed, id: "velocity", renamedFrom: ["speed"] };
    const entry = newPack.map.nodes.speed;
    delete newPack.map.nodes.speed;
    if (entry) newPack.map.nodes.velocity = { ...entry, id: "velocity" };
    delete newPack.map.nodes.units;
    delete newPack.nodes.units;
    const out = migrateProgress(oldPack, newPack, {
      speed: p("speed", "done"),
      units: p("units"),
      "unit-conversion": p("unit-conversion"),
    });
    expect(out.progress).toEqual({
      velocity: { ...p("speed", "done"), nodeId: "velocity" },
      "unit-conversion": p("unit-conversion"),
    });
    expect(out.archived.map((a) => a.nodeId)).toEqual(["units"]);
    expect(out.renamed).toEqual([{ from: "speed", to: "velocity" }]);
    expect(out.removed).toEqual(["units"]);
  });

  test("when both ids have progress, the stronger row wins and the other is archived", () => {
    const newPack = fixturePack();
    (newPack.nodes.units as PackNode).renamedFrom = ["old-units"];
    const out = migrateProgress(null, newPack, { units: p("units", "started"), "old-units": p("old-units", "lit", 5) });
    expect(out.progress.units).toMatchObject({ status: "lit", nodeId: "units", litAt: 5 });
    expect(out.archived).toEqual([p("units", "started")]);
  });

  test("cards follow renames; cards of deleted nodes are archived suspended", () => {
    const t = Date.UTC(2026, 0, 1);
    const node = lightNodeCard("mini-pack", "speed", t, 3, { fuzz: false }).card;
    const gone = lightNodeCard("mini-pack", "units", t, 3, { fuzz: false }).card;
    const flash: CardState = { ...node, id: "card:mini-pack:speed:card-1", kind: "flashcard" };
    const other: CardState = { ...node, id: "node:other:speed", packId: "other" };
    const out = migrateCards("mini-pack", [node, gone, flash, other], {
      renamed: [{ from: "speed", to: "velocity" }],
      archived: [p("units")],
    });
    expect(out.cards.map((c) => c.id).sort()).toEqual([
      "card:mini-pack:velocity:card-1",
      "node:mini-pack:velocity",
      "node:other:speed",
    ]);
    expect(out.removedIds.sort()).toEqual([
      "card:mini-pack:speed:card-1",
      "node:mini-pack:speed",
      "node:mini-pack:units",
    ]);
    expect(out.archived).toEqual([{ ...gone, suspended: true }]);
    // User cards follow renames in their own pack only.
    const mine: CardState = { ...node, id: "user:1", kind: "user", front: "f", back: "b" };
    const theirs: CardState = { ...mine, id: "user:2", packId: "other" };
    const users = migrateCards("mini-pack", [mine, theirs], {
      renamed: [{ from: "speed", to: "velocity" }],
      archived: [],
    });
    expect(users.cards.map((c) => [c.id, c.nodeId])).toEqual([
      ["user:1", "velocity"],
      ["user:2", "speed"],
    ]);
  });
});

describe("pack codemods", () => {
  const legacy = {
    "pack.yaml":
      "# my pack\nid: legacy-pack\nversion: 0.1.0\nentry: { suggested_start: a, cold_open_node: a, placement: false }\nwidgets: { probability-bars: 1 }\n",
    "nodes/a.yaml": [
      "id: a",
      "big_idea: something   # keep this comment",
      "renamed_from: [old_a]",
      "misconceptions:",
      "  my_wrong_idea: { label: x, upstream: in-node:s1, hint: y }",
      "screens:",
      "  - id: s1",
      "    interaction:",
      "      kind: numeric",
      "      feedback_right: yes",
      "      on_wrong: { '540': { feedback: no } }",
      "      widget: { id: plot, v: 1, props: { keep_me: 1 } }",
      "items:",
      "  - id: i1",
      "    params: { vars: { n_max: [1, 2] }, answer_expr: n_max * 2 }",
    ].join("\n"),
  };

  test("0 → 1 → 2: camelCase keys, ids and widget values untouched, comments kept, schema added", () => {
    expect(detectSchema(parse(legacy["pack.yaml"]))).toBe(0);
    const m = migratePack(legacy);
    expect(m).toMatchObject({ from: 0, to: 2, applied: ["snake-to-camel", "card-loop"] });
    const pack = parse(m.files["pack.yaml"] as string);
    expect(pack.schema).toBe(2);
    expect(pack.entry).toEqual({ suggestedStart: "a" });
    expect(pack.widgets).toEqual({ "probability-bars": 1 });
    expect(m.files["pack.yaml"]).toContain("# my pack");
    const node = parse(m.files["nodes/a.yaml"] as string);
    expect(node.bigIdea).toBe("something");
    expect(node.renamedFrom).toEqual(["old_a"]);
    expect(node.misconceptions).toEqual({ my_wrong_idea: { label: "x", hint: "y" } });
    expect(node.screens[0].interaction.feedbackRight).toBe("yes");
    expect(node.screens[0].interaction.onWrong["540"].feedback).toBe("no");
    expect(node.screens[0].interaction.widget.props).toEqual({ keep_me: 1 });
    expect(node.items[0].params).toEqual({ vars: { n_max: [1, 2] }, answerExpr: "n_max * 2" });
    expect(m.files["nodes/a.yaml"]).toContain("# keep this comment");
    expect(m.changes.length).toBeGreaterThan(5);
  });

  test("1 → 2 on a frozen revision-2 pack: the card loop, text edits only", () => {
    const files = rev2Files();
    const m = migratePack(files);
    expect(m).toMatchObject({ from: 1, to: 2, applied: ["card-loop"] });
    expect(m.deleted.sort()).toEqual(["bosses/boss-shop.yaml", "toy.yaml"]);
    const manifest = PackManifest.parse({ ...parse(m.files["pack.yaml"] as string), id: "rev2-pack" });
    expect(manifest.theme.gateName).toBe("Shop test");
    expect(manifest.entry).toEqual({ suggestedStart: "per-hundred" });
    // Untouched lines stay byte for byte (comments, flow style, quoting).
    expect(m.files["pack.yaml"]).toContain("# A frozen revision-2 pack");
    expect(m.files["pack.yaml"]).toContain('lines: ["#7FB2FF", "#C792F2", "#F07DA6", "#9AD07A", "#E6E1D3"]');
    expect(MapFile.parse(parse(m.files["map.yaml"] as string)).nodes["boss-shop"]?.kind).toBe("checkpoint");
    const nodes = Object.fromEntries(
      ["per-hundred", "ten-percent", "price-change"].map((id) => [
        id,
        PackNode.parse(parse(m.files[`nodes/${id}.yaml`] as string)),
      ]),
    );
    const old = parse(files["nodes/per-hundred.yaml"] as string);
    const ph = nodes["per-hundred"] as PackNode;
    expect(ph.close).toEqual({ text: old.hook.reveal, teaser: "" });
    expect(ph.flashcards?.map((c) => c.id)).toEqual(["c1"]);
    expect(ph.misconceptions["percent-is-count"]).toEqual({
      label: old.misconceptions["percent-is-count"].label,
      hint: old.misconceptions["percent-is-count"].hint,
    });
    expect(ph.items.find((i) => i.id === "i3")?.use).toEqual(["checkpoint", "relight"]);
    const ported = ph.items.find((i) => i.id === "st1-share");
    expect(ported).toMatchObject({ kind: "widget", level: "transfer", difficulty: 3 });
    expect(ported?.why?.endsWith("…")).toBe(true);
    expect(ported?.why?.split(/\s+/).length).toBe(25);
    expect(nodes["price-change"]?.items.at(-1)).toMatchObject({ id: "st2-price", why: "18 is less than 20." });
    for (const n of Object.values(nodes)) expect(n.screens.every((s) => s.interaction && s.reveal)).toBe(true);
    const lock = parse(m.files["pack.lock.yaml"] as string);
    expect(Object.keys(lock.provenance)).toEqual(["nodes/per-hundred.yaml"]);
    // Running it again changes nothing.
    const again = migratePack({
      ...Object.fromEntries(Object.entries(files).filter(([k]) => !m.deleted.includes(k))),
      ...m.files,
    });
    expect(again).toMatchObject({ from: 2, to: 2, applied: [], files: {}, deleted: [] });
  });

  test("current packs are left alone; newer packs are refused", () => {
    const current = { "pack.yaml": "schema: 2\nid: x\n" };
    expect(migratePack(current)).toMatchObject({ from: 2, to: 2, applied: [], files: {} });
    expect(() => migratePack({ "pack.yaml": "schema: 9\n" })).toThrow(/newer/);
  });
});

describe("MemoryRepo", () => {
  test("tx rolls back on error; values are copies", async () => {
    const repo = new MemoryRepo();
    await repo.putProgress("pk", p("a"));
    await expect(
      repo.tx(async (r) => {
        await r.putProgress("pk", p("b"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(Object.keys(await repo.progress("pk"))).toEqual(["a"]);
    const got = await repo.progress("pk");
    (got.a as NodeProgress).theta = 99;
    expect((await repo.progress("pk")).a?.theta).toBe(0);
  });

  test("export → import round trip", async () => {
    const repo = new MemoryRepo();
    await repo.putProgress("pk", p("a"));
    await repo.putCard(lightNodeCard("pk", "a", 0, 3, { fuzz: false }).card);
    await repo.addAttempt({
      runId: "r",
      packId: "pk",
      nodeId: "a",
      interactionId: "i",
      phase: "checkpoint",
      answer: { kind: "idk" },
      correct: false,
      score: 0,
      creditedScore: 0,
      counted: true,
      hintLevel: 0,
      assisted: false,
      ms: 1,
      at: 2,
    });
    await repo.setKv("k", { x: 1 });
    const dump = await repo.exportTables();
    const fresh = new MemoryRepo();
    const counts = await fresh.importTables(dump);
    expect(counts).toMatchObject({ node_progress: 1, card: 1, attempt: 1 });
    expect(await fresh.exportTables()).toEqual(dump);
    expect(await fresh.addAttempt({ ...dump.attempt[0], id: undefined } as never)).toBe(2);
    expect(await repo.kv("k")).toEqual({ x: 1 });
  });
});
