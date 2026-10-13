/**
 * metro (default and fallback): a transit map. Octilinear tracks with a ground-coloured casing, roundel
 * cards, interchange rings, and ticket barriers across the line for checkpoints. Done cards are solid
 * roundels in their line colour; track is laid card by card and powered gold only once lit. Ambient: tiny
 * trains run only on lit track; fading track runs a reduced service (thinner, slower, fewer trains).
 */

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
import { TokenMarker } from "./token";

const R = 11;

export function MetroRenderer(props: MapRendererProps) {
  const m = useDrawModel(props, "metro");
  return (
    <g data-renderer="metro">
      <defs>
        <SharedDefs m={m} />
      </defs>
      <Ground m={m} />
      <DawnWash m={m} />
      <g data-layer="pools">
        {m.nodes.map((n) => (
          <At key={n.id} n={n}>
            <LightPool m={m} n={n} r={64} />
          </At>
        ))}
      </g>
      <g data-layer="casing" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {m.edges.map((e) => (
          <path key={e.key} d={e.d} stroke={m.colors.ground} strokeWidth={14} opacity={edgeOpacity(e)} />
        ))}
      </g>
      <g data-layer="tracks" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {m.edges.map((e) => (
          <Track key={e.key} m={m} e={e} />
        ))}
      </g>
      {props.reducedMotion || !m.detail ? null : <Trains m={m} />}
      <SectionVeil m={m} />
      <LineTitles m={m} />
      <g data-layer="stops">
        {m.nodes.map((n) => (
          <At key={n.id} n={n}>
            {n.gate ? <TicketBarrier m={m} n={n} /> : <Roundel m={m} n={n} />}
          </At>
        ))}
      </g>
      <FlagLayer m={m} />
      <TokenMarker m={m} />
    </g>
  );
}

function Track({ m, e }: { m: DrawModel; e: DrawEdge }) {
  const color = lineColor(m, e.color);
  const k = edgeBoost(e);
  const op = edgeOpacity(e);
  if (e.kind === "transfer") {
    const lit = e.state === "lit" || e.state === "dim" || e.state === "open";
    return (
      <path
        d={e.d}
        stroke={lit ? color : m.colors.muted}
        strokeWidth={3 * k}
        strokeDasharray="0.5 7"
        opacity={op}
        data-edge={e.key}
        data-state={e.state}
      />
    );
  }
  switch (e.state) {
    case "lit":
      return (
        <g opacity={op} data-edge={e.key} data-state={e.state}>
          <path d={e.d} stroke={color} strokeWidth={8 * k} />
          <path d={e.d} stroke="var(--lumen)" strokeWidth={2} />
        </g>
      );
    case "dim":
      return (
        <g opacity={op * 0.6} data-edge={e.key} data-state={e.state}>
          <path d={e.d} stroke={color} strokeWidth={6 * k} />
          <path d={e.d} stroke="var(--lumen)" strokeWidth={1.5} />
        </g>
      );
    case "done":
      return <path d={e.d} stroke={color} strokeWidth={7 * k} opacity={op} data-edge={e.key} data-state={e.state} />;
    case "open":
      return (
        <path d={e.d} stroke={color} strokeWidth={6 * k} opacity={op * 0.7} data-edge={e.key} data-state={e.state} />
      );
    case "unbuilt":
      return (
        <path
          d={e.d}
          stroke={m.colors.ink2}
          strokeWidth={4 * k}
          strokeDasharray="8 6"
          strokeLinecap="butt"
          opacity={op * 0.45}
          data-edge={e.key}
          data-state={e.state}
        />
      );
    case "locked":
      return (
        <path
          d={e.d}
          stroke={color}
          strokeWidth={5 * k}
          strokeDasharray="2 6"
          opacity={op * 0.35}
          data-edge={e.key}
          data-state={e.state}
        />
      );
    case "planned":
      return (
        <path
          d={e.d}
          stroke={m.colors.muted}
          strokeWidth={3 * k}
          strokeDasharray="3 7"
          opacity={op * 0.75}
          data-edge={e.key}
          data-state={e.state}
        />
      );
  }
}

/** Tiny trains on lit track. Capped so a large lit map stays light on the compositor. */
function Trains({ m }: { m: DrawModel }) {
  const lit = m.edges.filter((e) => (e.state === "lit" || e.state === "dim") && e.kind !== "transfer" && !e.fogged);
  return (
    <g data-layer="ambient" aria-hidden>
      {lit.slice(0, 16).map((e, i) => {
        const slow = e.state === "dim" ? 2.2 : 1;
        const dur = Math.max(2.4, e.length / 42) * slow;
        return (
          <g key={e.key} opacity={e.state === "dim" ? 0.55 : 0.95}>
            <rect
              x={-6}
              y={-3}
              width={12}
              height={6}
              rx={3}
              fill={m.colors.ground}
              stroke={m.colors.ink}
              strokeWidth={1.5}
            >
              <animateMotion
                dur={`${dur.toFixed(2)}s`}
                begin={`${(-i * 0.9).toFixed(1)}s`}
                repeatCount="indefinite"
                path={e.d}
                rotate="auto"
              />
            </rect>
          </g>
        );
      })}
    </g>
  );
}

