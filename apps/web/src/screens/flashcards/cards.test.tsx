import { afterEach, describe, expect, test } from "bun:test";
import type { CardState } from "@learncroc/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type MockApi, mockApi, renderApp } from "../../app/testing";
import { dueLabel } from "./index";

const NOW = 1_792_500_000_000;
const DAY = 86_400_000;

function card(over: Partial<CardState> & { front: string; back: string }) {
  return {
    id: `user:${over.front}`,
    packId: "mini-pack",
    nodeId: "units",
    kind: "user" as const,
    due: NOW + 3 * DAY,
    stability: 3,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 3,
    reps: 1,
    lapses: 0,
    state: 2 as const,
    suspended: false,
    ...over,
  };
}

const CARDS = [
  card({ front: "Is 90 minutes more than an hour?", back: "Yes: **1.5 hours**.", due: NOW - DAY }),
  card({ id: "card:mini-pack:units:c1", kind: "flashcard", front: "Distance or time: 3 km?", back: "Distance." }),
  card({ id: "node:mini-pack:units", kind: "node", front: "units", back: "" }),
];

let api: MockApi | undefined;
afterEach(() => api?.restore());

describe("dueLabel", () => {
  test("relative to the server's now", () => {
    expect(dueLabel(NOW - 1, NOW)).toBe("Due now");
    expect(dueLabel(NOW + DAY / 2, NOW)).toBe("Due tomorrow");
    expect(dueLabel(NOW + 3 * DAY, NOW)).toBe("Due in 3 days");
  });
});

describe("cards", () => {
  const handlers = {
    "GET /cards": () => CARDS,
    "GET /cards/due": () => ({ now: NOW, cards: [CARDS[0]] }),
  } as const;

  test("lists your cards and pack cards (not stop cards), renders inline Markdown", async () => {
    api = mockApi(handlers);
    renderApp("/cards");
    expect(await screen.findByRole("heading", { level: 1, name: "Cards" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Cards" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("1.5 hours").tagName).toBe("STRONG");
    expect(screen.getByText(/1 card is due/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "From packs" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  test("edit a card of your own", async () => {
    api = mockApi({ ...handlers, "PATCH /cards/:id": (c) => ({ ...CARDS[0], ...(c.body as object) }) });
    renderApp("/cards");
    await userEvent.click(await screen.findByRole("button", { name: /Edit card: Is 90 minutes/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit card" });
    const back = within(dialog).getByRole("textbox", { name: "Back" });
    await userEvent.clear(back);
    await userEvent.type(back, "Yes, 1.5 h");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api?.calls.find((c) => c.key === "PATCH /cards/:id")?.body).toEqual({
        front: "Is 90 minutes more than an hour?",
        back: "Yes, 1.5 h",
      }),
    );
  });

  test("delete asks first; pause works on pack cards", async () => {
    api = mockApi({ ...handlers, "DELETE /cards/:id": () => ({ ok: true }), "PATCH /cards/:id": () => CARDS[1] });
    renderApp("/cards");
    await userEvent.click(await screen.findByRole("button", { name: /Delete card/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete this card?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api?.calls.some((c) => c.key === "DELETE /cards/:id")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: /Pause card: Distance or time/ }));
    await waitFor(() =>
      expect(api?.calls.find((c) => c.key === "PATCH /cards/:id")?.body).toEqual({ suspended: true }),
    );
  });

  test("new card (N) posts a manual card", async () => {
    api = mockApi({ ...handlers, "POST /cards": (c) => card(c.body as never) });
    renderApp("/cards");
    await screen.findByRole("list", { name: "Cards" });
    await userEvent.keyboard("n");
    const dialog = await screen.findByRole("dialog", { name: "New card" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Front" }), "Q");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Back" }), "A");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add card" }));
    await waitFor(() =>
      expect(api?.calls.find((c) => c.key === "POST /cards")?.body).toEqual({
        packId: "mini-pack",
        front: "Q",
        back: "A",
        source: "manual",
      }),
    );
  });

  test("export asks the server for CSV", async () => {
    api = mockApi({
      ...handlers,
      "GET /cards/export": () => new Response("front,back\n", { headers: { "content-type": "text/csv" } }),
    });
    const created: string[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = () => {
      created.push("blob");
      return "blob:x";
    };
    renderApp("/cards");
    await userEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(api.calls.find((c) => c.key === "GET /cards/export")?.query.get("format")).toBe("csv");
    URL.createObjectURL = orig;
  });

  test("empty state", async () => {
    api = mockApi();
    renderApp("/cards");
    expect(await screen.findByRole("heading", { name: "No cards yet" })).toBeInTheDocument();
  });
});
