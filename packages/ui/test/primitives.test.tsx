import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NodeState } from "@learncroc/core";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  AnswerKey,
  Button,
  ConfidenceTap,
  Dialog,
  Drawer,
  IrisMark,
  Kbd,
  Menu,
  MenuItem,
  Popover,
  ProgressBeads,
  Segmented,
  SegmentRing,
  STATE_LABEL,
  StatePill,
  StopGlyph,
  Switch,
  Toaster,
  toast,
  useReducedMotion,
  WhyThisWorks,
} from "../src/index";

afterEach(() => {
  delete document.documentElement.dataset.motion;
});

describe("AnswerKey", () => {
  test("shows its number badge and presses", async () => {
    let pressed = 0;
    render(
      <AnswerKey n={2} onPress={() => pressed++}>
        2 hours
      </AnswerKey>,
    );
    await userEvent.click(screen.getByRole("button", { name: /2 hours/ }));
    expect(pressed).toBe(1);
  });

  test("the digit key drops the key, then presses it; never inside a text field", async () => {
    let pressed = 0;
    render(
      <>
        <input aria-label="Notes" />
        <AnswerKey n={3} hotkey onPress={() => pressed++}>
          Tea
        </AnswerKey>
      </>,
    );
    const key = screen.getByRole("button", { name: /Tea/ });
    expect(key).toHaveAttribute("aria-keyshortcuts", "3");
    await userEvent.keyboard("3");
    expect(key.className).toContain("translate-y-0.5");
    await waitFor(() => expect(pressed).toBe(1));
    await userEvent.click(screen.getByRole("textbox", { name: "Notes" }));
    await userEvent.keyboard("3");
    await new Promise((r) => setTimeout(r, 120));
    expect(pressed).toBe(1);
  });

  test("down stays pressed and reports aria-pressed", () => {
    render(
      <AnswerKey n={1} state="down" onPress={() => {}}>
        Coffee
      </AnswerKey>,
    );
    const key = screen.getByRole("button", { name: /Coffee/ });
    expect(key).toHaveAttribute("aria-pressed", "true");
    expect(key.className).toContain("shadow-key-down");
  });
});

describe("stop states", () => {
  const STATES: NodeState[] = ["locked", "ready", "in-progress", "done", "lit", "fading", "planned", "building"];

  test("every state has a glyph named with the constant UI words", () => {
    render(
      <div>
        {STATES.map((s) => (
          <StopGlyph key={s} state={s} />
        ))}
      </div>,
    );
    for (const s of STATES) expect(screen.getByRole("img", { name: STATE_LABEL[s] })).toHaveAttribute("data-state", s);
  });

  test("states are told apart by shape, not only colour", () => {
    const { container } = render(
      <div>
        {STATES.map((s) => (
          <StopGlyph key={s} state={s} decorative />
        ))}
      </div>,
    );
    const shapes = [...container.querySelectorAll("svg")].map((svg) =>
      [...svg.querySelectorAll("circle,path,rect")]
        .map(
          (el) =>
            `${el.tagName}:${el.getAttribute("d") ?? el.getAttribute("r") ?? ""}:${el.getAttribute("stroke-dasharray") ?? ""}`,
        )
        .join("|"),
    );
    expect(new Set(shapes).size).toBe(STATES.length);
  });

  test("final gate and durable marks", () => {
    const { container } = render(<StopGlyph state="lit" kind="checkpoint" final durable />);
    expect(screen.getByRole("img", { name: "Final checkpoint, Open, durable" })).toBeInTheDocument();
    expect(container.querySelector('[data-part="final"]')).not.toBeNull();
    expect(container.querySelector('[data-part="durable"]')).not.toBeNull();
  });

  test("decorative glyphs are hidden from assistive tech", () => {
    const { container } = render(<StopGlyph state="ready" decorative />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  test("StatePill shows the glyph and the word", () => {
    render(<StatePill state="fading" />);
    expect(screen.getByText("Fading")).toHaveAttribute("data-state", "fading");
  });
});

describe("progress", () => {
  test("SegmentRing powers segments in Lumen and marks the current one", () => {
    const { container } = render(<SegmentRing total={5} powered={2} current={2} label="2 of 5 stages powered" />);
    expect(screen.getByRole("img", { name: "2 of 5 stages powered" })).toBeInTheDocument();
    const segs = [...container.querySelectorAll("[data-segment]")].map((s) => s.getAttribute("data-segment"));
    expect(segs).toEqual(["powered", "powered", "current", "rest", "rest"]);
  });

  test("ProgressBeads", () => {
    const { container } = render(<ProgressBeads total={4} done={1} current={1} label="Screen 2 of 4" />);
    expect(screen.getByRole("img", { name: "Screen 2 of 4" })).toBeInTheDocument();
    expect([...container.querySelectorAll("[data-bead]")].map((b) => b.getAttribute("data-bead"))).toEqual([
      "done",
      "current",
      "ahead",
      "ahead",
    ]);
  });
});

describe("controls", () => {
  test("ConfidenceTap is a radio group", async () => {
    const seen: number[] = [];
    render(<ConfidenceTap onChange={(v) => seen.push(v)} />);
    await userEvent.click(screen.getByRole("radio", { name: "Guessing" }));
    expect(seen).toEqual([1]);
  });

  test("Switch and Segmented", async () => {
    function Harness() {
      const [on, setOn] = useState(false);
      const [size, setSize] = useState<5 | 8 | 12>(8);
      return (
        <>
          <Switch checked={on} onChange={setOn} label="Sound" />
          <Segmented
            label="Relight size"
            value={size}
            onChange={setSize}
            options={[
              { value: 5, label: "5" },
              { value: 8, label: "8" },
              { value: 12, label: "12" },
            ]}
          />
        </>
      );
    }
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "Sound" });
    await userEvent.click(sw);
    expect(sw).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "12" }));
    expect(screen.getByRole("radio", { name: "12" })).toBeChecked();
  });

  test("Button shows its keyboard hint", () => {
    render(
      <Button variant="primary" kbd="R">
        Relight
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Relight" })).toBeInTheDocument();
  });

  test("Kbd reads sequences as 'then'", () => {
    render(<Kbd keys={["G", "L"]} />);
    expect(screen.getByRole("img", { name: "G then L" })).toBeInTheDocument();
  });

  test("IrisMark labels AI text", () => {
    render(<IrisMark>Attention mixes earlier words.</IrisMark>);
    expect(screen.getByText(/Drafted by AI/)).toBeInTheDocument();
  });
});

