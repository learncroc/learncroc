import { describe, expect, test } from "bun:test";
import { WIDGET_IDS } from "@learncroc/core";
import { buildCatalog } from "../scripts/gen-catalog";
import { catalogEntry, WIDGET_CATALOG, widgetCatalogText } from "../src/catalog";

/** Widgets whose catalogue entries this suite holds to "freshly generated". */
const OWN = [
  "probability-bars",
  "token-splitter",
  "attention-weights",
  "embedding-plane",
  "plot",
  "sorter",
  "hotspot",
  "ab-compare",
] as const;

describe("widget catalogue", () => {
  test("lists every widget", () => {
    expect(WIDGET_CATALOG.map((e) => e.id)).toEqual([...WIDGET_IDS]);
  });

  test("entries match the specs (regenerate with bun packages/widgets/scripts/gen-catalog.ts)", () => {
    const fresh = buildCatalog();
    for (const id of OWN) expect(catalogEntry(id)).toEqual(fresh.find((e) => e.id === id) as never);
  });

  test("entries carry JSON Schemas and a worked example", () => {
    for (const id of OWN) {
      const e = catalogEntry(id);
      if (!e) throw new Error(`missing ${id}`);
      expect((e.props as { type?: string }).type).toBe("object");
      expect(e.goal).not.toBeNull();
      expect(e.example?.correctAnswer).toBeDefined();
    }
  });

  test("prompt text", () => {
    const text = widgetCatalogText({ ids: ["sorter", "plot"] });
    expect(text).toContain("## sorter (generic): Sorter");
    expect(text).toContain("## plot (generic): Plot");
    expect(text).not.toContain("## hotspot");
    expect(widgetCatalogText({ ids: ["sorter"], schemas: true })).toContain("Props schema:");
  });
});
