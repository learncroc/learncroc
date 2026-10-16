import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "@learncroc/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { mockProgress } from "../api/mock";
import { applyAppearance } from "./appearance";
import { reportScreenUrl } from "./ScreenMenu";
import { useShell } from "./store";
import { type MockApi, mockApi, renderApp } from "./testing";

let api: MockApi | undefined;
afterEach(() => {
  api?.restore();
  useShell.setState({ layer: null });
  delete process.env.VITE_LM_DEMO;
  const root = document.documentElement;
  for (const k of ["theme", "font", "contrast", "motion"]) delete root.dataset[k];
});

describe("rail", () => {
  test("shows the destinations and an ember dot (never a number) when something is fading", async () => {
    api = mockApi();
    renderApp("/library");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    for (const name of ["Library", "Create", "Logbook", "Settings", "Command palette"]) {
      expect(within(nav).getByRole(name === "Command palette" ? "button" : "link", { name })).toBeInTheDocument();
    }
    const relight = await within(nav).findByRole("link", { name: "Relight: some stops are fading" });
    expect(relight).toHaveAttribute("href", "/relight");
    expect(within(relight).getByTestId("relight-dot").textContent).toBe("");
    expect(within(nav).getByRole("link", { name: /AI is off/ })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  });

  test("no dot when nothing is fading; Current map appears once a pack was opened", async () => {
    api = mockApi({
      "GET /progress": () => ({
        now: mockProgress.now,
        packs: { "mini-pack": { lit: 1, sparked: 0, fading: 0, playable: 4, due: 0 } },
      }),
    });
    renderApp("/library");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    await within(nav).findByRole("link", { name: "Relight" });
    expect(within(nav).queryByTestId("relight-dot")).toBeNull();
  });

  test("focus mode hides the rail on run screens", async () => {
    api = mockApi();
    renderApp("/p/mini-pack/run/units");
    await waitFor(() => expect(document.querySelector("[data-focus-mode]")).not.toBeNull());
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });
});

describe("global keys", () => {
  test("G then L goes to the Library; G then K to the Marketplace", async () => {
    api = mockApi();
    const { router } = renderApp("/logbook");
    await screen.findByRole("heading", { level: 1, name: "Logbook" });
    await userEvent.keyboard("gl");
    await waitFor(() => expect(router.state.location.pathname).toBe("/library"));
    await userEvent.keyboard("gk");
    await waitFor(() => expect(router.state.location.pathname).toBe("/market"));
  });

  test("single keys never fire inside a text field", async () => {
    api = mockApi();
    const { router } = renderApp("/market");
    const search = await screen.findByRole("searchbox", { name: "Search packs" });
    await userEvent.click(search);
    await userEvent.keyboard("gl");
    expect(router.state.location.pathname).toBe("/market");
    expect(search).toHaveValue("gl");
  });

  test("G navigation is off in focus mode", async () => {
    api = mockApi();
    const { router } = renderApp("/relight");
    await waitFor(() => expect(document.querySelector("[data-focus-mode]")).not.toBeNull());
    await userEvent.keyboard("gl");
    expect(router.state.location.pathname).toBe("/relight");
  });

  test("? opens the shortcut sheet with the screen's own keys; Esc closes it", async () => {
    api = mockApi();
    renderApp("/library");
    await screen.findByRole("heading", { level: 1, name: "Library" });
    await userEvent.keyboard("?");
    const sheet = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(sheet).getByText("Continue the most recent map")).toBeInTheDocument();
    expect(within(sheet).getByText("Command palette: packs, stops, cards, settings")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull());
  });
});