describe("layers", () => {
  test("Popover opens, Esc closes it and focus returns to the anchor", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <Popover
          open={open}
          onOpenChange={setOpen}
          label="Details"
          anchor={
            <button type="button" onClick={() => setOpen(true)}>
              More
            </button>
          }
        >
          <button type="button">Inside</button>
        </Popover>
      );
    }
    render(<Harness />);
    const anchor = screen.getByRole("button", { name: "More" });
    await userEvent.click(anchor);
    expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Details" })).toBeNull());
    await waitFor(() => expect(anchor).toHaveFocus());
  });

  test("WhyThisWorks shows the honesty label", async () => {
    render(
      <WhyThisWorks
        title="Guess first"
        line="Guessing before you're taught makes the answer stick."
        evidence="strong"
        citation="Richland, Kornell & Kao (2009)"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Why this works: Guess first" }));
    expect(await screen.findByText(/Strong evidence/)).toBeInTheDocument();
  });

  test("Drawer traps focus and Esc closes it", async () => {
    const onClose = mock(() => {});
    render(
      <Drawer open onClose={onClose} title="Ask Tok">
        <input aria-label="Question" />
      </Drawer>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Ask Tok" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  test("Dialog renders title, description and actions", async () => {
    render(
      <Dialog
        open
        onClose={() => {}}
        title="Remove this pack?"
        description="Your progress is kept."
        actions={<Button>Remove</Button>}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Remove this pack?" });
    expect(dialog).toHaveAccessibleDescription("Your progress is kept.");
  });

  test("Menu: arrow keys and Enter pick an item", async () => {
    const picked: string[] = [];
    render(
      <Menu label="More">
        <MenuItem onSelect={() => picked.push("report")}>Report this screen</MenuItem>
        <MenuItem onSelect={() => picked.push("shortcuts")}>Shortcuts</MenuItem>
      </Menu>,
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Shortcuts" }));
    expect(picked).toEqual(["shortcuts"]);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  test("Toaster shows a toast and dismisses it", async () => {
    render(<Toaster />);
    act(() => {
      toast({ message: "Installed. Open map", tone: "done" });
    });
    expect(await screen.findByText("Installed. Open map")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText("Installed. Open map")).toBeNull());
  });
});

describe("motion", () => {
  test("useReducedMotion follows the app override", async () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => {
      document.documentElement.dataset.motion = "reduced";
    });
    await waitFor(() => expect(result.current).toBe(true));
  });
});

describe("tokens", () => {
  const tokens = readFileSync(join(import.meta.dir, "../src/tokens.css"), "utf8");
  const theme = readFileSync(join(import.meta.dir, "../src/theme.css"), "utf8");
  const value = (css: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

  test("theme.css repeats the shadow and easing tokens exactly", () => {
    for (const name of ["--shadow-1", "--shadow-2", "--shadow-3", "--ease-out", "--ease-in-out", "--ease-in"]) {
      expect(value(theme, name)).toBe(value(tokens, name));
    }
  });

  test("no red: the palette has no hue between 345° and 15° with high saturation", () => {
    for (const [, hex] of tokens.matchAll(/#([0-9a-f]{6})\b/gi)) {
      const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt((hex as string).slice(i, i + 2), 16) / 255) as [
        number,
        number,
        number,
      ];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const s = max === 0 ? 0 : (max - min) / max;
      let h = 0;
      if (max !== min) {
        if (max === r) h = ((g - b) / (max - min)) * 60;
        else if (max === g) h = (2 + (b - r) / (max - min)) * 60;
        else h = (4 + (r - g) / (max - min)) * 60;
      }
      h = (h + 360) % 360;
      expect({ hex, red: s > 0.5 && max > 0.5 && (h >= 345 || h <= 15) }).toEqual({ hex, red: false });
    }
  });
});
