import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { lintPack, memoryFs } from "@learncroc/core";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import { parse } from "yaml";
import { type BuildFs, buildPack, planToMap } from "../src/build/author";
import { fakeClient } from "./helpers";

const FIXTURE = resolve(import.meta.dir, "../../core/fixtures/mini-pack");

function memFs(initial: Record<string, string>): BuildFs & { files: Record<string, string> } {
  const files = { ...initial };
  return {
    files,
    read: async (p) => files[p],
    write: async (p, t) => {
      files[p] = t;
    },
    list: async (dir) =>
      Object.keys(files)
        .filter((k) => k.startsWith(`${dir}/`))
        .map((k) => k.slice(dir.length + 1)),
  };
}

describe("learncroc build", () => {
  test("plan → stops → practice → lint-clean draft YAML with provenance, no reviews", async () => {
    const fs = memFs({
      "pack.yaml": readFileSync(join(FIXTURE, "pack.yaml"), "utf8"),
      "sources/notes.md": readFileSync(join(import.meta.dir, "fixtures", "article.md"), "utf8"),
    });
    const logs: string[] = [];
    const result = await buildPack({
      client: fakeClient(),
      fs,
      nodeCount: 4,
      yes: true,
      log: (m) => logs.push(m),
      now: () => Date.UTC(2026, 9, 20),
      lint: async () => (await lintPack(memoryFs(fs.files), { widgets: widgetSpecRegistry })).report,
    });
    expect(result.written.length).toBe(4);
    expect(result.failed).toEqual([]);
    expect(result.report?.errors).toBe(0);
    const node = parse(fs.files[`nodes/${result.written[0]}.yaml`] as string);
    expect(node.status).toBe("draft");
    expect(node.provenance).toMatchObject({ feature: "build", prompt: "author-node@3" });
    expect(
      fs.files[`nodes/${result.written[0]}.yaml`]?.startsWith(
        "# yaml-language-server: $schema=../../../schemas/node.schema.json",
      ),
    ).toBe(true);
    const lock = parse(fs.files["pack.lock.yaml"] as string);
    expect(Object.keys(lock.provenance)).toContain("map.yaml");
    expect(lock.reviews).toBeUndefined();
    expect(parse(fs.files["pack.yaml"] as string).widgets["ab-compare"]).toBe(1);
  });

  test("without --yes the build stops at the plan checkpoint", async () => {
    const fs = memFs({ "pack.yaml": readFileSync(join(FIXTURE, "pack.yaml"), "utf8") });
    const result = await buildPack({
      client: fakeClient(),
      fs,
      nodeCount: 3,
      confirmPlan: async () => false,
      log: () => undefined,
      now: () => 0,
      lint: async () => {
        throw new Error("lint must not run at the checkpoint");
      },
    });
    expect(result.stoppedAtPlan).toBe(true);
    expect(fs.files["map.yaml"]).toBeDefined();
    expect(Object.keys(fs.files).some((k) => k.startsWith("nodes/"))).toBe(false);
  });

  test("planToMap drops forward references and cycles", () => {
    const base = {
      line: "main",
      kind: "node" as const,
      bigIdea: "b",
      hookIdea: "h",
      objectives: ["o"],
      misconceptions: [],
      sources: [],
    };
    const { map } = planToMap({
      lines: [{ id: "main", title: "Main", outcome: "Explain" }],
      nodes: [
        { ...base, id: "a", title: "A", requires: ["c"] },
        { ...base, id: "b", title: "B", requires: ["a"] },
        { ...base, id: "c", title: "C", requires: ["b", "a"] },
      ],
    });
    expect(map.nodes.a?.requires).toEqual([]);
    expect(map.nodes.c?.requires).toEqual(["b", "a"]);
  });
});
