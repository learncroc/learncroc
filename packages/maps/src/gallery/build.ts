/**
 * Builders for gallery maps: compact specs → compiled-pack-shaped objects (manifest + map) with
 * a provisional layout, and simulated learner views for any mix of states. Used by /dev/maps and tests
 * so every renderer and world can be seen before (and alongside) the real compiled packs.
 *
 * Specs list cards and (usually) one final gate. The builder cuts the cards, in reading order, into
 * sections of 2–3 (core `sectionSizes`) with a checkpoint after each, the way real packs are wired: a
 * checkpoint requires its section's last cards, and the next section's cards require the checkpoint.
 */
import type {
  CompiledMap,
  CompiledMapNode,
  CompiledPack,
  LintProfile,
  NodeId,
  NodeView,
  PackCategory,
  PackTheme,
} from "@learncroc/core";
import { sectionSizes } from "@learncroc/core";
import { satisfies, sectionsOf } from "../lib/graph";
import { provisionalLayout, topoOrder } from "../lib/layout";

export type GalleryPack = Pick<CompiledPack, "manifest" | "map">;

export interface NodeSpec {
  id: NodeId;
  line: string;
  /** Space-separated prerequisite ids. */
  requires?: string;
  title: string;
  teaser?: string;
  /** A checkpoint (gate). */
  gate?: boolean;
  planned?: boolean;
  building?: boolean;
  est?: number;
}

export interface GallerySpec {
  id: string;
  title: string;
  subtitle?: string;
  category: PackCategory;
  profile: LintProfile;
  theme: PackTheme;
  lines: { id: string; title: string; color: 1 | 2 | 3 | 4 | 5; outcome?: string }[];
  nodes: NodeSpec[];
  /** Cut the cards into sections with checkpoints (default true). State sheets turn it off. */
  sections?: boolean;
}

const reqs = (n: NodeSpec) => (n.requires ?? "").split(/\s+/).filter(Boolean);

/**
 * Insert checkpoints every 2–3 cards. Cards keep their same-section prerequisites; links into earlier
 * sections become a link to the previous checkpoint. The spec's final gate closes the last section;
 * planned cards hang off the final gate.
 */
export function sectionize(spec: GallerySpec): NodeSpec[] {
  const byId = new Map(spec.nodes.map((n) => [n.id, n] as const));
  const topo = topoOrder(
    Object.fromEntries(spec.nodes.map((n) => [n.id, { requires: reqs(n).filter((r) => byId.has(r)) }])),
  );
  const cards = topo.filter((id) => {
    const n = byId.get(id);
    return n && !n.gate && !n.planned;
  });
  if (cards.length < 2) return spec.nodes;
  const sizes = sectionSizes(cards.length, [2, 3]);
  const sectionOf = new Map<NodeId, number>();
  const members: NodeId[][] = [];
  let at = 0;
  sizes.forEach((size, k) => {
    members.push(cards.slice(at, at + size));
    for (const id of cards.slice(at, at + size)) sectionOf.set(id, k);
    at += size;
  });
  const finalSpec = spec.nodes.find((n) => n.gate && !n.planned);
  const K = sizes.length;
  const base = spec.theme.gateName ?? "Checkpoint";
  const gateId = (k: number) => (k === K - 1 && finalSpec ? finalSpec.id : `cp-${k + 1}`);
  const finalId = gateId(K - 1);
  const rewritten = new Map<NodeId, NodeSpec>();
  for (const id of cards) {
    const n = byId.get(id) as NodeSpec;
    const k = sectionOf.get(id) ?? 0;
    const same = reqs(n).filter((r) => sectionOf.get(r) === k);
    const requires = k > 0 && same.length === 0 ? [gateId(k - 1)] : same;
    rewritten.set(id, { ...n, requires: requires.join(" ") });
  }
  const gates: NodeSpec[] = members.map((ids, k) => {
    const sinks = ids.filter((id) => !ids.some((o) => reqs(rewritten.get(o) as NodeSpec).includes(id)));
    const last = ids[ids.length - 1] as NodeId;
    const titles = ids.map((id) => byId.get(id)?.title ?? id);
    const own = k === K - 1 && finalSpec ? finalSpec : undefined;
    return {
      id: gateId(k),
      line: own?.line ?? byId.get(last)?.line ?? spec.lines[0]?.id ?? "main",
      title: own?.title ?? `${base} ${k + 1}`,
      teaser: own?.teaser ?? `A short checkpoint on ${titles.join(", ")}.`,
      gate: true,
      ...(own?.building ? { building: true } : {}),
      requires: sinks.join(" "),
    };
  });
  const out: NodeSpec[] = [];
  const emitted = new Set<number>();
  const remaining = members.map((m) => new Set(m));
  for (const n of spec.nodes) {
    if (n.gate && !n.planned) continue;
    if (n.planned) {
      const requires = reqs(n).map((r) => (sectionOf.has(r) || r === finalSpec?.id ? finalId : r));
      out.push({ ...n, requires: [...new Set(requires)].join(" ") });
      continue;
    }
    const k = sectionOf.get(n.id);
    out.push(rewritten.get(n.id) ?? n);
    if (k === undefined) continue;
    remaining[k]?.delete(n.id);
    if (remaining[k]?.size === 0 && !emitted.has(k)) {
      emitted.add(k);
      out.push(gates[k] as NodeSpec);
    }
  }
  return out;
}

