/**
 * Scene: the compiled layout re-routed in a renderer's edge style. Renderers, the effects layer, the
 * token and the moments all read the same routes, so light always flows along the drawn track.
 *
 * Routes start from the compiled endpoints and try a few shapes per style; the first one that keeps
 * clear of every other stop wins (an edge must never look like it passes through a stop it doesn't
 * serve). The compiled polyline is the last resort.
 */
import type { CompiledMap, MapEdge, NodeId, RendererId } from "@learncroc/core";
import {
  catmullRomPoints,
  chamferPoints,
  linePath,
  type Pt,
  polylineDistance,
  polylineLength,
  roundedPath,
  simplify,
} from "./geometry";
import { finalGate, mapGraph } from "./graph";
import { rng } from "./random";

export type RouteStyle = "octilinear" | "manhattan" | "smooth" | "sketch";

export const ROUTE_STYLE: Record<RendererId, RouteStyle> = {
  metro: "octilinear",
  circuit: "manhattan",
  atlas: "smooth",
  sketchbook: "sketch",
};

export interface SceneNode {
  id: NodeId;
  x: number;
  y: number;
  line: string;
  /** 0..4 into theme.lines. */
  color: number;
  /** A checkpoint entry (drawn as a gate across the track). */
  gate: boolean;
  /** The map's last playable gate (1.8×, with the world landmark). */
  final: boolean;
  interchange: boolean;
  status: "playable" | "planned" | "building";
  title: string;
}

export interface SceneEdge {
  key: string;
  from: NodeId;
  to: NodeId;
  kind: MapEdge["kind"];
  /** Control points of the route (before smoothing). */
  control: Pt[];
  /** Dense polyline matching the drawn path (for flows and travel). */
  points: Pt[];
  d: string;
  length: number;
}

export interface Scene {
  width: number;
  height: number;
  direction: "lr" | "bt";
  cell: { w: number; h: number };
  nodes: SceneNode[];
  byId: Map<NodeId, SceneNode>;
  edges: SceneEdge[];
  /** Edges keyed `${from}>${to}`. */
  edgeByKey: Map<string, SceneEdge>;
}

/** Stops are kept at least this far (layout px) from edges that don't serve them. */
export const CLEARANCE = 22;

const cache = new WeakMap<CompiledMap, Map<RouteStyle, Scene>>();

