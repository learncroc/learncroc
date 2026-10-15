/**
 * learncroc build <dir> — draft a pack's map and stops with AI (needs a key or a local model).
 *
 *   learncroc build packs/my-pack [--nodes 6] [--topic "…"] [--only id,id] [--yes]
 *   learncroc build --prompt <id>      print a versioned prompt (no key needed; used by skills/)
 *
 * The plan (map.yaml) is a checkpoint: wrong edges are the costliest mistake, so the build stops
 * there unless you confirm (or pass --yes). Everything is written as `status: draft`; lint is the
 * gate, and human reviews are recorded in pack.lock.yaml by people, never by this command.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { buildPack, createAiRuntime, isPromptId, PROMPT_IDS, printablePrompt } from "@learncroc/ai";
import pc from "picocolors";
import { parseArgs } from "../lib/args";
import { cliEnv } from "../lib/context";
import { lintDir } from "../lib/lint";

const USAGE = `Usage: learncroc build <dir> [--nodes N] [--topic "…"] [--only id,id] [--yes]
       learncroc build --prompt <${PROMPT_IDS.join("|")}>`;

export async function build(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["nodes", "topic", "only", "prompt", "home", "port"]);
  const promptId = args.values.get("prompt");
  if (promptId !== undefined) {
    if (!isPromptId(promptId)) {
      console.error(`Unknown prompt "${promptId}".\n${USAGE}`);
      return 2;
    }
    process.stdout.write(printablePrompt(promptId));
    return 0;
  }
  const target = args._[0];
  if (!target || args.flags.has("help") || args.flags.has("h")) {
    console.error(USAGE);
    return target ? 0 : 2;
  }
  const dir = resolve(target);
  if (!existsSync(join(dir, "pack.yaml"))) {
    console.error(`No pack.yaml in ${dir}. Create one with \`learncroc new <id>\` first.`);
    return 2;
  }
  const nodes = Number(args.values.get("nodes") ?? 6);
  if (!Number.isInteger(nodes) || nodes < 3 || nodes > 16) {
    console.error("--nodes must be between 3 and 16.");
    return 2;
  }

  const env = cliEnv(argv);
  // Authoring makes many calls in a row: the learner-facing rate limit doesn't apply.
  const runtime = createAiRuntime({ home: env.home, ratePerMinute: 10_000 });
  const active = runtime.current();
  if (!active) {
    console.error(
      "learncroc build needs AI: set ANTHROPIC_API_KEY (or OPENAI_API_KEY with LEARNCROC_AI_BASE_URL), add a key in the app's Settings, or run Ollama.\nWithout a key, write the pack with your coding agent and the skills in skills/ (`learncroc lint` is the gate).",
    );
    return 2;
  }

  const fs = {
    read: async (p: string) => {
      try {
        return readFileSync(join(dir, p), "utf8");
      } catch {
        return undefined;
      }
    },
    write: async (p: string, text: string) => {
      const file = join(dir, p);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    list: async (p: string) => {
      try {
        return readdirSync(join(dir, p));
      } catch {
        return [];
      }
    },
  };

  const only = args.values
    .get("only")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const topic = args.values.get("topic");
  const started = Date.now();
  const spentBefore = runtime.usage().spentUsd;
  try {
    const result = await buildPack({
      client: active.client,
      fs,
      nodeCount: nodes,
      ...(topic ? { topic } : {}),
      ...(only?.length ? { only } : {}),
      yes: args.flags.has("yes") || args.flags.has("y"),
      confirmPlan: async (plan) => {
        console.log(pc.bold("\nPlanned map"));
        for (const n of plan.nodes)
          console.log(`  ${n.id}${n.requires.length ? pc.dim(` ← ${n.requires.join(", ")}`) : pc.dim(" (start)")}`);
        if (!process.stdin.isTTY) {
          console.log(pc.yellow("\nStopped at the plan. Check map.yaml, then re-run with --yes to write the stops."));
          return false;
        }
        const ok = await confirm({ message: "Write the stops for this map?" });
        return ok === true && !isCancel(ok);
      },
      lint: () => lintDir(dir),
      log: (m) => console.log(m),
      now: () => Date.now(),
    });
    const spent = runtime.usage().spentUsd - spentBefore;
    if (result.stoppedAtPlan) return 0;
    console.log(
      `\nWrote ${result.written.length} of ${result.planned.length} stops in ${Math.round((Date.now() - started) / 1000)} s${spent > 0 ? ` (about $${spent.toFixed(2)})` : ""}.`,
    );
    for (const f of result.failed) console.log(pc.yellow(`  ${f.id}: not written (${f.reason})`));
    if (result.report) {
      const r = result.report;
      const line = `lint: ${r.errors} error${r.errors === 1 ? "" : "s"}, ${r.warnings} warning${r.warnings === 1 ? "" : "s"}`;
      console.log(r.errors ? pc.red(line) : pc.green(line));
      if (r.errors)
        console.log(pc.dim(`Run \`learncroc lint ${target}\` for details; fix by hand or with the skills in skills/.`));
    }
    console.log(pc.dim("Everything is status: draft until a named human reviews it (pack.lock.yaml)."));
    return result.failed.length > 0 || (result.report?.errors ?? 0) > 0 ? 1 : 0;
  } catch (e) {
    console.error(pc.red(e instanceof Error ? e.message : String(e)));
    return 1;
  }
}

/**
 * Placeholder: learncroc convert <dir> — turn a revision-2 pack into the card loop with AI help (closes,
 * teasers, checkpoint items). `learncroc migrate` already does the mechanical half without a key.
 */
export async function convert(argv: string[]): Promise<number> {
  const target = argv.find((a) => !a.startsWith("-"));
  console.error(
    `learncroc convert${target ? ` ${target}` : ""}: not available yet. Run \`learncroc migrate <dir>\` for the mechanical upgrade.`,
  );
  return 1;
}
