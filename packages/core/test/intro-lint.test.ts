import { describe, expect, test } from "bun:test";
import { CARD_CAPS, cardShapeIssues, gateShapeIssues, INTRO_NODE_ID, type MapFile, type PackNode } from "../src/index";

function intro(over: Partial<PackNode> = {}): PackNode {
  return {
    id: INTRO_NODE_ID,
    title: "Before you start",
    estMinutes: 1,
    bigIdea: "Spaced reviews make memories last.",
    objectives: ["See what the article claims."],
    misconceptions: {},
    hook: {
      interaction: {
        id: "hook",
        kind: "choice",
        prompt: "Which of these are you most curious about?",
        options: [
          { id: "o1", text: "Why memories fade" },
          { id: "o2", text: "The sorting box" },
        ],
        answer: "o1",
      },
    },
    screens: [
      {
        id: "s1",
        blocks: [
          { type: "story", text: "Hi. I'm Moss. I read this one before you got here, so I'll walk you through it." },
          {
            type: "quote",
            text: "Spaced repetition is an evidence-based learning technique.",
            cite: { title: "Spaced repetition" },
          },
          { type: "story", text: "Short version: review just as it starts to slip." },
        ],
      },
    ],
    close: { text: "That's the map: 2 stops, one question each.", teaser: "Ready for the first question?" },
    items: [],
    sources: [{ id: "article", title: "Spaced repetition" }],
    status: "draft",
    ...over,
  };
}

describe("the intro card", () => {
  test("has its own shape: one read-only screen, no items, no picture or misconception rules", () => {
    expect(cardShapeIssues(INTRO_NODE_ID, intro(), "pocket", "en").filter((i) => i.severity === "error")).toEqual([]);
  });

  test("still checks its words and that it grades nothing", () => {
    const long = intro({
      screens: [
        {
          id: "s1",
          blocks: [{ type: "story", text: Array.from({ length: CARD_CAPS.beat + 1 }, () => "word").join(" ") }],
          interaction: {
            id: "s1-do",
            kind: "choice",
            prompt: "Pick",
            options: [
              { id: "a", text: "A" },
              { id: "b", text: "B" },
            ],
            answer: "a",
          },
          reveal: { text: "Done." },
        },
      ],
    });
    const rules = cardShapeIssues(INTRO_NODE_ID, long, "pocket", "en").map((i) => i.rule);
    expect(rules).toContain("L001");
    expect(rules).toContain("L006");
  });

  test("never counts toward a checkpoint's size", () => {
    const cards = ["a", "b", "c", "d"];
    const map: MapFile = {
      lines: [{ id: "l1", title: "Line", color: 1, outcome: "Explain it." }],
      nodes: {
        intro: { requires: [], line: "l1", kind: "node" },
        a: { requires: ["intro"], line: "l1", kind: "node" },
        b: { requires: ["a"], line: "l1", kind: "node" },
        c: { requires: ["b"], line: "l1", kind: "node" },
        d: { requires: ["c"], line: "l1", kind: "node" },
        "cp-1": { requires: ["d"], line: "l1", kind: "checkpoint", covers: ["intro", ...cards] },
      },
    };
    const issues = gateShapeIssues(map, "pocket").filter((i) => i.severity === "error");
    expect(issues).toEqual([]);
  });
});
