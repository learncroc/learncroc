/**
 * `learncroc build <dir>` (minimal): author-plan (the DAG, with a review step, and a
 * checkpoint every 2–3 cards) → author-node per card → author-practice → card lint → repair
 * (≤ 2 rounds) → write `status: draft` YAML and pack.lock.yaml provenance. Agents never write
 * `reviews`; humans sign off later.
 */
import {
  CROC_NAME,
  type LintReport,
  type MapFile,
  NODE_ID_RE,
  PackLock,
  type PackManifest,
  type PackNode,
  type Provenance,
} from "@learncroc/core";
import { parseDocument, parse as parseYaml, stringify } from "yaml";
import type { AiClient } from "../client";
import type { ConvertIssue } from "../convert";
import { assembleCard } from "../create/card";
import { placeCheckpoints } from "../create/pack";
import { tidyVoice } from "../guards";
import type { AuthorNodeInput, AuthorPlanInput, AuthorPracticeInput } from "../inputs";
import { wouldCycle } from "../layout";
import { inputBlock, prompt, render, tag } from "../prompts";
import { AuthorNodeDraft, AuthorPlanDraft, AuthorPracticeDraft } from "../schemas";
import { slug } from "../text";

export interface BuildFs {
  read(path: string): Promise<string | undefined>;
  write(path: string, text: string): Promise<void>;
  list(dir: string): Promise<string[]>;
}

export interface BuildOptions {
  client: AiClient;
  fs: BuildFs;
  /** Number of playable stops to plan (default 6). */
  nodeCount?: number;
  /** What the pack teaches, when pack.yaml's title and tagline aren't enough. */
  topic?: string;
  /** Only (re)write these stops (map.yaml must exist). */
  only?: string[];
  /** Skip the plan checkpoint. */
  yes?: boolean;
  /** The review checkpoint: return false to stop after writing map.yaml. */
  confirmPlan?(plan: AuthorPlanDraft): Promise<boolean>;
  lint(): Promise<LintReport>;
  log(msg: string): void;
  now(): number;
  concurrency?: number;
}

export interface BuildResult {
  planned: string[];
  written: string[];
  failed: { id: string; reason: string }[];
  report?: LintReport;
  stoppedAtPlan: boolean;
}

const NODE_HEADER = "# yaml-language-server: $schema=../../../schemas/node.schema.json\n";
const MAP_HEADER = "# yaml-language-server: $schema=../../schemas/map.schema.json\n";
const LOCK_HEADER = "# yaml-language-server: $schema=../../schemas/lock.schema.json\n";

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

/** Sources: every .md / .txt file under sources/, as cited chunks s1, s2, … */
async function readSources(fs: BuildFs): Promise<{ id: string; title: string; text: string }[]> {
  const names = (await fs.list("sources")).filter((n) => /\.(md|txt)$/i.test(n)).sort();
  const out: { id: string; title: string; text: string }[] = [];
  for (const [i, name] of names.entries()) {
    const text = (await fs.read(`sources/${name}`)) ?? "";
    if (text.trim())
      out.push({ id: `s${i + 1}`, title: name.replace(/\.(md|txt)$/i, ""), text: text.slice(0, 60_000) });
  }
  return out;
}

/** Curated packs: a checkpoint every 2–3 cards. */
const CURATED_CHECKPOINT_EVERY = [2, 3] as const;

