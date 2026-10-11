import { describe, expect, test } from "bun:test";
import { type LintIssue, type LintProfile, lintFix, lintPack, RULE_IDS, RULES, type RuleInfo } from "../src/index";
import { cleanFiles, editYaml, type Files, fixtureFiles, fsOf } from "./support/pack";
import { fakeWidgets } from "./support/widgets";

type Obj = Record<string, unknown>;
// biome-ignore lint/suspicious/noExplicitAny: test fixtures are edited as loose YAML values.
type Loose = any;

const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");

async function lint(files: Files, profile?: LintProfile, extra: { sanitizeSvg?: (s: string) => string } = {}) {
  return (await lintPack(fsOf(files), { widgets: fakeWidgets, ...(profile ? { profile } : {}), ...extra })).report;
}

const node = (files: Files, id: string, fn: (n: Loose) => void) => editYaml<Loose>(files, `nodes/${id}.yaml`, fn);
const has = (issues: LintIssue[], rule: string, severity?: "error" | "warn") =>
  issues.some((i) => i.rule === rule && (severity === undefined || i.severity === severity));

interface Case {
  rule: string;
  name: string;
  bad: (f: Files) => Files;
  profile?: LintProfile;
  severity?: "error" | "warn";
}

const HTML_OK = "<div id=a></div><script>document.getElementById('a').onclick=()=>lm.report(3)</script>";

