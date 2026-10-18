import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { diskFs, lintPack, type NodeFsPromises } from "@learncroc/core";
import { applyTemperature, widgetSpecRegistry } from "@learncroc/widgets/spec";
import { parse, stringify } from "yaml";
import { checkPack, checkSvg, defaultTargets, type Issue } from "./check";

const root = resolve(import.meta.dir, "../..");
const flagship = join(root, "packs/how-llms-work");
const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error");
const show = (issues: Issue[]) => issues.map((i) => `${i.rule} ${i.file}: ${i.message}`).join("\n");

type Json = Record<string, unknown>;
const data = (name: string): Json => JSON.parse(readFileSync(join(flagship, "data", `${name}.json`), "utf8")) as Json;
const at = (obj: unknown, ptr: string): unknown =>
  ptr
    .split("/")
    .filter(Boolean)
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
const node = (id: string): string => readFileSync(join(flagship, "nodes", `${id}.yaml`), "utf8");
/** Every string in a node file, as the learner sees it (folded scalars joined, quotes unescaped). */
const nodeText = (id: string): string => {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(parse(node(id)));
  return out.join("\n");
};
const says = (id: string, phrase: string) => {
  const found = nodeText(id).includes(phrase);
  if (!found) console.error(`nodes/${id}.yaml doesn't say: ${phrase}`);
  return found;
};
const pct = (p: unknown, digits = 1) => `${(Number(p) * 100).toFixed(digits)}%`;

/** Pocket maps are converted to cards separately: check the ones that already pass the validator, and say which wait. */
function convertedTargets(): string[] {
  return defaultTargets(root).filter((dir) => {
    if (dir === flagship) return true;
    const ok = Bun.spawnSync(["bun", join(root, "scripts/validate-pack.ts"), dir], { cwd: root }).exitCode === 0;
    if (!ok) console.warn(`content checks: skipping ${dir.split("/").at(-1)} (not yet converted to the card loop)`);
    return ok;
  });
}

describe("content checks", () => {
  const targets = convertedTargets();

  test("cover the flagship (and any pocket maps under packs/_pocket)", () => {
    expect(defaultTargets(root).map((t) => t.split("/").at(-1))).toEqual(expect.arrayContaining(["how-llms-work"]));
  });

  for (const dir of targets) {
    test(`${dir.split("/").at(-1)} has no errors`, () => {
      const issues = errors(checkPack(dir));
      if (issues.length) console.error(show(issues));
      expect(issues).toEqual([]);
    });
  }

  test("the core lint (learncroc lint's rule set) reports no errors", async () => {
    for (const dir of targets) {
      const fs = diskFs(fsp as unknown as NodeFsPromises, dir);
      const { report } = await lintPack(fs, { widgets: widgetSpecRegistry });
      const bad = report.issues.filter((i) => i.severity === "error");
      if (bad.length) console.error(bad.map((i) => `${dir} ${i.rule} ${i.file} ${i.path}: ${i.message}`).join("\n"));
      expect(bad).toEqual([]);
    }
  });

  test("the flagship passes the schema and widget validator", () => {
    const r = Bun.spawnSync(["bun", join(root, "scripts/validate-pack.ts"), ...targets, "--json"], { cwd: root });
    if (r.exitCode !== 0) console.error(r.stdout.toString());
    expect(r.exitCode).toBe(0);
  });

  test("the flagship: 11 cards in 4 sections, strawberry first, planned cards beyond the terminus", () => {
    const map = parse(readFileSync(join(flagship, "map.yaml"), "utf8")) as { nodes: Record<string, Json> };
    const entries = Object.entries(map.nodes);
    const playable = (kind: string) => entries.filter(([, n]) => n.status !== "planned" && (n.kind ?? "node") === kind);
    expect(playable("node")).toHaveLength(11);
    expect(playable("checkpoint").map(([id]) => id)).toEqual(["cp-text-in", "cp-loop", "cp-core", "cp-learned"]);
    expect(entries[0]?.[0]).toBe("tokens");
    expect(readdirSync(flagship)).not.toContain("bosses");
    const planned = entries.filter(([, n]) => n.status === "planned").map(([id]) => id);
    expect(planned).toEqual(["post-training", "prompting", "grounding", "cp-support-bot"]);
    for (const [id] of playable("node")) {
      const n = parse(node(id)) as Json;
      expect((n.items as unknown[]).length).toBeGreaterThanOrEqual(6);
      expect(n.status).toBe("draft");
      expect(((n.close as Json).teaser as string).endsWith("?")).toBe(true);
    }
    const tokens = parse(node("tokens")) as Json;
    expect(((tokens.hook as Json).interaction as Json).prompt).toContain("strawberry");
    const split = ((tokens.screens as Json[])[0] as Json).interaction as Json;
    expect(((split.widget as Json).goal as Json).kind).toBe("split");
  });

  test("no guides or bosses in the flagship's words", () => {
    const text = [readFileSync(join(flagship, "README.md"), "utf8"), readFileSync(join(flagship, "pack.yaml"), "utf8")]
      .concat(readdirSync(join(flagship, "nodes")).map((f) => readFileSync(join(flagship, "nodes", f), "utf8")))
      .join("\n");
    expect(text).not.toMatch(/\bTok\b|\bNib\b|\bboss|Run the Machine/i);
  });
});

