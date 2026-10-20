/**
 * trail (Pond trail): a footpath across a meadow. Every route is a soft grass-worn band; the way ahead is
 * marked with white stepping dots (faint until it opens), and walked path is inked in the line colour
 * (powered gold once lit). Only planned stops get a bare dotted line.
 * Stops are round markers on the path, checkpoints are a garden gate across it, and Moss stands on the
 * path beside the learner's current stop.
 */
import { Croc } from "@learncroc/ui";
import { mix } from "../lib/color";
import type { Pt } from "../lib/geometry";
import type { MapRendererProps } from "../types";
import {
  At,
  BuildingRing,
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
  PlannedSquare,
  ProgressArc,
  Rays,
  ReadyHalo,
  SectionVeil,
  SharedDefs,
  useDrawModel,
} from "./kit";
import { Ground } from "./textures";

const R = 10;
/** Moss on the path: px square, and how far back along the path from the current stop he stands. */
const MOSS = { size: 48, back: 76 } as const;

export function TrailRenderer(props: MapRendererProps) {
  const m = useDrawModel(props, "trail");
  const band = mix(m.colors.ground, m.colors.lines[3], m.colors.mode === "dark" ? 0.22 : 0.3);
  const step = mix(m.colors.ground, "#FFFFFF", m.colors.mode === "dark" ? 0.35 : 0.85);
  return (
    <g data-renderer="trail">
      <defs>
        <SharedDefs m={m} />
      </defs>
      <Ground m={m} />
      <DawnWash m={m} />
      <g data-layer="pools">
        {m.nodes.map((n) => (
          <At key={n.id} n={n}>
            <LightPool m={m} n={n} r={58} />
          </At>
        ))}
      </g>
      <g data-layer="paths" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {m.edges.map((e) => (
          <Path key={e.key} m={m} e={e} band={band} step={step} />
        ))}
      </g>
      <SectionVeil m={m} />
      <LineTitles m={m} />
      <g data-layer="stops">
        {m.nodes.map((n) => (
          <At key={n.id} n={n}>
            {n.gate ? <Stile m={m} n={n} /> : <Marker m={m} n={n} />}
          </At>
        ))}
      </g>
      <FlagLayer m={m} />
      <MossOnPath m={m} />
    </g>
  );
}

function Path({ m, e, band, step }: { m: DrawModel; e: DrawEdge; band: string; step: string }) {
  const color = lineColor(m, e.color);
  const k = edgeBoost(e);
  const op = edgeOpacity(e);
  const transfer = e.kind === "transfer";
  const attrs = { "data-edge": e.key, "data-state": e.state };
  if (e.state === "planned") {
    return (
      <path
        d={e.d}
        stroke={m.colors.muted}
        strokeWidth={2.5 * k}
        strokeDasharray="1 9"
        opacity={op * 0.75}
        {...attrs}
      />
    );
  }
  const width = transfer ? 10 : 16;
  // The worn band under every path.
  const worn = <path d={e.d} stroke={band} strokeWidth={width * k} />;
  if (e.state === "locked" || e.state === "open" || e.state === "unbuilt") {
    // The way ahead: stepping dots on the band (fainter until it opens).
    const shut = e.state !== "open";
    return (
      <g opacity={op * (shut ? 0.6 : 1)} {...attrs}>
        {worn}
        <path d={e.d} stroke={step} strokeWidth={(transfer ? 3.5 : 5) * k} strokeDasharray="0.1 12" />
      </g>
    );
  }
  const ink = e.state === "lit" ? 7 : e.state === "dim" ? 6 : 6.5;
  return (
    <g opacity={op * (e.state === "dim" ? 0.6 : 1)} {...attrs}>
      {worn}
      <path d={e.d} stroke={color} strokeWidth={ink * k} strokeDasharray={transfer ? "6 6" : undefined} />
      {e.state === "lit" || e.state === "dim" ? (
        <path d={e.d} stroke="var(--lumen)" strokeWidth={2} strokeDasharray={transfer ? "6 6" : undefined} />
      ) : null}
    </g>
  );
}