export function buildScene(map: CompiledMap, style: RouteStyle, seed = "map"): Scene {
  let perMap = cache.get(map);
  if (!perMap) {
    perMap = new Map();
    cache.set(map, perMap);
  }
  const hit = perMap.get(style);
  if (hit) return hit;

  const g = mapGraph(map);
  const { layout } = map;
  const nodes: SceneNode[] = [];
  const last = finalGate(map);
  for (const id of g.ids) {
    const p = layout.nodes[id];
    const n = map.nodes[id];
    if (!p || !n) continue;
    nodes.push({
      id,
      x: p.x,
      y: p.y,
      line: n.line,
      color: g.colorIndex.get(id) ?? 0,
      gate: n.kind === "checkpoint",
      final: id === last,
      interchange: g.interchanges.has(id),
      status: n.status,
      title: n.title,
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const edgeList = layout.edges.length ? layout.edges : synthEdges(map);
  const random = rng(`${seed}:${style}`);
  const edges: SceneEdge[] = [];
  for (const e of edgeList) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const others = nodes.filter((n) => n.id !== a.id && n.id !== b.id).map((n): Pt => [n.x, n.y]);
    const control = route(style, [a.x, a.y], [b.x, b.y], others, layout.cell, layout.direction, e.points, random);
    const points = style === "smooth" || style === "sketch" ? catmullRomPoints(control, 10) : expand(style, control);
    const d =
      style === "octilinear"
        ? roundedPath(control, 16)
        : style === "manhattan"
          ? linePath(chamferPoints(control, 12))
          : linePath(points);
    edges.push({
      key: `${e.from}>${e.to}`,
      from: e.from,
      to: e.to,
      kind: e.kind,
      control,
      points,
      d,
      length: polylineLength(points),
    });
  }
  const scene: Scene = {
    width: layout.width,
    height: layout.height,
    direction: layout.direction,
    cell: layout.cell,
    nodes,
    byId,
    edges,
    edgeByKey: new Map(edges.map((e) => [e.key, e] as const)),
  };
  perMap.set(style, scene);
  return scene;
}

function expand(style: RouteStyle, control: Pt[]): Pt[] {
  return style === "manhattan" ? chamferPoints(control, 12) : control;
}

/** Edges from `requires` when a (provisional) layout carries none. */
function synthEdges(map: CompiledMap): MapEdge[] {
  const out: MapEdge[] = [];
  for (const n of Object.values(map.nodes)) {
    for (const r of n.requires) {
      const a = map.layout.nodes[r];
      const b = map.layout.nodes[n.id];
      if (!a || !b) continue;
      out.push({
        from: r,
        to: n.id,
        kind: map.nodes[r]?.line === n.line ? "line" : "interchange",
        points: [
          [a.x, a.y],
          [b.x, b.y],
        ],
      });
    }
  }
  return out;
}

// ── routing in a normalised frame: "along" is +u (the map's reading direction), "across" is v.

type Frame = { to(p: Pt): Pt; from(p: Pt): Pt };
const LR: Frame = { to: (p) => p, from: (p) => p };
const BT: Frame = { to: ([x, y]) => [-y, x], from: ([u, v]) => [v, -u] };

function route(
  style: RouteStyle,
  A: Pt,
  B: Pt,
  others: Pt[],
  cell: { w: number; h: number },
  direction: "lr" | "bt",
  compiled: MapEdge["points"],
  random: () => number,
): Pt[] {
  const f = direction === "bt" ? BT : LR;
  const a = f.to(A);
  const b = f.to(B);
  const lane = (direction === "bt" ? cell.w : cell.h) / 2;
  const laneU = (direction === "bt" ? cell.h : cell.w) / 2;
  const candidates = [
    ...(style === "octilinear"
      ? octilinear(a, b, lane)
      : style === "manhattan"
        ? manhattan(a, b, lane)
        : smooth(a, b, lane, style === "sketch" ? 0.06 : 0.12, random)),
    ...columnLanes(a, b, laneU).map((c) => (style === "smooth" || style === "sketch" ? softenLane(c) : c)),
  ].map((c) => simplify(c.map(f.from)));
  const sampled = (c: Pt[]) => (style === "smooth" || style === "sketch" ? catmullRomPoints(c, 8) : c);
  // Among routes that keep clear of other stops, take the shortest (bends cost a little), so a long
  // detour only wins when nothing simpler fits. Candidate order breaks ties.
  let best: Pt[] | undefined;
  let bestClear = -1;
  let winner: Pt[] | undefined;
  let winnerCost = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const pts = sampled(c);
    const clear = others.reduce((m, o) => Math.min(m, polylineDistance(o, pts)), Number.POSITIVE_INFINITY);
    if (clear >= CLEARANCE) {
      // Roads and pencil lines keep their authored bow: the first clear candidate wins outright.
      if (style === "smooth" || style === "sketch") return c;
      const cost = polylineLength(c) + (c.length - 2) * 24;
      if (cost < winnerCost - 0.5) {
        winnerCost = cost;
        winner = c;
      }
    } else if (clear > bestClear) {
      bestClear = clear;
      best = c;
    }
  }
  if (winner) return winner;
  const fallback = compiled.length >= 2 ? compiled.map((p): Pt => [p[0], p[1]]) : undefined;
  if (fallback) {
    const clear = others.reduce((m, o) => Math.min(m, polylineDistance(o, fallback)), Number.POSITIVE_INFINITY);
    if (clear > bestClear) return fallback;
  }
  return best ?? [A, B];
}

/** Metro: 0/45/90° segments. Middle diagonal, early, late, then detours through the lanes between rows. */
function octilinear(a: Pt, b: Pt, lane: number): Pt[][] {
  const du = b[0] - a[0];
  const dv = b[1] - a[1];
  const su = Math.sign(du) || 1;
  const sv = Math.sign(dv) || 1;
  const adu = Math.abs(du);
  const adv = Math.abs(dv);
  const out: Pt[][] = [];
  if (adv < 0.5) out.push([a, b]);
  if (adu >= adv) {
    const h = (adu - adv) / 2;
    out.push([a, [a[0] + su * h, a[1]], [b[0] - su * h, b[1]], b]);
    out.push([a, [a[0] + su * adv, b[1]], b]);
    out.push([a, [b[0] - su * adv, a[1]], b]);
  } else {
    const v = (adv - adu) / 2;
    out.push([a, [a[0], a[1] + sv * v], [b[0], b[1] - sv * v], b]);
    out.push([a, [b[0], a[1] + sv * adu], b]);
  }
  // Detours: leave on a 45°, run along the lane above or below both rows, come back on a 45°.
  for (const side of [-1, 1]) {
    const laneV = side < 0 ? Math.min(a[1], b[1]) - lane : Math.max(a[1], b[1]) + lane;
    const offA = Math.abs(laneV - a[1]);
    const offB = Math.abs(laneV - b[1]);
    if (offA + offB < adu) out.push([a, [a[0] + su * offA, laneV], [b[0] - su * offB, laneV], b]);
  }
  return out;
}

/**
 * Column lanes: run across in the gap between columns (halfway between stops), then along the target's
 * row. Rescues long edges that would otherwise cut through a stack of stops. Valid in every style
 * (right angles are rounded or chamfered later).
 */
function columnLanes(a: Pt, b: Pt, laneU: number): Pt[][] {
  const su = Math.sign(b[0] - a[0]) || 1;
  const out: Pt[][] = [];
  for (const lu of [a[0] + su * laneU, b[0] - su * laneU]) {
    if ((lu - a[0]) * su <= 0 || (b[0] - lu) * su <= 0) continue;
    out.push([a, [lu, a[1]], [lu, b[1]], b]);
  }
  return out;
}

/** Pull a lane route's corners in a little so a spline through it doesn't overshoot into a loop. */
function softenLane(c: Pt[]): Pt[] {
  const [a, p1, p2, b] = c as [Pt, Pt, Pt, Pt];
  const dv = b[1] - a[1];
  return [a, [p1[0], a[1] + dv * 0.18], [p2[0], b[1] - dv * 0.18], b];
}

/** Circuit: horizontal-vertical-horizontal traces (chamfered later), then lane detours. */
function manhattan(a: Pt, b: Pt, lane: number): Pt[][] {
  const du = b[0] - a[0];
  const out: Pt[][] = [];
  if (Math.abs(b[1] - a[1]) < 0.5) out.push([a, b]);
  for (const k of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    const mu = a[0] + du * k;
    out.push([a, [mu, a[1]], [mu, b[1]], b]);
  }
  const step = Math.min(28, Math.abs(du) / 4);
  const su = Math.sign(du) || 1;
  for (const side of [-1, 1]) {
    const laneV = side < 0 ? Math.min(a[1], b[1]) - lane : Math.max(a[1], b[1]) + lane;
    out.push([
      a,
      [a[0] + su * step, a[1]],
      [a[0] + su * step, laneV],
      [b[0] - su * step, laneV],
      [b[0] - su * step, b[1]],
      b,
    ]);
  }
  return out;
}

/** Atlas roads and sketch lines: gentle curves through a bowed midpoint; detours bow into the lanes. */
function smooth(a: Pt, b: Pt, lane: number, bow: number, random: () => number): Pt[][] {
  const du = b[0] - a[0];
  const dv = b[1] - a[1];
  const len = Math.hypot(du, dv) || 1;
  const nu = -dv / len;
  const nv = du / len;
  // A gentle, seeded bow: always some curve (a road, not a ruler), in a random direction.
  const wobble = (random() < 0.5 ? -1 : 1) * (0.55 + random() * 0.45);
  const out: Pt[][] = [];
  for (const s of [wobble, -wobble, wobble * 0.35, 0]) {
    const k = s * bow * len;
    out.push([a, [a[0] + du * 0.5 + nu * k, a[1] + dv * 0.5 + nv * k], b]);
  }
  for (const side of [-1, 1]) {
    const laneV = side < 0 ? Math.min(a[1], b[1]) - lane : Math.max(a[1], b[1]) + lane;
    out.push([a, [a[0] + du * 0.22, laneV], [a[0] + du * 0.78, laneV], b]);
  }
  return out;
}

/** A polyline through a sequence of stops, following drawn edges where they exist (straight otherwise). */
export function routeThrough(scene: Scene, ids: NodeId[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as NodeId;
    const n = scene.byId.get(id);
    if (!n) continue;
    if (i === 0 || out.length === 0) {
      out.push([n.x, n.y]);
      continue;
    }
    const prev = ids[i - 1] as NodeId;
    const fwd = scene.edgeByKey.get(`${prev}>${id}`);
    const back = fwd ? undefined : scene.edgeByKey.get(`${id}>${prev}`);
    const pts = fwd ? fwd.points : back ? [...back.points].reverse() : [[n.x, n.y] as Pt];
    out.push(...pts.slice(fwd || back ? 1 : 0));
  }
  return out;
}
