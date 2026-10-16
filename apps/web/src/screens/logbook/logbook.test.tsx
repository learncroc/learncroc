import { afterEach, describe, expect, test } from "bun:test";
import type { Logbook } from "@learncroc/core";
import { screen, within } from "@testing-library/react";
import { type MockApi, mockApi, renderApp } from "../../app/testing";
import { activityGrid, dayKey, logbookMarkdown } from "./index";

const NOW = new Date(2026, 9, 21, 12).getTime(); // a Wednesday
const LOG: Logbook = {
  badges: [],
  canNow: [{ packId: "mini-pack", lineId: "basics", text: "Tell distance from time and convert between units" }],
  fieldNotes: [
    {
      id: "n1",
      packId: "mini-pack",
      nodeId: "units",
      title: "Distance or time?",
      myWords: "Kilometres measure how far; minutes measure how long.",
      usedToThink: "km/h is a distance",
      litAt: NOW - 86_400_000,
      durable: true,
    },
  ],
  usedToThink: [
    { packId: "mini-pack", nodeId: "units", guess: "km/h is a distance", now: "km/h is a speed: distance per time" },
  ],
  activity: [
    { date: dayKey(NOW), count: 3 },
    { date: dayKey(NOW - 2 * 86_400_000), count: 1 },
  ],
  now: NOW,
};

let api: MockApi | undefined;
afterEach(() => api?.restore());

describe("helpers", () => {
  test("activity grid: 12 Monday-first weeks ending this week, future days blank", () => {
    const grid = activityGrid(LOG.activity, NOW);
    expect(grid).toHaveLength(12);
    const last = grid[11] ?? [];
    expect(last[2]).toEqual({ date: dayKey(NOW), count: 3 });
    expect(last[0]?.count).toBe(1);
    expect(last[3]?.count).toBe(-1);
  });

  test("markdown export has every section", () => {
    const md = logbookMarkdown(LOG, () => "Mini pack");
    expect(md).toContain("## You can now");
    expect(md).toContain("> Kilometres measure how far");
    expect(md).toContain("I used to think km/h is a distance. Now: km/h is a speed");
  });
});

describe("logbook", () => {
  test("You can now, field notes, used to think, activity; no streak words", async () => {
    api = mockApi({ "GET /logbook": () => LOG });
    renderApp("/logbook");
    expect(await screen.findByRole("heading", { level: 1, name: "Logbook" })).toBeInTheDocument();
    expect(await screen.findByText("Tell distance from time and convert between units")).toBeInTheDocument();
    const note = screen.getByRole("article", { name: "Field note: Distance or time?" });
    expect(within(note).getByText(/Kilometres measure how far/)).toBeInTheDocument();
    expect(within(note).getByRole("img", { name: "Lit, durable" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Things I used to think" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Activity in the last 12 weeks: 2 active days/ })).toBeInTheDocument();
    expect(document.body.textContent?.toLowerCase()).not.toContain("streak");
  });

  test("empty state", async () => {
    api = mockApi();
    renderApp("/logbook");
    expect(
      await screen.findByRole("heading", { name: "Light your first stop and it shows up here" }),
    ).toBeInTheDocument();
  });
});
