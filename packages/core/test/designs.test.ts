import { describe, expect, test } from "bun:test";
import {
  applyMapDesign,
  designTheme,
  MAP_DESIGNS,
  MapDesignId,
  ownMapDesign,
  type PackTheme,
  PackTheme as PackThemeSchema,
  suggestMapDesign,
  withMapDesign,
} from "../src/index";

const authored: PackTheme = {
  renderer: "circuit",
  world: "The Machine",
  mode: "dark",
  direction: "lr",
  ground: "#0E1A1F",
  texture: "pcb",
  lines: ["#6CC4FF", "#C59BFF", "#FF8FC2", "#A6E36F", "#E9E4D6"],
  token: "electron",
  landmarks: { gate: { name: "The core" } },
  gateName: "Power check",
};

const oldPocket: PackTheme = {
  renderer: "sketchbook",
  world: "Agents",
  mode: "light",
  direction: "lr",
  ground: "#F7F4EE",
  texture: "paper",
  lines: ["#111111", "#222222", "#333333", "#444444", "#555555"],
  token: "paper-plane",
  backdrop: "sketchbook",
};

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe("map designs", () => {
  test("every design id has exactly one preset, and every preset is a valid theme", () => {
    expect(MAP_DESIGNS.map((d) => d.id).sort()).toEqual([...MapDesignId.options].sort());
    for (const d of MAP_DESIGNS)
      expect(PackThemeSchema.safeParse(designTheme(d.id, { world: "W" })).success).toBe(true);
  });

  test("every path colour reads on its ground (≥ 3:1)", () => {
    for (const d of MAP_DESIGNS) {
      for (const line of d.look.lines) expect(contrast(line, d.look.ground)).toBeGreaterThanOrEqual(3);
    }
  });

  test("a design keeps the map's world, landmarks and gate name", () => {
    const t = applyMapDesign(authored, "pond");
    expect(t.renderer).toBe("trail");
    expect(t.design).toBe("pond");
    expect(t.world).toBe("The Machine");
    expect(t.landmarks).toEqual(authored.landmarks);
    expect(t.gateName).toBe("Power check");
  });

  test("original, no pick, or the design a map already wears leave its theme alone", () => {
    expect(applyMapDesign(authored, undefined)).toBe(authored);
    expect(applyMapDesign(authored, "original")).toBe(authored);
    expect(ownMapDesign(oldPocket)).toBe("paper");
    expect(applyMapDesign(oldPocket, "paper")).toBe(oldPocket);
    expect(ownMapDesign(authored)).toBeUndefined();
  });

  test("withMapDesign returns the same object for the same pack and pick", () => {
    const pack = { manifest: { theme: authored } };
    expect(withMapDesign(pack, undefined)).toBe(pack);
    const a = withMapDesign(pack, "atlas");
    expect(a).not.toBe(pack);
    expect(withMapDesign(pack, "atlas")).toBe(a);
    expect(a.manifest.theme.renderer).toBe("atlas");
  });

  test("new maps get Pond trail unless the title or gist points elsewhere", () => {
    expect(suggestMapDesign("OAuth 2.0 in one evening", "Why apps never see your password")).toBe("pond");
    expect(suggestMapDesign("How LLMs work", "Tokens, embeddings and the transformer")).toBe("circuit");
    expect(suggestMapDesign("How DNS finds a server", "Routing a request across the network")).toBe("metro");
    expect(suggestMapDesign("A short history of the Silk Road", "Trade, travel and empire")).toBe("atlas");
    expect(suggestMapDesign("Writing a persuasive essay")).toBe("paper");
  });
});
