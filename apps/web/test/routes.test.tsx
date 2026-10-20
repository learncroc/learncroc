import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { createAppRouter } from "../src/router";

/** Every route renders its stub screen (heading = the screen's name). */
const CASES: [path: string, name: string][] = [
  ["/", "Home"],
  ["/welcome", "Welcome"],
  ["/library", "Library"],
  ["/p/mini-pack", "Pack map"],
  ["/p/mini-pack?stop=units", "Pack map"],
  ["/p/mini-pack/run/units", "Node run"],
  ["/p/mini-pack/toy/units", "Toy"],
  ["/p/mini-pack/boss/boss-trip", "Boss"],
  ["/p/mini-pack/teach/unit-conversion", "Teach Nib"],
  ["/p/mini-pack/placement", "Find my level"],
  ["/relight", "Relight"],
  ["/relight?pack=mini-pack", "Relight"],
  ["/cards", "Cards"],
  ["/market", "Marketplace"],
  ["/market/mini-pack", "Pack detail"],
  ["/create", "Create"],
  ["/create/pocket", "Pocket map"],
  ["/create/pocket/job-1", "Surveying"],
  ["/logbook", "Logbook"],
  ["/settings", "Settings"],
  ["/settings/appearance", "Settings"],
  ["/dev/widgets", "Widget gallery"],
  ["/dev/maps", "Map gallery"],
  ["/no/such/route", "Not found"],
];

describe("routes", () => {
  for (const [path, name] of CASES) {
    test(`${path} renders "${name}"`, async () => {
      const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
      render(
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
      expect(await screen.findByRole("heading", { level: 1, name })).toBeInTheDocument();
    });
  }

  test("focus mode hides the rail on run screens", async () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/p/mini-pack/run/units"] }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { level: 1, name: "Node run" });
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });
});
