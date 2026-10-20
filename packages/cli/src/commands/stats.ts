/**
 * learncroc stats [--pack <id>] [--json] — your local numbers: next-day explain, first-try
 * checkpoint passes, maps finished, coming back, link to first card, plus the supporting numbers, then
 * the checkpoint questions missed most often, per pack. Computed on this machine from your own data;
 * nothing leaves it. Reads GET /numbers through the running server or in-process.
 *
 * `--pack` narrows the per-pack parts (first-try passes and most-missed questions) to one pack.
 * `--json` prints LocalNumbers as returned by GET /numbers (filtered the same way with --pack).
 */
import { type CompiledPack, LOCAL_NUMBER_EXPLAIN, type LocalNumbers, PACK_ID_RE } from "@learncroc/core";
import pc from "picocolors";
import { parseArgs } from "../lib/args";
import { cliEnv } from "../lib/context";
import { openTransport, type Transport } from "../lib/transport";

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "–");
const ratio = (n: number, d: number) => `${n} of ${d}${d > 0 ? ` (${pct(n, d)})` : ""}`;

/** Labels for the most-missed list: pack titles, card titles and question prompts (plain, one line). */
export interface StatsLabels {
  pack(packId: string): string;
  card(packId: string, nodeId: string): string;
  prompt(packId: string, nodeId: string, itemId: string): string | undefined;
}

const plain = (md: string, max = 70): string => {
  const s = md
    .replace(/\{\{?[^}]*\}?\}/g, "…")
    .replace(/[*_`#>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Labels from compiled packs (ids are shown when a pack isn't installed any more). */
export function labelsFrom(packs: Map<string, CompiledPack>): StatsLabels {
  return {
    pack: (id) => packs.get(id)?.manifest.title ?? id,
    card: (p, n) => packs.get(p)?.map.nodes[n]?.title ?? n,
    prompt: (p, n, i) => {
      const item = packs.get(p)?.nodes[n]?.items.find((it) => it.id === i);
      return item ? plain(item.prompt) : undefined;
    },
  };
}

const idLabels: StatsLabels = { pack: (id) => id, card: (_p, n) => n, prompt: () => undefined };

/** The numbers narrowed to one pack: per-pack first-try passes and most-missed questions. */
export function forPack(n: LocalNumbers, packId: string): LocalNumbers {
  const one = n.checkpointFirstTry.perPack[packId] ?? { attempted: 0, passedFirstTry: 0 };
  return {
    ...n,
    checkpointFirstTry: { ...one, perPack: { [packId]: one } },
    mostMissed: n.mostMissed.filter((m) => m.packId === packId),
  };
}

/** One line per number: the value, then its one-line explanation; then most-missed questions per pack. */
export function formatNumbers(n: LocalNumbers, labels: StatsLabels = idLabels): string[] {
  const rows: [keyof typeof LOCAL_NUMBER_EXPLAIN, string][] = [
    ["nextDayExplain", ratio(n.nextDayExplain.right, n.nextDayExplain.asked)],
    ["checkpointFirstTry", ratio(n.checkpointFirstTry.passedFirstTry, n.checkpointFirstTry.attempted)],
    ["maps", ratio(n.maps.finished, n.maps.started)],
    ["cameBack", ratio(n.cameBack.returned, n.cameBack.activeDays)],
    [
      "linkToFirstCard",
      n.linkToFirstCard.medianSec === null
        ? "no samples yet"
        : `${Math.round(n.linkToFirstCard.medianSec)} s (${n.linkToFirstCard.samples} maps)`,
    ],
    ["cardCompletion", ratio(n.cardCompletion.closed, n.cardCompletion.opened)],
    ["cardMinutes", n.cardMinutes.median === null ? "no samples yet" : `${n.cardMinutes.median.toFixed(1)} min`],
    ["workedAnswers", ratio(n.workedAnswers.needed, n.workedAnswers.beats)],
    ["checkpointHints", ratio(n.checkpointHints.hinted, n.checkpointHints.questions)],
    ["crocAsks", `${n.crocAsks.chips} buttons · ${n.crocAsks.freeText} typed`],
    [
      "relightPerWeek",
      n.relightPerWeek.weeks > 0 ? (n.relightPerWeek.sessions / n.relightPerWeek.weeks).toFixed(1) : "–",
    ],
  ];
  const out = rows.map(([k, v]) => `${pc.bold(v.padEnd(22))} ${pc.dim(LOCAL_NUMBER_EXPLAIN[k])}`);

  const perPack = Object.entries(n.checkpointFirstTry.perPack).filter(([, v]) => v.attempted > 0);
  if (perPack.length > 0) {
    out.push("", pc.bold("Checkpoints passed on the first try, per map"));
    for (const [id, v] of perPack.sort(([a], [b]) => labels.pack(a).localeCompare(labels.pack(b))))
      out.push(`  ${ratio(v.passedFirstTry, v.attempted).padEnd(18)} ${labels.pack(id)}`);
  }

  out.push("", pc.bold(LOCAL_NUMBER_EXPLAIN.mostMissed.replace(/\.$/, "")));
  const missed = n.mostMissed.filter((m) => m.missed > 0);
  if (missed.length === 0) out.push(pc.dim("  None yet."));
  const byPack = new Map<string, typeof missed>();
  for (const m of missed) byPack.set(m.packId, [...(byPack.get(m.packId) ?? []), m]);
  for (const [packId, list] of byPack) {
    out.push(`  ${labels.pack(packId)}`);
    for (const m of [...list].sort((a, b) => b.missed - a.missed || b.asked - a.asked).slice(0, 5)) {
      const prompt = labels.prompt(packId, m.nodeId, m.itemId);
      out.push(
        `    ${`${m.missed} of ${m.asked}`.padEnd(9)} ${labels.card(packId, m.nodeId)} · ${m.itemId}${
          prompt ? pc.dim(`  “${prompt}”`) : ""
        }`,
      );
    }
  }
  return out;
}

async function loadLabels(t: Transport, n: LocalNumbers): Promise<StatsLabels> {
  const packs = new Map<string, CompiledPack>();
  const ids = new Set([...n.mostMissed.map((m) => m.packId), ...Object.keys(n.checkpointFirstTry.perPack)]);
  for (const id of ids) {
    if (!PACK_ID_RE.test(id)) continue;
    try {
      packs.set(id, await t.call("GET /packs/:id", { path: `/packs/${id}` }));
    } catch {
      /* uninstalled or invalid: shown by id */
    }
  }
  return labelsFrom(packs);
}

export async function stats(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["home", "port", "pack"]);
  const pack = args.values.get("pack");
  if (pack !== undefined && !PACK_ID_RE.test(pack)) {
    console.error(`"${pack}" is not a pack id.`);
    return 2;
  }
  const env = cliEnv(argv);
  const t = await openTransport(env.home, env.port);
  try {
    let numbers: LocalNumbers;
    try {
      numbers = await t.call("GET /numbers");
    } catch (e) {
      console.error(`Your numbers aren't available yet: ${(e as Error).message}`);
      return 1;
    }
    if (pack) numbers = forPack(numbers, pack);
    if (args.flags.has("json")) {
      console.log(JSON.stringify(numbers, null, 2));
      return 0;
    }
    const labels = await loadLabels(t, numbers);
    console.log(
      pc.bold(pack ? `Your numbers · ${labels.pack(pack)}` : "Your numbers"),
      pc.dim("(computed on this machine; nothing leaves it)\n"),
    );
    for (const line of formatNumbers(numbers, labels)) console.log(line);
    return 0;
  } finally {
    t.close();
  }
}