/** The plan as a map file: lines, the DAG (forward references and cycles dropped) and checkpoints. */
export function planToMap(plan: AuthorPlanDraft): { map: MapFile; ids: Record<string, string> } {
  const ids: Record<string, string> = {};
  const req = new Map<string, string[]>();
  const lines = plan.lines.slice(0, 5).map((l, i) => ({
    id: slug(l.id || l.title, 30),
    title: tidyVoice(l.title),
    color: (i + 1) as 1 | 2 | 3 | 4 | 5,
    outcome: tidyVoice(l.outcome),
  }));
  if (lines.length === 0) lines.push({ id: "main", title: "Main line", color: 1, outcome: "Explain the main ideas" });
  const lineIds = new Set(lines.map((l) => l.id));
  const nodes: MapFile["nodes"] = {};
  for (const n of plan.nodes) {
    let id = slug(n.id || n.title, 48);
    if (!NODE_ID_RE.test(id)) continue;
    for (let k = 2; nodes[id]; k++) id = `${slug(n.id || n.title, 44)}-${k}`;
    ids[n.id] = id;
    const requires = n.requires
      .map((r) => ids[r])
      .filter((r): r is string => !!r && !wouldCycle(req, r, id))
      .slice(0, 4);
    req.set(id, requires);
    const line = slug(n.line, 30);
    nodes[id] = { requires, line: lineIds.has(line) ? line : (lines[0]?.id as string) };
  }
  const gates = placeCheckpoints(
    Object.entries(nodes).map(([id, e]) => ({ id, requires: e.requires })),
    CURATED_CHECKPOINT_EVERY,
  );
  const withGates: MapFile["nodes"] = {};
  const cpAfter = new Map(gates.checkpoints.map((c) => [c.covers.at(-1), c]));
  for (const [id, e] of Object.entries(nodes)) {
    withGates[id] = { ...e, requires: gates.requires[id] ?? e.requires };
    const cp = cpAfter.get(id);
    if (cp) withGates[cp.id] = { requires: cp.requires, line: e.line, kind: "checkpoint", covers: cp.covers };
  }
  return { map: { lines, nodes: withGates }, ids };
}

function nodeYaml(node: PackNode): string {
  return NODE_HEADER + stringify(node, { lineWidth: 110 });
}

function assembleAuthored(
  plan: AuthorPlanDraft["nodes"][number],
  id: string,
  ids: Record<string, string>,
  ancestors: Set<string>,
  draft: AuthorNodeDraft,
  practice: AuthorPracticeDraft,
  provenance: Provenance,
  sources: { id: string; title: string }[],
): { node?: PackNode; issues: ConvertIssue[] } {
  const upstream = new Map(
    plan.misconceptions.flatMap((m) => {
      const up = m.upstream ? ids[m.upstream] : undefined;
      return up && ancestors.has(up) ? [[slug(m.id || m.label, 30), up] as const] : [];
    }),
  );
  const used = sources.filter((s) => plan.sources.includes(s.id));
  const built = assembleCard(
    // Practice items carry `params`; itemFromDraft reads them.
    { ...draft, items: practice.items, flashcards: practice.cards },
    {
      id,
      title: tidyVoice(plan.title),
      tagline: tidyVoice(draft.tagline),
      estMinutes: Math.max(3, Math.min(6, draft.beats.length + 1)),
      bigIdea: tidyVoice(plan.bigIdea),
      objectives: plan.objectives.slice(0, 3).map(tidyVoice),
      misconceptions: plan.misconceptions.slice(0, 3).map((m) => ({ id: m.id, label: m.label })),
      upstreamFor: (mid) => upstream.get(mid),
      srcIds: new Set(used.map((s) => s.id)),
      sources: used.map((s) => ({ id: s.id, title: s.title })),
      provenance,
      faq: draft.faq,
      profile: "curated",
    },
  );
  return built.node ? { node: built.node, issues: [] } : { issues: built.issues };
}

