/**
 * learncroc relight [--pack ID] [--limit N] — a Relight session in the terminal. Widget, html and
 * explain items are asked through their built-in fallback. Answers go through the same grading
 * path as the app (POST /runs/:id/attempts), via the running server or in-process.
 */
import { createInterface } from "node:readline";
import { AnswerValue, answerText, type FallbackInteraction, type Item, PACK_ID_RE } from "@learncroc/core";
import { renderTemplate } from "@learncroc/core/params";
import pc from "picocolors";
import { parseArgs } from "../lib/args";
import { cliEnv } from "../lib/context";
import { openTransport } from "../lib/transport";

type Askable = Item | FallbackInteraction;

/** The interaction a terminal can ask: built-in kinds as they are, the rest through their fallback. */
export function terminalInteraction(item: Item): Askable {
  if (item.kind === "widget" || item.kind === "html") return item.fallback;
  if (item.kind === "explain") return item.offline;
  return item;
}

const plain = (md: string) => md.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

/** The correct answer as text, when the grader returned one in answer shape. */
export function solutionText(ix: Askable, solution: unknown, vars?: Record<string, number>): string {
  const parsed = AnswerValue.safeParse(solution);
  if (!parsed.success) return "";
  try {
    return answerText(ix, parsed.data, vars ? { vars } : {});
  } catch {
    return "";
  }
}

/** Parse a typed line into an answer for this interaction; null = couldn't read it (ask again). */
export function parseAnswer(ix: Askable, line: string): AnswerValue | null {
  const s = line.trim();
  if (s === "" || s === "?") return { kind: "idk" };
  switch (ix.kind) {
    case "choice": {
      const picks = s.split(/[\s,]+/).map((x) => Number(x));
      if (picks.some((n) => !Number.isInteger(n) || n < 1 || n > ix.options.length)) return null;
      const ids = picks.map((n) => ix.options[n - 1]?.id as string);
      return { kind: "choice", selected: ix.multi ? ids : (ids[0] as string) };
    }
    case "numeric":
    case "estimate": {
      const v = Number(s.replace(/,/g, "").replace(/[^\d.eE+-]/g, ""));
      if (!Number.isFinite(v)) return null;
      return ix.kind === "numeric" ? { kind: "numeric", value: v } : { kind: "estimate", value: v };
    }
    case "text":
      return { kind: "text", value: s };
    case "order": {
      const order = s.split(/[\s,]+/).map((x) => Number(x) - 1);
      if (order.length !== ix.items.length || order.some((n) => !Number.isInteger(n) || n < 0 || n >= ix.items.length))
        return null;
      return { kind: "order", order };
    }
    case "match": {
      const pairs: [number, number][] = [];
      for (const part of s.split(/[\s,]+/)) {
        const m = /^(\d+)[-:=]([a-z]|\d+)$/i.exec(part);
        if (!m) return null;
        const right = /^\d+$/.test(m[2] as string)
          ? Number(m[2]) - 1
          : (m[2] as string).toLowerCase().charCodeAt(0) - 97;
        pairs.push([Number(m[1]) - 1, right]);
      }
      return { kind: "match", pairs };
    }
    case "cloze": {
      const keys = Object.keys(ix.blanks);
      const vals = s.split("|").map((x) => x.trim());
      if (vals.length !== keys.length) return null;
      return { kind: "cloze", values: Object.fromEntries(keys.map((k, i) => [k, vals[i] as string])) };
    }
    default:
      return null;
  }
}

/** How to answer, shown under the prompt. */
export function describe(ix: Askable, vars?: Record<string, number>): string[] {
  const out: string[] = [];
  switch (ix.kind) {
    case "choice":
      for (const [i, o] of ix.options.entries()) out.push(`  ${i + 1}. ${plain(renderTemplate(o.text, vars ?? {}))}`);
      out.push(pc.dim(ix.multi ? "  Type the numbers, separated by spaces." : "  Type a number."));
      break;
    case "numeric":
      out.push(pc.dim(`  Type a number${ix.unit ? ` (${ix.unit})` : ""}.`));
      break;
    case "estimate":
      out.push(
        pc.dim(
          `  Type your estimate${ix.scale.unit ? ` (${ix.scale.unit})` : ""}, between ${ix.scale.min} and ${ix.scale.max}.`,
        ),
      );
      break;
    case "text":
      out.push(pc.dim("  Type your answer."));
      break;
    case "order":
      for (const [i, t] of ix.items.entries()) out.push(`  ${i + 1}. ${plain(t)}`);
      out.push(pc.dim("  Type the numbers in the right order, e.g. 2 1 3."));
      break;
    case "match":
      for (const [i, t] of ix.left.entries()) out.push(`  ${i + 1}. ${plain(t)}`);
      for (const [i, t] of ix.right.entries()) out.push(`  ${String.fromCharCode(97 + i)}. ${plain(t)}`);
      out.push(pc.dim("  Pair them up, e.g. 1-b 2-a 3-c."));
      break;
    case "cloze":
      out.push(`  ${plain(ix.text)}`);
      out.push(pc.dim("  Fill the blanks in order, separated by |."));
      break;
  }
  out.push(pc.dim("  (Enter on its own: no idea yet.)"));
  return out;
}

