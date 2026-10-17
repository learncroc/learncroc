import { afterEach, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import { type MockApi, mockApi, renderApp } from "../../app/testing";

let api: MockApi | undefined;
afterEach(() => api?.restore());

test("/dev/maps shows each renderer with every state, and every world as a poster", async () => {
  api = mockApi();
  const { container } = renderApp("/dev/maps");
  expect(await screen.findByRole("heading", { level: 1, name: "Map gallery" })).toBeInTheDocument();
  for (const r of ["metro", "circuit", "atlas", "sketchbook"]) {
    expect(container.querySelector(`[data-map="states-${r}"]`)).not.toBeNull();
  }
  expect(container.querySelectorAll("svg[data-poster]").length).toBeGreaterThanOrEqual(15);
  expect(container.querySelector("[data-collisions='0']")).not.toBeNull();
  expect(screen.getByRole("treegrid")).toBeInTheDocument();
});
