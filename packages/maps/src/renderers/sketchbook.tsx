/**
 * sketchbook: hand-drawn ink on paper with seeded rough.js jitter (identical on every render). Inked
 * circles for cards (hachured in the line colour when Done, solid with rays when Lit), pencil lines for
 * edges, and a strip of masking tape across the path for each checkpoint (peeled at one end when Ready,
 * torn away when Open). On the corkboard texture cards become pinned case cards joined by string.
 * Ambient: lit lines ink in once.
 */
import type { NodeId } from "@learncroc/core";
import { useMemo } from "react";
import rough from "roughjs";
import { mix } from "../lib/color";
import { compactPath, type Pt } from "../lib/geometry";
import { hashString } from "../lib/random";
import type { Scene } from "../lib/scene";
import type { MapRendererProps } from "../types";
import {
  At,
  BuildingRing,
  beginOnMount,
  DawnWash,
  DoneTick,
  type DrawEdge,
  type DrawModel,
  type DrawNode,
  edgeBoost,
  edgeOpacity,
  FlagLayer,
  Flicker,
  FocusHalo,
  GateGlyph,
  halfDiscPath,
  LightPool,
  LineTitles,
  lineColor,
  OncePulse,
  ProgressArc,
  ReadyHalo,
  SectionVeil,
  SharedDefs,
  useDrawModel,
} from "./kit";
import { Ground } from "./textures";
import { TokenMarker } from "./token";

interface Sketch {
  edges: Map<string, string>;
  circles: Map<NodeId, string>;
  cards: Map<NodeId, string>;
  /** Hachure fill strokes for Done circles (gap 4). */
  hachure: Map<NodeId, string>;
  tape: Map<NodeId, string>;
  planned: Map<NodeId, string>;
}

const sketchCache = new WeakMap<Scene, Sketch>();

/** Rough geometry for every element, generated once per scene. Colours are applied at render time. */
function sketchFor(scene: Scene, seed: string): Sketch {
  const hit = sketchCache.get(scene);
  if (hit) return hit;
  const gen = rough.generator();
  const paths = (d: ReturnType<typeof gen.circle>) =>
    compactPath(
      gen
        .toPaths(d)
        .map((p) => p.d)
        .join(""),
    );
  const s = (key: string) => (hashString(`${seed}:${key}`) % 2_000_000) + 1;
  const sketch: Sketch = {
    edges: new Map(),
    circles: new Map(),
    cards: new Map(),
    hachure: new Map(),
    tape: new Map(),
    planned: new Map(),
  };
  for (const e of scene.edges) {
    const pts = e.control.map((p): [number, number] => [p[0], p[1]]);
    const opts = { seed: s(e.key), roughness: 0.9, bowing: 1.2, disableMultiStroke: false };
    sketch.edges.set(
      e.key,
      paths(
        pts.length > 2
          ? gen.curve(pts, opts)
          : gen.line(pts[0]?.[0] ?? 0, pts[0]?.[1] ?? 0, pts[1]?.[0] ?? 0, pts[1]?.[1] ?? 0, opts),
      ),
    );
  }
  for (const n of scene.nodes) {
    sketch.circles.set(n.id, paths(gen.circle(0, 0, 28, { seed: s(`c:${n.id}`), roughness: 1.1 })));
    sketch.cards.set(n.id, paths(gen.rectangle(-17, -12, 34, 26, { seed: s(`k:${n.id}`), roughness: 0.8 })));
    const hatch = gen.circle(0, 0, 24, {
      seed: s(`h:${n.id}`),
      roughness: 1,
      fill: "#f00",
      stroke: "none",
      fillStyle: "hachure",
      hachureGap: 4,
      hachureAngle: -41,
    });
    sketch.hachure.set(
      n.id,
      compactPath(
        gen
          .toPaths(hatch)
          .filter((p) => p.stroke === "#f00")
          .map((p) => p.d)
          .join(""),
      ),
    );
    sketch.tape.set(n.id, paths(gen.rectangle(-9, -30, 18, 60, { seed: s(`t:${n.id}`), roughness: 1.3 })));
    sketch.planned.set(n.id, paths(gen.rectangle(-11, -11, 22, 22, { seed: s(`p:${n.id}`), roughness: 1.4 })));
  }
  sketchCache.set(scene, sketch);
  return sketch;
}