export async function buildPack(o: BuildOptions): Promise<BuildResult> {
  const manifestText = await o.fs.read("pack.yaml");
  if (!manifestText) throw new Error("pack.yaml not found. Run `learncroc new <id>` first.");
  const manifest = parseYaml(manifestText) as Partial<PackManifest>;
  const sources = await readSources(o.fs);
  const provenance = (promptRef: string, tier: "fast" | "smart"): Provenance => ({
    feature: "build",
    prompt: promptRef,
    provider: o.client.env.providerId === "fake" ? "none" : (o.client.env.providerId as Provenance["provider"]),
    model: o.client.env.models[tier],
    at: new Date(o.now()).toISOString(),
  });
  const result: BuildResult = { planned: [], written: [], failed: [], stoppedAtPlan: false };
  const lockPaths: Record<string, Provenance> = {};

  // 1. plan
  const planInput: AuthorPlanInput = {
    kind: "author-plan",
    title: manifest.title ?? "Untitled",
    topic: o.topic ?? [manifest.title, manifest.tagline].filter(Boolean).join(": "),
    nodeCount: o.nodeCount ?? 6,
    sources: sources.map((s) => ({ id: s.id, title: s.title, excerpt: s.text.slice(0, 400) })),
  };
  o.log(`Planning ${planInput.nodeCount} stops for "${planInput.title}"…`);
  const { value: plan } = await o.client.object({
    feature: "build",
    promptId: "author-plan",
    vars: { nodeCount: planInput.nodeCount },
    schema: AuthorPlanDraft,
    schemaName: "AuthorPlanDraft",
    messages: [
      {
        role: "user",
        content: `Pack: ${planInput.title}\nTopic: ${planInput.topic}\nAudience level: ${manifest.level ?? "beginner"}\n${sources.map((s) => tag("source", s.text, { id: s.id, title: s.title })).join("\n")}\n\n${inputBlock(planInput)}`,
      },
    ],
  });
  const { map, ids } = planToMap(plan);
  result.planned = Object.keys(map.nodes);
  await o.fs.write("map.yaml", MAP_HEADER + stringify(map, { lineWidth: 110 }));
  lockPaths["map.yaml"] = provenance(prompt("author-plan").ref, "smart");
  o.log(`Wrote map.yaml (${result.planned.length} stops). Wrong edges are the costliest mistake: check them.`);
  if (!o.yes && !(await (o.confirmPlan?.(plan) ?? Promise.resolve(false)))) {
    await writeLock(o.fs, lockPaths);
    result.stoppedAtPlan = true;
    return result;
  }

  // 2–3. nodes and practice
  const planned = plan.nodes.filter((n) => ids[n.id]);
  const todo = o.only ? planned.filter((n) => o.only?.includes(ids[n.id] as string)) : planned;
  const ancestorsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...(map.nodes[id]?.requires ?? [])];
    while (stack.length) {
      const c = stack.pop() as string;
      if (out.has(c)) continue;
      out.add(c);
      stack.push(...(map.nodes[c]?.requires ?? []));
    }
    return out;
  };
  await pool(todo, o.concurrency ?? 3, async (p) => {
    const id = ids[p.id] as string;
    const children = Object.entries(map.nodes)
      .filter(([, e]) => e.kind !== "checkpoint" && e.requires.includes(id))
      .map(([cid]) => cid);
    const order = planned.map((n) => ids[n.id] as string);
    const nextPlan = planned[order.indexOf(id) + 1];
    const nodeInput: AuthorNodeInput = {
      kind: "author-node",
      node: { id, title: p.title, bigIdea: p.bigIdea, hookIdea: p.hookIdea, objectives: p.objectives },
      misconceptions: p.misconceptions.map((m) => ({ id: m.id, label: m.label })),
      beatCount: 3,
      next: nextPlan ? { title: nextPlan.title, hookIdea: nextPlan.hookIdea } : null,
      widgets: [{ id: "sorter", useWhen: "classify 3–8 examples into 2–4 groups" }],
    };
    try {
      const base = [
        {
          role: "user" as const,
          content: `Card plan:\n${JSON.stringify(p, null, 1)}\n${sources
            .filter((s) => p.sources.includes(s.id))
            .map((s) => tag("source", s.text.slice(0, 12_000), { id: s.id }))
            .join("\n")}\n\n${inputBlock(nodeInput)}`,
        },
      ];
      const vars = {
        beatCount: 3,
        prereqs: map.nodes[id]?.requires.filter((r) => map.nodes[r]?.kind !== "checkpoint").join(", ") || "nothing yet",
        children: children.join(", ") || "none",
      };
      let draft = (
        await o.client.object({
          feature: "build",
          promptId: "author-node",
          vars,
          schema: AuthorNodeDraft,
          schemaName: "AuthorNodeDraft",
          messages: base,
        })
      ).value;
      const practiceInput: AuthorPracticeInput = {
        kind: "author-practice",
        node: { id, title: p.title, bigIdea: p.bigIdea, keyPoints: draft.beats.map((b) => b.idea).filter(Boolean) },
        misconceptions: p.misconceptions.map((m) => ({ id: m.id, label: m.label })),
        itemCount: 6,
      };
      const practice = (
        await o.client.object({
          feature: "build",
          promptId: "author-practice",
          vars: { itemCount: 6 },
          schema: AuthorPracticeDraft,
          schemaName: "AuthorPracticeDraft",
          messages: [
            {
              role: "user",
              content: `Card: ${p.title}. ${p.bigIdea}\n${JSON.stringify(draft.beats.map((b) => b.action?.prompt ?? b.idea))}\n\n${inputBlock(practiceInput)}`,
            },
          ],
        })
      ).value;
      const prov = provenance(prompt("author-node").ref, "smart");
      let built = assembleAuthored(p, id, ids, ancestorsOf(id), draft, practice, prov, sources);
      for (let round = 0; !built.node && round < 2; round++) {
        o.log(`  ${id}: repairing (${built.issues.length} problem${built.issues.length === 1 ? "" : "s"})`);
        draft = (
          await o.client.object({
            feature: "build",
            promptId: "repair",
            maxTokens: prompt("author-node").maxTokens,
            extraSystem: [{ text: render(prompt("author-node").body, { crocName: CROC_NAME, ...vars }) }],
            schema: AuthorNodeDraft,
            schemaName: "AuthorNodeDraft",
            messages: [
              ...base,
              { role: "assistant", content: JSON.stringify(draft) },
              {
                role: "user",
                content: `Problems:\n${built.issues.map((i) => `- ${i.path}: ${i.message}`).join("\n")}\nReturn the corrected AuthorNodeDraft JSON.\n\n${inputBlock(nodeInput)}`,
              },
            ],
          })
        ).value;
        built = assembleAuthored(p, id, ids, ancestorsOf(id), draft, practice, prov, sources);
      }
      if (!built.node) {
        result.failed.push({ id, reason: built.issues.map((i) => `${i.path}: ${i.message}`).join("; ") });
        o.log(`  ${id}: failed after 2 repair rounds`);
        return;
      }
      await o.fs.write(`nodes/${id}.yaml`, nodeYaml(built.node));
      lockPaths[`nodes/${id}.yaml`] = prov;
      result.written.push(id);
      o.log(`  ${id}: written`);
    } catch (e) {
      result.failed.push({ id, reason: e instanceof Error ? e.message : String(e) });
      o.log(`  ${id}: ${e instanceof Error ? e.message : e}`);
    }
  });

  // 4. lint (the gate) and provenance
  await syncManifest(o.fs, map);
  await writeLock(o.fs, lockPaths);
  result.report = await o.lint();
  return result;
}

