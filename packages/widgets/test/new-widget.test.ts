import { describe, expect, test } from "bun:test";
import { scaffoldHtml, scaffoldWidget, validateWidgetId } from "../scripts/new-widget";
import { scanFrameHtml } from "../src/sandbox/bridge";

describe("new:widget", () => {
  test("core scaffold: spec, view and test with the id wired through", () => {
    const files = scaffoldWidget("number-line");
    expect(files.map((f) => f.path)).toEqual([
      "src/number-line/spec.ts",
      "src/number-line/View.tsx",
      "test/number-line.test.tsx",
    ]);
    const [spec, view, testFile] = files.map((f) => f.content);
    expect(spec).toContain("export const numberLineSpec");
    expect(spec).toContain("export const NumberLineProps");
    expect(spec).not.toMatch(/from "react"/);
    expect(view).toContain('id="number-line"');
    expect(testFile).toContain('from "../src/number-line/spec"');
    expect((spec?.match(/note: "/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("refuses bad or taken ids", () => {
    expect(validateWidgetId("Number_Line")).toContain("isn't a valid widget id");
    expect(validateWidgetId("sorter")).toContain("already exists");
    expect(validateWidgetId("number-line")).toBeNull();
    expect(() => scaffoldWidget("plot")).toThrow();
  });

  test("html scaffold passes the sandbox pre-scan and uses the bridge", () => {
    const f = scaffoldHtml("seesaw");
    expect(f.path).toBe("assets/interactive/seesaw.html");
    expect(scanFrameHtml(f.content)).toEqual([]);
    for (const call of ["lm.ready()", "lm.report(", "lm.onInit(", "lm.onTest(", "lm.announce("])
      expect(f.content).toContain(call);
    expect(() => scaffoldHtml("../evil")).toThrow();
  });
});
