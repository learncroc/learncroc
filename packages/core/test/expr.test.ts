import { describe, expect, test } from "bun:test";
import { compileExpr, ExprError, evaluate, exprVariables } from "../src/expr";

describe("expr", () => {
  test("arithmetic, precedence and right-associative powers", () => {
    expect(evaluate("1 + 2 * 3")).toBe(7);
    expect(evaluate("(1 + 2) * 3")).toBe(9);
    expect(evaluate("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluate("-2 ^ 2")).toBe(-4);
    expect(evaluate("2 ^ -1")).toBe(0.5);
    expect(evaluate("2 ** 3")).toBe(8);
    expect(evaluate("7 % 4")).toBe(3);
    expect(evaluate("1.5e3 / 3")).toBe(500);
  });
  test("variables, constants and functions", () => {
    expect(evaluate("sqrt(g^2 + s^2) / g", { g: 4, s: 3 })).toBe(1.25);
    expect(evaluate("1 / sqrt(1 - x^2)", { x: 0.6 })).toBeCloseTo(1.25, 12);
    expect(evaluate("100 * sqrt(1 - v^2)", { v: 0.6 })).toBeCloseTo(80, 12);
    expect(evaluate("round(pi, 2)")).toBe(3.14);
    expect(evaluate("log(e)")).toBe(1);
    expect(evaluate("log(8, 2)")).toBeCloseTo(3, 12);
    expect(evaluate("max(1, 5, 3)")).toBe(5);
  });
  test("compile once, evaluate many", () => {
    const f = compileExpr("n / 1.25");
    expect([10, 20, 50].map((n) => f({ n }))).toEqual([8, 16, 40]);
  });
  test("lists free variables", () => {
    expect(exprVariables("sqrt(g^2 + s^2) / g + pi").sort()).toEqual(["g", "s"]);
  });
  test("rejects anything that isn't an expression", () => {
    for (const bad of [
      "",
      "1 +",
      "foo(1)",
      "constructor",
      "a.b",
      "x[0]",
      "alert`1`",
      "1;2",
      "sqrt(1,2)",
      "process.exit()",
    ]) {
      expect(() => evaluate(bad, {})).toThrow(ExprError);
    }
    expect(() => evaluate("x + 1")).toThrow(/unknown variable 'x'/);
    expect(() => evaluate("toString")).toThrow(ExprError);
  });
});
