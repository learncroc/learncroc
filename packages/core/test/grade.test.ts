import { describe, expect, test } from "bun:test";
import {
  answerText,
  estimateBand,
  GradeError,
  gradeExplainOffline,
  gradeFromExplainGrade,
  gradeHtmlGoal,
  gradeInteraction,
  gradeWidget,
  type Interaction,
  type Item,
  matchedKeyPoints,
  matchKeywords,
  normalizeText,
  solutionOf,
} from "../src/index";
import { fakeWidgets } from "./support/widgets";

const base = { id: "q", prompt: "?" };
const choice: Interaction = {
  ...base,
  kind: "choice",
  options: [
    { id: "a", text: "Train A", why: "A goes slower" },
    { id: "b", text: "Train B", misconception: "further" },
    { id: "same", text: "Same speed" },
  ],
  answer: "same",
  feedbackRight: "50 km each hour.",
  onWrong: { a: { feedback: "Check the hours." } },
};

describe("grading matrix", () => {
  test("choice: single, misconceptions, onWrong and why", () => {
    expect(gradeInteraction(choice, { kind: "choice", selected: "same" })).toMatchObject({
      correct: true,
      score: 1,
      feedback: "50 km each hour.",
    });
    expect(gradeInteraction(choice, { kind: "choice", selected: "b" })).toMatchObject({
      correct: false,
      score: 0,
      misconception: "further",
    });
    expect(gradeInteraction(choice, { kind: "choice", selected: "a" }).feedback).toBe("Check the hours.");
    expect(gradeInteraction(choice, { kind: "choice", selected: ["same"] }).correct).toBe(true);
    expect(gradeInteraction(choice, { kind: "choice", selected: ["same", "a"] }).correct).toBe(false);
    expect(gradeInteraction(choice, { kind: "choice", selected: "a" }).solution).toEqual({
      kind: "choice",
      selected: "same",
    });
  });

  test("choice: multi with partial credit", () => {
    const multi: Interaction = {
      ...base,
      kind: "choice",
      multi: true,
      options: [
        { id: "x", text: "x" },
        { id: "y", text: "y" },
        { id: "z", text: "z", misconception: "m" },
      ],
      answer: ["x", "y"],
    };
    expect(gradeInteraction(multi, { kind: "choice", selected: ["y", "x"] }).correct).toBe(true);
    expect(gradeInteraction(multi, { kind: "choice", selected: ["x"] })).toMatchObject({ correct: false, score: 0.5 });
    expect(gradeInteraction(multi, { kind: "choice", selected: ["x", "z"] })).toMatchObject({
      correct: false,
      score: 0,
      misconception: "m",
    });
  });

  test("numeric: tolerance, float noise, onWrong by value, parametric answers", () => {
    const num: Interaction = {
      ...base,
      kind: "numeric",
      answer: 0.75,
      tolerance: 0.001,
      onWrong: {
        "0.45": { misconception: "decimal" },
        "2700": { misconception: "times" },
        default: { feedback: "Divide by 60." },
      },
    };
    expect(gradeInteraction(num, { kind: "numeric", value: 0.7505 }).correct).toBe(true);
    expect(gradeInteraction(num, { kind: "numeric", value: 0.45 }).misconception).toBe("decimal");
    expect(gradeInteraction(num, { kind: "numeric", value: 2700 }).misconception).toBe("times");
    expect(gradeInteraction(num, { kind: "numeric", value: 3 }).feedback).toBe("Divide by 60.");
    expect(
      gradeInteraction({ ...base, kind: "numeric", answer: 0.3 }, { kind: "numeric", value: 0.1 + 0.2 }).correct,
    ).toBe(true);
    expect(
      gradeInteraction({ ...base, kind: "numeric", answer: 1 }, { kind: "numeric", value: Number.NaN }).correct,
    ).toBe(false);
    const param: Item = {
      ...base,
      kind: "numeric",
      level: "apply",
      difficulty: 2,
      prompt: "{m} minutes?",
      answer: 2,
      tolerance: 0.001,
      params: { vars: { m: [120, 90] }, answerExpr: "m / 60" },
    };
    expect(gradeInteraction(param, { kind: "numeric", value: 1.5 }, { vars: { m: 90 } }).correct).toBe(true);
    expect(gradeInteraction(param, { kind: "numeric", value: 2 }, { vars: { m: 90 } }).correct).toBe(false);
    expect(gradeInteraction(param, { kind: "numeric", value: 2 }).correct).toBe(true);
  });

  test("estimate: factor and absolute bands, partial credit fades with distance", () => {
    const est: Interaction = {
      ...base,
      kind: "estimate",
      scale: { min: 1, max: 100, log: true },
      answer: 5,
      accept: { factor: 1.6 },
    };
    expect(estimateBand(5, { factor: 2 })).toEqual([2.5, 10]);
    expect(gradeInteraction(est, { kind: "estimate", value: 7.9 }).correct).toBe(true);
    expect(gradeInteraction(est, { kind: "estimate", value: 3.2 }).correct).toBe(true);
    const near = gradeInteraction(est, { kind: "estimate", value: 9 });
    const far = gradeInteraction(est, { kind: "estimate", value: 90 });
    expect(near.correct).toBe(false);
    expect(near.score).toBeGreaterThan(far.score);
    expect(far.score).toBe(0);
    const abs: Interaction = { ...base, kind: "estimate", scale: { min: 0, max: 100 }, answer: 50, accept: { abs: 5 } };
    expect(gradeInteraction(abs, { kind: "estimate", value: 54 }).correct).toBe(true);
    expect(gradeInteraction(abs, { kind: "estimate", value: 56 }).correct).toBe(false);
  });

  test("text: normalisation, articles, accents and the accent slip", () => {
    expect(normalizeText("  The   Distance! ", ["case", "punct", "space"])).toBe("the distance");
    expect(normalizeText("The distance", ["case", "articles", "space"])).toBe("distance");
    expect(normalizeText("la estación", ["case", "articles", "accents", "space"], "es")).toBe("estacion");
    const t: Interaction = { ...base, kind: "text", accept: ["distance", "length"] };
    expect(gradeInteraction(t, { kind: "text", value: "Distance." }).correct).toBe(true);
    expect(gradeInteraction(t, { kind: "text", value: "LENGTH" }).correct).toBe(true);
    expect(gradeInteraction(t, { kind: "text", value: "time" }).correct).toBe(false);
    const es: Interaction = { ...base, kind: "text", accept: ["está"], lang: "es" };
    const slip = gradeInteraction(es, { kind: "text", value: "esta" });
    expect(slip.correct).toBe(true);
    expect(slip.feedback).toContain("está");
    const art: Interaction = { ...base, kind: "text", accept: ["the cat"], normalize: ["case", "articles", "space"] };
    expect(gradeInteraction(art, { kind: "text", value: "cat" }).correct).toBe(true);
  });

  test("order, match and cloze", () => {
    const order: Interaction = { ...base, kind: "order", items: ["a", "b", "c", "d"], answer: [0, 1, 2, 3] };
    expect(gradeInteraction(order, { kind: "order", order: [0, 1, 2, 3] }).correct).toBe(true);
    const swapped = gradeInteraction(order, { kind: "order", order: [1, 0, 2, 3] });
    expect(swapped.correct).toBe(false);
    expect(swapped.score).toBeGreaterThan(0.5);
    expect(gradeInteraction(order, { kind: "order", order: [0, 0, 1, 2] }).score).toBe(0);
    const match: Interaction = {
      ...base,
      kind: "match",
      left: ["x", "y"],
      right: ["1", "2"],
      answer: [
        [0, 1],
        [1, 0],
      ],
    };
    expect(
      gradeInteraction(match, {
        kind: "match",
        pairs: [
          [1, 0],
          [0, 1],
        ],
      }).correct,
    ).toBe(true);
    expect(gradeInteraction(match, { kind: "match", pairs: [[0, 1]] })).toMatchObject({ correct: false, score: 0.5 });
    const cloze: Interaction = {
      ...base,
      kind: "cloze",
      text: "{{1}} y {{2}}",
      blanks: { "1": { accept: ["pan"] }, "2": { accept: ["vino"] } },
    };
    expect(gradeInteraction(cloze, { kind: "cloze", values: { "1": "Pan", "2": "vino" } }).correct).toBe(true);
    expect(gradeInteraction(cloze, { kind: "cloze", values: { "1": "pan", "2": "agua" } })).toMatchObject({
      correct: false,
      score: 0.5,
    });
  });

  test("html goals", () => {
    expect(gradeHtmlGoal({ kind: "equals", value: 3, tolerance: 0.1 }, 3.05).correct).toBe(true);
    expect(gradeHtmlGoal({ kind: "equals", value: 3 }, "3").correct).toBe(true);
    expect(gradeHtmlGoal({ kind: "equals", value: "red" }, "blue").correct).toBe(false);
    expect(gradeHtmlGoal({ kind: "equals", value: true }, true).correct).toBe(true);
    expect(gradeHtmlGoal({ kind: "range", min: 1, max: 2 }, 1.5).correct).toBe(true);
    expect(gradeHtmlGoal({ kind: "range", min: 1, max: 2 }, 2.5).correct).toBe(false);
    expect(gradeHtmlGoal({ kind: "set", values: ["a", "b"], match: "any" }, ["b"]).correct).toBe(true);
    expect(gradeHtmlGoal({ kind: "set", values: ["a", "b"], match: "all" }, ["a", "b", "c"]).correct).toBe(true);
    expect(gradeHtmlGoal({ kind: "set", values: ["a", "b"], match: "exact" }, ["a", "b", "c"]).correct).toBe(false);
  });

  test("widgets delegate to the injected spec; fallbacks take built-in answers", () => {
    const w: Interaction = {
      ...base,
      kind: "widget",
      widget: {
        id: "sorter",
        v: 1,
        props: {
          mode: "rank",
          cards: [
            { id: "x", text: "x" },
            { id: "y", text: "y" },
          ],
        },
        goal: { kind: "rank", order: ["x", "y"] },
      },
      solution: { order: ["x", "y"] },
      fallback: {
        kind: "choice",
        prompt: "first?",
        options: [
          { id: "x", text: "x" },
          { id: "y", text: "y" },
        ],
        answer: "x",
      },
      feedbackRight: "Ranked.",
    };
    expect(
      gradeInteraction(w, { kind: "widget", value: { order: ["x", "y"] } }, { widgets: fakeWidgets }),
    ).toMatchObject({ correct: true, feedback: "Ranked." });
    expect(
      gradeInteraction(w, { kind: "widget", value: { order: ["y", "x"] } }, { widgets: fakeWidgets }).correct,
    ).toBe(false);
    expect(gradeInteraction(w, { kind: "widget", value: "garbage" }, { widgets: fakeWidgets }).correct).toBe(false);
    expect(gradeInteraction(w, { kind: "choice", selected: "x" }, { widgets: fakeWidgets }).correct).toBe(true);
    expect(() => gradeInteraction(w, { kind: "widget", value: {} })).toThrow(GradeError);
    expect(() => gradeWidget({ id: "listen", v: 1, props: {} }, {}, fakeWidgets)).toThrow(/unknown widget/);
  });

  test("idk and mismatched kinds are always wrong", () => {
    expect(gradeInteraction(choice, { kind: "idk" })).toMatchObject({ correct: false, score: 0 });
    expect(gradeInteraction(choice, { kind: "numeric", value: 1 }).correct).toBe(false);
  });

  test("explain offline: self-rating, keywords, tiles, options and the offline choice", () => {
    const keyPoints = [
      { id: "slope", text: "speed is the slope", keywords: ["slope", "steeper"] },
      { id: "ratio", text: "distance over time", keywords: ["divide", "per hour"] },
    ];
    const target = {
      keyPoints,
      minHits: 1,
      tiles: [
        { text: "speed is the slope", keyPoint: "slope" },
        { text: "further is faster", wrong: true },
      ],
      options: [
        { text: "x", correct: false },
        { text: "y", correct: true },
      ],
    };
    expect(
      gradeExplainOffline(target, { kind: "explain", text: "It's the slope, per hour.", selfRating: "got-it" }),
    ).toMatchObject({ correct: true, score: 1, matched: ["slope", "ratio"] });
    expect(gradeExplainOffline(target, { kind: "explain", text: "No idea", selfRating: "got-it" }).correct).toBe(false);
    expect(gradeExplainOffline(target, { kind: "explain", text: "slope", selfRating: "partly" })).toMatchObject({
      correct: false,
      score: 0.5,
    });
    expect(gradeExplainOffline(target, { kind: "explain", tiles: ["speed is the slope"] }).correct).toBe(true);
    expect(
      gradeExplainOffline(target, { kind: "explain", tiles: ["speed is the slope", "further is faster"] }).correct,
    ).toBe(false);
    expect(gradeExplainOffline(target, { kind: "explain", choice: "1" }).correct).toBe(true);
    const item: Interaction = {
      ...base,
      kind: "explain",
      keyPoints,
      minHits: 1,
      exemplar: "…",
      offline: {
        kind: "choice",
        prompt: "?",
        options: [
          { id: "r", text: "r" },
          { id: "w", text: "w" },
        ],
        answer: "r",
      },
    };
    expect(gradeInteraction(item, { kind: "explain", choice: "r" }).correct).toBe(true);
    expect(gradeInteraction(item, { kind: "choice", selected: "w" }).correct).toBe(false);
    const ai = gradeFromExplainGrade(
      { hit: ["slope"], missing: "ratio", correct: false, feedback: "Half there.", source: "ai" },
      target,
    );
    expect(ai).toMatchObject({ correct: false, score: 0.5, matched: ["slope"], feedback: "Half there." });
  });

  test("keyword matching is case- and accent-insensitive with offsets into the original text", () => {
    const kps = [{ id: "e", text: "", keywords: ["estación", "per hour"] }];
    const text = "La ESTACION queda a 5 km, 50 km per  hour.";
    const m = matchKeywords(text, kps, "es");
    expect(m.map((x) => text.slice(x.start, x.end))).toEqual(["ESTACION", "per  hour"]);
    // Inflections match; other trailing letters and short keywords stay whole-word.
    expect(matchedKeyPoints("it blends them", [{ id: "b", text: "", keywords: ["blend"] }])).toEqual(["b"]);
    expect(matchedKeyPoints("two stations", [{ id: "s", text: "", keywords: ["station"] }])).toEqual(["s"]);
    expect(matchedKeyPoints("scored", [{ id: "s", text: "", keywords: ["score"] }])).toEqual(["s"]);
    expect(matchedKeyPoints("stationary", [{ id: "s", text: "", keywords: ["station"] }])).toEqual([]);
    expect(matchedKeyPoints("not now", [{ id: "n", text: "", keywords: ["no"] }])).toEqual([]);
    expect(matchedKeyPoints("mixes", [{ id: "m", text: "", keywords: ["mix"] }])).toEqual(["m"]);
    expect(matchedKeyPoints("divide by 60 ÷", [{ id: "d", text: "", keywords: ["÷"] }])).toEqual(["d"]);
    expect(matchedKeyPoints("the readout is the slope of the line", [{ id: "t", text: "slope of the line" }])).toEqual([
      "t",
    ]);
  });

  test("solutions and answer text", () => {
    expect(solutionOf(choice)).toEqual({ kind: "choice", selected: "same" });
    expect(answerText(choice, { kind: "choice", selected: "b" })).toBe("Train B");
    expect(answerText({ ...base, kind: "numeric", answer: 1, unit: "h" }, { kind: "numeric", value: 1.5 })).toBe(
      "1.5 h",
    );
    expect(
      answerText({ ...base, kind: "order", items: ["a", "b"], answer: [0, 1] }, { kind: "order", order: [1, 0] }),
    ).toBe("b → a");
  });
});
