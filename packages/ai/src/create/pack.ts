/**
 * The pocket pack on disk: a compiled local pack at
 * <home>/packs/local/<packId>@0.1.0/ (pack.json + assets/ + README.md), rewritten atomically as
 * stops land. While building it is `provisional` and stops still being written are `building`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CompiledMap,
  type CompiledPack,
  CompiledPack as CompiledPackSchema,
  checkpointMinutes,
  defaultCheckpointSize,
  designTheme,
  INTRO_NODE_ID,
  LEARNCROC_VERSION,
  type MinimapSkeleton,
  type NodeId,
  type PackManifest,
  type PackNode,
  type PackOrigin,
  sectionSizes,
  suggestMapDesign,
  type WidgetId,
} from "@learncroc/core";
import { layoutMap, POCKET_INKS, POCKET_PAPER } from "../layout";
import { slug } from "../text";
import { type IntroSource, introNode } from "./intro";

export const POCKET_GROUND = POCKET_PAPER;
export const POCKET_VERSION = "0.1.0";
const DEFAULT_LINES = POCKET_INKS;

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Darken a colour until it reaches `min` contrast against the ground (theme lint auto-correct). */
export function ensureContrast(hex: string, ground = POCKET_GROUND, min = 3): string {
  let c = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_LINES[0];
  for (let i = 0; i < 20 && contrast(c, ground) < min; i++) {
    c = `#${[1, 3, 5]
      .map((k) =>
        Math.round(Number.parseInt(c.slice(k, k + 2), 16) * 0.85)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  }
  return c.toUpperCase();
}

/** Too close to the reserved meaning colours (Lumen gold, Ember, Sea) → use the default instead. */
function reserved(hex: string): boolean {
  const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex) as [number, number, number];
  return ["#FFC23D", "#E5793F", "#12877A"].some((h) => {
    const [R, G, B] = rgb(h) as [number, number, number];
    return Math.hypot(r - R, g - G, b - B) < 60;
  });
}

export function pocketLines(palette?: string[]): [string, string, string, string, string] {
  const out = DEFAULT_LINES.map((d, i) => {
    const p = palette?.[i];
    return ensureContrast(p && /^#[0-9a-f]{6}$/i.test(p) && !reserved(p) ? p : d);
  });
  return out as [string, string, string, string, string];
}

/** "pm-" + 10 random base32 characters: a valid PackId; the title is display text only. */
export function newPocketId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `pm-${Array.from(bytes, (b) => alphabet[b % 32]).join("")}`;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function contentHash(pack: Omit<CompiledPack, "contentHash">): string {
  return createHash("sha256").update(canonical(pack)).digest("hex");
}

export interface PocketPackState {
  packId: string;
  skeleton: MinimapSkeleton;
  origin: PackOrigin;
  familiarity: "none" | "some" | "lots";
  nodes: Record<NodeId, PackNode>;
  /** Asset path → bytes (figures). */
  assets: Record<string, string>;
  /** True once the plan stream has ended: checkpoints are placed from then on. */
  planComplete?: boolean;
  /** The article's opening: the map gets an intro card first. */
  intro?: IntroSource;
  now: () => number;
}

/** Article maps: a checkpoint every 4–6 cards, at least one at the end. */
export const POCKET_CHECKPOINT_EVERY = [4, 6] as const;

export interface PlannedCheckpoint {
  id: NodeId;
  requires: NodeId[];
  covers: NodeId[];
  size: number;
}

/**
 * Sections over cards in reading order (article maps: 4–6 cards each; curated packs pass 2–3): `cp-<k>` requires the sinks of section k and covers its
 * cards explicitly; the first cards of section k+1 (no requirement inside their own section) gain
 * `cp-<k>`, so every card of a section sits behind the previous checkpoint.
 */
export function placeCheckpoints(
  cards: readonly { id: NodeId; requires: readonly NodeId[] }[],
  every: readonly [number, number] = POCKET_CHECKPOINT_EVERY,
): {
  requires: Record<NodeId, NodeId[]>;
  checkpoints: PlannedCheckpoint[];
} {
  const requires: Record<NodeId, NodeId[]> = Object.fromEntries(cards.map((c) => [c.id, [...c.requires]]));
  const checkpoints: PlannedCheckpoint[] = [];
  if (cards.length === 0) return { requires, checkpoints };
  let at = 0;
  for (const [k, size] of sectionSizes(cards.length, every).entries()) {
    const section = cards.slice(at, at + size).map((c) => c.id);
    at += size;
    const inSection = new Set(section);
    const prev = checkpoints.at(-1);
    if (prev) {
      for (const id of section) {
        const req = requires[id] ?? [];
        if (!req.some((r) => inSection.has(r))) requires[id] = [...req, prev.id];
      }
    }
    const required = new Set(section.flatMap((id) => (requires[id] ?? []).filter((r) => inSection.has(r))));
    checkpoints.push({
      id: `cp-${k + 1}`,
      requires: section.filter((id) => !required.has(id)),
      covers: section,
      size: defaultCheckpointSize(section.length),
    });
  }
  return { requires, checkpoints };
}

export function buildPocketPack(s: PocketPackState, provisional: boolean): CompiledPack {
  const sk = s.skeleton;
  const gates = s.planComplete ? placeCheckpoints(sk.nodes) : { requires: {}, checkpoints: [] };
  // The intro card comes first: the map's first cards require it, and the first checkpoint covers it
  // (it asks nothing, so section sizes and checkpoint sizes ignore it).
  const intro =
    s.intro && sk.nodes.length > 0
      ? introNode({ source: s.intro, gist: sk.gist, stops: sk.nodes.map((n) => n.title) })
      : undefined;
  const reqOf = (id: NodeId, own: NodeId[]) => {
    const req = gates.requires[id] ?? own;
    return intro && req.length === 0 ? [INTRO_NODE_ID] : req;
  };
  if (intro && gates.checkpoints[0]) gates.checkpoints[0].covers = [INTRO_NODE_ID, ...gates.checkpoints[0].covers];
  const { layout, lineOf, topo } = layoutMap([
    ...(intro ? [{ id: INTRO_NODE_ID, requires: [] }] : []),
    ...sk.nodes.map((n) => ({ id: n.id, requires: reqOf(n.id, n.requires) })),
    ...gates.checkpoints.map((c) => ({ id: c.id, requires: c.requires })),
  ]);
  const lines = [...new Set(topo.map((id) => lineOf[id] as string))];
  const gateOf = new Map(gates.checkpoints.flatMap((c) => c.covers.map((id) => [id, c.id] as const)));
  const mapNodes: CompiledMap["nodes"] = {};
  if (intro) {
    const gate = gateOf.get(INTRO_NODE_ID);
    mapNodes[INTRO_NODE_ID] = {
      id: INTRO_NODE_ID,
      requires: [],
      line: lineOf[INTRO_NODE_ID] as string,
      kind: "node",
      status: "playable",
      title: intro.title,
      teaser: "What the article says, and the questions ahead",
      estMinutes: 1,
      ...(gate ? { gate } : {}),
    };
  }
  for (const n of sk.nodes) {
    const ready = s.nodes[n.id];
    const gate = gateOf.get(n.id);
    mapNodes[n.id] = {
      id: n.id,
      requires: reqOf(n.id, n.requires),
      line: lineOf[n.id] as string,
      kind: "node",
      status: ready ? "playable" : "building",
      title: n.title,
      teaser: ready ? ready.hook.interaction.prompt : n.hookIdea,
      estMinutes: 3,
      ...(gate ? { gate } : {}),
    };
  }
  gates.checkpoints.forEach((c, k) => {
    mapNodes[c.id] = {
      id: c.id,
      requires: c.requires,
      line: lineOf[c.id] as string,
      kind: "checkpoint",
      status: c.covers.every((id) => id === INTRO_NODE_ID || s.nodes[id]) ? "playable" : "building",
      title: `Checkpoint ${k + 1}`,
      teaser: "",
      estMinutes: checkpointMinutes(c.size),
      covers: c.covers,
      size: c.size,
    };
  });
  const widgets: Partial<Record<WidgetId, number>> = {};
  for (const node of Object.values(s.nodes)) {
    for (const sc of node.screens) {
      if (sc.interaction?.kind === "widget") widgets[sc.interaction.widget.id] = 1;
      if (sc.visual?.kind === "widget") widgets[sc.visual.widget.id] = 1;
    }
    for (const c of node.cards ?? []) {
      if ((c.type === "try" || c.type === "check") && c.interaction.kind === "widget")
        widgets[c.interaction.widget.id] = 1;
      if ((c.type === "teach" || c.type === "try") && c.visual?.kind === "widget") widgets[c.visual.widget.id] = 1;
    }
  }
  const landmarks = Object.fromEntries(
    sk.nodes.filter((n) => n.landmark).map((n) => [n.id, { name: n.landmark as string }]),
  );
  const site = s.origin.kind === "url" ? (s.origin.site ?? new URL(s.origin.url).hostname) : "pasted text";
  const cautions = sk.nodes.filter((n) => n.caution).map((n) => `${n.title}: ${n.caution}`);
  const manifest: PackManifest = {
    schema: 2,
    id: s.packId,
    version: POCKET_VERSION,
    title: sk.title,
    subtitle: sk.gist,
    tagline: `AI-drafted from ${site}`,
    publisher: "learncroc (AI-drafted)",
    authors: [{ name: `AI-drafted from ${site}` }],
    license: "CC-BY-SA-4.0",
    lang: "en",
    level: s.familiarity === "lots" ? "advanced" : s.familiarity === "some" ? "intermediate" : "beginner",
    estMinutes: Math.max(3, sk.nodes.length * 3),
    tags: ["pocket-map"],
    category: "thinking",
    engine: ">=0.1.0 <1.0.0",
    widgets,
    profile: "pocket",
    // The map's design comes from its topic (Pond trail unless the title or gist suggests another).
    theme: designTheme(suggestMapDesign(sk.title, sk.gist), {
      world: sk.title,
      direction: "lr",
      ...(Object.keys(landmarks).length > 0 ? { landmarks } : {}),
      fieldNoteStyle: "card",
      gateName: "Checkpoint",
    }),
    entry: { ...(intro ? { suggestedStart: INTRO_NODE_ID } : sk.nodes[0] ? { suggestedStart: sk.nodes[0].id } : {}) },
    outcomes: sk.nodes.slice(0, 3).map((n) => n.objective),
    ai: { tutorNotes: [sk.gist, ...cautions].join(" ") },
    private: true,
    origin: s.origin,
    status: "draft",
  };
  const withIntro: Record<NodeId, PackNode> = intro ? { ...s.nodes, [INTRO_NODE_ID]: intro } : s.nodes;
  const nodes = Object.fromEntries(topo.filter((id) => withIntro[id]).map((id) => [id, withIntro[id] as PackNode]));
  const all = Object.values(nodes);
  const withoutHash: Omit<CompiledPack, "contentHash"> = {
    format: 2,
    manifest,
    map: {
      lines: lines.map((id, i) => ({
        id,
        title: i === 0 ? sk.title : `${sk.title} ${i + 1}`,
        color: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
        outcome: sk.nodes.find((n) => lineOf[n.id] === id)?.objective || sk.gist || sk.title,
      })),
      nodes: mapNodes,
      topo,
      layout,
    },
    nodes,
    stats: {
      nodes: sk.nodes.length + (intro ? 1 : 0),
      playable: all.length,
      planned: 0,
      checkpoints: gates.checkpoints.length,
      screens: all.reduce((n, x) => n + x.screens.length, 0),
      items: all.reduce((n, x) => n + x.items.length, 0),
      flashcards: all.reduce((n, x) => n + (x.flashcards?.length ?? 0), 0),
      words: 0,
    },
    compiledWith: { learncroc: LEARNCROC_VERSION, at: new Date(s.now()).toISOString() },
    ...(provisional ? { provisional: true } : {}),
  };
  return CompiledPackSchema.parse({ ...withoutHash, contentHash: contentHash(withoutHash) });
}

export function pocketDir(home: string, packId: string): string {
  if (!/^pm-[a-z2-7]{10}$/.test(packId)) throw new Error(`not a pocket pack id: ${packId}`);
  return join(home, "packs", "local", `${packId}@${POCKET_VERSION}`);
}

function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/** Write (or rewrite) the pocket pack. Figures first, then pack.json, so pack.json never points at a missing asset. */
export function writePocketPack(
  home: string,
  pack: CompiledPack,
  assets: Record<string, string>,
  readme: string,
): string {
  const dir = pocketDir(home, pack.manifest.id);
  mkdirSync(join(dir, "assets"), { recursive: true });
  for (const [path, body] of Object.entries(assets)) {
    if (!/^assets\/fig-[a-z0-9-]+\.svg$/.test(path)) continue;
    atomicWrite(join(dir, path), body);
  }
  atomicWrite(join(dir, "README.md"), readme);
  atomicWrite(join(dir, "pack.json"), JSON.stringify(pack, null, 2));
  return dir;
}

export function removePocketPack(home: string, packId: string): void {
  rmSync(pocketDir(home, packId), { recursive: true, force: true });
}

export function pocketReadme(title: string, origin: PackOrigin): string {
  const from =
    origin.kind === "url"
      ? `[${origin.title ?? origin.url}](${origin.url})${origin.license ? ` (${origin.license})` : ""}`
      : `pasted text ("${origin.title}")`;
  return `# ${title}\n\nAn article map AI-drafted by learncroc from ${from}. Review pending.\n\nOnly the link, cited passages (120 words or fewer each) and the generated lesson are stored; the full article text is not.\n`;
}

/** Node and screen ids are already lowercase slugs, so the path is predictable for previews. */
export function figurePath(nodeId: string, screenId: string): string {
  return `assets/fig-${slug(nodeId, 64)}-${slug(screenId, 32)}.svg`;
}
