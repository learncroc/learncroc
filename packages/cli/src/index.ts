#!/usr/bin/env bun
/**
 * The learncroc CLI. `learncroc` with no command runs `serve`.
 */
import { LEARNCROC_VERSION } from "@learncroc/core";
import { lint, migrate, newPack, play } from "./commands/author";
import { build, convert } from "./commands/build";
import { buildPack, install, list, registry, uninstall } from "./commands/packs";
import { relight } from "./commands/relight";
import { serve } from "./commands/serve";
import { stats } from "./commands/stats";
import { doctor, installApp } from "./commands/system";

type Command = (argv: string[]) => Promise<number>;

/** Every v0.1 command (PLAN §4 Authoring, §18 CLI). */
export const COMMANDS: Record<string, { run: Command; help: string }> = {
  serve: { run: serve, help: "Start the local app (default) [--port N] [--home DIR] [--no-open]" },
  install: { run: install, help: "Install a pack from a registry id or a local .lmpack" },
  list: { run: list, help: "List installed packs [--json]" },
  uninstall: { run: uninstall, help: "Remove a pack (progress is kept)" },
  lint: { run: lint, help: "Lint a pack source folder [--fix] [--json] [--profile]" },
  "build-pack": { run: buildPack, help: "Compile a pack folder to a .lmpack [--out dist]" },
  new: { run: newPack, help: "Scaffold a lint-clean pack [--title] [--author]" },
  play: { run: play, help: "Open a pack folder in the app with live reload" },
  migrate: { run: migrate, help: "Upgrade a pack's files to the current schema" },
  relight: { run: relight, help: "Relight fading cards in the terminal [--pack ID] [--limit N]" },
  stats: { run: stats, help: "Your local numbers (nothing leaves this machine) [--pack ID] [--json]" },
  "install-app": { run: installApp, help: "Start learncroc at login and add a shortcut [--remove]" },
  doctor: { run: doctor, help: "Print environment and install diagnostics [--json]" },
  registry: { run: registry, help: "registry build: compile packs and write index.json" },
  build: { run: build, help: "Draft a pack with AI (needs a key)" },
  convert: { run: convert, help: "Convert a revision-2 pack to the card loop with AI help (coming)" },
  prompt: {
    run: (argv) => build(["--prompt", ...argv]),
    help: "Print a versioned AI prompt (for agents, no key needed)",
  },
};

export async function main(argv: string[]): Promise<number> {
  const [first, ...rest] = argv;
  if (first === "--version" || first === "-v") {
    console.log(LEARNCROC_VERSION);
    return 0;
  }
  if (first === "--help" || first === "-h" || first === "help") {
    console.log(`learncroc ${LEARNCROC_VERSION}\n\nUsage: learncroc [command] [options]\n`);
    for (const [name, c] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(12)} ${c.help}`);
    console.log("\nCommon options: --home DIR (default ~/.learncroc, or LEARNCROC_HOME), --port N (default 4747)");
    return 0;
  }
  if (first === undefined || first.startsWith("-")) return serve(argv);
  const cmd = COMMANDS[first];
  if (!cmd) {
    console.error(`Unknown command "${first}". Run learncroc --help.`);
    return 2;
  }
  try {
    return await cmd.run(rest);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
