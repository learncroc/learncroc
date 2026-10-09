import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { parse } from "yaml";

const root = join(import.meta.dir, "..");
const schema = (kind: string) => JSON.parse(readFileSync(join(root, "schemas", `${kind}.schema.json`), "utf8"));
const fixture = join(root, "packages/core/fixtures/mini-pack");
const yaml = (rel: string) => parse(readFileSync(join(fixture, rel), "utf8"));

describe("generated JSON Schemas", () => {
  test("are up to date with the zod schemas", () => {
    const r = Bun.spawnSync(["bun", join(root, "scripts/schemas.ts"), "--check"], { cwd: root });
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
  });

  test("compile as JSON Schema 2020-12 and accept the fixture pack", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const cases: [string, unknown][] = [
      ["pack", yaml("pack.yaml")],
      ["map", yaml("map.yaml")],
      ["lock", yaml("pack.lock.yaml")],
      ...readdirSync(join(fixture, "nodes")).map((f): [string, unknown] => ["node", yaml(`nodes/${f}`)]),
      ["compiled-pack", JSON.parse(readFileSync(join(fixture, "pack.json"), "utf8"))],
    ];
    for (const [kind, value] of cases) {
      const validate =
        ajv.getSchema(`https://learncroc.github.io/schema/v1/${kind}.schema.json`) ?? ajv.compile(schema(kind));
      const ok = validate(value);
      expect({ kind, errors: ok ? null : validate.errors?.slice(0, 3) }).toEqual({ kind, errors: null });
    }
  });

  test("the old boss and toy schemas are gone", () => {
    expect(readdirSync(join(root, "schemas")).sort()).not.toContain("boss.schema.json");
    expect(readdirSync(join(root, "schemas")).sort()).not.toContain("toy.schema.json");
  });

  test("widget refs autocomplete per widget and reject unknown props", () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema("node"));
    const node = yaml("nodes/units.yaml") as {
      screens: { interaction: { widget: { props: Record<string, unknown> } } }[];
    };
    const bad = structuredClone(node);
    const first = bad.screens[0];
    if (!first) throw new Error("fixture has no screens");
    first.interaction.widget.props.colour = "red";
    expect(validate(bad)).toBe(false);
  });
});
