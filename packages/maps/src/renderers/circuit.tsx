/**
 * circuit: a PCB seen from above. Manhattan copper traces with chamfered corners and vias, IC chips for
 * cards and a relay across the trace for each checkpoint (its contacts close when the gate opens, and
 * current flows). Locked traces are unetched outlines. Ambient: current pulses along lit traces (slower
 * and fainter on fading ones).
 */
import { mix } from "../lib/color";
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
  LightPool,
  LineTitles,
  lineColor,
  OncePulse,
  PlannedSquare,
  ProgressArc,
  ReadyHalo,
  SectionVeil,
  SharedDefs,
  useDrawModel,
} from "./kit";
import { Ground } from "./textures";
import { TokenMarker } from "./token";

export function CircuitRenderer(props: MapRendererProps) {
  const m = useDrawModel(props, "circuit");
  return (
    <g data-renderer="circuit">
      <defs>
        <SharedDefs m={m} />
      </defs>
      <Ground m={m} />
      <DawnWash m={m} />
      <g data-layer="pools">
        {m.nodes.map((n) => (
          <At key={n.id} n={n}>
            <LightPool m={m} n={n} r={70} />
          </At>
        ))}
      </g>
      <g data-layer="traces" fill="none" strokeLinejoin="round" strokeLinecap="round">
        {m.edges.map((e) => (
          <Trace key={e.key} m={m} e={e} />
        ))}
      </g>
      {props.reducedMotion || !m.detail ? null : <Current m={m} />}
      <SectionVeil m={m} />
      <LineTitles m={m} />
      <g data-layer="stops">
        {m.nodes.map((n) => (
          <At key={n.id} n={n}>
            {n.gate ? <Relay m={m} n={n} /> : <Chip m={m} n={n} />}
          </At>
        ))}
      </g>
      <FlagLayer m={m} />
      <TokenMarker m={m} />
    </g>
  );
}

function Trace({ m, e }: { m: DrawModel; e: DrawEdge }) {
  const color = lineColor(m, e.color);
  const k = edgeBoost(e);
  const op = edgeOpacity(e);
  const vias = e.control.slice(1, -1);
  if (e.state === "planned" || e.state === "unbuilt") {
    // Unetched: the trace exists only as a dashed outline in the copper.
    const planned = e.state === "planned";
    return (
      <path
        d={e.d}
        stroke={planned ? m.colors.muted : m.colors.ink2}
        strokeWidth={(planned ? 3 : 4) * k}
        strokeDasharray={planned ? "2 6" : "8 6"}
        strokeLinecap="butt"
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
        strokeWidth={4 * k}
        strokeDasharray="2 6"
        opacity={op * 0.35}
        data-edge={e.key}
        data-state={e.state}
      />
    );
  }
  const width = e.state === "lit" ? 5 : e.state === "done" ? 4.5 : 3.5;
  const dashed = e.kind === "transfer";
  const alpha = e.state === "dim" ? 0.6 : e.state === "open" ? 0.7 : 1;
  return (
    <g opacity={op * alpha} data-edge={e.key} data-state={e.state}>
      <path d={e.d} stroke={color} strokeWidth={width * k} strokeDasharray={dashed ? "1 7" : undefined} />
      {e.state === "lit" || e.state === "dim" ? (
        <path d={e.d} stroke="var(--lumen)" strokeWidth={2} strokeDasharray={dashed ? "1 7" : undefined} />
      ) : null}
      {vias.map((v) => (
        <circle
          key={`${v[0]}-${v[1]}`}
          cx={v[0]}
          cy={v[1]}
          r={4}
          fill={m.colors.ground}
          stroke={color}
          strokeWidth={2}
        />
      ))}
    </g>
  );
}

/** Current pulses: bright dashes running along lit traces. */
function Current({ m }: { m: DrawModel }) {
  const lit = m.edges.filter((e) => (e.state === "lit" || e.state === "dim") && !e.fogged);
  return (
    <g data-layer="ambient" fill="none" strokeLinecap="round" aria-hidden>
      {lit.slice(0, 24).map((e) => {
        const slow = e.state === "dim" ? 2.5 : 1;
        const spark = mix(lineColor(m, e.color), m.colors.mode === "dark" ? "#FFFFFF" : "#FFFFFF", 0.65);
        return (
          <path
            key={e.key}
            d={e.d}
            stroke={spark}
            strokeWidth={2.2}
            strokeDasharray="4 30"
            opacity={e.state === "dim" ? 0.45 : 0.95}
          >
            <animate
              attributeName="stroke-dashoffset"
              from="34"
              to="0"
              dur={`${(0.9 * slow).toFixed(2)}s`}
              repeatCount="indefinite"
            />
          </path>
        );
      })}
    </g>
  );
}

function pins(w: number, h: number, count: number, len: number, sides: "tb" | "all") {
  const d: string[] = [];
  const step = w / (count + 1);
  for (let i = 1; i <= count; i++) {
    const x = -w / 2 + i * step;
    d.push(`M${x} ${-h / 2}V${-h / 2 - len}M${x} ${h / 2}V${h / 2 + len}`);
  }
  if (sides === "all") {
    const vstep = h / (count + 1);
    for (let i = 1; i <= count; i++) {
      const y = -h / 2 + i * vstep;
      d.push(`M${-w / 2} ${y}H${-w / 2 - len}M${w / 2} ${y}H${w / 2 + len}`);
    }
  }
  return d.join("");
}

