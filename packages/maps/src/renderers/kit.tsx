/**
 * Shared renderer kit: the derived draw model (states, section fog, hover relations), SVG defs, the
 * section veil, gate helpers (swing, halo, rays), card flags and the small shape-coded state marks every
 * renderer reuses (rays, half-disc, progress arc, building dash, the Done tick).
 *
 * Colour rules: Lumen only for mastery (lit), the line colour plus a ground tick for done, Sea for ready,
 * Ember for fading. No red. Every state differs by shape as well as colour.
 */
import type { LandmarkGlyph, NodeId, NodeState, NodeView, RendererId } from "@learncroc/core";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { dawnColors, type WorldColors, worldColors } from "../lib/color";
import {
  type EdgeState,
  edgeState,
  everythingLit,
  type FogLevel,
  fogLevels,
  mapGraph,
  nextGate,
  viewFor,
} from "../lib/graph";
import { glyphSize, placeLineTitles } from "../lib/labels";
import { buildScene, ROUTE_STYLE, type Scene, type SceneEdge, type SceneNode } from "../lib/scene";
import type { MapRendererProps } from "../types";
import { LandmarkArt } from "./glyphs";

export type Relation = "none" | "self" | "prereq" | "dependent" | "dimmed";

export interface DrawNode extends SceneNode {
  view: NodeView;
  state: NodeState;
  fog: FogLevel;
  rel: Relation;
  focus: boolean;
  /** Pulses once: a missing prerequisite of the hovered Later card, or an unfinished cover of a hovered gate. */
  pulse: boolean;
  landmark?: { name: string; glyph?: LandmarkGlyph };
}

export interface DrawEdge extends SceneEdge {
  state: EdgeState;
  rel: "none" | "up" | "down" | "dimmed";
  /** Either end is two or more gates away (muted). */
  fogged: boolean;
  /** --w-1..5 colour index of the edge (the target's line for line edges, the source's otherwise). */
  color: number;
}

export interface DrawModel {
  scene: Scene;
  nodes: DrawNode[];
  edges: DrawEdge[];
  colors: WorldColors;
  /** Unique, url()-safe id prefix for defs. */
  uid: string;
  dawn: boolean;
  seed: string;
  /** Show card-level detail (semantic zoom: below 0.8× only regions, ready cards and gates). */
  detail: boolean;
  props: MapRendererProps;
  renderer: RendererId;
}

