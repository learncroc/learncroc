import { describe, expect, setDefaultTimeout, test } from "bun:test";

// Each case spawns the CLI a few times.
setDefaultTimeout(30_000);

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type FallbackInteraction, type Item, LEARNCROC_VERSION } from "@learncroc/core";
import { parseAnswer, terminalInteraction } from "../src/commands/relight";
import { appInstallFiles, appInstallPaths } from "../src/commands/system";
import { parseArgs } from "../src/lib/args";

const CLI = join(import.meta.dir, "../src/index.ts");
const FIXTURE = resolve(import.meta.dir, "../../core/fixtures/mini-pack");
const tmp = (p = "lm-cli-") => mkdtempSync(join(tmpdir(), p));

function run(args: string[], opts: { home?: string; stdin?: string; cwd?: string } = {}) {
  const env = { ...process.env, LEARNCROC_HOME: opts.home ?? tmp("lm-home-"), CI: "1" } as Record<string, string>;
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
  const r = Bun.spawnSync(["bun", CLI, ...args], {
    env,
    cwd: opts.cwd ?? process.cwd(),
    ...(opts.stdin !== undefined ? { stdin: new TextEncoder().encode(opts.stdin) } : {}),
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe("learncroc CLI", () => {
  test("--help lists every command; unknown commands exit 2", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    for (const c of [
      "serve",
      "install",
      "list",
      "uninstall",
      "lint",
      "build-pack",
      "new",
      "play",
      "migrate",
      "relight",
      "install-app",
      "doctor",
      "registry",
    ])
      expect(r.out).toContain(c);
    expect(run(["nope"]).code).toBe(2);
  });

  test("new scaffolds a pack that lints clean", () => {
    const dir = join(tmp(), "kitchen-chemistry");
    const made = run(["new", "kitchen-chemistry", "--dir", dir, "--title", "Kitchen chemistry", "--author", "Ada"]);
    expect(made.code).toBe(0);
    expect(readFileSync(join(dir, "pack.yaml"), "utf8")).toContain("id: kitchen-chemistry");
    expect(readFileSync(join(dir, "pack.yaml"), "utf8")).not.toContain("__");
    const lint = run(["lint", dir, "--json"]);
    expect(lint.code).toBe(0);
    const report = JSON.parse(lint.out) as { errors: number; warnings: number; packId: string };
    expect(report).toMatchObject({ packId: "kitchen-chemistry", errors: 0, warnings: 0 });
    expect(run(["new", "kitchen-chemistry", "--dir", dir]).code).toBe(1);
    expect(run(["new", "Bad Id"]).code).toBe(2);
  });

  test("lint --json reports problems with rule ids and exits 1 on errors", () => {
    const r = run(["lint", FIXTURE, "--json", "--profile", "curated"]);
    const report = JSON.parse(r.out) as { errors: number; issues: { rule: string }[] };
    expect(report.issues.every((i) => /^L\d{3}b?$/.test(i.rule))).toBe(true);
    expect(r.code).toBe(report.errors > 0 ? 1 : 0);
    expect(run(["lint", tmp()]).code).toBe(2);
  });

  test("build-pack → install (local file) → list → uninstall", () => {
    const out = tmp("lm-dist-");
    const home = tmp("lm-home-");
    const built = run(["build-pack", FIXTURE, "--out", out]);
    expect(built.code).toBe(0);
    const file = join(out, "mini-pack-0.1.0.lmpack");
    expect(existsSync(file)).toBe(true);
    expect(run(["install", file], { home }).code).toBe(0);
    const list = run(["list", "--json"], { home });
    expect((JSON.parse(list.out) as { id: string }[]).map((p) => p.id)).toEqual(["mini-pack"]);
    expect(run(["uninstall", "mini-pack"], { home }).code).toBe(0);
    expect(JSON.parse(run(["list", "--json"], { home }).out)).toEqual([]);
    expect(run(["uninstall", "mini-pack"], { home }).code).toBe(1);
    expect(run(["install", join(out, "missing.lmpack")], { home }).code).toBe(1);
  });

  test("registry build writes index.json and archives", () => {
    const out = tmp("lm-reg-");
    const r = run(["registry", "build", "--packs", resolve(FIXTURE, ".."), "--out", out]);
    expect(r.code).toBe(0);
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8")) as { packs: { id: string }[] };
    expect(index.packs.map((p) => p.id)).toEqual(["mini-pack"]);
    expect(existsSync(join(out, "dist", "mini-pack-0.1.0.lmpack"))).toBe(true);
  });

  test("migrate reports packs already at the current format", () => {
    const r = run(["migrate", FIXTURE]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("already at pack format 1");
  });

  test("doctor --json prints diagnostics without secrets", () => {
    const r = run(["doctor", "--json"]);
    expect(r.code).toBe(0);
    const d = JSON.parse(r.out) as Record<string, string>;
    expect(d.learncroc).toBe(LEARNCROC_VERSION);
    expect(d.server).toBe("not running");
  });
});

describe("relight answers in a terminal", () => {
  const choice = {
    kind: "choice",
    id: "q",
    prompt: "?",
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    answer: "b",
  } as unknown as FallbackInteraction;

  test("parses each kind and treats an empty line as no idea yet", () => {
    expect(parseAnswer(choice, "2")).toEqual({ kind: "choice", selected: "b" });
    expect(parseAnswer(choice, "7")).toBeNull();
    expect(parseAnswer(choice, "")).toEqual({ kind: "idk" });
    expect(parseAnswer({ kind: "numeric", prompt: "?", answer: 3 } as FallbackInteraction, "1,200")).toEqual({
      kind: "numeric",
      value: 1200,
    });
    expect(
      parseAnswer(
        { kind: "order", prompt: "?", items: ["x", "y", "z"], answer: [0, 1, 2] } as FallbackInteraction,
        "3 1 2",
      ),
    ).toEqual({
      kind: "order",
      order: [2, 0, 1],
    });
    expect(parseAnswer({ kind: "text", prompt: "?", accept: ["x"] } as FallbackInteraction, " hola ")).toEqual({
      kind: "text",
      value: "hola",
    });
  });

  test("widget items are asked through their fallback", () => {
    const item = {
      kind: "widget",
      id: "w",
      prompt: "?",
      widget: { id: "sorter", v: 1, props: {} },
      solution: {},
      fallback: choice,
      level: "recall",
      difficulty: 1,
    } as unknown as Item;
    expect(terminalInteraction(item)).toBe(choice);
  });
});

describe("install-app", () => {
  test("writes a LaunchAgent on macOS, XDG autostart + desktop entry on Linux, Startup files on Windows", () => {
    const cmd = ["/usr/local/bin/bun", "/opt/learncroc/index.ts", "serve", "--no-open"];
    const mac = appInstallFiles("darwin", cmd, "http://127.0.0.1:4747", appInstallPaths("darwin", "/Users/a", {}));
    const [macFile, plist] = [...mac][0] as [string, string];
    expect(macFile).toBe("/Users/a/Library/LaunchAgents/dev.learncroc.com.plist");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    const linux = appInstallFiles("linux", cmd, "http://127.0.0.1:4747", appInstallPaths("linux", "/home/a", {}));
    expect([...linux.keys()]).toEqual([
      "/home/a/.config/autostart/learncroc.desktop",
      "/home/a/.local/share/applications/learncroc.desktop",
    ]);
    const win = appInstallFiles(
      "win32",
      cmd,
      "http://127.0.0.1:4747",
      appInstallPaths("win32", "C:/Users/a", { APPDATA: "C:/Users/a/AppData/Roaming" }),
    );
    expect([...win.keys()][0]).toContain("Startup");
  });
});

test("parseArgs", () => {
  const a = parseArgs(["x", "--port", "5000", "--json", "--name=hi", "-v"], ["port"]);
  expect(a._).toEqual(["x"]);
  expect(a.values.get("port")).toBe("5000");
  expect(a.values.get("name")).toBe("hi");
  expect(a.flags.has("json")).toBe(true);
  expect(a.flags.has("v")).toBe(true);
});

describe("learncroc relight in a terminal", () => {
  test("completes a session over due stops (in-process, no server)", async () => {
    const { PackStore, SqliteRepo, compilePackDir, homePaths } = await import("@learncroc/server");
    const { lightNodeCard } = await import("@learncroc/core");
    const home = tmp("lm-home-");
    const store = new PackStore({ home });
    const pack = await compilePackDir(FIXTURE);
    store.install(PackStore.filesFromSource(pack, FIXTURE), { source: "file", tier: "local" });
    const repo = SqliteRepo.open(homePaths(home).db);
    const longAgo = Date.now() - 40 * 86_400_000;
    for (const nodeId of ["units", "speed"]) {
      await repo.putProgress("mini-pack", {
        nodeId,
        status: "lit",
        source: "run",
        litAt: longAgo,
        theta: 0,
        relightsOk: 0,
      });
      await repo.putCard(lightNodeCard("mini-pack", nodeId, longAgo, 3, { fuzz: false }).card);
    }
    repo.close();
    const r = run(["relight", "--limit", "4"], { home, stdin: "\n\n\n\n\n\n\n\n\n\n" });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Relight ·");
    expect(r.out).toContain("Done.");
    const again = SqliteRepo.open(homePaths(home).db);
    const logs = (await again.exportTables()).review_log;
    expect(logs.length).toBeGreaterThan(0);
    again.close();
  });

  test("says so when nothing is due", () => {
    const r = run(["relight"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Nothing to relight right now.");
  });
});