export function buildGalleryPack(spec: GallerySpec): GalleryPack {
  const nodes: Record<NodeId, CompiledMapNode> = {};
  const specNodes = spec.sections === false ? spec.nodes : sectionize(spec);
  for (const n of specNodes) {
    nodes[n.id] = {
      id: n.id,
      requires: (n.requires ?? "").split(/\s+/).filter(Boolean),
      line: n.line,
      kind: n.gate ? "checkpoint" : "node",
      status: n.planned ? "planned" : n.building ? "building" : "playable",
      title: n.title,
      teaser: n.teaser ?? `What sits behind “${n.title}”?`,
      ...(n.planned ? {} : { estMinutes: n.est ?? (n.gate ? 3 : 4) }),
    };
  }
  const layout = provisionalLayout({ lines: spec.lines, nodes, direction: spec.theme.direction });
  const map: CompiledMap = {
    lines: spec.lines.map((l) => ({
      id: l.id,
      title: l.title,
      color: l.color,
      outcome: l.outcome ?? `Explain ${l.title.toLowerCase()}`,
    })),
    nodes,
    topo: topoOrder(nodes),
    layout,
  };
  // Resolve gate covers and sizes the way compile does.
  for (const sec of sectionsOf(map)) {
    const gate = nodes[sec.checkpoint];
    if (gate) {
      gate.covers = sec.cards;
      gate.size = Math.min(5, Math.max(3, sec.cards.length + 1));
    }
    for (const c of sec.cards) {
      const card = nodes[c];
      if (card && !card.gate) card.gate = sec.checkpoint;
    }
  }
  const playable = specNodes.filter((n) => !n.planned);
  const manifest: GalleryPack["manifest"] = {
    schema: 2,
    id: spec.id,
    version: "0.1.0",
    title: spec.title,
    ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
    publisher: spec.profile === "pocket" ? "you" : "learncroc",
    authors: [{ name: "learncroc contributors" }],
    license: "CC-BY-SA-4.0",
    lang: "en",
    level: "beginner",
    estMinutes: playable.reduce((s, n) => s + (n.est ?? 4), 0),
    tags: [],
    category: spec.category,
    engine: ">=0.1.0 <1.0.0",
    widgets: {},
    profile: spec.profile,
    theme: spec.theme,
    entry: { ...(map.topo[0] ? { suggestedStart: map.topo[0] } : {}) },
    outcomes: [],
    status: "draft",
    ...(spec.profile === "pocket" ? { private: true } : {}),
  };
  return { manifest, map };
}