const CASES: Case[] = [
  {
    rule: "L001",
    name: "beat over 300 words",
    bad: (f) =>
      node(f, "units", (n) => {
        n.screens[0].blocks[0].text = words(301);
      }),
  },
  {
    rule: "L001",
    name: "hook over 30 words",
    bad: (f) =>
      node(f, "units", (n) => {
        n.hook.blocks[0].text = words(31);
      }),
  },
  {
    rule: "L001",
    name: "a byGuess close over 60 words",
    bad: (f) =>
      node(f, "units", (n) => {
        n.close.byGuess.minutes = words(61);
      }),
  },
  {
    rule: "L001b",
    name: "card under 100 words",
    bad: (f) =>
      node(f, "units", (n) => {
        n.hook.blocks = [];
        for (const s of n.screens) s.blocks = [];
      }),
  },
  {
    rule: "L001b",
    name: "card over 800 words",
    bad: (f) =>
      node(f, "units", (n) => {
        for (const s of n.screens) s.blocks = [{ type: "story", text: words(280) }];
      }),
  },
  {
    rule: "L002",
    name: "flashcard front over 20 words",
    bad: (f) =>
      node(f, "units", (n) => {
        n.flashcards = [{ id: "c1", kind: "qa", front: words(21), back: "x" }];
      }),
  },
  {
    rule: "L006",
    name: "one beat",
    bad: (f) =>
      node(f, "units", (n) => {
        n.screens = [n.screens[0]];
      }),
  },
  {
    rule: "L006",
    name: "no beat has an action",
    bad: (f) =>
      node(f, "units", (n) => {
        for (const s of n.screens) {
          delete s.interaction;
          delete s.reveal;
        }
      }),
  },
  {
    rule: "L006",
    name: "a reveal without an interaction",
    bad: (f) =>
      node(f, "units", (n) => {
        delete n.screens[1].interaction;
      }),
  },
  {
    rule: "L006",
    name: "two read-only beats",
    severity: "warn",
    bad: (f) =>
      node(f, "units", (n) => {
        for (const s of n.screens.slice(1)) {
          delete s.interaction;
          delete s.reveal;
        }
      }),
  },
  {
    rule: "L011",
    name: "too few transfer items",
    bad: (f) =>
      node(f, "units", (n) => {
        for (const i of n.items) i.level = "apply";
      }),
  },
  {
    rule: "L021",
    name: "audio without rendered src in a curated language pack (device voice: warning)",
    profile: "curated",
    severity: "warn",
    bad: (f) =>
      node(
        editYaml<Loose>(f, "pack.yaml", (m) => {
          m.targetLang = "es-ES";
        }),
        "units",
        (n) => {
          n.screens[0].blocks.push({ type: "audio", tts: { text: "dos", lang: "es-ES" }, transcript: "dos" });
        },
      ),
  },
  {
    rule: "L023",
    name: "empty teaser",
    bad: (f) =>
      node(f, "units", (n) => {
        n.close.teaser = "";
      }),
  },
  {
    rule: "L023",
    name: "a byGuess key the hook doesn't allow",
    bad: (f) =>
      node(f, "units", (n) => {
        n.close.byGuess.under = "Too low.";
      }),
  },
  {
    rule: "L023",
    name: "{guess} in the close text without byGuess.idk",
    bad: (f) =>
      node(f, "units", (n) => {
        n.close.text = "You said {guess}.";
        delete n.close.byGuess.idk;
      }),
  },
  {
    rule: "L024",
    name: "a card no checkpoint covers",
    bad: (f) =>
      editYaml<Loose>(f, "map.yaml", (m) => {
        delete m.nodes["checkpoint-trip"];
        m.nodes["average-speed"].requires = ["speed"];
      }),
  },
  {
    rule: "L024",
    name: "covers on a card entry",
    bad: (f) =>
      editYaml<Loose>(f, "map.yaml", (m) => {
        m.nodes.speed.covers = ["units"];
      }),
  },
  {
    rule: "L000",
    name: "schema error",
    bad: (f) =>
      node(f, "units", (n) => {
        n.estMinutes = "soon";
      }),
  },
  {
    rule: "L001",
    name: "prompt over 40 words",
    bad: (f) =>
      node(f, "units", (n) => {
        n.screens[1].interaction.prompt = words(41);
      }),
  },
  {
    rule: "L001",
    name: "reveal over 50 words",
    bad: (f) =>
      node(f, "units", (n) => {
        n.screens[1].reveal.text = words(51);
      }),
  },
  {
    rule: "L002",
    name: "feedbackRight over 20 words",
    bad: (f) =>
      node(f, "units", (n) => {
        n.screens[0].interaction.feedbackRight = words(21);
      }),
  },
  {
    rule: "L002",
    name: "misconception hint over 30 words",
    bad: (f) =>
      node(f, "units", (n) => {
        n.misconceptions["bigger-number"].hint = words(31);
      }),
  },
  {
    rule: "L003",
    name: "a continue option",
    bad: (f) =>
      node(f, "units", (n) => {
        n.screens[2].interaction.options[2].text = "Continue";
      }),
  },
  { rule: "L004", name: "a screen without a visual", bad: () => fixtureFiles() },
  {
    rule: "L004",
    name: "empty alt text",
    bad: (f) =>
      node(f, "units", (n) => {
        n.hook.visual.alt = "";
      }),
  },
  {
    rule: "L005",
    name: "the hook prompt gives the answer",
    bad: (f) =>
      node(f, "speed", (n) => {
        n.hook.interaction.prompt = "Both have the same speed. Which is faster?";
      }),
  },
  {
    rule: "L005",
    name: "a definition hook",
    severity: "warn",
    bad: (f) =>
      node(f, "units", (n) => {
        n.hook.interaction.prompt = "What is a unit?";
      }),
  },
  {
    rule: "L007",
    name: "a planned stop blocks a playable one",
    bad: (f) =>
      editYaml<Loose>(f, "map.yaml", (m) => {
        m.nodes.future = { requires: [], line: "motion", status: "planned", title: "Future", teaser: "Later?" };
        m.nodes.speed.requires = ["future"];
      }),
  },
  {
    rule: "L007",
    name: "in-degree over 4",
    bad: (f) =>
      editYaml<Loose>(f, "map.yaml", (m) => {
        for (const id of ["q1", "q2", "q3"])
          m.nodes[id] = { requires: [], line: "motion", status: "planned", title: id, teaser: "?" };
        m.nodes.q5 = {
          requires: ["units", "speed", "q1", "q2", "q3"],
          line: "motion",
          status: "planned",
          title: "q5",
          teaser: "?",
        };
      }),
  },
  {
    rule: "L007",
    name: "sampler: planned stops only beyond the terminus",
    profile: "sampler",
    bad: (f) =>
      editYaml<Loose>(f, "map.yaml", (m) => {
        m.nodes.side = { requires: ["units"], line: "basics", status: "planned", title: "Side", teaser: "?" };
      }),
  },
  {
    rule: "L008",
    name: "upstream isn't an ancestor",
    bad: (f) =>
      node(f, "units", (n) => {
        n.misconceptions["bigger-number"].upstream = "speed";
      }),
  },
  {
    rule: "L008",
    name: "unknown misconception id",
    bad: (f) =>
      node(f, "units", (n) => {
        n.items[0].options[0].misconception = "nope";
      }),
  },
  {
    rule: "L009",
    name: "choice answer not an option",
    bad: (f) =>
      node(f, "units", (n) => {
        n.items[0].answer = "furlong";
      }),
  },
  {
    rule: "L009",
    name: "order answer not a permutation",
    bad: (f) =>
      node(f, "units", (n) => {
        n.items[3].answer = [0, 0, 1, 2];
      }),
  },
  {
    rule: "L009",
    name: "widget solution doesn't grade correct",
    bad: (f) =>
      node(f, "unit-conversion", (n) => {
        n.screens[0].interaction.solution = { params: { m: 10 } };
      }),
  },
  {
    rule: "L009",
    name: "parametric answer mismatch",
    bad: (f) =>
      node(f, "units", (n) => {
        n.items[1].answer = 999;
      }),
  },
  {
    rule: "L010",
    name: "widget missing from pack.yaml",
    bad: (f) =>
      editYaml<Loose>(f, "pack.yaml", (m) => {
        delete m.widgets.plot;
      }),
  },
  {
    rule: "L010",
    name: "major version mismatch",
    bad: (f) =>
      node(f, "speed", (n) => {
        n.screens[0].interaction.widget.v = 2;
      }),
  },
  {
    rule: "L010",
    name: "props fail the widget schema",
    bad: (f) =>
      node(f, "units", (n) => {
        n.screens[0].interaction.widget.props.mode = "pile";
      }),
  },
  { rule: "L011", name: "too few items (curated)", profile: "curated", bad: (f) => f },
  {
    rule: "L011",
    name: "no placement item (curated: error)",
    profile: "curated",
    severity: "error",
    bad: (f) =>
      node(f, "units", (n) => {
        delete n.items[0].placement;
      }),
  },
  {
    rule: "L011",
    name: "an untagged distractor",
    severity: "warn",
    bad: (f) =>
      node(f, "speed", (n) => {
        delete n.hook.interaction.options[0].misconception;
      }),
  },
  {
    rule: "L012",
    name: "Most people",
    bad: (f) =>
      node(f, "units", (n) => {
        n.close.text = "Most people get this wrong.";
      }),
  },
  {
    rule: "L012",
    name: "emoji",
    bad: (f) =>
      node(f, "units", (n) => {
        n.screens[0].reveal.text = "Two piles 🎉";
      }),
  },
  {
    rule: "L012",
    name: "!!",
    bad: (f) =>
      node(f, "units", (n) => {
        n.close.teaser = "What next!!";
      }),
  },
  {
    rule: "L013",
    name: "missing asset",
    bad: (f) =>
      node(f, "units", (n) => {
        n.hook.visual.asset = "assets/img/missing.svg";
      }),
  },
  {
    rule: "L013",
    name: "markdown link into assets/",
    bad: (f) =>
      node(f, "units", (n) => {
        n.close.text = "See [this](assets/img/clock-and-road.svg).";
      }),
  },
  { rule: "L013", name: "file name not allowed", bad: (f) => ({ ...f, "assets/img/Bad Name.SVG": "<svg/>" }) },
  {
    rule: "L013",
    name: "oversized asset",
    bad: (f) => ({ ...f, "assets/img/clock-and-road.svg": "x".repeat(2 * 1024 * 1024 + 1) }),
  },
  {
    rule: "L013",
    name: "$data outside data/",
    bad: (f) =>
      node(f, "units", (n) => {
        n.hook.reveal = { $data: "data/../pack.yaml" };
      }),
  },
  {
    rule: "L014",
    name: "line colour near Lumen (community: warning)",
    severity: "warn",
    bad: (f) =>
      editYaml<Loose>(f, "pack.yaml", (m) => {
        m.theme.lines[4] = "#FFC000";
      }),
  },
  {
    rule: "L014",
    name: "line colour near Lumen (curated: error)",
    profile: "curated",
    severity: "error",
    bad: (f) =>
      editYaml<Loose>(f, "pack.yaml", (m) => {
        m.theme.lines[4] = "#FFC000";
      }),
  },
  {
    rule: "L014",
    name: "a light ground on a dark world",
    severity: "warn",
    bad: (f) =>
      editYaml<Loose>(f, "pack.yaml", (m) => {
        m.theme.ground = "#F4F4F4";
      }),
  },
  {
    rule: "L017",
    name: "reviewed without a human review",
    bad: (f) =>
      node(f, "units", (n) => {
        n.status = "reviewed";
      }),
  },
  {
    rule: "L017",
    name: "learncroc packs must be curated or sampler",
    bad: (f) =>
      editYaml<Loose>(f, "pack.yaml", (m) => {
        m.publisher = "learncroc";
      }),
  },
  {
    rule: "L018",
    name: "a true/false item",
    bad: (f) =>
      node(
        f,
        "units",
        (n) =>
          void n.items.push({
            id: "tf",
            kind: "choice",
            level: "recall",
            difficulty: 1,
            prompt: "Miles are distance?",
            options: [
              { id: "t", text: "True" },
              { id: "f", text: "False", misconception: "all-units-same" },
            ],
            answer: "t",
          }),
      ),
  },
  {
    rule: "L018",
    name: "over 40% choice items (curated: error)",
    profile: "curated",
    severity: "error",
    bad: (f) =>
      node(f, "units", (n) => {
        n.items = n.items.map((i: Obj) =>
          i.id === "i1" ? i : { ...structuredClone(n.items[0]), id: i.id, placement: undefined },
        );
      }),
  },
  {
    rule: "L018",
    name: "over 40% choice items (community: warning)",
    severity: "warn",
    bad: (f) =>
      node(f, "units", (n) => {
        n.items = [n.items[0], n.items[1], { ...structuredClone(n.items[0]), id: "c2" }, n.items[3]];
      }),
  },
  {
    rule: "L019",
    name: "choice on a widget canvas without visualState (curated: error)",
    profile: "curated",
    severity: "error",
    bad: (f) =>
      node(f, "units", (n) => {
        n.screens[1].interaction = {
          kind: "choice",
          id: "s2-q",
          prompt: "Which is longest?",
          options: [
            { id: "a", text: "45 minutes", misconception: "bigger-number" },
            { id: "c", text: "90 minutes" },
          ],
          answer: "c",
        };
      }),
  },
  {
    rule: "L020",
    name: "an html interactive that fetches and never reports",
    bad: (f) => ({
      ...node(f, "units", (n) =>
        n.items.push({
          id: "h1",
          kind: "html",
          level: "apply",
          difficulty: 2,
          prompt: "Set it",
          asset: "assets/interactive/toy.html",
          height: 300,
          alt: "A toy",
          goal: { kind: "equals", value: 3 },
          solution: 3,
          fallback: { kind: "numeric", prompt: "3?", answer: 3 },
        }),
      ),
      "assets/interactive/toy.html": "<script>fetch('https://example.com')</script>",
    }),
  },
  {
    rule: "L022",
    name: "language pack with mostly recognition items",
    profile: "curated",
    bad: (f) =>
      editYaml<Loose>(f, "pack.yaml", (m) => {
        m.targetLang = "es-ES";
      }),
  },
];