export function useDrawModel(props: MapRendererProps, renderer: RendererId): DrawModel {
  const rawId = useId();
  const uid = `lm${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const { pack, views, theme, hoverId, focusId, fog, zoom } = props;
  const map = pack.map;
  const seed = pack.manifest.id;
  const scene = buildScene(map, ROUTE_STYLE[renderer], seed);
  const colors = useMemo(() => worldColors(theme), [theme]);
  const fogMap = useMemo(() => (fog ? fogLevels(map, views) : undefined), [fog, map, views]);
  const dawn = useMemo(() => everythingLit(map, views), [map, views]);
  const g = mapGraph(map);
  const hoverPrereqs = hoverId ? new Set(g.prereqs.get(hoverId) ?? []) : undefined;
  const hoverDeps = hoverId ? new Set(g.dependents.get(hoverId) ?? []) : undefined;
  const hoverView = hoverId ? viewFor(map, views, hoverId) : undefined;
  const hoverGate = hoverId ? map.nodes[hoverId]?.kind === "checkpoint" : false;
  const pulseSet = new Set(
    hoverView?.state === "locked"
      ? hoverGate
        ? (g.prereqs.get(hoverId as NodeId) ?? []).filter((p) => viewFor(map, views, p).state !== "done")
        : hoverView.missing
      : [],
  );

  const nodes: DrawNode[] = scene.nodes.map((n) => {
    const view = viewFor(map, views, n.id);
    const rel: Relation = !hoverId
      ? "none"
      : n.id === hoverId
        ? "self"
        : hoverPrereqs?.has(n.id)
          ? "prereq"
          : hoverDeps?.has(n.id)
            ? "dependent"
            : "dimmed";
    const lm = theme.landmarks?.[n.id];
    return {
      ...n,
      view,
      state: view.state,
      fog: fogMap?.get(n.id) ?? 0,
      rel,
      focus: focusId === n.id,
      pulse: pulseSet.has(n.id),
      ...(lm ? { landmark: { name: lm.name, ...(lm.glyph ? { glyph: lm.glyph } : {}) } } : {}),
    };
  });
  const fogById = new Map(nodes.map((n) => [n.id, n.fog] as const));
  const edges: DrawEdge[] = scene.edges.map((e) => {
    const from = scene.byId.get(e.from);
    const to = scene.byId.get(e.to);
    return {
      ...e,
      state: edgeState(map, views, e),
      rel: !hoverId ? "none" : e.to === hoverId ? "up" : e.from === hoverId ? "down" : "dimmed",
      fogged: (fogById.get(e.from) ?? 0) === 2 || (fogById.get(e.to) ?? 0) === 2,
      color: e.kind === "line" ? (to?.color ?? 0) : (from?.color ?? 0),
    };
  });
  return { scene, nodes, edges, colors, uid, dawn, seed, detail: zoom >= 0.8, props, renderer };
}

export const lineColor = (m: DrawModel, index: number): string => m.colors.lines[index] ?? m.colors.lines[0];

/** Opacity of a glyph under section fog (behind the next gate 70%, further 45%) and hover. */
export function nodeOpacity(n: DrawNode): number {
  const fog = n.fog === 2 ? 0.45 : n.fog === 1 ? 0.7 : 1;
  const hover = n.rel === "dimmed" ? 0.6 : 1;
  return n.rel === "self" ? 1 : fog * hover;
}

export function edgeOpacity(e: DrawEdge): number {
  const fog = e.fogged ? 0.55 : 1;
  const hover = e.rel === "dimmed" ? 0.45 : 1;
  return fog * hover;
}

/** Edge stroke boost under hover. */
export const edgeBoost = (e: DrawEdge): number => (e.rel === "up" || e.rel === "down" ? 1.6 : 1);

/** Extra width for laid (done) track: +1 px over open track. */
export const DONE_EXTRA = 1;

/** The <defs> shared by every renderer: Lumen glow, ready halo, fog blur, dawn wash. */
export function SharedDefs({ m }: { m: DrawModel }) {
  const { uid } = m;
  return (
    <>
      <filter id={`${uid}-glow`} x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b" />
        <feColorMatrix in="b" type="matrix" values="1 0 0 0 0.2  0 1 0 0 0.15  0 0 1 0 0  0 0 0 0.9 0" result="g" />
        <feMerge>
          <feMergeNode in="g" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="18" />
      </filter>
      <radialGradient id={`${uid}-lumen`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="var(--lumen)" stopOpacity="0.75" />
        <stop offset="55%" stopColor="var(--lumen)" stopOpacity="0.22" />
        <stop offset="100%" stopColor="var(--lumen)" stopOpacity="0" />
      </radialGradient>
    </>
  );
}

/**
 * The section veil (replaces the fog wash): a soft ground-tinted scrim over everything past the next
 * unopened gate. It starts at the gate's x (y on bottom-to-top maps) and ramps from 0 to 0.16 over 160
 * layout px, then stays flat. A wash, never a blur. When the gate opens it slides on to the next gate.
 */
export function SectionVeil({ m }: { m: DrawModel }) {
  const map = m.props.pack.map;
  const gate = m.props.fog ? nextGate(map, m.props.views) : undefined;
  const at = gate ? m.scene.byId.get(gate) : undefined;
  const b = groundBounds(m);
  const bt = m.scene.direction === "bt";
  const id = `${m.uid}-veil`;
  const RAMP = 160;
  // Start a little past the gate so the gate itself stays clear.
  const offset = at ? (bt ? at.y - 30 : at.x + 30) : bt ? b.y - 2 * RAMP : b.x + b.w + RAMP;
  const shift = bt ? `translate(0px, ${offset}px)` : `translate(${offset}px, 0px)`;
  const span = bt ? b.h : b.w;
  return (
    <g aria-hidden data-layer="veil" data-veil-at={gate ?? ""} pointerEvents="none">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={bt ? 0 : RAMP} y2={bt ? -RAMP : 0}>
          <stop offset="0%" stopColor={m.colors.ground} stopOpacity="0" />
          <stop offset="100%" stopColor={m.colors.ground} stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <g
        style={{
          transform: shift,
          opacity: at ? 1 : 0,
          transition: m.props.reducedMotion
            ? "opacity 120ms linear"
            : "transform 900ms cubic-bezier(.2,.8,.2,1), opacity 600ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <rect
          x={bt ? b.x : 0}
          y={bt ? -span * 2 : b.y}
          width={bt ? b.w : span * 2}
          height={bt ? span * 2 : b.h}
          fill={`url(#${id})`}
        />
      </g>
    </g>
  );
}