export interface SimulatedProgress {
  lit?: NodeId[];
  fading?: NodeId[];
  /** Cards closed (Done) but not yet passed at a checkpoint. */
  done?: NodeId[];
  inProgress?: NodeId[];
  durable?: NodeId[];
}

/** Views as the server would compute them for a given set of mastered / started stops. */
export function simulateViews(pack: GalleryPack, p: SimulatedProgress): Record<NodeId, NodeView> {
  const map = pack.map;
  const lit = new Set(p.lit ?? []);
  const fading = new Set(p.fading ?? []);
  const done = new Set(p.done ?? []);
  const started = new Set(p.inProgress ?? []);
  const durable = new Set(p.durable ?? []);
  const views: Record<NodeId, NodeView> = {};
  let suggested = false;
  for (const id of map.topo) {
    const node = map.nodes[id];
    if (!node) continue;
    const base = {
      id,
      durable: durable.has(id),
      suggested: false,
      missing: [] as NodeId[],
      fadingPrereqs: [] as NodeId[],
    };
    if (node.status === "planned") {
      views[id] = { ...base, state: "planned", brightness: 0 };
      continue;
    }
    if (node.status === "building") {
      views[id] = { ...base, state: "building", brightness: 0 };
      continue;
    }
    if (lit.has(id)) {
      views[id] = { ...base, state: "lit", brightness: 1, retrievability: 0.96 };
      continue;
    }
    if (fading.has(id)) {
      views[id] = { ...base, state: "fading", brightness: 0.58, retrievability: 0.58 };
      continue;
    }
    const missing = node.requires.filter((r) => !satisfies(views[r]?.state));
    if (missing.length) {
      views[id] = { ...base, state: "locked", brightness: 0, missing };
      continue;
    }
    const state = done.has(id) ? "done" : started.has(id) ? "in-progress" : "ready";
    const fadingPrereqs = node.requires.filter((r) => views[r]?.state === "fading");
    const view: NodeView = { ...base, state, brightness: 0, fadingPrereqs };
    if (state === "ready" && !suggested) {
      view.suggested = true;
      suggested = true;
    }
    views[id] = view;
  }
  return views;
}

export type Scenario = "fresh" | "journey" | "all-lit";

/** Ready-made progress for a gallery map: first visit, mid-journey (every state at once), everything lit. */
export function scenarioViews(pack: GalleryPack, scenario: Scenario): Record<NodeId, NodeView> {
  const map = pack.map;
  const playable = map.topo.filter((id) => map.nodes[id]?.status === "playable");
  if (scenario === "fresh") return simulateViews(pack, {});
  if (scenario === "all-lit") return simulateViews(pack, { lit: playable, durable: playable.slice(0, 2) });
  // Journey: the first sections passed (cards and gates lit, one card fading), then in the current
  // section one card Done and one In progress; everything past the next gate is Later.
  const secs = sectionsOf(map);
  if (secs.length === 0) {
    const cards = playable.filter((id) => map.nodes[id]?.kind !== "checkpoint");
    return simulateViews(pack, {
      ...(cards[0] ? { done: [cards[0]] } : {}),
      ...(cards[1] ? { inProgress: [cards[1]] } : {}),
    });
  }
  const passed = Math.max(secs.length > 1 ? 1 : 0, Math.floor(secs.length * 0.45));
  const lit: NodeId[] = [];
  for (const sec of secs.slice(0, passed)) lit.push(...sec.cards, sec.checkpoint);
  const litCards = lit.filter((id) => map.nodes[id]?.kind !== "checkpoint");
  const fade = litCards.length > 2 ? [litCards[1] as NodeId] : [];
  const current = secs[passed];
  const done = current?.cards[0] ? [current.cards[0]] : [];
  const started = current && current.cards.length > 2 && current.cards[1] ? [current.cards[1]] : [];
  return simulateViews(pack, {
    lit: lit.filter((id) => !fade.includes(id)),
    fading: fade,
    durable: fade.concat(litCards.slice(0, 1)),
    done,
    inProgress: started,
  });
}
