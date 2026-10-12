import { describe, expect, mock, test } from "bun:test";
import type { WidgetRef } from "@learncroc/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { lightSpecRegistry, WIDGET_SPECS } from "../src/host/specs";
import { WidgetHost, type WidgetHostProps } from "../src/host/WidgetHost";
import { loadWidget, WIDGET_SPEC_LOADERS, WIDGET_VIEW_LOADERS } from "../src/registry";
import { expectAxeClean } from "./widget-harness";

const sorterEx = WIDGET_SPECS.sorter.examples[0];
if (!sorterEx) throw new Error("missing sorter example");
const sorterRef: WidgetRef = { id: "sorter", v: 1, props: sorterEx.props, goal: sorterEx.goal };

function host(extra: Partial<WidgetHostProps> = {}) {
  return render(
    <WidgetHost
      widget={sorterRef}
      mode="answer"
      reducedMotion
      theme="light"
      assetUrl={(a) => `/assets/${a}`}
      alt="Units to sort into distance and time"
      {...extra}
    />,
  );
}

describe("registry", () => {
  test("every widget has a view loader and a spec loader that resolve", async () => {
    for (const id of Object.keys(WIDGET_VIEW_LOADERS) as (keyof typeof WIDGET_VIEW_LOADERS)[]) {
      const w = await loadWidget(id);
      expect(typeof w.View).toBe("function");
      expect(w.spec.id).toBe(id);
      expect(await WIDGET_SPEC_LOADERS[id]()).toBe(w.spec);
    }
    expect(lightSpecRegistry.get("plot")?.id).toBe("plot");
  });
});

describe("WidgetHost", () => {
  test("lazy-loads the widget, describes it, and restores the value", async () => {
    host({ value: { assignment: { km: "distance" } } });
    expect(await screen.findByRole("button", { name: "kilometre, in Distance" })).toBeInTheDocument();
    const fig = document.querySelector("figure[data-widget-host='sorter']");
    expect(fig).toHaveAttribute("aria-label", "Units to sort into distance and time");
    const desc = document.getElementById(fig?.getAttribute("aria-describedby") ?? "");
    expect(desc?.textContent).toContain("Sort 4 cards");
  });

  test("forwards changes and announcements (aria-live)", async () => {
    const user = userEvent.setup();
    const onChange = mock((_v: unknown) => {});
    function Controlled() {
      const [v, setV] = useState<unknown>(undefined);
      return (
        <WidgetHost
          widget={sorterRef}
          mode="answer"
          value={v}
          onChange={(x) => {
            onChange(x);
            setV(x);
          }}
          reducedMotion
          theme="light"
          assetUrl={(a) => a}
        />
      );
    }
    render(<Controlled />);
    const km = await screen.findByRole("button", { name: /^kilometre/ });
    km.focus();
    await user.keyboard("  ");
    expect(onChange).toHaveBeenLastCalledWith({ assignment: { km: "distance" } });
    await waitFor(() =>
      expect(document.querySelector("[data-widget-live]")?.textContent).toBe("kilometre placed in Distance."),
    );
  });

  test("keeps its own value when uncontrolled", async () => {
    const user = userEvent.setup();
    host();
    (await screen.findByRole("button", { name: /^mile/ })).focus();
    await user.keyboard("  ");
    expect(await screen.findByRole("button", { name: "mile, in Distance" })).toBeInTheDocument();
  });

  test("review mode is read-only and shows where cards belong", async () => {
    host({ mode: "review", value: sorterEx.wrongAnswer, solution: sorterEx.correctAnswer });
    expect(await screen.findByText("belongs in Distance")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Use buttons instead" })).toBeNull();
  });

  test("draws the VisualState note and merges its props", async () => {
    const pb = WIDGET_SPECS["probability-bars"].examples[0];
    if (!pb) throw new Error("missing example");
    render(
      <WidgetHost
        widget={{ id: "probability-bars", v: 1, props: pb.props }}
        mode="answer"
        visualState={{ note: "The model barely considers bowl", props: { hideTruth: false } }}
        reducedMotion
        theme="dark"
        assetUrl={(a) => a}
      />,
    );
    expect(await screen.findByText("The model barely considers bowl")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll("[data-truth]").length).toBeGreaterThan(0));
  });

  test("explore mode opens the widget up (spec.explore)", async () => {
    const pb = WIDGET_SPECS["probability-bars"].examples[0];
    if (!pb) throw new Error("missing example");
    render(
      <WidgetHost
        widget={{ id: "probability-bars", v: 1, props: pb.props }}
        mode="explore"
        reducedMotion
        theme="light"
        assetUrl={(a) => a}
      />,
    );
    // hideTruth is lifted in explore, so the real bars show.
    await waitFor(() => expect(document.querySelectorAll("[data-truth]").length).toBe(pb.props.tokens.length + 1));
  });

  test("bad props fall back to the figure and say the interactive didn't load", async () => {
    const onError = mock((_e: Error) => {});
    host({
      widget: { id: "sorter", v: 1, props: { mode: "sideways", cards: [] } },
      fallback: <img src="/fig.svg" alt="Units in two columns" />,
      onError,
    });
    expect(await screen.findByText(/This interactive didn't load/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Units in two columns" })).toBeInTheDocument();
    expect(document.querySelector("[data-widget-error='config']")).not.toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("a stale restored answer is dropped instead of crashing", async () => {
    host({ value: { assignment: "not-a-record" } });
    expect(await screen.findByRole("button", { name: "kilometre, not sorted yet" })).toBeInTheDocument();
  });

  test("axe clean", async () => {
    const { container } = host();
    await screen.findByRole("button", { name: /^kilometre/ });
    await expectAxeClean(container);
  });
});