/**
 * Line input that works for a TTY and for piped stdin alike: lines that arrive before a question
 * are queued, and end of input answers every remaining question with "no idea yet".
 */
export function lineReader(input: NodeJS.ReadableStream, output: NodeJS.WritableStream) {
  const rl = createInterface({ input, terminal: false });
  const queue: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  let closed = false;
  rl.on("line", (line) => {
    const w = waiting.shift();
    if (w) w(line);
    else queue.push(line);
  });
  rl.on("close", () => {
    closed = true;
    for (const w of waiting.splice(0)) w(null);
  });
  return {
    async ask(prompt: string): Promise<string | null> {
      output.write(prompt);
      const queued = queue.shift();
      if (queued !== undefined) return queued;
      if (closed) return null;
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () => rl.close(),
  };
}

export async function relight(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["pack", "limit", "port", "home"]);
  const env = cliEnv(argv);
  const pack = args.values.get("pack");
  if (pack !== undefined && !PACK_ID_RE.test(pack)) {
    console.error("--pack needs a pack id");
    return 2;
  }
  const limitRaw = args.values.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 30)) {
    console.error("--limit must be between 1 and 30");
    return 2;
  }
  const api = await openTransport(env.home, env.port);
  const rl = lineReader(process.stdin, process.stdout);
  try {
    const session = await api.call("POST /relight", {
      body: { ...(pack ? { packId: pack } : {}), ...(limit ? { limit } : {}) },
    });
    if (session.nothingDue || session.items.length === 0) {
      const next = session.nextDueAt
        ? ` The next stop starts fading ${new Date(session.nextDueAt).toLocaleString()}.`
        : "";
      console.log(`Nothing to relight right now.${next}`);
      if (!session.nothingDue) await api.call("POST /runs/:runId/abandon", { path: `/runs/${session.run.id}/abandon` });
      return 0;
    }
    console.log(pc.bold(`Relight · ${session.items.length} question${session.items.length === 1 ? "" : "s"}`));
    let right = 0;
    for (const [i, entry] of session.items.entries()) {
      const ix = terminalInteraction(entry.interaction);
      console.log(`\n${pc.dim(`${i + 1}/${session.items.length} · ${entry.packTitle} · ${entry.nodeTitle}`)}`);
      console.log(pc.bold(plain(renderTemplate(ix.prompt, entry.vars ?? {}))));
      for (const l of describe(ix, entry.vars)) console.log(l);
      let answer: AnswerValue | null = null;
      const started = Date.now();
      while (!answer) {
        const line = await rl.ask("> ");
        if (line === null) process.stdout.write("\n");
        answer = parseAnswer(ix, line ?? "");
        if (!answer) console.log(pc.dim("  I couldn't read that. Try again."));
      }
      const result = await api.call("POST /runs/:runId/attempts", {
        path: `/runs/${session.run.id}/attempts`,
        body: {
          packId: entry.ref.packId,
          nodeId: entry.ref.nodeId,
          interactionId: entry.ref.itemId,
          phase: "relight",
          answer,
          ms: Date.now() - started,
        },
      });
      if (result.correct) {
        right++;
        console.log(pc.green("  Right."));
      } else {
        console.log(pc.yellow("  Not this time."));
        const shown = solutionText(ix, result.solution, entry.vars);
        if (shown) console.log(`  The answer: ${plain(shown)}`);
      }
      if (result.feedback) console.log(`  ${plain(result.feedback)}`);
      const why = "why" in entry.interaction ? entry.interaction.why : undefined;
      if (why) console.log(pc.dim(`  ${plain(why)}`));
    }
    const summary = await api.call("POST /runs/:runId/finish", { path: `/runs/${session.run.id}/finish`, body: {} });
    console.log(`\n${pc.bold("Done.")} ${right} of ${session.items.length} right.`);
    for (const r of summary.relit ?? []) {
      const word = r.grade >= 3 ? "relit" : r.grade === 2 ? "relit, a little dim" : "comes back soon";
      console.log(`  ${r.packId} / ${r.nodeId}: ${word}`);
    }
    if (summary.nextFadeAt) console.log(pc.dim(`Next relight: ${new Date(summary.nextFadeAt).toLocaleString()}`));
    return 0;
  } finally {
    rl.close();
    api.close();
  }
}