describe("the checker catches problems", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lm-check-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function mutated(name: string, edit: (dir: string) => void): Issue[] {
    const dir = join(tmp, name, "how-llms-work");
    cpSync(flagship, dir, { recursive: true });
    edit(dir);
    return errors(checkPack(dir));
  }
  const editYaml = (file: string, f: (v: Json) => void) => {
    const v = parse(readFileSync(file, "utf8")) as Json;
    f(v);
    writeFileSync(file, stringify(v));
  };

  test("a reveal over 50 words", () => {
    const issues = mutated("long-reveal", (dir) =>
      editYaml(join(dir, "nodes/tokens.yaml"), (v) => {
        const s = (v.screens as Json[])[1] as Json;
        s.reveal = { text: Array.from({ length: 130 }, () => "word").join(" ") };
      }),
    );
    expect(issues.some((i) => i.rule === "L001" && i.message.includes("s2-shatter"))).toBe(true);
  });

  test("too many choice items and a True/False item", () => {
    const issues = mutated("choices", (dir) =>
      editYaml(join(dir, "nodes/sampling.yaml"), (v) => {
        const items = v.items as Json[];
        items.push(
          ...[1, 2, 3, 4].map((k) => ({
            id: `tf${k}`,
            kind: "choice",
            level: "recall",
            difficulty: 1,
            prompt: "Is it so?",
            options: [
              { id: "t", text: "True" },
              { id: "f", text: "False" },
            ],
            answer: "t",
          })),
        );
      }),
    );
    expect(issues.map((i) => i.rule)).toEqual(expect.arrayContaining(["L018"]));
    expect(issues.some((i) => i.message.includes("True/False"))).toBe(true);
  });

  test("a misconception routed to a node that isn't an ancestor", () => {
    const issues = mutated("upstream", (dir) =>
      editYaml(join(dir, "nodes/tokens.yaml"), (v) => {
        ((v.misconceptions as Json).letters as Json).upstream = "attention";
      }),
    );
    expect(issues.some((i) => i.rule === "L008")).toBe(true);
  });

  test("a parametric item whose answer doesn't match its expression", () => {
    const issues = mutated("params", (dir) =>
      editYaml(join(dir, "nodes/next-token.yaml"), (v) => {
        const it = (v.items as Json[]).find((x) => x.id === "i2") as Json;
        it.answer = 301;
      }),
    );
    expect(issues.some((i) => i.rule === "L009" && i.message.includes("i2"))).toBe(true);
  });

  test("a close that never names a wrong guess, and a section with no callback item", () => {
    const issues = mutated("loop", (dir) =>
      editYaml(join(dir, "nodes/tokens.yaml"), (v) => {
        delete ((v.close as Json).byGuess as Json).whole;
        for (const it of v.items as Json[]) delete it.callback;
      }),
    );
    expect(issues.some((i) => i.rule === "L023" && i.message.includes('"whole"'))).toBe(true);
    expect(issues.some((i) => i.rule === "callback")).toBe(true);
  });

  test("a precomputed widget without a $data reference", () => {
    const issues = mutated("numbers", (dir) =>
      editYaml(join(dir, "nodes/sampling.yaml"), (v) => {
        const toy = v.toy as Json;
        ((toy.widget as Json).props as Json).tokens = [{ text: "blue", p: 0.5 }];
        ((toy.widget as Json).props as Json).context = "typed by hand";
        ((toy.widget as Json).props as Json).samples = [];
      }),
    );
    expect(issues.some((i) => i.rule === "numbers")).toBe(true);
  });

  test("an exclamation mark in learner-facing text", () => {
    const issues = mutated("voice", (dir) =>
      editYaml(join(dir, "nodes/attention.yaml"), (v) => {
        (v.close as Json).text = "Robbed. Amazing!";
      }),
    );
    expect(issues.some((i) => i.rule === "voice")).toBe(true);
  });

  test("the illustration contract for SVGs", () => {
    const ok = readFileSync(join(flagship, "assets/img/loop.svg"), "utf8");
    expect(checkSvg(ok)).toEqual([]);
    const bad =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="#ff0000" onclick="x()"/><text font-size="10">far too many words here</text></svg>';
    const problems = checkSvg(bad).join("\n");
    expect(problems).toContain("viewBox");
    expect(problems).toContain("<title>");
    expect(problems).toContain("event handlers");
    expect(problems).toContain("theme variables");
    expect(problems).toContain("14 px");
    expect(problems).toContain("4 words");
  });
});

