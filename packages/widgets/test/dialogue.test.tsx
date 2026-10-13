import { describe, expect, test } from "bun:test";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkPath, maxGoodChoices, dialogueSpec as spec } from "../src/dialogue/spec";
import { matchText, normalizeText } from "../src/dialogue/text";
import DialogueView from "../src/dialogue/View";
import { expectAxeClean, flush, renderWidget } from "./_lang-physics-code.harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("typed-answer matching", () => {
  test("accent-tolerant by default, and it notices the slip", () => {
    const m = matchText("una cana por favor", ["Una caña, por favor"], ["case", "accents", "punct", "space"]);
    expect(m.matched).toBe(true);
    expect(m.accentSlip).toBe(true);
    const exact = matchText("Una caña, por favor.", ["Una caña, por favor"], ["case", "accents", "punct", "space"]);
    expect(exact).toEqual({ matched: true, accepted: "Una caña, por favor", accentSlip: false });
    expect(matchText("una cana", ["Una caña"], ["case", "punct", "space"]).matched).toBe(false);
    expect(normalizeText("¿Más  despacio?", ["case", "accents", "punct", "space"])).toBe("mas despacio");
    expect(normalizeText("The cat", ["case", "articles", "space"])).toBe("cat");
    expect(matchText("   ", ["x"], ["space"]).matched).toBe(false);
  });
});

describe("dialogue spec", () => {
  test("validate catches dangling links, unreachable nodes, fake endings and impossible minimums", () => {
    const e = ex(0);
    const broken = {
      ...e.props,
      nodes: [...e.props.nodes, { id: "orphan", line: "…" }],
    };
    expect(spec.validate(broken).join()).toContain('"orphan" can\'t be reached');
    const dangling = {
      ...e.props,
      nodes: e.props.nodes.map((n) => (n.id === "served" ? { ...n, choices: [{ text: "x", next: "nowhere" }] } : n)),
    };
    expect(spec.validate(dangling).join()).toContain('unknown node "nowhere"');
    expect(spec.validate(e.props, { kind: "reach", endings: ["hola"] }).join()).toContain("isn't an ending");
    expect(maxGoodChoices(ex(1).props)).toBe(2);
    expect(spec.validate(ex(1).props, { kind: "good-choices", min: 3 }).join()).toContain("more than any path offers");
    expect(spec.validate({ ...e.props, character: { name: "Lola", speak: true } }).join()).toContain("speak needs");
  });

  test("grading refuses invented paths and caps the good count", () => {
    const e = ex(1);
    expect(checkPath(e.props, { path: ["ask", "card"], endedAt: "card", goodCount: 2 }).valid).toBe(false);
    // A typed turn reaches its success branch only with a matching reply.
    const lola = ex(0);
    const forged = { path: ["hola", "despacio", "served"], endedAt: "served", goodCount: 1 };
    expect(spec.grade({ props: lola.props, goal: lola.goal, answer: forged }).correct).toBe(false);
    const wrongWords = { ...forged, typed: { despacio: "un café" } };
    expect(spec.grade({ props: lola.props, goal: lola.goal, answer: wrongWords }).correct).toBe(false);
    const inflated = { path: ["ask", "interest", "flat"], endedAt: "flat", goodCount: 5 };
    expect(spec.grade({ props: e.props, goal: e.goal, answer: inflated }).correct).toBe(false);
  });
});

describe("dialogue view", () => {
  test("keyboard: slow Lola down, type the order without accents, reach the ending (commits)", async () => {
    const user = userEvent.setup();
    const e = ex(0);
    const h = renderWidget(DialogueView, { props: e.props, goal: e.goal });
    expect(screen.getByText(/Lola's pace: fast/)).toBeTruthy();
    const replies = screen.getByRole("group", { name: "Your reply" });
    within(replies)
      .getByRole("button", { name: /Más despacio/ })
      .focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText(/Lola's pace: slow/)).toBeTruthy();
    expect(h.announcements).toContain("Lola slows down.");
    const input = screen.getByRole("textbox", { name: /Type your reply \(Spanish\)/ });
    await user.type(input, "una cana por favor{Enter}");
    const last = h.last();
    expect(last?.path).toEqual(["hola", "despacio", "served"]);
    expect(last?.endedAt).toBe("served");
    expect(h.commits).toHaveLength(1);
    expect(spec.grade({ props: e.props, goal: e.goal, answer: h.commits[0] ?? last ?? e.wrongAnswer }).correct).toBe(
      true,
    );
    expect(screen.getByText(/Written with accents/)).toBeTruthy();
    expect(screen.getByText("The conversation ends here.")).toBeTruthy();
    await flush(10);
  });

  test("a reply that doesn't match takes the else branch", async () => {
    const user = userEvent.setup();
    const e = ex(0);
    const h = renderWidget(DialogueView, {
      props: e.props,
      goal: e.goal,
      value: { path: ["hola", "despacio"], endedAt: null, goodCount: 1 },
    });
    await user.type(screen.getByRole("textbox"), "un café{Enter}");
    expect(h.last()?.path).toEqual(["hola", "despacio", "again"]);
    expect(h.last()?.typed).toEqual({ despacio: "un café" });
    await flush(10);
  });

  test("good-choices: the pitch, by keyboard", async () => {
    const user = userEvent.setup();
    const e = ex(1);
    const h = renderWidget(DialogueView, { props: e.props, goal: e.goal });
    for (const name of [/saves nurses an hour/, /timed 40 shifts/]) {
      within(screen.getByRole("group", { name: "Your reply" }))
        .getByRole("button", { name })
        .focus();
      await user.keyboard("{Enter}");
    }
    expect(h.commits[0]).toEqual({ path: ["ask", "interest", "card"], endedAt: "card", goodCount: 2 });
    expect(spec.grade({ props: e.props, goal: e.goal, answer: h.commits[0] ?? e.wrongAnswer }).correct).toBe(true);
  });

  test("translations toggle and restored transcripts", async () => {
    const e = ex(0);
    renderWidget(DialogueView, { props: e.props, goal: e.goal, value: e.correctAnswer, mode: "review" });
    expect(screen.queryByText("One small beer, coming up.")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Show translations" }));
    expect(screen.getByText("One small beer, coming up.")).toBeTruthy();
    expect(screen.getByText("¿Más despacio, por favor?")).toBeTruthy();
  });

  test("axe clean", async () => {
    for (const e of spec.examples) {
      const a = renderWidget(DialogueView, { props: e.props, goal: e.goal });
      await expectAxeClean(a.container);
      a.container.remove();
      const r = renderWidget(DialogueView, { props: e.props, goal: e.goal, mode: "review", value: e.correctAnswer });
      await expectAxeClean(r.container);
      r.container.remove();
    }
  });
});
