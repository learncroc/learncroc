import { describe, expect, test } from "bun:test";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { listenSpec as spec } from "../src/listen/spec";
import ListenView from "../src/listen/View";
import { expectAxeClean, flush, renderWidget } from "./_lang-physics-code.harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("listen spec", () => {
  test("validate catches missing audio, bad speeds, mismatched goals", () => {
    const e = ex(0);
    expect(spec.validate({ ...e.props, src: undefined, tts: undefined }).join()).toContain("needs src");
    expect(spec.validate({ ...e.props, speeds: [3] }).join()).toContain("between 0.5 and 1.5");
    expect(spec.validate(e.props, { kind: "choice", answer: "nope" }).join()).toContain("isn't one of the options");
    expect(spec.validate(e.props, { kind: "shadow" }).join()).toContain("doesn't match the task");
    expect(spec.validate({ ...e.props, options: ["only one"] }).join()).toContain("2–5 options");
  });
  test("typed answers are accent tolerant, with a gentle note", () => {
    const e = ex(1);
    const r = spec.grade({ props: e.props, goal: e.goal, answer: { text: "Una cana, por favor" } });
    expect(r.correct).toBe(true);
    expect(r.feedback).toContain("Una caña, por favor");
  });
});

describe("listen view", () => {
  test("no voice installed: pressing play shows the transcript instead (graceful fallback)", async () => {
    const e = ex(1);
    const h = renderWidget(ListenView, { props: e.props, goal: e.goal });
    expect(h.container.querySelector("[data-transcript]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Play the phrase, natural speed/ }));
    await flush(20);
    expect(h.container.querySelector("[data-transcript]")?.textContent).toContain("Una caña, por favor.");
    expect(screen.getByText(/no es-ES voice installed/)).toBeTruthy();
    expect(h.announcements.at(-1)).toContain("Audio isn't available here");
  });

  test("keyboard: type what you heard", async () => {
    const user = userEvent.setup();
    const e = ex(1);
    const h = renderWidget(ListenView, { props: e.props, goal: e.goal });
    await user.type(screen.getByRole("textbox", { name: "Type what you heard" }), "una cana por favor");
    expect(spec.grade({ props: e.props, goal: e.goal, answer: h.last() ?? {} }).correct).toBe(true);
  });

  test("keyboard: pick an option; the transcript toggle works", async () => {
    const user = userEvent.setup();
    const e = ex(0);
    const h = renderWidget(ListenView, { props: e.props, goal: e.goal });
    within(screen.getByRole("group", { name: "What did you hear?" }))
      .getByRole("button", { name: /Más despacio/ })
      .focus();
    await user.keyboard("{Enter}");
    expect(spec.grade({ props: e.props, goal: e.goal, answer: h.last() ?? {} }).correct).toBe(true);
    const t = ex(1);
    const h2 = renderWidget(ListenView, { props: t.props, goal: t.goal });
    await user.click(screen.getByRole("button", { name: "Show transcript" }));
    expect(h2.container.querySelector("[data-transcript]")).not.toBeNull();
  });

  test("shadow without a microphone still lets the learner rate themselves", async () => {
    const user = userEvent.setup();
    const e = ex(2);
    const h = renderWidget(ListenView, { props: e.props, goal: e.goal });
    expect(screen.getByText(/can't record/)).toBeTruthy();
    within(screen.getByRole("group", { name: "Rate your shadowing" }))
      .getByRole("button", { name: /Partly there/ })
      .focus();
    await user.keyboard("{Enter}");
    expect(h.last()).toEqual({ selfRating: "partly" });
    expect(spec.grade({ props: e.props, goal: e.goal, answer: h.last() ?? {} }).correct).toBe(true);
    expect(screen.getByText(/never uploaded/)).toBeTruthy();
  });

  test("review shows the transcript; axe clean", async () => {
    for (const e of spec.examples) {
      const a = renderWidget(ListenView, { props: e.props, goal: e.goal });
      await expectAxeClean(a.container);
      a.container.remove();
      const r = renderWidget(ListenView, {
        props: e.props,
        goal: e.goal,
        mode: "review",
        value: e.wrongAnswer,
        solution: e.correctAnswer,
      });
      expect(r.container.querySelector("[data-transcript]")).not.toBeNull();
      await expectAxeClean(r.container);
      r.container.remove();
    }
  });
});
