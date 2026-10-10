/**
 * Fixture helpers: the mini-pack as in-memory files (editable), its compiled pack.json, a builder for
 * small card-shaped packs with checkpoints, and a controllable clock.
 *
 * The mini-pack (community profile): units → unit-conversion → checkpoint-basics → speed →
 * checkpoint-trip, then the planned average-speed beyond the final checkpoint.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseDocument, stringify } from "yaml";
import packJson from "../../fixtures/mini-pack/pack.json";
import {
  type Clock,
  CompiledPack,
  compilePack,
  type MapNodeEntry,
  memoryFs,
  type PackFs,
  type PackNode,
} from "../../src/index";
import { MINI_PACK_DIR } from "./fs";

export type Files = Record<string, string | Uint8Array>;

function readDir(dir: string, root = dir, out: Files = {}): Files {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readDir(p, root, out);
    else {
      const rel = relative(root, p).split("\\").join("/");
      out[rel] =
        /\.(ya?ml|json|svg|html|md)$/.test(name) || name === "LICENSE"
          ? readFileSync(p, "utf8")
          : new Uint8Array(readFileSync(p));
    }
  }
  return out;
}

/** The mini-pack sources as editable in-memory files (pack.json, the compiled output, is left out). */
export function fixtureFiles(): Files {
  const files = readDir(MINI_PACK_DIR);
  delete files["pack.json"];
  return files;
}

/** Parse a YAML file of the set, let `fn` mutate the value, write it back (comments dropped). */
export function editYaml<T = Record<string, unknown>>(files: Files, path: string, fn: (v: T) => void): Files {
  const text = files[path];
  if (typeof text !== "string") throw new Error(`no YAML file ${path}`);
  const v = parseDocument(text).toJS() as T;
  fn(v);
  return { ...files, [path]: stringify(v, { lineWidth: 0 }) };
}

/** A lint-clean variant of the mini-pack (community profile): the fixture plus a picture on every
 * beat that has none and tagged distractors. */
export function cleanFiles(): Files {
  let files = fixtureFiles();
  const figure = { kind: "figure", asset: "assets/img/clock-and-road.svg", alt: "A clock face beside a road." };
  for (const id of ["units", "speed", "unit-conversion"]) {
    files = editYaml<{ screens: Record<string, unknown>[] }>(files, `nodes/${id}.yaml`, (n) => {
      for (const s of n.screens)
        if (!s.visual && (s.interaction as { kind?: string } | undefined)?.kind !== "widget") s.visual = figure;
    });
  }
  // Tag the two untagged distractors so the clean pack has no warnings either.
  files = editYaml<{
    hook: { interaction: { options: Record<string, unknown>[] } };
    items: { options?: Record<string, unknown>[] }[];
  }>(files, "nodes/speed.yaml", (n) => {
    const a = n.hook.interaction.options.find((o) => o.id === "a");
    if (a) a.misconception = "multiply";
    const slower = n.items[1]?.options?.find((o) => o.id === "slower");
    if (slower) slower.misconception = "speed-is-distance";
  });
  return files;
}

// ── a builder for small card-shaped packs

/**
 * A valid card (community and curated shape): a choice hook with options a/b/c (b is right), two beats
 * (s1 with a numeric action, s2 read-only), a close with byGuess for a, c and idk, and 6 items
 * (3 transfer; i1–i5 checkpoint-eligible, i6 recall). Override any field.
 */
