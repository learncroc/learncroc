import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { canonical, expectedAt, samePrediction, codeStepperSpec as spec } from "../src/code-stepper/spec";
import CodeStepperView from "../src/code-stepper/View";
import { expectAxeClean, renderWidget } from "./_lang-physics-code.harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("code-stepper spec", () => {
  test("prediction matching is forgiving about quotes, case of literals and number forms", () => {
    expect(samePrediction('"tea"', "tea")).toBe(true);
    expect(samePrediction("'tea'", "tea")).toBe(true);
    expect(samePrediction("6.0", "6")).toBe(true);
    expect(samePrediction("true", "True")).toBe(true);
    expect(samePrediction("None", "null")).toBe(true);
    expect(samePrediction("Tea", "tea")).toBe(false);
    expect(canonical("  hello   world ")).toBe("hello world");
  });
  test("expected values come from the trace", () => {
    expect(expectedAt(ex(0).props, 0)).toBe("3");
    expect(expectedAt(ex(0).props, 1)).toBe("6");
    expect(expectedAt(ex(2).props, 0)).toBe("4");
  });
  test("validate catches answers that contradict the trace, bad steps and long code", () => {
    const e = ex(0);
    expect(spec.validate(e.props, { kind: "predictions", answers: ["4", "6"], minCorrect: 2 }).join()).toContain(
      'the trace says "3"',
    );
    expect(spec.validate({ ...e.props, predictAt: [{ step: 99, ask: "output" }] }).join()).toContain("step 99");
    expect(spec.validate({ ...e.props, predictAt: [{ step: 0, ask: "output" }] }).join()).toContain("prints nothing");
    expect(spec.validate({ ...e.props, predictAt: [{ step: 0, ask: "var", name: "zzz" }] }).join()).toContain('"zzz"');
    expect(spec.validate({ ...e.props, code: Array.from({ length: 21 }, () => "x = 1").join("\n") }).join()).toContain(
      "limit is 20",
    );
    expect(spec.validate(e.props, { kind: "predictions", answers: ["3", "6"], minCorrect: 3 }).join()).toContain(
      "minCorrect",
    );
  });
});

describe("code-stepper view", () => {
  test("keyboard: step, predict at the marked steps, reach a correct answer", async () => {
    const user = userEvent.setup();
    const e = ex(0);
    const h = renderWidget(CodeStepperView, { props: e.props, goal: e.goal });
    expect(screen.getByRole("region", { name: /Program, Python/ })).toBeTruthy();
    const stepKey = () => screen.getByRole("button", { name: /^Step/ });
    // Steps 1–4 reveal freely.
    stepKey().focus();
    for (let i = 0; i < 4; i++) await user.keyboard("{Enter}");
    expect(screen.getByText("Step 4 of 8")).toBeTruthy();
    // Step 5 asks for total first.
    await user.keyboard("{Enter}");
    const q = screen.getByRole("textbox", { name: /What will total be after it/ });
    expect(q).toHaveFocus();
    await user.keyboard("3{Enter}");
    expect(h.last()?.predictions).toEqual(["3", ""]);
    expect(h.announcements.at(-1)).toContain("That matches.");
    expect(screen.getByText("Step 5 of 8")).toBeTruthy();
    // Steps 6–7, then the print asks for output.
    stepKey().focus();
    await user.keyboard("{Enter}{Enter}{Enter}");
    await user.type(screen.getByRole("textbox", { name: /What will it print/ }), "6{Enter}");
    expect(h.last()?.predictions).toEqual(["3", "6"]);
    expect(spec.grade({ props: e.props, goal: e.goal, answer: h.last() ?? { predictions: [] } }).correct).toBe(true);
    expect(h.container.querySelector("[data-output]")?.textContent).toBe("6");
  });

  test("← and → step back and forth from the stepper's buttons, and → still asks for the prediction", async () => {
    const user = userEvent.setup();
    const e = ex(2);
    renderWidget(CodeStepperView, { props: e.props, goal: e.goal });
    screen.getByRole("button", { name: /^Step/ }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("textbox", { name: /Which line runs next/ })).toHaveFocus();
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
  });

  test("'Not sure' reveals the step and counts as a miss", async () => {
    const user = userEvent.setup();
    const e = ex(2);
    const h = renderWidget(CodeStepperView, { props: e.props, goal: e.goal });
    await user.click(screen.getByRole("button", { name: "Step →" }));
    await user.click(screen.getByRole("button", { name: "Step →" }));
    await user.click(screen.getByRole("button", { name: "Step (predict first)" }));
    // A "line" question doesn't highlight the next line.
    expect(h.container.querySelector("li.outline-dashed")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Not sure, show me" }));
    expect(h.last()).toEqual({ predictions: [""] });
    expect(spec.grade({ props: e.props, goal: e.goal, answer: h.last() ?? { predictions: [] } }).correct).toBe(false);
    expect(screen.getByText("Step 3 of 3")).toBeTruthy();
    expect(screen.getByText(/not sure/)).toBeTruthy();
  });

  test("name tags and boxes both show changed values", async () => {
    const e = ex(1);
    const h = renderWidget(CodeStepperView, { props: e.props, goal: e.goal, mode: "review", value: e.correctAnswer });
    // Review starts at the end: a = "coffee", b = "tea".
    expect(h.container.querySelector('[data-var="a"]')?.textContent).toContain('"coffee"');
    expect(h.container.querySelector('[data-var="b"]')?.textContent).toContain('"tea"');
    expect(h.container.querySelectorAll('[data-prediction="match"]').length).toBe(1);
  });

  test("axe clean", async () => {
    for (const e of spec.examples) {
      const a = renderWidget(CodeStepperView, { props: e.props, goal: e.goal });
      await expectAxeClean(a.container);
      a.container.remove();
      const r = renderWidget(CodeStepperView, {
        props: e.props,
        goal: e.goal,
        mode: "review",
        value: e.wrongAnswer,
        solution: e.correctAnswer,
      });
      await expectAxeClean(r.container);
      r.container.remove();
    }
  });
});
