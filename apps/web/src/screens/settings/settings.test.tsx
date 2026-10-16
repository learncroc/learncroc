import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type SettingsPatch } from "@learncroc/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mergeSettings } from "../../app/queries";
import { type MockApi, mockApi, renderApp } from "../../app/testing";

let api: MockApi | undefined;
afterEach(() => api?.restore());

const patchHandler = () => ({
  "PATCH /settings": (c: { body: unknown }) => mergeSettings(DEFAULT_SETTINGS, c.body as SettingsPatch),
});
const patches = () => api?.calls.filter((c) => c.key === "PATCH /settings").map((c) => c.body) ?? [];

describe("settings", () => {
  test("every section renders with its nav link marked current", async () => {
    api = mockApi();
    for (const [section, heading] of [
      ["ai", "AI"],
      ["appearance", "Appearance"],
      ["learning", "Learning"],
      ["sound", "Sound"],
      ["data", "Data"],
      ["experiments", "Experiments"],
      ["about", "About"],
    ] as const) {
      const { unmount } = renderApp(`/settings/${section}`);
      expect(await screen.findByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
      const nav = screen.getByRole("navigation", { name: "Settings sections" });
      expect(within(nav).getByRole("link", { name: heading })).toHaveAttribute("aria-current", "page");
      unmount();
    }
  });

  test("the AI section mounts the AI settings panel", async () => {
    api = mockApi();
    renderApp("/settings/ai");
    expect(await screen.findByRole("region", { name: /AI settings/i })).toBeInTheDocument();
  });

  test("appearance changes save as you make them", async () => {
    api = mockApi(patchHandler());
    renderApp("/settings/appearance");
    await userEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    await userEvent.click(screen.getByRole("switch", { name: /Easier-to-read font/ }));
    await waitFor(() =>
      expect(patches()).toEqual([{ appearance: { theme: "dark" } }, { appearance: { font: "atkinson" } }]),
    );
    await waitFor(() => expect(document.documentElement.dataset.font).toBe("atkinson"));
    delete document.documentElement.dataset.font;
  });

  test("learning: relight size and the daily reminder time", async () => {
    api = mockApi(patchHandler());
    renderApp("/settings/learning");
    await userEvent.click(await screen.findByRole("radio", { name: "12" }));
    await userEvent.click(screen.getByRole("switch", { name: /Daily reminder/ }));
    await waitFor(() =>
      expect(patches()).toEqual([
        { learning: { dailyRelight: 12 } },
        { learning: { reminder: { enabled: true, time: "19:00" } } },
      ]),
    );
  });

  test("sound samples stay disabled until sound is on", async () => {
    api = mockApi();
    renderApp("/settings/sound");
    expect(await screen.findByRole("button", { name: "Right answer" })).toBeDisabled();
  });

  test("reset needs the pack id typed", async () => {
    api = mockApi({ "POST /reset/:packId": () => ({ ok: true }) });
    renderApp("/settings/data");
    const select = await screen.findByRole("combobox", { name: "Pack to reset" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    await userEvent.selectOptions(select, "mini-pack");
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Reset Mini pack?" });
    const confirm = within(dialog).getByRole("button", { name: "Reset" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), "mini-pack");
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(api?.calls.find((c) => c.key === "POST /reset/:packId")?.body).toEqual({ confirm: "mini-pack" }),
    );
  });

  test("an unknown section says so", async () => {
    api = mockApi();
    renderApp("/settings/keyboard");
    expect(await screen.findByRole("heading", { name: "No such section" })).toBeInTheDocument();
  });
});
