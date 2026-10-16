import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "@learncroc/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockPack, mockProgress } from "../../api/mock";
import { type MockApi, mockApi, renderApp } from "../../app/testing";
import { homeTarget } from "./index";
import { relightCopy, relightMinutes } from "./RelightStrip";

let api: MockApi | undefined;
afterEach(() => api?.restore());

describe("home redirect", () => {
  const DAY = 86_400_000;
  const now = 1_800_000_000_000;
  test("first run goes to the cold open", () => {
    expect(homeTarget({ firstRunCompleted: false, packs: [], now })).toBe("/welcome");
  });
  test("the last map opened in the past 14 days, else the library", () => {
    const packs = [
      { id: "a", status: "ok" as const, lastOpenedAt: now - 3 * DAY },
      { id: "b", status: "ok" as const, lastOpenedAt: now - 1 * DAY },
      { id: "c", status: "invalid" as const, lastOpenedAt: now },
    ];
    expect(homeTarget({ firstRunCompleted: true, packs, now })).toBe("/p/b");
    expect(
      homeTarget({ firstRunCompleted: true, packs: [{ id: "a", status: "ok", lastOpenedAt: now - 20 * DAY }], now }),
    ).toBe("/library");
  });
  test("/ redirects to /welcome on first run", async () => {
    api = mockApi();
    const { router } = renderApp("/");
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome"));
  });
  test("/ redirects to the library when no map was opened recently", async () => {
    api = mockApi({
      "GET /settings": () => ({ ...DEFAULT_SETTINGS, firstRun: { completed: true } }),
      "GET /packs": () => [],
    });
    const { router } = renderApp("/");
    await waitFor(() => expect(router.state.location.pathname).toBe("/library"));
  });
});

describe("relight copy", () => {
  test("names the size of the job, singular and plural", () => {
    expect(relightCopy(1, ["How LLMs work"])).toBe("1 stop is fading in How LLMs work. About a minute brings it back.");
    expect(relightCopy(6, ["A", "B"])).toBe("6 stops are fading across 2 maps. About 4 minutes brings them back.");
    expect(relightMinutes(30)).toBe(5);
  });
});

describe("library", () => {
  test("shows the Relight strip, the map poster and Continue", async () => {
    api = mockApi();
    renderApp("/library");
    expect(await screen.findByRole("heading", { level: 1, name: "Library" })).toBeInTheDocument();
    const strip = await screen.findByRole("region", { name: /fading in Mini pack/ });
    expect(within(strip).getByRole("link", { name: /Relight/ })).toHaveAttribute("href", "/relight");
    expect(await within(strip).findByRole("link", { name: "Minutes into hours" })).toBeInTheDocument();
    const poster = screen.getByRole("article", { name: mockPack.manifest.title });
    expect(within(poster).getByRole("link", { name: mockPack.manifest.title })).toHaveAttribute("href", "/p/mini-pack");
    const cont = within(poster).getByRole("link", { name: /Continue|Start here/ });
    expect(cont.getAttribute("href")).toMatch(/^\/p\/mini-pack\/(run|boss)\//);
    expect((await within(poster).findAllByText(/of \d+ lit/)).length).toBeGreaterThan(0);
  });

  test("no strip when nothing is fading", async () => {
    const views = Object.fromEntries(
      Object.entries(mockProgress.views).map(([id, v]) => [
        id,
        { ...v, state: v.state === "fading" ? ("lit" as const) : v.state },
      ]),
    );
    api = mockApi({
      "GET /progress": () => ({
        now: mockProgress.now,
        packs: { "mini-pack": { lit: 2, sparked: 1, fading: 0, playable: 4, due: 0 } },
      }),
      "GET /progress/:packId": () => ({ ...mockProgress, views }),
      "GET /packs": () => [{ ...fixtureSummary()[0], fading: 0 }],
    });
    renderApp("/library");
    await screen.findByRole("article", { name: mockPack.manifest.title });
    expect(screen.queryByRole("region", { name: /fading/ })).toBeNull();
  });

  test("empty shelf invites to the marketplace and pocket maps", async () => {
    api = mockApi({ "GET /packs": () => [], "GET /progress": () => ({ now: 0, packs: {} }) });
    renderApp("/library");
    expect(await screen.findByRole("heading", { name: "Your shelf is empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Browse the Marketplace/ })).toHaveAttribute("href", "/market");
    expect(screen.getByRole("link", { name: /New pocket map/ })).toHaveAttribute("href", "/create/pocket");
  });

  test("a pack that fails validation shows Repair and Remove; Remove asks first", async () => {
    const [s] = fixtureSummary();
    api = mockApi({
      "GET /packs": () => [{ ...s, status: "invalid", statusMessage: "This pack's files don't match its lockfile." }],
      "DELETE /packs/:id": () => ({ ok: true }),
    });
    renderApp("/library");
    expect(await screen.findByText("This pack's files don't match its lockfile.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repair" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog", { name: /Remove Mini pack/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api?.calls.some((c) => c.key === "DELETE /packs/:id")).toBe(true));
  });

  test("a server error is explained, with a retry", async () => {
    api = mockApi({
      "GET /packs": () => {
        throw new Error("boom");
      },
    });
    renderApp("/library");
    expect(await screen.findByRole("heading", { name: "Couldn't load your maps" })).toBeInTheDocument();
    expect(screen.getByText(/hit a problem reading your packs \(500 boom\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  test("a server that doesn't answer is explained, with how to start it", async () => {
    api = mockApi();
    const answer = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).endsWith("/api/packs")
        ? Promise.reject(new TypeError("Failed to fetch"))
        : answer(input, init)) as typeof fetch;
    renderApp("/library");
    expect(
      await screen.findByRole("heading", { name: "Couldn't load your maps" }, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/didn't answer \(Failed to fetch\)/)).toBeInTheDocument();
  });

  test("keyboard: R goes to Relight, G then L stays a navigation", async () => {
    api = mockApi();
    const { router } = renderApp("/library");
    await screen.findByRole("article", { name: mockPack.manifest.title });
    await userEvent.keyboard("r");
    await waitFor(() => expect(router.state.location.pathname).toBe("/relight"));
  });
});

/** The fixture's GET /packs answer (same shape as api/mock.ts). */
function fixtureSummary(): Record<string, unknown>[] {
  const { manifest, stats, map } = mockPack;
  return [
    {
      id: manifest.id,
      version: manifest.version,
      title: manifest.title,
      subtitle: manifest.subtitle,
      category: manifest.category,
      theme: manifest.theme,
      tier: "official",
      kind: "pack",
      profile: manifest.profile,
      review: manifest.status,
      customInteractives: false,
      nodes: stats.nodes,
      playable: stats.playable,
      lit: 1,
      fading: 1,
      next: { nodeId: "speed", title: map.nodes.speed?.title ?? "speed" },
      status: "ok",
    },
  ];
}