function Chip({ m, n }: { m: DrawModel; n: DrawNode }) {
  const reduced = m.props.reducedMotion;
  const s = n.state;
  const color = lineColor(m, n.color);
  const w = 34;
  const h = 22;
  const body = mix(m.colors.ground, m.colors.ink, m.colors.mode === "dark" ? 0.14 : 0.1);
  if (s === "planned") return <PlannedSquare size={24} color={m.colors.muted} />;
  if (s === "building") return <BuildingRing r={13} color={color} reduced={reduced} />;
  const locked = s === "locked";
  return (
    <g>
      {n.pulse ? <OncePulse key={m.props.hoverId} r={16} reduced={reduced} /> : null}
      {n.focus ? <FocusHalo r={18} /> : null}
      {s === "ready" || s === "in-progress" ? <ReadyHalo r={18} reduced={reduced} /> : null}
      <path
        d={pins(w, h, 4, 5, "tb")}
        stroke={locked ? m.colors.muted : s === "lit" ? "var(--lumen)" : color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <g filter={s === "lit" ? `url(#${m.uid}-glow)` : undefined}>
        {s === "fading" ? <Flicker reduced={reduced} /> : null}
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={3}
          fill={locked ? m.colors.ground : s === "done" ? color : body}
          stroke={locked ? m.colors.muted : color}
          strokeWidth={2}
          strokeDasharray={locked ? "3 3" : undefined}
        />
        {/* The die: empty when locked, a Sea LED when ready, a tick etched in the filled body when done, Lumen when lit. */}
        {s === "lit" ? <rect x={-9} y={-6} width={18} height={12} rx={2} fill="var(--lumen)" /> : null}
        {s === "done" ? <DoneTick size={7} color={m.colors.ground} /> : null}
        {s === "fading" ? (
          <>
            <rect x={-9} y={-6} width={18} height={12} rx={2} fill="none" stroke="var(--ember)" strokeWidth={1.2} />
            <rect
              x={-9}
              y={0}
              width={18}
              height={6}
              rx={1}
              fill="var(--ember)"
              opacity={Math.max(0.55, n.view.brightness)}
            />
          </>
        ) : null}
        {s === "ready" || s === "in-progress" ? <circle r={4} fill="var(--sea)" /> : null}
        <circle cx={-w / 2 + 4} cy={-h / 2 + 4} r={1.6} fill={locked ? m.colors.muted : m.colors.ink} opacity={0.7} />
      </g>
      {s === "in-progress" ? <ProgressArc r={22} /> : null}
      {n.view.durable && (s === "lit" || s === "fading") ? <HeatSink x={w / 2 + 2} y={-h / 2 - 9} m={m} /> : null}
    </g>
  );
}

/** Durable mark: heat-sink fins (the part runs cool and steady). */
function HeatSink({ x, y, m }: { x: number; y: number; m: DrawModel }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke={m.colors.ink} strokeWidth={1.6} strokeLinecap="round">
      <path d="M-4 0V6M0 -2V6M4 0V6M-6 6H6" fill="none" />
    </g>
  );
}

/**
 * Checkpoint: a relay across the trace. A coil block on one rail and two contact arms reaching across the
 * gap. Locked: the arms stand well apart. Ready: they tilt towards each other (Sea). Open: the contacts
 * close and current (Lumen) flows across. Here "open" means the circuit closes; the picture of current
 * flowing reads right, and the UI word stays "Open".
 */
function Relay({ m, n }: { m: DrawModel; n: DrawNode }) {
  const ground = m.colors.ground;
  const body = mix(m.colors.ground, m.colors.ink, m.colors.mode === "dark" ? 0.14 : 0.1);
  return (
    <GateGlyph
      m={m}
      n={n}
      draw={({ angle, across, along, tone, open, planned }) => {
        // Gate angle 0 → 12 → 80 becomes arm deflection 40° → 14° → 0°.
        const deflect = angle <= 12 ? 40 - (angle / 12) * 26 : 14 * (1 - (angle - 12) / 68);
        const hy = across / 2 - 7;
        const len = hy - 3;
        const arm = (dir: 1 | -1) => (
          <g transform={`translate(0 ${-dir * hy}) rotate(${deflect})`}>
            <path
              d={`M0 0V${dir * len}`}
              stroke={tone}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={planned ? "3 3" : undefined}
            />
            <circle cy={dir * len} r={3.6} fill={open ? "var(--lumen)" : ground} stroke={tone} strokeWidth={2} />
          </g>
        );
        return (
          <g data-part="relay">
            <rect
              x={-along / 2}
              y={-across / 2}
              width={along}
              height={across}
              rx={5}
              fill={ground}
              stroke={m.colors.muted}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              opacity={0.9}
            />
            {/* Coil blocks on both rails, with a zigzag winding. */}
            {[-1, 1].map((d) => (
              <g key={d} transform={`translate(0 ${d * (across / 2 - 4)})`}>
                <rect
                  x={-along / 2 + 3}
                  y={-4}
                  width={along - 6}
                  height={8}
                  rx={2}
                  fill={body}
                  stroke={tone}
                  strokeWidth={1.5}
                />
                <path
                  d={`M${-along / 2 + 6} 0l3 -3l3 6l3 -6l3 6l3 -6l3 6l3 -3`}
                  fill="none"
                  stroke={tone}
                  strokeWidth={1.2}
                  opacity={0.8}
                />
              </g>
            ))}
            {open ? (
              <path d={`M0 ${-hy + 2}V${hy - 2}`} stroke="var(--lumen)" strokeWidth={4} strokeLinecap="round" />
            ) : null}
            {arm(1)}
            {arm(-1)}
          </g>
        );
      }}
    />
  );
}