/** Area the ground and texture cover: the layout plus a margin, so panning never shows a hard edge. */
export function groundBounds(m: DrawModel, pad = 480) {
  return { x: -pad, y: -pad, w: m.scene.width + pad * 2, h: m.scene.height + pad * 2 };
}

/** Everything lit: the ground shifts towards dawn (craft). Crossfades in over the light-up duration. */
export function DawnWash({ m }: { m: DrawModel }) {
  const b = groundBounds(m);
  const dawn = dawnColors(m.props.theme);
  const vertical = m.scene.direction === "bt";
  return (
    <g aria-hidden data-layer="dawn">
      <defs>
        <linearGradient id={`${m.uid}-dawn`} x1="0" y1="0" x2={vertical ? "1" : "0"} y2={vertical ? "0" : "1"}>
          <stop offset="0%" stopColor={dawn.top} stopOpacity="0" />
          <stop offset="65%" stopColor={dawn.top} stopOpacity="0.5" />
          <stop offset="100%" stopColor={dawn.horizon} stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        fill={`url(#${m.uid}-dawn)`}
        opacity={m.dawn ? 1 : 0}
        style={{ transition: m.props.reducedMotion ? undefined : "opacity 2400ms cubic-bezier(.65,0,.35,1)" }}
      />
    </g>
  );
}

/** Breathing for ready stops (3.2 s) — the only idle motion. Static ring in reduced motion. */
export function ReadyHalo({ r, reduced, color = "var(--sea)" }: { r: number; reduced: boolean; color?: string }) {
  if (reduced) return <circle r={r + 4} fill="none" stroke={color} strokeWidth={2} opacity={0.9} />;
  return (
    <circle r={r + 3} fill="none" stroke={color} strokeWidth={2.5} opacity={0.6}>
      <animate attributeName="r" values={`${r + 2};${r + 8};${r + 2}`} dur="3.2s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.75;0.15;0.75" dur="3.2s" repeatCount="indefinite" />
    </circle>
  );
}

/** Fading flicker (6 s, gentle; never more than 3 flashes per second). */
export function Flicker({ reduced }: { reduced: boolean }) {
  if (reduced) return null;
  return <animate attributeName="opacity" values="0.95;0.7;0.9;0.75;0.95" dur="6s" repeatCount="indefinite" />;
}

/** A missing prerequisite pulses once when a Later stop is hovered. */
export function OncePulse({ r, reduced }: { r: number; reduced: boolean }) {
  if (reduced) return <circle r={r + 6} fill="none" stroke="var(--sea)" strokeWidth={2} strokeDasharray="3 3" />;
  return (
    <circle r={r} fill="none" stroke="var(--sea)" strokeWidth={3} opacity={0}>
      <animate ref={beginOnMount} attributeName="r" from={r} to={r + 18} dur="0.9s" begin="indefinite" fill="freeze" />
      <animate ref={beginOnMount} attributeName="opacity" values="0.9;0" dur="0.9s" begin="indefinite" fill="freeze" />
    </circle>
  );
}

/**
 * One-shot SMIL animations must start when they mount, not at document time 0 (which has long passed
 * on a page that has been open a while). Use with begin="indefinite".
 */
export function beginOnMount(el: SVGElement | null): void {
  const anim = el as (SVGElement & { beginElement?: () => void }) | null;
  if (anim && typeof anim.beginElement === "function") {
    try {
      anim.beginElement();
    } catch {
      // Not attached to a rendered document (tests): the static end state is fine.
    }
  }
}

