import { afterEach, describe, expect, test } from "bun:test";
import type { RegistryView, TryBundle } from "@learncroc/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockPack } from "../../api/mock";
import { type MockApi, mockApi, renderApp, sseResponse } from "../../app/testing";
import { aboutTime, megabytes } from "./index";
import { routePath, SketchPoster } from "./SketchPoster";
import { reduceInstall } from "./useInstall";

type Entry = RegistryView["packs"][number];

function entry(over: Partial<Entry> = {}): Entry {
  const { manifest, map } = mockPack;
  return {
    id: "relativity-lite",
    title: "Special relativity",
    tagline: "Why moving clocks run slow.",
    publisher: "learncroc",
    tier: "official",
    category: "science",
    tags: ["physics"],
    lang: "en",
    profile: "curated",
    review: "draft",
    customInteractives: false,
    theme: manifest.theme,
    outcomes: ["Explain why a moving clock runs slow", "Draw a light clock", "Read a spacetime diagram"],
    sketch: {
      width: map.layout.width,
      height: map.layout.height,
      nodes: Object.entries(map.layout.nodes).map(([id, p]) => ({
        id,
        x: p.x,
        y: p.y,
        line: map.nodes[id]?.line ?? "basics",
        kind: map.nodes[id]?.kind ?? "node",
        status: map.nodes[id]?.status === "planned" ? "planned" : "playable",
      })),
      edges: map.layout.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
      lines: map.lines.map((l) => ({ id: l.id, color: l.color })),
    },
    latest: "0.1.0",
    versions: [
      {
        version: "0.1.0",
        engine: ">=0.1.0",
        url: "relativity-lite-0.1.0.lmpack",
        sha256: "x",
        size: 2_600_000,
        nodes: 12,
        playable: 11,
        estMinutes: 120,
        license: "CC-BY-SA-4.0",
        published: "2026-10-01",
        tryUrl: "relativity-lite.try.json",
      },
    ],
    updateAvailable: false,
    registry: "builtin",
    ...over,
  };
}

const VIEW: RegistryView = {
  packs: [
    entry(),
    entry({ id: "mini-pack", title: "Mini pack", installed: "0.1.0" }),
    entry({
      id: "wine-basics",
      title: "Wine basics",
      tagline: "Taste five grapes.",
      tier: "community",
      publisher: "@lu",
      category: "practical",
      review: "draft",
    }),
  ],
  stale: false,
  errors: [],
};
const TRY: TryBundle = {
  manifest: mockPack.manifest,
  map: mockPack.map,
  node: Object.values(mockPack.nodes)[0] as TryBundle["node"],
};

let api: MockApi | undefined;
afterEach(() => api?.restore());

describe("helpers", () => {
  test("sizes and times", () => {
    expect(megabytes(2_600_000)).toBe("2.6 MB");
    expect(megabytes(40_000)).toBe("40 KB");
    expect(aboutTime(120)).toBe("about 2 h");
    expect(aboutTime(40)).toBe("about 40 min");
  });
  test("a sketch drawing in keeps its dashed edges dashed", () => {
    const { container } = render(<SketchPoster sketch={entry().sketch} title="Sketch" drawing />);
    const paths = [...container.querySelectorAll("path")];
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      if (p.getAttribute("stroke-dasharray")) expect(p.getAttribute("class")).toBe("lm-fade-in");
      else expect(p.getAttribute("class")).toBe("lm-draw");
    }
  });

  test("routes bend at 45°", () => {
    expect(routePath(0, 0, 100, 0)).toBe("M0 0L100 0");
    expect(routePath(0, 0, 100, 40)).toBe("M0 0L60 0L100 40");
  });
  test("install events reduce to progress", () => {
    let s = reduceInstall({ phase: "idle", progress: 0 }, { type: "resolving", id: "a" });
    s = reduceInstall(s, { type: "downloading", received: 50, total: 100 });
    expect(s).toEqual({ phase: "downloading", progress: 0.45 });
    s = reduceInstall(s, { type: "error", code: "hash_mismatch", message: "x" });
    expect(s.error).toContain("checksum");
  });
});