export function SketchbookRenderer(props: MapRendererProps) {
  const m = useDrawModel(props, "sketchbook");
  const sketch = useMemo(() => sketchFor(m.scene, m.seed), [m.scene, m.seed]);
  const cork = props.theme.texture === "corkboard";
  return (
    <g data-renderer="sketchbook">
      <defs>
        <SharedDefs m={m} />
      </defs>
      <Ground m={m} />
      <DawnWash m={m} />
      <g data-layer="pools">
        {m.nodes.map((n) => (
          <At key={n.id} n={n}>
            <LightPool m={m} n={n} r={56} />
          </At>
        ))}
      </g>
      <g data-layer="lines" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {m.edges.map((e) => (
          <Pencil key={e.key} m={m} e={e} d={sketch.edges.get(e.key) ?? e.d} cork={cork} />
        ))}
      </g>
      <SectionVeil m={m} />
      <LineTitles m={m} />
      <g data-layer="stops">
        {m.nodes.map((n) => (
          <At key={n.id} n={n}>
            {n.gate ? (
              <TapedTab m={m} n={n} tape={sketch.tape.get(n.id) ?? ""} />
            ) : cork ? (
              <CaseCard m={m} n={n} card={sketch.cards.get(n.id) ?? ""} planned={sketch.planned.get(n.id) ?? ""} />
            ) : (
              <InkCircle
                m={m}
                n={n}
                circle={sketch.circles.get(n.id) ?? ""}
                planned={sketch.planned.get(n.id) ?? ""}
                hachure={sketch.hachure.get(n.id) ?? ""}
              />
            )}
          </At>
        ))}
      </g>
      <FlagLayer m={m} />
      <TokenMarker m={m} />
    </g>
  );
}

function Pencil({ m, e, d, cork }: { m: DrawModel; e: DrawEdge; d: string; cork: boolean }) {
  const color = lineColor(m, e.color);
  const k = edgeBoost(e);
  const op = edgeOpacity(e);
  const reduced = m.props.reducedMotion;
  if (e.state === "planned" || e.state === "unbuilt") {
    const planned = e.state === "planned";
    return (
      <path
        d={e.d}
        stroke={planned ? m.colors.muted : m.colors.ink2}
        strokeWidth={(planned ? 1.6 : 2) * k}
        strokeDasharray={planned ? "2 8" : "8 6"}
        opacity={op * (planned ? 0.7 : 0.45)}
        data-edge={e.key}
        data-state={e.state}
      />
    );
  }
  if (e.state === "locked") {
    return (
      <path
        d={e.d}
        stroke={color}
        strokeWidth={2 * k}
        strokeDasharray="2 6"
        opacity={op * 0.35}
        data-edge={e.key}
        data-state={e.state}
      />
    );
  }
  const width = (cork ? 2 : e.state === "lit" ? 2.8 : e.state === "done" ? 3.2 : 2.2) * k;
  const inkIn = e.state === "lit" && !reduced;
  const lumenCore =
    e.state === "lit" || e.state === "dim" ? (
      <path d={d} stroke="var(--lumen)" strokeWidth={1.6} opacity={op * (e.state === "dim" ? 0.55 : 1)} />
    ) : null;
  return (
    <>
      <path
        d={d}
        stroke={color}
        strokeWidth={width}
        opacity={op * (e.state === "dim" ? 0.55 : e.state === "open" ? 0.7 : 1)}
        strokeDasharray={e.kind === "transfer" ? "1 6" : inkIn ? "1" : undefined}
        pathLength={inkIn && e.kind !== "transfer" ? 1 : undefined}
        data-edge={e.key}
        data-state={e.state}
      >
        {inkIn && e.kind !== "transfer" ? (
          <animate
            ref={beginOnMount}
            attributeName="stroke-dashoffset"
            from="1"
            to="0"
            dur="1.2s"
            begin="indefinite"
            fill="freeze"
          />
        ) : null}
      </path>
      {lumenCore}
    </>
  );
}