/** A round marker on the path: open white (Later), ringed in Sea (Ready), filled in the line colour (Done). */
function Marker({ m, n }: { m: DrawModel; n: DrawNode }) {
  const reduced = m.props.reducedMotion;
  const color = lineColor(m, n.color);
  const ground = m.colors.ground;
  const paper = mix(ground, "#FFFFFF", 0.85);
  const s = n.state;
  if (s === "planned") return <PlannedSquare size={18} color={m.colors.muted} />;
  if (s === "building") return <BuildingRing r={R} color={color} reduced={reduced} />;
  return (
    <g>
      {n.pulse ? <OncePulse key={m.props.hoverId} r={R} reduced={reduced} /> : null}
      {n.focus ? <FocusHalo r={R} /> : null}
      {s === "ready" || s === "in-progress" ? <ReadyHalo r={R + 2} reduced={reduced} /> : null}
      {s === "locked" ? (
        <circle r={R - 1} fill={paper} stroke={mix(ground, m.colors.muted, 0.8)} strokeWidth={3} />
      ) : (
        <g filter={s === "lit" ? `url(#${m.uid}-glow)` : undefined}>
          {s === "fading" ? <Flicker reduced={reduced} /> : null}
          <circle
            r={R + 1}
            fill={s === "lit" ? "var(--lumen)" : s === "done" ? color : paper}
            stroke={s === "ready" || s === "in-progress" ? "var(--sea-text)" : s === "lit" ? m.colors.ink : color}
            strokeWidth={s === "ready" || s === "in-progress" ? 3.5 : 2.5}
          />
          {s === "done" ? <DoneTick size={R - 1} color={paper} /> : null}
          {s === "ready" || s === "in-progress" ? <circle r={4.5} fill="var(--sea)" /> : null}
          {s === "fading" ? (
            <path d={halfDiscPath(R - 2)} fill="var(--ember)" opacity={Math.max(0.55, n.view.brightness)} />
          ) : null}
          {s === "lit" ? <Rays r={R + 5} length={5} /> : null}
        </g>
      )}
      {s === "in-progress" ? <ProgressArc r={R + 7} /> : null}
      {n.view.durable && (s === "lit" || s === "fading") ? (
        // Durable: a small flower beside the marker.
        <g transform={`translate(${R + 5} ${-R - 3})`}>
          {[0, 72, 144, 216, 288].map((a) => (
            <circle
              key={a}
              cx={Math.cos((a * Math.PI) / 180) * 3}
              cy={Math.sin((a * Math.PI) / 180) * 3}
              r={2.2}
              fill={paper}
              stroke={m.colors.ink}
              strokeWidth={0.8}
            />
          ))}
          <circle r={1.6} fill={color} />
        </g>
      ) : null}
    </g>
  );
}

/**
 * Checkpoint: a garden gate across the path. Two posts either side and a picket leaf hinged on the near
 * post: shut across the path (Locked), ajar (Ready), swung back along it (Open).
 */
function Stile({ m, n }: { m: DrawModel; n: DrawNode }) {
  const ground = m.colors.ground;
  const paper = mix(ground, "#FFFFFF", 0.85);
  return (
    <GateGlyph
      m={m}
      n={n}
      draw={({ angle, across, tone, open, planned, color }) => {
        const hy = across / 2 - 2;
        const leaf = hy * 2 - 2;
        const dash = planned ? "3 3" : undefined;
        return (
          <g data-part="garden-gate">
            <g transform={`translate(0 ${-hy}) rotate(${-angle})`}>
              <rect
                x={-6}
                y={0}
                width={12}
                height={leaf}
                rx={4}
                fill={open ? "var(--lumen)" : paper}
                stroke={tone}
                strokeWidth={2.2}
                strokeDasharray={dash}
              />
              {/* Two pickets and a cross brace. */}
              <path d={`M0 3V${leaf - 3}M-4 ${leaf * 0.2}L4 ${leaf * 0.8}`} stroke={tone} strokeWidth={1.4} />
            </g>
            {[-1, 1].map((d) => (
              <circle
                key={d}
                cy={d * hy}
                r={6.5}
                fill={open ? color : paper}
                stroke={open ? m.colors.ink : tone}
                strokeWidth={2.2}
                strokeDasharray={dash}
              />
            ))}
          </g>
        );
      }}
    />
  );
}

/** Where Moss stands: on the path leading into the stop, `back` px before it (else up and to its left). */
function standingSpot(m: DrawModel, id: string, back: number): { x: number; y: number } | undefined {
  const n = m.scene.byId.get(id);
  if (!n) return undefined;
  const edge = m.scene.edges.find((e) => e.to === id && e.kind !== "transfer");
  const pts = edge?.points ?? [];
  let left = back;
  for (let i = pts.length - 1; i > 0; i--) {
    const [ax, ay] = pts[i] as Pt;
    const [bx, by] = pts[i - 1] as Pt;
    const d = Math.hypot(ax - bx, ay - by);
    if (d >= left) return { x: ax + ((bx - ax) * left) / d, y: ay + ((by - ay) * left) / d };
    left -= d;
  }
  return { x: n.x - back, y: n.y - 8 };
}

/** Moss stands on the path just before the learner's current stop (the trail's token). */
function MossOnPath({ m }: { m: DrawModel }) {
  const at = m.props.tokenAt;
  const spot = at ? standingSpot(m, at, MOSS.back) : undefined;
  if (!at || !spot) return null;
  // Feet (y 110 of 120) on the path, centred on the spot.
  return (
    <g
      data-layer="token"
      data-token-at={at}
      transform={`translate(${spot.x - MOSS.size / 2} ${spot.y - MOSS.size * 0.92})`}
    >
      <Croc size={MOSS.size} decorative />
    </g>
  );
}