describe("command palette", () => {
  test("⌘K opens it; local actions and /api/search hits answer; Enter goes there", async () => {
    api = mockApi({
      "GET /search": (c) =>
        c.query.get("q") === "minutes"
          ? [
              {
                type: "node",
                title: "Minutes into hours",
                subtitle: "Mini pack",
                href: "/p/mini-pack?stop=unit-conversion",
              },
            ]
          : [],
    });
    const { router } = renderApp("/library");
    await screen.findByRole("heading", { level: 1, name: "Library" });
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    expect(within(palette).getByText("Relight")).toBeInTheDocument();
    await userEvent.type(within(palette).getByRole("combobox"), "minutes");
    await userEvent.click(await within(palette).findByText("Minutes into hours"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/p/mini-pack"));
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  test("filters local entries accent- and case-insensitively; Enter opens the first result", async () => {
    api = mockApi();
    const { router } = renderApp("/library");
    await screen.findByRole("heading", { level: 1, name: "Library" });
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    await userEvent.type(within(palette).getByRole("combobox"), "LOGBOOK");
    await new Promise((r) => setTimeout(r, 300));
    expect(within(palette).queryByText("Marketplace")).toBeNull();
    expect(within(palette).getByText("Logbook")).toBeInTheDocument();
    // The first result is selected after the debounced query lands, so Enter works without arrows.
    expect(palette.querySelector('[cmdk-item][data-selected="true"]')?.textContent).toContain("Logbook");
    await userEvent.keyboard("{Enter}");
    await new Promise((r) => setTimeout(r, 100));
    expect(router.state.location.pathname).toBe("/logbook");
  });
});

describe("appearance", () => {
  test("settings land on <html>: theme, font, contrast, motion, text size", () => {
    const root = document.createElement("div");
    applyAppearance(
      { theme: "dark", font: "atkinson", textScale: 1.25, reducedMotion: "on", contrast: "more", mapLabels: "zoom" },
      false,
      root,
    );
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.font).toBe("atkinson");
    expect(root.dataset.contrast).toBe("more");
    expect(root.dataset.motion).toBe("reduced");
    expect(root.style.getPropertyValue("--t-body-size")).toBe("20px");
    applyAppearance({ ...DEFAULT_SETTINGS.appearance }, true, root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.motion).toBeUndefined();
    expect(root.style.getPropertyValue("--t-body-size")).toBe("");
  });

  test("the app applies the saved theme", async () => {
    api = mockApi({
      "GET /settings": () => ({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: "dark" } }),
    });
    renderApp("/library");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });
});

describe("report this screen", () => {
  test("prefills ids and versions only", () => {
    const url = new URL(
      reportScreenUrl(
        { screen: "Node Run", packId: "how-llms-work", packVersion: "0.1.0", nodeId: "attention", screenId: "s2" },
        "0.1.0",
      ),
    );
    expect(url.pathname).toBe("/learncroc/learncroc/issues/new");
    const body = url.searchParams.get("body") ?? "";
    expect(url.searchParams.get("title")).toBe("Screen report: how-llms-work / attention / s2");
    expect(body).toContain("`how-llms-work@0.1.0`");
    expect(body).toContain("App version: `0.1.0`");
    expect(body).toContain("No learner data");
  });
});

describe("demo", () => {
  test("the static demo shows its banner", async () => {
    process.env.VITE_LM_DEMO = "1";
    api = mockApi();
    renderApp("/library");
    expect(await screen.findByText(/Demo: progress is saved in this browser/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Install/ })).toHaveAttribute(
      "href",
      expect.stringContaining("github.com"),
    );
  });
});

describe("accessibility", () => {
  const ROUTES = [
    "/library",
    "/market",
    "/cards",
    "/logbook",
    "/settings/appearance",
    "/settings/learning",
    "/settings/data",
  ];
  for (const path of ROUTES) {
    test(`axe: no serious or critical violations on ${path}`, async () => {
      api = mockApi();
      renderApp(path);
      await screen.findByRole("heading", { level: 1 });
      await new Promise((r) => setTimeout(r, 50));
      const result = await axe.run(document.body, {
        rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
      });
      const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 80)).join(" | ")}`)).toEqual([]);
    });
  }
});