function InkCircle({
  m,
  n,
  circle,
  planned,
  hachure,
}: {
  m: DrawModel;
  n: DrawNode;
  circle: string;
  planned: string;
  hachure: string;
}) {
  const reduced = m.props.reducedMotion;
  const s = n.state;
  const color = lineColor(m, n.color);
  const ink = m.colors.ink;
  const r = 12;
  if (s === "planned")
    return <path d={planned} fill="none" stroke={m.colors.muted} strokeWidth={1.6} strokeDasharray="4 3" />;
  if (s === "building") return <BuildingRing r={r} color={color} reduced={reduced} />;
  const locked = s === "locked";
  return (
    <g>
      {n.pulse ? <OncePulse key={m.props.hoverId} r={r + 2} reduced={reduced} /> : null}
      {n.focus ? <FocusHalo r={r + 2} /> : null}
      {s === "ready" || s === "in-progress" ? <ReadyHalo r={r + 2} reduced={reduced} /> : null}
      <g filter={s === "lit" ? `url(#${m.uid}-glow)` : undefined}>
        {s === "fading" ? <Flicker reduced={reduced} /> : null}
        {s === "lit" ? <circle r={r} fill="var(--lumen)" /> : null}
        {s === "done" ? <path d={hachure} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" /> : null}
        {s === "fading" ? (
          <path d={halfDiscPath(r)} fill="var(--ember)" opacity={Math.max(0.5, n.view.brightness)} />
        ) : null}
        <path
          d={circle}
          fill="none"
          stroke={locked ? m.colors.muted : ink}
          strokeWidth={locked ? 1.4 : 1.8}
          strokeDasharray={locked ? "3 3" : undefined}
        />
        {s === "done" ? <DoneTick size={r} color={ink} /> : null}
        {s === "ready" || s === "in-progress" ? <circle r={3.5} fill="var(--sea)" /> : null}
        {s === "lit" ? <Hatch color={ink} /> : null}
      </g>
      {/* A dab of the line's colour, like a highlighter tick. */}
      {locked ? null : (
        <path
          d={`M${-r - 2} ${r + 5}q${r} 4 ${2 * r + 4} 0`}
          stroke={color}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          opacity={0.85}
        />
      )}
      {s === "in-progress" ? <ProgressArc r={r + 6} /> : null}
      {n.view.durable && (s === "lit" || s === "fading") ? <Doodle x={r + 5} y={-r - 3} ink={ink} /> : null}
    </g>
  );
}

/** Corkboard stops: case cards pinned to the board. */
function CaseCard({ m, n, card, planned }: { m: DrawModel; n: DrawNode; card: string; planned: string }) {
  const reduced = m.props.reducedMotion;
  const s = n.state;
  const color = lineColor(m, n.color);
  const paper = m.colors.mode === "dark" ? "#EDE6D6" : "#FFFDF7";
  const cardInk = "#2A2440";
  if (s === "planned")
    return <path d={planned} fill="none" stroke={m.colors.muted} strokeWidth={1.6} strokeDasharray="4 3" />;
  if (s === "building") return <BuildingRing r={13} color={color} reduced={reduced} />;
  const locked = s === "locked";
  return (
    <g>
      {n.pulse ? <OncePulse key={m.props.hoverId} r={16} reduced={reduced} /> : null}
      {n.focus ? <FocusHalo r={18} /> : null}
      {s === "ready" || s === "in-progress" ? <ReadyHalo r={18} reduced={reduced} /> : null}
      <g filter={s === "lit" ? `url(#${m.uid}-glow)` : undefined} transform={`rotate(${(hashString(n.id) % 9) - 4})`}>
        {s === "fading" ? <Flicker reduced={reduced} /> : null}
        {/* Face-down when locked: just the card's outline. */}
        <rect x={-17} y={-12} width={34} height={26} fill={locked ? mix(m.colors.ground, m.colors.ink, 0.14) : paper} />
        {s === "lit" ? <rect x={-17} y={-12} width={34} height={26} fill="var(--lumen)" opacity={0.85} /> : null}
        {s === "done" ? <rect x={-17} y={-12} width={34} height={26} fill={color} opacity={0.55} /> : null}
        {s === "fading" ? (
          <rect x={-17} y={1} width={34} height={13} fill="var(--ember)" opacity={Math.max(0.5, n.view.brightness)} />
        ) : null}
        <path
          d={card}
          fill="none"
          stroke={locked ? m.colors.muted : cardInk}
          strokeWidth={1.4}
          strokeDasharray={locked ? "3 3" : undefined}
        />
        {locked ? null : <path d="M-11 0H9M-11 5H5" stroke={cardInk} strokeWidth={1} opacity={0.5} />}
        {s === "done" ? (
          <g transform="translate(8 -2)">
            <DoneTick size={6} color={cardInk} />
          </g>
        ) : null}
        {s === "lit" ? (
          <path d="M3 3l4 4l7 -10" stroke={cardInk} strokeWidth={2} fill="none" strokeLinecap="round" />
        ) : null}
      </g>
      {/* The pin: Sea while the card waits under the lamp, the line colour otherwise. */}
      <circle
        cx={0}
        cy={-12}
        r={4}
        fill={locked ? m.colors.muted : s === "ready" || s === "in-progress" ? "var(--sea)" : color}
        stroke={m.colors.ground}
        strokeWidth={1.2}
      />
      {s === "in-progress" ? <ProgressArc r={22} /> : null}
      {n.view.durable && (s === "lit" || s === "fading") ? <Doodle x={20} y={-14} ink={m.colors.ink} /> : null}
    </g>
  );
}

/** Lit hatch: a few quick ink rays. */
function Hatch({ color }: { color: string }) {
  const rays: Pt[] = [
    [0, -1],
    [0.7, -0.7],
    [1, 0],
    [0.7, 0.7],
    [0, 1],
    [-0.7, 0.7],
    [-1, 0],
    [-0.7, -0.7],
  ];
  return (
    <g stroke={color} strokeWidth={1.4} strokeLinecap="round">
      {rays.map(([x, y]) => (
        <line key={`${x}${y}`} x1={x * 16} y1={y * 16} x2={x * 21} y2={y * 21} />
      ))}
    </g>
  );
}

/** Durable mark: a tiny doodled star in the margin. */
function Doodle({ x, y, ink }: { x: number; y: number; ink: string }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(0.32)`}
      d="M0 -15L4.4 -5.5L14.5 -4.6L6.8 2.2L9 12.3L0 7L-9 12.3L-6.8 2.2L-14.5 -4.6L-4.4 -5.5Z"
      fill="none"
      stroke={ink}
      strokeWidth={4}
      strokeLinejoin="round"
    />
  );
}

/**
 * Checkpoint: a strip of masking tape across the path. Locked: taped down flat. Ready: one end peeled up
 * (Sea). Open: torn away, only ragged stubs left at the edges, and rays.
 */
function TapedTab({ m, n, tape }: { m: DrawModel; n: DrawNode; tape: string }) {
  const ink = m.colors.ink;
  const paper = m.colors.mode === "dark" ? "#D9CFA8" : "#F1E3B4";
  return (
    <GateGlyph
      m={m}
      n={n}
      draw={({ across, along, tone, open, ready, planned }) => {
        const k = across / 60;
        const w = Math.min(along * 0.6, 22);
        const hy = across / 2;
        const tick = (y: number) => `M${-w / 2 + 3} ${y}H${w / 2 - 3}`;
        if (planned) {
          return (
            <rect
              x={-w / 2}
              y={-hy}
              width={w}
              height={across}
              fill="none"
              stroke={m.colors.muted}
              strokeWidth={1.6}
              strokeDasharray="4 3"
            />
          );
        }
        if (open) {
          // Torn stubs at both ends with a zigzag edge.
          const stub = (dir: 1 | -1) => {
            const y0 = dir * hy;
            const y1 = dir * (hy - 12 * k);
            const zig = `L${w / 2} ${y1}l${-w / 4} ${-dir * 4}l${-w / 4} ${dir * 4}l${-w / 4} ${-dir * 4}l${-w / 4} ${dir * 4}`;
            return (
              <path
                key={dir}
                d={`M${-w / 2} ${y0}H${w / 2}${zig}Z`}
                fill={paper}
                stroke={ink}
                strokeWidth={1.4}
                opacity={0.9}
              />
            );
          };
          return (
            <g data-part="tape" data-tape="torn">
              {stub(1)}
              {stub(-1)}
            </g>
          );
        }
        return (
          <g data-part="tape" data-tape={ready ? "peeled" : "flat"}>
            <g transform={`scale(${(w / 18).toFixed(3)} ${k.toFixed(3)})`}>
              <path d={tape} fill={paper} fillOpacity={0.92} stroke="none" />
              <path d={tape} fill="none" stroke={ready ? tone : ink} strokeWidth={1.4 / k} />
            </g>
            <path
              d={`${tick(-hy * 0.45)}${tick(-hy * 0.15)}${tick(hy * 0.15)}${tick(hy * 0.45)}`}
              stroke={ink}
              strokeWidth={1}
              opacity={0.35}
            />
            {ready ? (
              // The top end lifts and folds back.
              <path
                d={`M${-w / 2} ${-hy + 2}L${w / 2} ${-hy + 2}L${w / 2 + 7} ${-hy - 9}L${-w / 2 + 4} ${-hy - 6}Z`}
                fill={paper}
                stroke={tone}
                strokeWidth={1.6}
                strokeLinejoin="round"
              />
            ) : null}
          </g>
        );
      }}
    />
  );
}