describe("lint", () => {
  test("the clean fixture passes every rule (community)", async () => {
    const r = await lint(cleanFiles());
    expect(r.issues).toEqual([]);
    expect(r).toMatchObject({ packId: "mini-pack", profile: "community", errors: 0, warnings: 0 });
  });

  test("every active rule has at least one bad fixture", () => {
    // L025 (reading order) lands with the full revision-3 rule set; retired rules are never emitted.
    for (const id of RULE_IDS.filter((r) => !(RULES[r] as RuleInfo).retired && r !== "L025"))
      expect(CASES.some((c) => c.rule === id)).toBe(true);
  });

  // The good fixture for every rule is the clean pack (first test: no issue under community, where
  // every rule is on). Profile cases show the threshold: clean under community, bad under the profile.
  for (const c of CASES) {
    test(`${c.rule}: ${c.name}`, async () => {
      const r = await lint(c.bad(cleanFiles()), c.profile);
      const found = r.issues.filter(
        (i) => i.rule === c.rule && (c.severity === undefined || i.severity === c.severity),
      );
      expect(found.length).toBeGreaterThan(0);
      for (const i of found) {
        expect(i.why.length).toBeGreaterThan(10);
        expect(i.file).toBeTruthy();
        // Every placeholder is interpolated ("$n screens" would mean a broken template).
        expect(i.message.replace(/\$data/g, "")).not.toMatch(/\$[A-Za-z{]/);
      }
      if (c.profile && c.profile !== "community") {
        // The same content under the relaxed community profile is at most a warning.
        const relaxed = await lint(c.bad(cleanFiles()), "community");
        expect(relaxed.issues.filter((i) => i.rule === c.rule && i.severity === "error")).toEqual([]);
      }
    });
  }

  test("profile thresholds: the same pack passes community but not curated", async () => {
    const community = await lint(cleanFiles(), "community");
    const curated = await lint(cleanFiles(), "curated");
    expect(community.errors).toBe(0);
    expect(curated.errors).toBeGreaterThan(0);
    expect(curated.profile).toBe("curated");
  });

  test("SVGs that change when sanitised are rejected", async () => {
    const r = await lint(cleanFiles(), undefined, { sanitizeSvg: (s) => s.replace(/<script[\s\S]*?<\/script>/g, "") });
    expect(has(r.issues, "L013")).toBe(false);
    const files = { ...cleanFiles(), "assets/img/clock-and-road.svg": "<svg><script>alert(1)</script></svg>" };
    const bad = await lint(files, undefined, { sanitizeSvg: (s) => s.replace(/<script[\s\S]*?<\/script>/g, "") });
    expect(bad.issues.some((i) => i.rule === "L013" && /sanitised/.test(i.message))).toBe(true);
  });

  test("a well-formed html interactive passes L020", async () => {
    const files = {
      ...node(cleanFiles(), "units", (n) =>
        n.items.push({
          id: "h1",
          kind: "html",
          level: "apply",
          difficulty: 2,
          prompt: "Set it",
          asset: "assets/interactive/toy.html",
          height: 300,
          alt: "A toy",
          goal: { kind: "equals", value: 3 },
          solution: 3,
          fallback: { kind: "numeric", prompt: "3?", answer: 3 },
        }),
      ),
      "assets/interactive/toy.html": HTML_OK,
    };
    const r = await lint(files);
    expect(has(r.issues, "L020")).toBe(false);
    expect(has(r.issues, "L013")).toBe(false);
  });
});

describe("suppressions", () => {
  const longSetup = (f: Files) =>
    node(f, "units", (n) => {
      n.screens[0].blocks[0].text = words(301);
    });
  const suppress = (f: Files, comment: string, count = 1) => {
    const text = f["nodes/units.yaml"] as string;
    const marked = text.replace(
      /^(\s*)- id: s1-sort$/m,
      (_m, ind: string) => `${`${ind}${comment}\n`.repeat(count)}${ind}- id: s1-sort`,
    );
    expect(marked).not.toBe(text);
    return { ...f, "nodes/units.yaml": marked };
  };

  test("a reasoned lint-ignore suppresses the rule for that subtree and is listed", async () => {
    const r = await lint(suppress(longSetup(cleanFiles()), "# lint-ignore L001: quoted source"));
    expect(has(r.issues, "L001")).toBe(false);
    expect(r.suppressed).toEqual([
      { rule: "L001", file: "nodes/units.yaml", path: "/screens/0", reason: "quoted source" },
    ]);
    // Another rule in the same subtree is still reported.
    const other = await lint(suppress(longSetup(cleanFiles()), "# lint-ignore L002: unrelated"));
    expect(has(other.issues, "L001")).toBe(true);
  });

  test("a suppression needs a reason and a known rule", async () => {
    const noReason = await lint(suppress(longSetup(cleanFiles()), "# lint-ignore L001"));
    expect(has(noReason.issues, "L001")).toBe(true);
    expect(noReason.issues.some((i) => i.rule === "L000" && /needs a reason/.test(i.message))).toBe(true);
    const unknown = await lint(suppress(cleanFiles(), "# lint-ignore L999: nope"));
    expect(
      unknown.issues.some((i) => i.rule === "L000" && i.severity === "warn" && /unknown rule/.test(i.message)),
    ).toBe(true);
    const retired = await lint(suppress(cleanFiles(), "# lint-ignore L016: old habit"));
    expect(
      retired.issues.some((i) => i.rule === "L000" && i.severity === "warn" && /retired rule/.test(i.message)),
    ).toBe(true);
  });

  test("curated packs have a budget of 5 suppressions", async () => {
    const within = await lint(suppress(cleanFiles(), "# lint-ignore L002: fine", 5), "curated");
    expect(within.issues.some((i) => /lint suppressions/.test(i.message))).toBe(false);
    const over = await lint(suppress(cleanFiles(), "# lint-ignore L002: fine", 6), "curated");
    expect(over.issues.some((i) => i.rule === "L000" && /6 lint suppressions/.test(i.message))).toBe(true);
    const community = await lint(suppress(cleanFiles(), "# lint-ignore L002: fine", 6), "community");
    expect(community.issues.some((i) => /lint suppressions/.test(i.message))).toBe(false);
  });
});

describe("lint --fix", () => {
  test("adds TODO alt placeholders, writes generated flashcards, moves a long beat's last block into alts.simpler", async () => {
    let files = node(fixtureFiles(), "units", (n) => {
      n.hook.visual.alt = "";
      n.screens[1].blocks = [
        { type: "story", text: words(280) },
        { type: "story", text: words(30, "extra") },
      ];
    });
    files = { ...files, "nodes/units.yaml": `# a comment that survives\n${files["nodes/units.yaml"]}` };
    const before = await lint(files);
    expect(before.issues.some((i) => i.rule === "L004" && i.fixable)).toBe(true);
    expect(before.issues.some((i) => i.rule === "L001" && i.file === "nodes/units.yaml")).toBe(true);
    const { files: changed, fixed } = await lintFix(fsOf(files));
    const units = changed["nodes/units.yaml"] as string;
    expect(units).toContain("# a comment that survives");
    expect(units).toContain("TODO: describe this picture");
    expect(units).toMatch(/flashcards:/);
    expect(units).toMatch(/simpler: extra/);
    expect(fixed.map((f) => f.rule)).toEqual(expect.arrayContaining(["L004", "L001", "L002"]));
    const after = await lint({ ...files, ...changed });
    expect(after.issues.some((i) => i.rule === "L001" && i.file === "nodes/units.yaml")).toBe(false);
    expect(after.issues.some((i) => i.rule === "L004" && i.severity === "warn" && /TODO/.test(i.message))).toBe(true);
    // Idempotent.
    expect(Object.keys((await lintFix(fsOf({ ...files, ...changed }))).files)).toEqual([]);
  });

  test("L014 messages suggest the nearest passing colour", async () => {
    const r = await lint(
      editYaml<Loose>(cleanFiles(), "pack.yaml", (m) => {
        m.theme.lines[4] = "#FFC000";
      }),
    );
    const issue = r.issues.find((i) => i.rule === "L014");
    expect(issue?.example).toMatch(/#[0-9A-F]{6}/);
  });
});
