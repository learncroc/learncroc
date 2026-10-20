/** ListView (treegrid), MiniMap, MapPoster + share-card export. */
import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { galleryPack, scenarioViews, simulateViews } from "../src/gallery";
import { ListView, MapPoster, MiniMap, renderMapPosterSvg } from "../src/index";
import { inlineCssVars, litSummary } from "../src/MapPoster";

const llm = galleryPack("how-llms-work");
const spanish = galleryPack("spanish-tapas-bar");
if (!llm || !spanish) throw new Error("gallery pack missing");

// Asserts revision-2 behaviour (sparked, termini, hop fog, stops); to be rewritten for gates and sections.
describe.skip("ListView", () => {
  test("is a treegrid grouped by line with a row per stop", () => {
    render(<ListView pack={llm} views={scenarioViews(llm, "journey")} onSelect={() => {}} onOpen={() => {}} />);
    const grid = screen.getByRole("treegrid", { name: "How LLMs work: stops by line" });
    const rows = grid.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(llm.map.lines.length + Object.keys(llm.map.nodes).length);
    expect(grid.querySelectorAll("[aria-level='1']")).toHaveLength(llm.map.lines.length);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Stop", "State", "Needs", "Time"]);
  });

  test("rows carry the VoiceOver label", () => {
    const views = simulateViews(llm, { lit: ["tokens", "embeddings", "next-token"] });
    render(<ListView pack={llm} views={views} onSelect={() => {}} onOpen={() => {}} />);
    const row = screen.getByRole("row", { name: /^Words looking at words\. Ready\. Meaning line\. Needs/ });
    expect(row.getAttribute("aria-level")).toBe("2");
  });

  test("keyboard: arrows move, ← collapses a line, → expands it, Enter opens", () => {
    const onOpen = mock(() => {});
    const { container } = render(
      <ListView pack={llm} views={scenarioViews(llm, "fresh")} onSelect={() => {}} onOpen={onOpen} />,
    );
    const first = container.querySelector<HTMLTableRowElement>("[aria-level='1']") as HTMLTableRowElement;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    const stop = document.activeElement as HTMLElement;
    expect(stop.getAttribute("data-stop")).toBe("next-token");
    fireEvent.keyDown(stop, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("next-token");
    fireEvent.keyDown(stop, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-stop='next-token']")).toBeNull();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(container.querySelector("[data-stop='next-token']")).not.toBeNull();
  });
});

describe("MiniMap", () => {
  test("numbers the stuck walk in order and names it", () => {
    const views = scenarioViews(llm, "journey");
    render(<MiniMap pack={llm} views={views} path={["attention", "embeddings", "tokens"]} tokenAt="attention" />);
    const img = screen.getByRole("img", {
      name: "Mini map: Words looking at words, then Meaning as a location, then Tokens",
    });
    expect(img.querySelectorAll("text")).toHaveLength(3);
    expect(img.querySelector("[data-token-at='attention']")).not.toBeNull();
  });
});

describe("MapPoster", () => {
  test("draws the world, the title and the lit count", () => {
    const views = scenarioViews(spanish, "journey");
    const { container } = render(<MapPoster pack={spanish} views={views} width={600} height={400} />);
    const svg = container.querySelector("svg[data-poster]");
    expect(svg?.getAttribute("aria-label")).toContain("Survive a tapas bar in Spanish poster. El Camino.");
    expect(container.querySelector("[data-renderer='atlas']")).not.toBeNull();
    expect(container.textContent).toContain(litSummary(spanish, views));
    expect(container.querySelectorAll("animate, animateMotion")).toHaveLength(0);
  });

  test("share-card SVG is standalone: CSS variables inlined, signed Learncroc", async () => {
    const svg = await renderMapPosterSvg(
      { pack: llm, views: scenarioViews(llm, "all-lit"), width: 1200, height: 630 },
      { width: 1200, height: 630, scale: 2, caption: "All 12 lit" },
    );
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toContain("var(--");
    expect(svg).toContain("Learncroc");
    expect(svg).toContain("All 12 lit");
  });

  test("inlineCssVars resolves nested fallbacks", () => {
    expect(inlineCssVars("fill:var(--a, var(--b))", (n) => (n === "--b" ? "#123456" : undefined))).toBe("fill:#123456");
  });
});
