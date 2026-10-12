import { describe, expect, test } from "bun:test";
import "../src/token-splitter/tokenizer-eager";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { craftChecks, tokenSplitterSpec as spec, type TokenSplitterGoal } from "../src/token-splitter/spec";
import { tokenCount, tokenPieces, wordCount } from "../src/token-splitter/tokenize";
import View from "../src/token-splitter/View";
import { expectAxeClean, gradeLast, renderView } from "./widget-harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("token-splitter tokenizer", () => {
  test("cl100k_base splits as the real tokenizer does", () => {
    expect(tokenCount("strawberry")).toBe(3);
    expect(tokenCount(" strawberry")).toBe(1);
    expect(tokenPieces("Hello world").map((p) => p.text)).toEqual(["Hello", " world"]);
    expect(tokenCount("")).toBe(0);
    expect(tokenCount("<|endoftext|>")).toBeGreaterThan(1);
  });
  test("multi-token characters stay whole", () => {
    const pieces = tokenPieces("🙂 ok");
    expect(pieces.map((p) => p.text)).toEqual(["🙂", " ok"]);
    expect(pieces[0]?.ids.length).toBe(2);
    expect(pieces.every((p) => !p.text.includes("�"))).toBe(true);
  });
  test("word count", () => {
    expect(wordCount("  one two\nthree ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });
});

describe("token-splitter spec", () => {
  test("examples grade right and wrong", () => {
    expect(spec.examples.length).toBeGreaterThanOrEqual(2);
    for (const e of spec.examples) {
      const props = spec.props.parse(e.props);
      const goal = spec.goal?.parse(e.goal) as TokenSplitterGoal;
      expect(spec.validate(props, goal)).toEqual([]);
      expect(spec.grade({ props, goal, answer: e.correctAnswer }).correct).toBe(true);
      expect(spec.grade({ props, goal, answer: e.wrongAnswer }).correct).toBe(false);
    }
  });
  test("validate catches bad props and goals", () => {
    const props = ex(1).props;
    expect(spec.validate({ ...props, highlight: "kiwi" }).some((e) => e.includes("doesn't occur"))).toBe(true);
    expect(spec.validate({ ...props, editable: false }, ex(1).goal).some((e) => e.includes("editable"))).toBe(true);
    expect(spec.validate(props, { kind: "craft" }).some((e) => e.includes("at least one constraint"))).toBe(true);
    expect(
      spec.validate(props, { kind: "pick-token", text: "strawberry", index: 7 }).some((e) => e.includes("index")),
    ).toBe(true);
    expect(spec.validate(props, { kind: "craft", minTokens: 1 }).some((e) => e.includes("already meets"))).toBe(true);
  });
  test("count tolerance and craft checks", () => {
    const props = ex(0).props;
    const goal = ex(0).goal;
    expect(spec.grade({ props, goal, answer: { count: 7 } }).correct).toBe(true);
    expect(spec.grade({ props, goal, answer: { count: 8 } }).correct).toBe(false);
    expect(spec.grade({ props, goal, answer: {} }).solution).toEqual({ count: 6 });
    const checks = craftChecks({ kind: "craft", maxWords: 1, mustInclude: "BERRY" }, "strawberry");
    expect(checks.every((c) => c.ok)).toBe(true);
  });
});

describe("token-splitter view", () => {
  test("count: keyboard sets the guess; the split stays sealed until review", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(0);
    const r = renderView(View, { props, goal });
    expect(screen.queryByRole("list", { name: "The real split" })).toBeNull();
    const input = screen.getByRole("spinbutton", { name: "How many tokens?" });
    input.focus();
    await user.keyboard("{ArrowUp>6/}");
    expect(r.last()).toEqual({ count: 6 });
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("count review reveals the split", () => {
    const { props, goal } = ex(0);
    renderView(View, { props, goal, mode: "review", value: { count: 2 } });
    expect(screen.getByRole("list", { name: "The real split" })).toHaveAttribute("data-token-count", "6");
    expect(screen.getByText("You guessed 2.")).toBeInTheDocument();
  });

  test("craft: typing a one-word, five-token string meets every rule", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(1);
    const r = renderView(View, { props, goal });
    const box = screen.getByRole("textbox", { name: "Write a string" });
    await user.clear(box);
    await user.type(box, "antidisestablishmentarianism");
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    expect(document.querySelectorAll('[data-ok="true"]').length).toBe(2);
    await expectAxeClean(r.container);
  });

  test("pick-token: keyboard picks a chip", async () => {
    const user = userEvent.setup();
    const { props, goal } = ex(2);
    const r = renderView(View, { props, goal });
    const chips = screen.getAllByRole("radio");
    expect(chips.length).toBe(3);
    chips[2]?.focus();
    await user.keyboard("{Enter}");
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });

  test("explore: free typing redraws the split", async () => {
    const user = userEvent.setup();
    const r = renderView(View, { props: { ...ex(1).props, editable: true }, mode: "explore" });
    const box = screen.getByRole("textbox");
    await user.clear(box);
    await user.type(box, "Hello world");
    expect(screen.getByRole("list", { name: "Tokens" })).toHaveAttribute("data-token-count", "2");
    expect(r.announcements.at(-1)).toBe("2 tokens.");
  });
});

describe("token-splitter split", () => {
  const split = ex(3);
  const props = split.props;
  const goal = split.goal;
  const grade = (boundaries: number[]) => spec.grade({ props, goal, answer: { boundaries } });

  test("grades against the real cl100k boundaries", () => {
    expect(grade([3, 5]).correct).toBe(true);
    expect(grade([5, 3, 3, 0, 10, 99]).correct).toBe(true); // normalised: sorted, unique, in range
    const missing = grade([3]);
    expect(missing.correct).toBe(false);
    expect(missing.score).toBeCloseTo(0.5);
    expect(missing.solution).toEqual({ boundaries: [3, 5] });
    const extra = grade([3, 5, 7]);
    expect(extra.correct).toBe(false);
    expect(extra.score).toBeCloseTo(2 / 3);
    expect(grade([]).correct).toBe(false);
  });

  test("validate keeps split texts short and splittable", () => {
    expect(spec.validate(props, { kind: "split", text: "a".repeat(40) }).some((e) => e.includes("at most"))).toBe(true);
    expect(spec.validate(props, { kind: "split", text: "the" }).some((e) => e.includes("2 tokens"))).toBe(true);
  });

  test("the description doesn't give the split away", () => {
    const said = spec.textAlternative(props);
    expect(said).toContain("strawberry");
    expect(said).not.toMatch(/tokens:|“str”|“aw”|“berry”|\b3 tokens/);
  });

  test("keyboard: arrows move the caret, Space toggles, Enter checks", async () => {
    const user = userEvent.setup();
    const commits: unknown[] = [];
    const r = renderView(View, { props, goal });
    // The harness has no onCommit; re-render through the view's own button path instead.
    const gaps = screen.getAllByRole("button", { name: /^Cut between/ });
    expect(gaps.length).toBe(9);
    expect(gaps.filter((g) => g.tabIndex === 0).length).toBe(1);
    gaps[0]?.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(document.activeElement).toBe(gaps[2] ?? null);
    await user.keyboard(" ");
    expect(r.last()).toEqual({ boundaries: [3] });
    await user.keyboard("{ArrowRight}{ArrowRight} ");
    expect(r.last()).toEqual({ boundaries: [3, 5] });
    expect(r.announcements.at(-1)).toBe("Cut added. 3 pieces: str, aw, berry.");
    expect(gradeLast(spec, props, goal, r.last()).correct).toBe(true);
    await user.keyboard("{Delete}");
    expect(r.last()).toEqual({ boundaries: [3] });
    expect(commits).toEqual([]);
    await expectAxeClean(r.container);
  });

  test("Enter reports the cuts through onCommit", async () => {
    const user = userEvent.setup();
    const commits: unknown[] = [];
    const { render } = await import("@testing-library/react");
    render(
      <View
        props={props}
        goal={goal}
        mode="answer"
        value={{ boundaries: [5] }}
        onChange={() => {}}
        onCommit={(v) => commits.push(v)}
        announce={() => {}}
        reducedMotion
        theme="light"
        assetUrl={(p) => p}
      />,
    );
    const gap = screen.getByRole("button", { name: "Cut between “a” and “w”", pressed: false });
    gap.focus();
    await user.keyboard("{Enter}");
    expect(commits).toEqual([{ boundaries: [5] }]);
  });

  test("review shows the real split, ids, and marks the learner's misplaced chunks", () => {
    renderView(View, { props, goal, mode: "review", value: { boundaries: [5] }, solution: { boundaries: [3, 5] } });
    const chunks = [...document.querySelectorAll("[data-chunk]")].map((e) => e.getAttribute("data-chunk"));
    expect(chunks).toEqual(["str", "aw", "berry"]);
    expect(screen.getByText("496")).toBeInTheDocument();
    const misplaced = [...document.querySelectorAll("[data-misplaced]")].map((e) => e.textContent);
    expect(misplaced).toEqual(["straw"]);
    expect(document.querySelectorAll("[data-cut-handle]").length).toBe(0);
  });
});