export function testCard(id: string, over: Partial<PackNode> = {}): PackNode {
  const figure = { kind: "figure" as const, asset: "assets/img/clock-and-road.svg", alt: "A clock beside a road." };
  const num = (i: number, level: "recall" | "apply" | "transfer") => ({
    id: `i${i}`,
    kind: "numeric" as const,
    level,
    difficulty: 3 as const,
    prompt: `What is ${i} plus ${i}?`,
    answer: i * 2,
    tolerance: 0,
  });
  return {
    id,
    title: `Card ${id}`,
    estMinutes: 3,
    bigIdea: "A test card.",
    objectives: ["Pass the tests"],
    visual: figure,
    misconceptions: {
      off: { label: "Thinks the first option is right", hint: "Look again at what the question asks." },
    },
    hook: {
      blocks: [{ type: "story", text: "Three doors, one prize. You get one pick and no second look." }],
      interaction: {
        kind: "choice",
        id: "hook-q",
        prompt: "Which of these three options is the right one to pick here?",
        options: [
          { id: "a", text: "Option A", misconception: "off" },
          { id: "b", text: "Option B" },
          { id: "c", text: "Option C", misconception: "off" },
        ],
        answer: "b",
      },
    },
    screens: [
      {
        id: "s1",
        blocks: [
          { type: "story", text: "Here is the first idea, told in a short story with a few more words to read." },
        ],
        interaction: { kind: "numeric", id: "s1-q", prompt: "What is two plus two?", answer: 4, tolerance: 0 },
        reveal: { text: "Four. Two and two make four." },
      },
      {
        id: "s2",
        blocks: [
          {
            type: "story",
            text: "Here is the second idea, a read-only beat that explains why the right option was B and not the others. It takes a few sentences, because a beat teaches before it asks.",
          },
        ],
      },
    ],
    close: {
      text: "B is right. The close answers the hook in a sentence or two and names {guess} when it can.",
      byGuess: {
        a: "You picked *Option A*. Lots of people do. B is right because the question asks for B.",
        c: "You picked *Option C*. B is right because the question asks for B.",
        idk: "No guess is fine. B is right because the question asks for B.",
      },
      teaser: "So what comes after B?",
    },
    items: [
      num(1, "apply"),
      num(2, "apply"),
      num(3, "transfer"),
      num(4, "transfer"),
      num(5, "transfer"),
      num(6, "recall"),
    ],
    sources: [],
    status: "draft",
    ...over,
  };
}

export interface PackSpec {
  /** map.yaml entries in reading order (default line "main"). Entries without a card get one from testCard. */
  map: Record<string, Partial<MapNodeEntry> & { requires: string[] }>;
  /** Cards by id (default: testCard(id) for every playable node-kind entry). */
  cards?: Record<string, PackNode>;
  profile?: "curated" | "sampler" | "community" | "pocket";
}

/** In-memory sources for a small pack: the mini-pack manifest, one line, and the given map and cards. */
export function packFiles(spec: PackSpec): Files {
  const base = fixtureFiles();
  const files: Files = {
    LICENSE: base.LICENSE ?? "",
    "assets/img/clock-and-road.svg": base["assets/img/clock-and-road.svg"] ?? "",
  };
  const manifest = parseDocument(String(base["pack.yaml"])).toJS() as Record<string, unknown>;
  manifest.id = "test-pack";
  manifest.profile = spec.profile ?? "community";
  manifest.entry = {};
  delete (manifest.theme as Record<string, unknown>).landmarks;
  files["pack.yaml"] = stringify(manifest, { lineWidth: 0 });
  const nodes: Record<string, MapNodeEntry> = {};
  for (const [id, e] of Object.entries(spec.map)) nodes[id] = { line: "main", ...e };
  files["map.yaml"] = stringify(
    { lines: [{ id: "main", title: "Main", color: 1, outcome: "Pass the tests" }], nodes },
    { lineWidth: 0 },
  );
  for (const [id, e] of Object.entries(nodes)) {
    if ((e.kind ?? "node") !== "node" || e.status === "planned") continue;
    files[`nodes/${id}.yaml`] = stringify(spec.cards?.[id] ?? testCard(id), { lineWidth: 0 });
  }
  return files;
}

/** Compile a small pack (throws on compile errors). */
export async function buildPack(spec: PackSpec): Promise<CompiledPack> {
  const { pack, issues } = await compilePack(memoryFs(packFiles(spec)), { at: "2026-10-20T00:00:00Z" });
  if (!pack) throw new Error(issues.map((i) => `${i.file} ${i.path} ${i.message}`).join("\n"));
  return pack;
}

export const fsOf = (files: Files): PackFs => memoryFs(files);

/** The compiled fixture pack (fixtures/mini-pack/pack.json), validated. */
export function fixturePack(): CompiledPack {
  return CompiledPack.parse(structuredClone(packJson));
}

/** A clock tests move by hand. */
export function testClock(
  start = Date.UTC(2026, 9, 20, 9, 0, 0),
): Clock & { set(t: number): void; advance(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    set: (x) => {
      t = x;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

export const DAY = 86_400_000;
