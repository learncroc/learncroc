import { describe, expect, test } from "bun:test";
import type { Item } from "@learncroc/core";
import { findInteraction, interactionText } from "../src/context";
import {
  answerLeak,
  bannedPhrase,
  endsInAction,
  enforceCap,
  ensureAction,
  nibReplyAllowed,
  numbersIn,
  overCap,
  tidyVoice,
} from "../src/guards";
import { pack } from "./helpers";

const units = pack.nodes.units;
if (!units) throw new Error("fixture");

describe("word cap", () => {
  test("cuts at the last full sentence within the cap", () => {
    const long = "One two three four. Five six seven eight. Nine ten eleven twelve.";
    expect(overCap(long, 10)).toBe(true);
    expect(enforceCap(long, 10)).toBe("One two three four. Five six seven eight.");
    expect(enforceCap("Short.", 75)).toBe("Short.");
  });
});

describe("action ending", () => {
  test("questions, Try this and imperatives count as actions", () => {
    expect(endsInAction("What would change?")).toBe(true);
    expect(endsInAction("It sums to one.\nTry this: drag a bar.")).toBe(true);
    expect(endsInAction("Weights sum to one. Drag the first bar down.")).toBe(true);
    expect(endsInAction("Weights sum to one.")).toBe(false);
    expect(endsInAction("Fine.\nCHECK: q | a | b | answer=1")).toBe(false);
  });
  test("a statement gets a Your move line", () => {
    expect(ensureAction("Weights sum to one.", "set the bars")).toBe("Weights sum to one.\nYour move: set the bars");
  });
});

describe("answer leak", () => {
  const hook = units.hook.interaction;
  test("choice: the correct option text or its letter leaks", () => {
    expect(answerLeak("It's 2 hours, obviously.", hook).leak).toBe(true);
    expect(answerLeak("The answer is option B.", hook).leak).toBe(true);
    expect(answerLeak("What unit would you compare them in?", hook).leak).toBe(false);
  });
  test("numeric: the number leaks, with or without separators", () => {
    const it = findInteraction(units, "s2-q");
    if (it?.kind !== "numeric") throw new Error("fixture");
    expect(answerLeak(`It comes to ${it.answer} in the end.`, it).leak).toBe(true);
    expect(answerLeak("Convert first, then compare.", it).leak).toBe(false);
  });
  test("parametric numeric uses the instance's answer", () => {
    const item: Item = {
      id: "p",
      kind: "numeric",
      prompt: "{n} minutes in hours?",
      answer: 1.5,
      level: "apply",
      difficulty: 2,
      params: { vars: { n: [90, 120] }, answerExpr: "n / 60" },
    };
    expect(answerLeak("That is 2 hours.", item, { n: 120 }).leak).toBe(true);
    expect(answerLeak("That is 1.5 hours.", item, { n: 120 }).leak).toBe(false);
  });
  test("text, cloze and order leaks", () => {
    const text: Item = {
      id: "t",
      kind: "text",
      prompt: "Unit of time?",
      accept: ["seconds"],
      level: "recall",
      difficulty: 1,
    };
    expect(answerLeak("Think seconds.", text).leak).toBe(true);
    const order: Item = {
      id: "o",
      kind: "order",
      prompt: "Order",
      items: ["tokens", "embeddings", "attention"],
      answer: [0, 1, 2],
      level: "recall",
      difficulty: 1,
    };
    expect(answerLeak("First tokens, then embeddings, then attention.", order).leak).toBe(true);
    expect(answerLeak("Attention comes after something.", order).leak).toBe(false);
  });
  test("widget solutions leak when every value appears", () => {
    const it = findInteraction(units, "s1-q");
    if (!it) throw new Error("fixture");
    expect(answerLeak("Sort by what each one measures.", it).leak).toBe(false);
  });
});

describe("Nib and voice", () => {
  test("Nib may not introduce numbers or new terms", () => {
    const allowed = "attention looks at every word and weights sum to one";
    expect(nibReplyAllowed("Oh. So attention looks at every word.", allowed).ok).toBe(true);
    expect(nibReplyAllowed("So attention uses 12 heads.", allowed).ok).toBe(false);
    expect(nibReplyAllowed("So backpropagation through transformers explains everything.", allowed).ok).toBe(false);
  });
  test("tidyVoice removes exclamation marks and emoji; banned phrases are found", () => {
    expect(tidyVoice("Great!! Nice 🎉")).toBe("Great. Nice");
    expect(bannedPhrase("Most people think")).toBeDefined();
    expect(bannedPhrase("Lots of people guess")).toBeUndefined();
    expect(numbersIn("1,000 and 0.5")).toEqual([1000, 0.5]);
  });
});

describe("tutor context withholds the key", () => {
  test("order items and match pairs are not shown in the authored order before answering", () => {
    const order: Item = {
      id: "o1",
      kind: "order",
      level: "apply",
      difficulty: 2,
      prompt: "Put the steps in order.",
      items: ["Tokenize", "Embed", "Attend", "Predict"],
      answer: [0, 1, 2, 3],
    } as Item;
    const hidden = interactionText(order, false);
    expect(hidden).not.toContain("Tokenize | Embed | Attend | Predict");
    expect(hidden).not.toContain("Correct order");
    expect(interactionText(order, true)).toContain("Correct order: Tokenize → Embed → Attend → Predict");

    const match: Item = {
      id: "m1",
      kind: "match",
      level: "recall",
      difficulty: 2,
      prompt: "Match each beat.",
      left: ["Want", "Obstacle", "Turn"],
      right: ["wants to survive", "rent doubles", "a supper club"],
      answer: [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
    } as Item;
    const m = interactionText(match, false);
    expect(m).toContain("Right: a supper club | rent doubles | wants to survive");
    expect(m).not.toContain("Correct pairs");
    expect(interactionText(match, true)).toContain("Want = wants to survive");
  });
});
