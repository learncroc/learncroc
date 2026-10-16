import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { WIDGET_SPECS } from "@learncroc/widgets/host/specs";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevWidgetsScreen } from "./index";

/** React's act() bookkeeping only exists under test; it isn't a console error in the browser. */
const TEST_ONLY = /not wrapped in act|not configured to support act|suspended inside an `act` scope/;
const realErrors = (spy: ReturnType<typeof spyOn>) =>
  spy.mock.calls.filter((args: unknown[]) => !TEST_ONLY.test(String(args[0])));

/** Let lazy widget chunks resolve (React retries suspended trees when an act scope is awaited). */
async function settle(done: () => boolean, ms = 20_000) {
  const until = Date.now() + ms;
  while (!done() && Date.now() < until) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
}

const totalExamples = Object.values(WIDGET_SPECS).reduce((n, s) => n + s.examples.length, 0);

describe("/dev/widgets", () => {
  let errors: ReturnType<typeof spyOn>;
  beforeEach(() => {
    errors = spyOn(console, "error");
  });
  afterEach(() => errors.mockRestore());

  test("renders every example of every widget with no console errors", async () => {
    render(<DevWidgetsScreen />);
    expect(document.querySelectorAll("[data-example]").length).toBe(totalExamples);
    await settle(() => document.querySelectorAll("[data-widget-loading]").length === 0);
    expect(document.querySelectorAll("[data-widget-loading]").length).toBe(0);
    expect(document.querySelectorAll("[data-widget-fallback]").length).toBe(0);
    expect(document.querySelectorAll("[data-gallery-widget]").length).toBe(Object.keys(WIDGET_SPECS).length);
    expect(realErrors(errors)).toEqual([]);
  }, 30_000);

  test("Show answer then Check grades correct; both themes", async () => {
    const user = userEvent.setup();
    render(<DevWidgetsScreen />);
    const card = document.querySelector('[data-example="sorter:0"]') as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Show answer" }));
    await user.click(within(card).getByRole("button", { name: /Check/ }));
    await settle(() => card.querySelector('[data-result="true"]') !== null);
    expect(card.querySelector('[data-result="true"]')).not.toBeNull();
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.querySelector('[data-screen="Widget gallery"]')).toHaveAttribute("data-theme", "dark");
  }, 30_000);

  test("bad props JSON shows the widget's own validation messages", async () => {
    render(<DevWidgetsScreen />);
    const card = document.querySelector('[data-example="sorter:0"]') as HTMLElement;
    const props = within(card).getByLabelText("props");
    await act(async () => {
      fireEvent.change(props, { target: { value: '{"mode":"buckets","cards":[]}' } });
    });
    await settle(() => !!card.querySelector("[data-issues]"));
    expect(card.querySelector("[data-issues]")?.textContent).toContain("3–8 cards");
  }, 30_000);

  test("the hostile interactive is refused by the pre-scan", () => {
    render(<DevWidgetsScreen />);
    const issues = document.querySelector("[data-scan-issues]");
    expect(issues?.textContent).toContain("network");
    expect(issues?.textContent).toContain("storage");
  });
});