/** The Done tick: a short pen tick in the ground colour, drawn over a disc filled in the line colour. Never Lumen. */
export function DoneTick({ size, color }: { size: number; color: string }) {
  const k = size / 6;
  return (
    <path
      d={`M${-3.5 * k} ${0.2 * k}l${2.4 * k} ${2.4 * k} ${4.6 * k} ${-5 * k}`}
      fill="none"
      stroke={color}
      strokeWidth={Math.max(1.5, k * 1.6)}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** Four-point spark. */
export function Spark({ size, fill = "var(--lumen-text)" }: { size: number; fill?: string }) {
  const s = size;
  const k = s * 0.28;
  return <path d={`M0 ${-s}L${k} ${-k}L${s} 0L${k} ${k}L0 ${s}L${-k} ${k}L${-s} 0L${-k} ${-k}Z`} fill={fill} />;
}

/** Eight rays around a lit disc. */
export function Rays({
  r,
  length,
  color = "var(--lumen)",
  width = 2,
}: {
  r: number;
  length: number;
  color?: string;
  width?: number;
}) {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    rays.push(
      <line
        key={i}
        x1={c * r}
        y1={s * r}
        x2={c * (r + length)}
        y2={s * (r + length)}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />,
    );
  }
  return <g>{rays}</g>;
}

/** Lower half of a disc (fading). */
export const halfDiscPath = (r: number) => `M${-r} 0A${r} ${r} 0 0 0 ${r} 0Z`;
/** Left half of a disc. */
export const leftHalfPath = (r: number) => `M0 ${-r}A${r} ${r} 0 0 0 0 ${r}Z`;

/** Partial ring (in progress): a third of the way round from 12 o'clock. */
export function ProgressArc({ r, color = "var(--sea)", width = 3 }: { r: number; color?: string; width?: number }) {
  const a = (Math.PI * 2) / 3;
  const x = Math.sin(a) * r;
  const y = -Math.cos(a) * r;
  return (
    <path
      d={`M0 ${-r}A${r} ${r} 0 0 1 ${x} ${y}`}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
    />
  );
}

/** Building: a ring with a rotating dash (static in reduced motion). */
export function BuildingRing({ r, color, reduced }: { r: number; color: string; reduced: boolean }) {
  return (
    <g>
      <circle r={r} fill="none" stroke={color} strokeWidth={2} opacity={0.5} />
      <path d={`M0 ${-r}A${r} ${r} 0 0 1 ${r} 0`} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round">
        {reduced ? null : (
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0"
            to="360"
            dur="1.6s"
            repeatCount="indefinite"
          />
        )}
      </path>
    </g>
  );
}

/** Planned: a dashed square ("help write this stop"). */
export function PlannedSquare({ size, color }: { size: number; color: string }) {
  return (
    <rect
      x={-size / 2}
      y={-size / 2}
      width={size}
      height={size}
      rx={3}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeDasharray="4 3"
    />
  );
}

/** Focus halo drawn in the art (the button also has a focus ring). */
export function FocusHalo({ r }: { r: number }) {
  return <circle r={r + 9} fill="none" stroke="var(--focus)" strokeWidth={3} opacity={0.9} />;
}

/** Light pool behind lit stops: the stop "casts light on its neighbours". */
export function LightPool({ m, n, r }: { m: DrawModel; n: DrawNode; r: number }) {
  if (n.state !== "lit" && n.state !== "fading") return null;
  const k = n.state === "fading" ? Math.max(0.25, n.view.brightness) * 0.6 : 1;
  return <circle r={r} fill={`url(#${m.uid}-lumen)`} opacity={0.55 * k} />;
}

/** Group translated to a node with its hover/fog opacity; the glyph scales a touch under hover. */
export function At({ n, children }: { n: DrawNode; children: ReactNode }) {
  const scale = n.rel === "self" ? (n.gate ? 1.05 : 1.08) : 1;
  return (
    <g
      transform={`translate(${n.x} ${n.y})`}
      data-node={n.id}
      data-state={n.state}
      data-fog={n.fog}
      data-kind={n.gate ? "checkpoint" : "node"}
    >
      <g
        style={{
          opacity: nodeOpacity(n),
          transform: `scale(${scale})`,
          transformBox: "fill-box",
          transformOrigin: "center",
          transition: "opacity 600ms cubic-bezier(.2,.8,.2,1), transform 140ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {children}
      </g>
    </g>
  );
}

// ── gates

/** Leaf angle per gate state: closed (Locked), ajar 12° (Ready, In progress), swung 80° (Open). */
export function gateAngle(s: NodeState): number {
  if (s === "lit" || s === "done" || s === "fading") return 80;
  if (s === "ready" || s === "in-progress") return 12;
  return 0;
}

export const gateIsOpen = (s: NodeState) => s === "lit" || s === "done" || s === "fading";

/** A one-overshoot settle (springs.wobble in motion.ts: 300/12), for the gate swing. */
const wobble = (t: number) => 1 - Math.exp(-5.2 * t) * Math.cos(2.3 * Math.PI * t);

/**
 * Tween a gate's leaf angle when its state changes (700 ms on a wobble spring). The first render jumps
 * to the angle; reduced motion always jumps. Returns the angle to draw this frame.
 */
export function useSwing(target: number, reduced: boolean): number {
  const [angle, setAngle] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (from.current === target) return;
    const start = from.current;
    from.current = target;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : undefined;
    if (reduced || !raf) {
      setAngle(target);
      return;
    }
    let t0: number | undefined;
    let id = 0;
    const frame = (now: number) => {
      t0 ??= now;
      const t = Math.min(1, (now - t0) / 700);
      setAngle(start + (target - start) * wobble(t));
      if (t < 1) id = raf(frame);
    };
    id = raf(frame);
    return () => cancelAnimationFrame(id);
  }, [target, reduced]);
  return angle;
}

/** A gate is drawn in a frame where the track runs along +x; bottom-to-top maps turn it a quarter. */
export function GateFrame({ m, children }: { m: DrawModel; children: ReactNode }) {
  return m.scene.direction === "bt" ? <g transform="rotate(-90)">{children}</g> : <g>{children}</g>;
}

/** Ready gate halo: the one allowed idle on a gate (3.2 s breathing). Static ring when reduced. */
export function GateHalo({ w, h, reduced }: { w: number; h: number; reduced: boolean }) {
  const rx = w / 2 + 8;
  const ry = h / 2 + 8;
  if (reduced) return <ellipse rx={rx} ry={ry} fill="none" stroke="var(--sea)" strokeWidth={2} opacity={0.9} />;
  return (
    <ellipse rx={rx} ry={ry} fill="none" stroke="var(--sea)" strokeWidth={2.5} opacity={0.6}>
      <animate attributeName="rx" values={`${rx - 2};${rx + 5};${rx - 2}`} dur="3.2s" repeatCount="indefinite" />
      <animate attributeName="ry" values={`${ry - 2};${ry + 5};${ry - 2}`} dur="3.2s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.75;0.15;0.75" dur="3.2s" repeatCount="indefinite" />
    </ellipse>
  );
}

/** Lumen rays fanning out of an open gate's opening, both ways along the track. */
export function GateRays({ h, len = 10 }: { h: number; len?: number }) {
  const rays: ReactNode[] = [];
  for (const side of [-1, 1]) {
    for (const a of [-34, -12, 12, 34]) {
      const r = (a * Math.PI) / 180;
      const x1 = side * 10 * Math.cos(r);
      const y1 = Math.sin(r) * h * 0.32;
      rays.push(
        <line
          key={`${side}${a}`}
          x1={x1}
          y1={y1}
          x2={x1 + side * len * Math.cos(r)}
          y2={y1 + len * Math.sin(r)}
          stroke="var(--lumen)"
          strokeWidth={2.2}
          strokeLinecap="round"
        />,
      );
    }
  }
  return <g data-part="gate-rays">{rays}</g>;
}

/** What a renderer's gate art gets to draw with (canonical frame: the track runs along +x). */
export interface GateDraw {
  /** Leaf angle in degrees: 0 closed, 12 ajar, 80 open (tweened). */
  angle: number;
  /** Extent across the track and along it (layout px). */
  across: number;
  along: number;
  /** Stroke tone for the state: muted (Locked), Sea (Ready, In progress), Lumen (Open). */
  tone: string;
  state: NodeState;
  open: boolean;
  ready: boolean;
  planned: boolean;
  /** The gate's line colour. */
  color: string;
}

/**
 * A gate glyph: the renderer's barrier (`draw`) plus everything gates share: the focus ring, the Sea
 * breathing halo (Ready, In progress), the quarter arc (In progress), Lumen rays and glow (Open), the
 * final gate's landmark behind it, and the once-pulse. Bottom-to-top maps turn the barrier a quarter
 * unless it is drawn `upright` (atlas arches stand up on every map).
 */
export function GateGlyph({
  m,
  n,
  draw,
  upright,
}: {
  m: DrawModel;
  n: DrawNode;
  draw(p: GateDraw): ReactNode;
  upright?: boolean;
}) {
  const reduced = m.props.reducedMotion;
  const s = n.state;
  const planned = n.status === "planned" || s === "planned";
  const angle = useSwing(planned ? 0 : gateAngle(s), reduced);
  const size = nodeGlyph(m, n);
  const bt = m.scene.direction === "bt";
  const across = upright ? size.h : bt ? size.w : size.h;
  const along = upright ? size.w : bt ? size.h : size.w;
  const open = !planned && gateIsOpen(s);
  const ready = !planned && (s === "ready" || s === "in-progress");
  const tone = open ? "var(--lumen)" : ready ? "var(--sea)" : m.colors.muted;
  const color = lineColor(m, n.color);
  const body = draw({ angle, across, along, tone, state: s, open, ready, planned, color });
  const lmGlyph = n.landmark?.glyph ?? DEFAULT_GATE_LANDMARK[m.renderer];
  return (
    <g data-gate-state={planned ? "planned" : s} data-final={n.final || undefined}>
      {n.final ? (
        <g
          transform={`translate(${bt && !upright ? 0 : along * 0.15} ${bt && !upright ? -along * 0.15 : -across * 0.05}) scale(${across / 34})`}
          opacity={open ? 0.9 : planned ? 0.25 : 0.42}
        >
          <LandmarkArt
            kind={lmGlyph}
            ink={m.colors.muted}
            accent={open ? "var(--lumen)" : m.colors.ground}
            ground={m.colors.ground}
          />
        </g>
      ) : null}
      {n.pulse ? <OncePulse key={m.props.hoverId} r={across / 2} reduced={reduced} /> : null}
      {n.focus ? (
        <ellipse rx={along / 2 + 12} ry={across / 2 + 12} fill="none" stroke="var(--focus)" strokeWidth={3} />
      ) : null}
      {ready ? (
        <GateHalo w={upright || !bt ? along : across} h={upright || !bt ? across : along} reduced={reduced} />
      ) : null}
      <g filter={open ? `url(#${m.uid}-glow)` : undefined} opacity={!open && !ready && !planned ? 0.85 : 1}>
        {upright ? body : <GateFrame m={m}>{body}</GateFrame>}
        {open ? (
          upright ? (
            <GateRays h={across} len={across * 0.22} />
          ) : (
            <GateFrame m={m}>
              <GateRays h={across} len={across * 0.22} />
            </GateFrame>
          )
        ) : null}
      </g>
      {s === "in-progress" ? <ProgressArc r={Math.max(along, across) / 2 + 8} /> : null}
    </g>
  );
}

/** Landmark drawn behind the final gate when the theme names none for it. */
const DEFAULT_GATE_LANDMARK: Record<RendererId, LandmarkGlyph> = {
  metro: "station",
  circuit: "core",
  atlas: "town",
  sketchbook: "star",
};

/** Glyph size for a draw node (card, gate, final gate). */
export const nodeGlyph = (m: DrawModel, n: DrawNode) =>
  glyphSize(m.renderer, n.gate ? (n.final ? "final" : "gate") : "card", m.scene.direction);

/** Card flags on the glyph's upper right: Revisit (a Sea disc with a curved arrow). */
export function FlagLayer({ m }: { m: DrawModel }) {
  const flagged = m.nodes.filter((n) => n.view.revisit && !n.gate);
  if (!flagged.length) return null;
  return (
    <g data-layer="flags" aria-hidden>
      {flagged.map((n) => {
        const s = nodeGlyph(m, n);
        return (
          <g key={n.id} transform={`translate(${n.x + s.w / 2 - 1} ${n.y - s.h / 2 + 1})`} data-flag="revisit">
            <circle r={7} fill="var(--sea)" stroke={m.colors.ground} strokeWidth={1.5} />
            <path
              d="M-2.6 -1.2A3 3 0 1 1 -2.2 2.2M-2.6 -1.2V-3.6M-2.6 -1.2H-0.2"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
    </g>
  );
}

/** Region labels (line titles) by the first stop of each line. Always shown, including below 0.8×. */
export function LineTitles({ m }: { m: DrawModel }) {
  const map = m.props.pack.map;
  const placed = placeLineTitles(map, m.renderer);
  return (
    <g aria-hidden data-layer="line-titles">
      {placed.map((t) => {
        const line = map.lines.find((l) => l.id === t.line);
        return (
          <text
            key={t.line}
            x={t.x}
            y={t.y}
            textAnchor={t.anchor}
            fontSize={12}
            fontWeight={650}
            fill={lineColor(m, Math.max(0, (line?.color ?? 1) - 1))}
            style={{ paintOrder: "stroke" }}
            stroke={m.colors.ground}
            strokeWidth={4}
            strokeLinejoin="round"
          >
            {t.title}
          </text>
        );
      })}
    </g>
  );
}

/** Ids of nodes whose glyph should show the Lumen glow filter. */
export const glows = (s: NodeState) => s === "lit";

export type { NodeId };