/**
 * Mechanical pack.yaml upkeep (comments kept): list the widgets the stops use, and point
 * entry.suggestedStart / coldOpenNode at stops that exist.
 */
async function syncManifest(fs: BuildFs, map: MapFile): Promise<void> {
  const text = await fs.read("pack.yaml");
  if (!text) return;
  const doc = parseDocument(text);
  const used = new Set<string>();
  for (const name of await fs.list("nodes")) {
    const t = await fs.read(`nodes/${name}`);
    for (const m of t?.matchAll(/^\s*id: (sorter|plot|ab-compare|hotspot|tile-builder)\s*$/gm) ?? [])
      used.add(m[1] as string);
  }
  for (const w of used) if (!doc.hasIn(["widgets", w])) doc.setIn(["widgets", w], 1);
  const ids = Object.keys(map.nodes);
  const root = ids.find((id) => (map.nodes[id]?.requires.length ?? 0) === 0) ?? ids[0];
  const start = doc.getIn(["entry", "suggestedStart"]);
  if (typeof start === "string" && !ids.includes(start) && root) doc.setIn(["entry", "suggestedStart"], root);
  const cold = doc.getIn(["entry", "coldOpenNode"]);
  if (typeof cold === "string" && !ids.includes(cold)) doc.deleteIn(["entry", "coldOpenNode"]);
  const out = doc.toString();
  if (out !== text) await fs.write("pack.yaml", out);
}

/** Merge provenance into pack.lock.yaml. Human `reviews` are kept untouched and never written here. */
async function writeLock(fs: BuildFs, provenance: Record<string, Provenance>): Promise<void> {
  const text = await fs.read("pack.lock.yaml");
  let lock: PackLock = {};
  if (text) {
    const parsed = PackLock.safeParse(parseYaml(text));
    if (parsed.success) lock = parsed.data;
  }
  const next: PackLock = { ...lock, provenance: { ...lock.provenance, ...provenance } };
  await fs.write("pack.lock.yaml", LOCK_HEADER + stringify(next, { lineWidth: 110 }));
}
