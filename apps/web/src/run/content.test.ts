import { expect, test } from "bun:test";
import type { CompiledPack, PackNode } from "@learncroc/core";
import fixture from "@learncroc/core/fixtures/mini-pack/pack.json";
import { mapDeck, nodeCards } from "./content";

const pack = fixture as unknown as CompiledPack;
const node = (id: string) => pack.nodes[id] as PackNode;

test("a stop plays as Ask, a Teach and an action per beat, then Takeaway; a choice on the last beat is the Check", () => {
  expect(nodeCards(node("units")).map((c) => c.key)).toEqual([
    "ask",
    "teach-0",
    "act-0",
    "teach-1",
    "act-1",
    "teach-2",
    "act-2",
    "takeaway",
  ]);
  expect(nodeCards(node("units")).map((c) => c.type)).toEqual([
    "ask",
    "teach",
    "try",
    "teach",
    "try",
    "teach",
    "check",
    "takeaway",
  ]);
  // A read-only beat is a Teach card only; a numeric action on the last beat is a Try.
  expect(nodeCards(node("unit-conversion")).map((c) => c.type)).toEqual([
    "ask",
    "teach",
    "try",
    "teach",
    "teach",
    "try",
    "takeaway",
  ]);
});

test("the intro node is one Intro card", () => {
  const intro = { ...node("units"), id: "intro" } as PackNode;
  expect(nodeCards(intro)).toEqual([{ type: "intro", key: "intro" }]);
});

test("the map deck: every playable stop's cards in reading order, each checkpoint as a Check, planned stops left out", () => {
  const deck = mapDeck(pack);
  const stops = [...new Set(deck.map((d) => d.nodeId))];
  expect(stops).toEqual(["units", "unit-conversion", "checkpoint-basics", "speed", "checkpoint-trip"]);
  expect(deck.filter((d) => d.key === "checkpoint").map((d) => d.type)).toEqual(["check", "check"]);
  expect(deck.length).toBe(
    nodeCards(node("units")).length + nodeCards(node("unit-conversion")).length + nodeCards(node("speed")).length + 2,
  );
});