describe("numbers quoted in the text match the precomputed data", () => {
  const nt = data("next-token");
  const sm = data("sampling");
  const ha = data("hallucination");
  const pt = data("pretraining");
  const em = data("embeddings");
  const tr = data("traces");

  test("every data file names GPT-2 small and the script version", () => {
    for (const d of [nt, sm, ha, pt, em, tr]) {
      const meta = d.meta as Json;
      expect(meta.model).toBe("gpt2");
      expect(meta.script).toBe("scripts/precompute@1");
      expect(meta.parameters).toBe(124439808);
      expect(meta.vocabSize).toBe(50257);
    }
  });

  test("next-token: the cat on the floor, the loop, and the milk ranking item", () => {
    const cat = at(nt, "catSat/tokens") as { text: string; p: number }[];
    const p = Object.fromEntries(cat.map((t) => [t.text, t.p]));
    expect(says("next-token", `floor ${pct(p.floor)}, bed ${pct(p.bed)}, mat ${pct(p.mat)}`)).toBe(true);
    // Run 1 reads loopStart (the widget's own props); run i + 1 reads loop.steps[i - 1].
    expect(at(nt, "loopStart/context")).toBe(at(nt, "catSat/context"));
    expect(at(nt, "loopStart/tokens/0/text")).toBe("floor");
    expect(at(nt, "loop/steps/0/tokens/0/text")).toBe(",");
    expect(at(nt, "loop/steps/1/tokens/0/text")).toBe("and");
    expect(at(nt, "loop/steps/1/context")).toBe("The cat sat on the floor,");
    expect(node("next-token")).toContain('appended: ["floor", ",", "and"]');
    const milk = [...(at(nt, "coldOpen/tokens") as { text: string; p: number }[])].sort((a, b) => b.p - a.p);
    expect(node("next-token")).toContain(`ranking: [${milk.map((t) => t.text).join(", ")}]`);
    expect(at(nt, "coldOpen/top/0/text")).toBe("mouth");
    expect(says("next-token", `top pick overall was mouth, at ${pct(at(nt, "coldOpen/top/0/p"), 0)}`)).toBe(true);
  });

  test("sampling: blue at 5.1%, the ten rolls, and the colder bars", () => {
    const tokens = at(sm, "colour/tokens") as { text: string; p: number }[];
    const blue = tokens.find((t) => t.text === "blue");
    expect(pct(blue?.p)).toBe("5.1%");
    const rolls = (at(sm, "colour/samples") as { temperature: number; outputs: string[] }[]).find(
      (s) => s.temperature === 1,
    )?.outputs;
    expect(says("sampling", `began: ${rolls?.slice(0, 6).join(", ")}`)).toBe(true);
    expect(Number(at(sm, "colour/byTemperature/0.1/0/p"))).toBeGreaterThan(0.99);
  });

  test("Australia: Sydney 22% beats Canberra 4%, ten times out of ten when cold", () => {
    const t = Object.fromEntries(
      (at(sm, "australia/tokens") as { text: string; p: number }[]).map((x) => [x.text, x.p]),
    );
    expect(pct(t.Sydney, 0)).toBe("22%");
    expect(pct(t.Canberra, 0)).toBe("4%");
    expect(says("pretraining", "gets 22% as Australia's capital; real Canberra 4%")).toBe(true);
    expect(says("hallucination", "Sydney 21.6% and Canberra 4.4%")).toBe(true);
    const cold = (at(sm, "australia/samples") as { temperature: number; outputs: string[] }[])[0];
    expect(cold?.temperature).toBe(0.1);
    expect(cold?.outputs.every((o) => o === "Sydney")).toBe(true);
    expect(cold?.outputs).toHaveLength(10);
  });

  test("hallucination: Everest over Kilimanjaro, Einstein in 1776", () => {
    const ev = at(ha, "everest/tokens") as { text: string; p: number }[];
    expect(ev[0]?.text).toBe("Everest");
    expect(pct(ev[0]?.p)).toBe("7.4%");
    expect(ev[1]?.text).toBe("Kil");
    expect(pct(ev[1]?.p)).toBe("6.8%");
    const greedy = at(ha, "greedy") as { context: string; continuation: string }[];
    expect(greedy.find((g) => g.context.includes("Einstein"))?.continuation.startsWith("1776")).toBe(true);
    expect(says("hallucination", "it writes 1776")).toBe(true);
  });

  test("pretraining: oxygen 46%, helium 28%, and a base model continuing a Q&A", () => {
    const w = Object.fromEntries((at(pt, "water/tokens") as { text: string; p: number }[]).map((x) => [x.text, x.p]));
    expect(pct(w.oxygen, 0)).toBe("46%");
    expect(pct(w.helium, 0)).toBe("28%");
    expect(String(at(pt, "qa/continuation"))).toMatch(/^ The capital of France is Paris\.\nQ:/);
    expect(says("pretraining", `46% on "oxygen" (and, oddly, 28% on "helium")`)).toBe(true);
    expect(says("neural-nets", "124,439,808")).toBe(true);
  });

  test("embeddings: cosines, neighbours, the analogy and placement targets", () => {
    expect(at(em, "catCompare/dog")).toBeCloseTo(0.55, 2);
    expect(at(em, "catCompare/cap")).toBeCloseTo(0.26, 2);
    expect(at(em, "analogy/ranked/0")).toEqual(["queen", expect.closeTo(0.71, 2)]);
    expect(at(em, "analogy/ranked/1")).toEqual(["prince", expect.closeTo(0.48, 2)]);
    expect(at(em, "nearest/bank")).toEqual(["loan", "cash", "river"]);
    expect(says("embeddings", "cosine similarity 0.55 with *dog*, against 0.26 for *cap*")).toBe(true);
    expect(says("embeddings", "queen, cosine 0.71, well ahead of prince at 0.48")).toBe(true);
    expect(says("embeddings", "loan, cash, then river")).toBe(true);
    expect(at(em, "nearest/cat/0")).toBe("dog");
    expect(at(em, "projection/nearestNeighbourAgreement")).toBe("24/25");
    expect(at(em, "projection/analogyHoldsOnMap")).toBe(true);
    const points = at(em, "points") as { id: string }[];
    // nodes/embeddings.yaml points at these indices for the placement solution
    expect([1, 21, 6, 16].map((i) => points[i]?.id)).toEqual(["dog", "queen", "cheese", "lake"]);
  });

  test("transformer: the logit-lens guesses quoted on the stop", () => {
    const inputs = at(tr, "inputs") as { id: string; lens: { block: number; pick: string }[] }[];
    const lens = (id: string) =>
      Object.fromEntries((inputs.find((i) => i.id === id)?.lens ?? []).map((l) => [l.block, l.pick]));
    const peanut = lens("peanut");
    expect([peanut[4], peanut[8], peanut[12]]).toEqual(["then", "cheese", "jelly"]);
    expect(says("transformer", 'Block 4 said "then", block 8 "cheese", block 12 "jelly"')).toBe(true);
    const water = lens("water");
    expect([water[6], water[10], water[12]]).toEqual(["then", "hydrogen", "oxygen"]);
    expect(inputs.map((i) => i.id)).toEqual(["cat", "milk", "peanut", "water", "once", "everest"]);
  });

  test("temperature goals only accept settings where the claim on screen is true", () => {
    // The widget reshapes the listed bars (plus "everything else") at the dial's temperature.
    const goalRange = (file: string, marker: string): [number, number] => {
      const text = readFileSync(join(flagship, file), "utf8");
      const from = text.indexOf(marker);
      const m = /range: \[([\d.]+), ([\d.]+)\]/.exec(text.slice(from));
      if (from < 0 || !m) throw new Error(`no temperature goal after ${marker} in ${file}`);
      return [Number(m[1]), Number(m[2])];
    };
    // Sampling item i12: "until floor takes most of the rolls" (more than half, at every accepted setting).
    const cat = at(nt, "catSat/tokens") as { text: string; p: number }[];
    const [, itemHi] = goalRange("nodes/sampling.yaml", "id: i12");
    expect(cat[0]?.text).toBe("floor");
    expect(applyTemperature(cat, itemHi)[0]).toBeGreaterThan(0.5);
    // ...while bed still steals some, as the reveal says.
    expect(applyTemperature(cat, 0.1)[1]).toBeGreaterThan(0.05);
    // Sampling s2: "until one bar takes almost everything".
    const colour = at(sm, "colour/tokens") as { text: string; p: number }[];
    const [, hi] = goalRange("nodes/sampling.yaml", "id: s2-temperature");
    expect(applyTemperature(colour, hi)[0]).toBeGreaterThan(0.85);
  });

  test("traces name the attention sink before the strongest link", () => {
    const inputs = at(tr, "inputs") as { attention: { firstTokenShare: number }; steps: { attention: string } }[];
    for (const i of inputs) {
      expect(i.steps.attention).toContain(`after the ${Math.round(i.attention.firstTokenShare * 100)}% parked on`);
    }
  });
});
