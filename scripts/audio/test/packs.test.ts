/**
 * Content checks for packs/spanish-tapas-bar and packs/art-of-persuasion (PLAN §11.3, §12, §18).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkPack, loadPack, productionShare } from "./pack-rules";

const root = resolve(import.meta.dir, "..", "..", "..");
const spanishDir = join(root, "packs", "spanish-tapas-bar");
const persuasionDir = join(root, "packs", "art-of-persuasion");

const format = (issues: { rule: string; file: string; message: string }[]) =>
  issues.map((i) => `${i.rule} ${i.file}: ${i.message}`);

// Restored by the content-spanish-tapas-bar package once the pack is converted to cards.
describe.skip("spanish-tapas-bar", () => {
  const pack = loadPack(spanishDir);

  test("passes the content rules for the curated profile", () => {
    expect(format(checkPack(pack))).toEqual([]);
  });

  test("is a curated Castilian pack with the planned shape", () => {
    expect(pack.manifest.profile).toBe("curated");
    expect(pack.manifest.targetLang).toBe("es-ES");
    expect([...pack.nodes.keys()].sort()).toEqual(
      [
        "ar-verbs",
        "cognates",
        "gender-articles",
        "greetings",
        "gustar",
        "numbers-prices",
        "ordering",
        "questions",
        "ser-estar",
        "sounds",
      ].sort(),
    );
    expect(Object.entries(pack.map.nodes).filter(([, e]) => e.kind === "checkpoint").length).toBeGreaterThan(0);
    const planned = Object.entries(pack.map.nodes).filter(([, e]) => e.status === "planned");
    expect(planned.map(([id]) => id).sort()).toEqual(
      ["boss-valencia", "directions", "irregulars", "listening", "time-plans"].sort(),
    );
  });

  test("at least half of the items are production items", () => {
    const { production, items } = productionShare(pack);
    expect(production / items).toBeGreaterThanOrEqual(0.5);
  });

  test("uses vosotros (Castilian) somewhere in the taught material", () => {
    const all = [...pack.nodes.keys()]
      .map((id) => readFileSync(join(spanishDir, "nodes", `${id}.yaml`), "utf8"))
      .join("\n");
    expect(all).toMatch(/vosotros/);
    expect(all).toMatch(/habláis|tenéis|estáis|sois|tomáis/);
  });

  test("pronunciation screens include shadowing", () => {
    const sounds = pack.nodes.get("sounds");
    const shadow = sounds?.screens.some(
      (s) =>
        s.interaction?.kind === "widget" &&
        s.interaction.widget.id === "listen" &&
        (s.interaction.widget.props as { task?: string }).task === "shadow",
    );
    expect(shadow).toBe(true);
  });

  test("Lola's dinner dialogue survives as a transfer item with a speed dial", () => {
    const item = pack.nodes.get("greetings")?.items.find((i) => i.id === "st4-dinner");
    expect(item?.kind === "widget" && item.widget.id).toBe("dialogue");
    const props = (item?.kind === "widget" ? item.widget.props : {}) as { character?: { name: string } };
    expect(props.character?.name).toBe("Lola");
  });

  test("every figure referenced by the pack exists", () => {
    const text = [...pack.nodes.keys()]
      .map((id) => readFileSync(join(spanishDir, "nodes", `${id}.yaml`), "utf8"))
      .join("\n");
    for (const m of text.matchAll(/asset: (assets\/[^\s]+)/g))
      expect(existsSync(join(spanishDir, m[1] as string))).toBe(true);
  });
});

// Restored by the content-art-of-persuasion package once the pack is converted to cards.
describe.skip("art-of-persuasion", () => {
  const pack = loadPack(persuasionDir);

  test("passes the content rules for the sampler profile", () => {
    expect(format(checkPack(pack))).toEqual([]);
  });

  test("is a sampler: 5 playable cards and a checkpoint, the rest planned beyond it", () => {
    expect(pack.manifest.profile).toBe("sampler");
    expect([...pack.nodes.keys()].sort()).toEqual(["audience", "logos", "pathos", "pitch-structure", "story"]);
    expect(pack.map.nodes["boss-elevator"]?.kind).toBe("checkpoint");
  });

  test("influence claims carry a replication badge", () => {
    for (const id of ["audience", "story", "logos", "pathos"]) {
      const text = readFileSync(join(persuasionDir, "nodes", `${id}.yaml`), "utf8");
      expect(text, id).toMatch(/Replication:/);
    }
  });

  test("every figure referenced by the pack exists", () => {
    const text = [...pack.nodes.keys()]
      .map((id) => readFileSync(join(persuasionDir, "nodes", `${id}.yaml`), "utf8"))
      .join("\n");
    for (const m of text.matchAll(/asset: (assets\/[^\s]+)/g))
      expect(existsSync(join(persuasionDir, m[1] as string))).toBe(true);
  });
});

describe("figures follow the illustration contract (PLAN §6.5)", () => {
  const ALLOWED_ELEMENTS = new Set(["svg", "title", "desc", "g", "rect", "circle", "ellipse", "path", "line", "text"]);
  const COLOUR = /^(none|var\(--(w-[1-5]|ink|lumen|sea)\))$/;
  const svgs = [spanishDir, persuasionDir].flatMap((dir) =>
    readdirSync(join(dir, "assets", "img"))
      .filter((f) => f.endsWith(".svg"))
      .map((f) => join(dir, "assets", "img", f)),
  );

  test("there are figures to check", () => {
    expect(svgs.length).toBeGreaterThanOrEqual(15);
  });

  for (const file of svgs) {
    test(file.slice(root.length + 1), () => {
      const svg = readFileSync(file, "utf8");
      expect(svg.length).toBeLessThan(64 * 1024);
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (800 500|320 200)"/);
      expect(svg).toMatch(/<title id="t">[^<]+<\/title><desc id="d">[^<]+<\/desc>/);
      expect(svg).not.toMatch(/<!--|<\?xml|<script|<style|foreignObject|href=|\son[a-z]+=/i);
      for (const m of svg.matchAll(/<([a-zA-Z]+)[\s>]/g)) expect(ALLOWED_ELEMENTS.has(m[1] as string), m[1]).toBe(true);
      for (const m of svg.matchAll(/\s(fill|stroke)="([^"]*)"/g)) expect(m[2], `${m[1]}="${m[2]}"`).toMatch(COLOUR);
      for (const m of svg.matchAll(/font-size="(\d+)"/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(14);
      for (const m of svg.matchAll(/stroke-width="([\d.]+)"/g)) expect(m[1]).toBe("2");
      for (const m of svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g))
        expect((m[1] as string).trim().split(/\s+/).length).toBeLessThanOrEqual(4);
    });
  }
});
