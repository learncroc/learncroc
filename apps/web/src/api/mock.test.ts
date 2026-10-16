import { expect, test } from "bun:test";
import { FieldNote, Logbook, RegistryView, TryBundle } from "@learncroc/core";
import { mockFieldNotes, mockLogbook, mockPack, mockRegistryView, mockResponse } from "./mock";

test("fixture content for the marketplace and the logbook is valid against the contracts", () => {
  const view = RegistryView.parse(mockRegistryView());
  expect(view.packs.map((p) => p.id)).toEqual([mockPack.manifest.id]);
  expect(view.packs[0]?.sketch.nodes.length).toBe(mockPack.map.topo.length);

  const book = Logbook.parse(mockLogbook());
  expect(book.fieldNotes.map((n) => n.nodeId).sort()).toEqual(["unit-conversion", "units"]);
  expect(book.canNow.length).toBeGreaterThan(0);
  expect(FieldNote.array().parse(mockFieldNotes())).toHaveLength(2);
});

test("mock mode answers the try bundle for the fixture and 404s other packs", () => {
  const bundle = TryBundle.parse(mockResponse("GET /registry/:id/try", { id: mockPack.manifest.id }));
  expect(bundle.manifest.id).toBe(mockPack.manifest.id);
  expect(bundle.map.nodes[bundle.node.id]?.requires ?? []).toEqual([]);
  expect(() => mockResponse("GET /registry/:id/try", { id: "nope" })).toThrow();
});