describe("marketplace grid", () => {
  test("Handpicked and Community posters; category filter and search", async () => {
    api = mockApi({ "GET /registry": () => VIEW });
    renderApp("/market");
    expect(await screen.findByRole("heading", { level: 1, name: "Marketplace" })).toBeInTheDocument();
    const handpicked = await screen.findByRole("region", { name: "Handpicked" });
    expect(within(handpicked).getByRole("article", { name: "Special relativity" })).toBeInTheDocument();
    expect(within(handpicked).getByRole("img", { name: /Map of Special relativity/ })).toBeInTheDocument();
    const mini = within(handpicked).getByRole("article", { name: "Mini pack" });
    expect(within(mini).getByRole("link", { name: "Open map" })).toHaveAttribute("href", "/p/mini-pack");
    expect(screen.getByRole("region", { name: "Community" })).toBeInTheDocument();
    expect(within(handpicked).getAllByText("AI-drafted, review pending").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Practical" }));
    expect(screen.queryByRole("region", { name: "Handpicked" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search packs" }), "clocks");
    expect(screen.getByRole("article", { name: "Special relativity" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Wine basics" })).toBeNull();
  });

  test("/ focuses search", async () => {
    api = mockApi({ "GET /registry": () => VIEW });
    renderApp("/market");
    await screen.findByRole("region", { name: "Handpicked" });
    await userEvent.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Search packs" })).toHaveFocus();
  });

  test("an unreachable registry is explained; cached copy noted", async () => {
    api = mockApi({
      "GET /registry": () => ({
        ...VIEW,
        stale: true,
        fetchedAt: Date.UTC(2026, 9, 17),
        errors: [{ registry: "https://example.org/index.json", message: "timed out" }],
      }),
    });
    renderApp("/market");
    expect(await screen.findByText(/Couldn't reach https:\/\/example.org\/index.json/)).toBeInTheDocument();
    expect(screen.getByText(/Using the copy from/)).toBeInTheDocument();
  });

  test("empty registries", async () => {
    api = mockApi();
    renderApp("/market");
    expect(await screen.findByRole("heading", { name: "No packs to show yet" })).toBeInTheDocument();
  });
});

describe("pack detail", () => {
  test("outcomes, stats, lines from the try bundle, draft badge", async () => {
    api = mockApi({ "GET /registry": () => VIEW, "GET /registry/:id/try": () => TRY });
    renderApp("/market/relativity-lite");
    expect(await screen.findByRole("heading", { level: 1, name: "Special relativity" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "You'll be able to" })).toBeInTheDocument();
    expect(screen.getByText("Draw a light clock")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI-drafted, review pending" })).toBeInTheDocument();
    expect(screen.getByText("2.6 MB")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Lines and stops" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Lines and stops" })).getByText("Minutes into hours"),
    ).toBeInTheDocument();
  });

  test("reviewer credits when reviewed", async () => {
    api = mockApi({
      "GET /registry": () => ({
        ...VIEW,
        packs: [entry({ review: "reviewed", reviewers: [{ name: "Ada Physicist", role: "subject expert" }] })],
      }),
      "GET /registry/:id/try": () => TRY,
    });
    renderApp("/market/relativity-lite");
    expect(await screen.findByRole("heading", { name: "Reviewed by" })).toBeInTheDocument();
    expect(screen.getByText("Ada Physicist")).toBeInTheDocument();
  });

  test("Try the first stop embeds the try-run (T works too)", async () => {
    api = mockApi({ "GET /registry": () => VIEW, "GET /registry/:id/try": () => TRY });
    renderApp("/market/relativity-lite");
    await screen.findByRole("heading", { level: 1, name: "Special relativity" });
    await userEvent.keyboard("t");
    expect(await screen.findByRole("region", { name: "Try relativity-lite" })).toBeInTheDocument();
  });

  test("Install streams progress, then offers Open map", async () => {
    api = mockApi({
      "GET /registry": () => VIEW,
      "GET /registry/:id/try": () => TRY,
      "POST /packs/install": () =>
        sseResponse([
          { type: "resolving", id: "relativity-lite" },
          { type: "downloading", received: 10, total: 10 },
          { type: "verifying" },
          { type: "extracting" },
          { type: "done", id: "relativity-lite", version: "0.1.0" },
        ]),
    });
    renderApp("/market/relativity-lite");
    await screen.findByRole("heading", { level: 1, name: "Special relativity" });
    await userEvent.click(screen.getByRole("button", { name: /^Install/ }));
    expect(await screen.findByText("Installed. Works offline from now on.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open map/ })).toHaveAttribute("href", "/p/relativity-lite");
    // The poster draws itself in as a whole (a wipe), so dashed Later/planned strokes keep their dashes.
    const drawing = document.querySelector("[data-drawing]");
    expect(drawing?.classList.contains("lm-wipe")).toBe(true);
    expect(drawing?.querySelector('[class*="lm-draw"]')).toBeNull();
    const call = api.calls.find((c) => c.key === "POST /packs/install");
    expect(call?.body).toEqual({ id: "relativity-lite", registry: "builtin" });
  });

  test("a failed install says what happened", async () => {
    api = mockApi({
      "GET /registry": () => VIEW,
      "GET /registry/:id/try": () => TRY,
      "POST /packs/install": () =>
        sseResponse([
          { type: "resolving", id: "relativity-lite" },
          { type: "error", code: "network", message: "x" },
        ]),
    });
    renderApp("/market/relativity-lite");
    await screen.findByRole("heading", { level: 1, name: "Special relativity" });
    await userEvent.keyboard("i");
    await waitFor(() => expect(screen.getAllByText(/The download failed/).length).toBeGreaterThan(0));
  });

  test("unknown pack", async () => {
    api = mockApi({ "GET /registry": () => VIEW });
    renderApp("/market/nope");
    expect(await screen.findByText(/No registry lists a pack called “nope”/)).toBeInTheDocument();
  });
});