function Roundel({ m, n }: { m: DrawModel; n: DrawNode }) {
  const reduced = m.props.reducedMotion;
  const color = lineColor(m, n.color);
  const ground = m.colors.ground;
  const s = n.state;
  return (
    <g>
      {n.pulse ? <OncePulse key={m.props.hoverId} r={R} reduced={reduced} /> : null}
      {n.focus ? <FocusHalo r={R} /> : null}
      {s === "ready" || s === "in-progress" ? <ReadyHalo r={R} reduced={reduced} /> : null}
      {s === "planned" ? (
        <PlannedSquare size={20} color={m.colors.muted} />
      ) : s === "building" ? (
        <BuildingRing r={R} color={color} reduced={reduced} />
      ) : s === "locked" ? (
        <circle r={R - 1} fill={ground} stroke={m.colors.muted} strokeWidth={2.5} strokeDasharray="2.5 3.2" />
      ) : (
        <g filter={s === "lit" ? `url(#${m.uid}-glow)` : undefined} opacity={s === "fading" ? 0.9 : 1}>
          {s === "fading" ? <Flicker reduced={reduced} /> : null}
          {n.interchange ? <circle r={R + 4} fill={ground} stroke={m.colors.ink} strokeWidth={2} /> : null}
          <circle r={R} fill={s === "lit" ? "var(--lumen)" : ground} stroke={color} strokeWidth={4} />
          {s === "done" ? (
            <>
              <circle r={R - 2} fill={color} />
              <DoneTick size={R} color={ground} />
            </>
          ) : null}
          {s === "fading" ? (
            <path d={halfDiscPath(R - 2)} fill="var(--ember)" opacity={Math.max(0.55, n.view.brightness)} />
          ) : null}
          {s === "ready" || s === "in-progress" ? <circle r={4} fill="var(--sea)" /> : null}
          {s === "lit" ? <Rays r={R + 4} length={5} /> : null}
        </g>
      )}
      {s === "in-progress" ? <ProgressArc r={R + 6} /> : null}
      {n.view.durable && (s === "lit" || s === "fading") ? <StationClock x={R + 4} y={-R - 4} m={m} /> : null}
    </g>
  );
}

/** Durable mark: a tiny station clock. */
function StationClock({ x, y, m }: { x: number; y: number; m: DrawModel }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={5.5} fill={m.colors.ground} stroke={m.colors.ink} strokeWidth={1.5} />
      <path d="M0 -3V0L2 1.5" stroke={m.colors.ink} strokeWidth={1.2} strokeLinecap="round" fill="none" />
    </g>
  );
}

/**
 * Checkpoint: a ticket barrier across the platform line. Two cabinets either side of the track, one
 * paddle hinged on each: closed across the line (Locked), ajar 12° (Ready), swung 80° along the line (Open).
 */
function TicketBarrier({ m, n }: { m: DrawModel; n: DrawNode }) {
  const ground = m.colors.ground;
  return (
    <GateGlyph
      m={m}
      n={n}
      draw={({ angle, across, along, tone, open, planned, color }) => {
        const hy = across / 2 - 6;
        const len = hy - 2;
        const paddle = (dir: 1 | -1) => (
          <g transform={`translate(0 ${-dir * hy}) rotate(${-dir * angle})`}>
            <rect
              x={-3}
              y={dir === 1 ? 0 : -len}
              width={6}
              height={len}
              rx={3}
              fill={open ? "var(--lumen)" : ground}
              stroke={tone}
              strokeWidth={2.5}
              strokeDasharray={planned ? "3 3" : undefined}
            />
          </g>
        );
        return (
          <g data-part="ticket-barrier">
            {/* A ground-coloured plate so the barrier reads over the track. */}
            <rect x={-along / 2} y={-across / 2} width={along} height={across} rx={6} fill={ground} opacity={0.85} />
            {paddle(1)}
            {paddle(-1)}
            {[-1, 1].map((d) => (
              <rect
                key={d}
                x={-along / 2 + 2}
                y={d * hy - 5}
                width={along - 4}
                height={10}
                rx={3}
                fill={open ? color : ground}
                stroke={open ? m.colors.ink : tone}
                strokeWidth={2}
                strokeDasharray={planned ? "3 3" : undefined}
              />
            ))}
          </g>
        );
      }}
    />
  );
}
