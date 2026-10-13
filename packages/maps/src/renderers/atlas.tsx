/**
 * atlas: an illustrated terrain map. Smooth Catmull-Rom roads with a casing, town markers with a flag,
 * and a stone arch with a wooden two-leaf door for each checkpoint. Done towns have their roofs filled in
 * the line colour. Locked roads are dotted tracks. Ambient: lights in lit towns come on at dusk; fading
 * towns keep their lamps low.
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

export function AtlasRenderer(props: MapRendererProps) {
  const m = useDrawModel(props, "atlas");
  return (
    <g data-renderer="atlas">
      <defs>
        <SharedDefs m={m} />
      </defs>
      <Ground m={m} />
      <DawnWash m={m} />
      <g data-layer="pools">
        {m.nodes.map((n) => (
          <At key={n.id} n={n}>
            <LightPool m={m} n={n} r={60} />
          </At>
        ))}
      </g>
      <g data-layer="roads" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {m.edges.map((e) => (
          <Road key={e.key} m={m} e={e} />
        ))}
      </g>
      <SectionVeil m={m} />
      <LineTitles m={m} />
      <g data-layer="stops">
        {m.nodes.map((n) => (
          <At key={n.id} n={n}>
            {n.gate ? <Arch m={m} n={n} /> : <Town m={m} n={n} />}
          </At>
        ))}
      </g>
      <FlagLayer m={m} />
      <TokenMarker m={m} />
    </g>
  );
}

function Road({ m, e }: { m: DrawModel; e: DrawEdge }) {
  const color = lineColor(m, e.color);
  const k = edgeBoost(e);
  const op = edgeOpacity(e);
  if (e.state === "planned" || e.state === "unbuilt") {
    const planned = e.state === "planned";
    return (
      <path
        d={e.d}
        stroke={planned ? m.colors.muted : m.colors.ink2}
        strokeWidth={(planned ? 2.5 : 3.5) * k}
        strokeDasharray={planned ? "1 9" : "8 6"}
        opacity={op * (planned ? 0.75 : 0.45)}
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
        strokeWidth={3.5 * k}
        strokeDasharray="2 6"
        opacity={op * 0.35}
        data-edge={e.key}
        data-state={e.state}
      />
    );
  }
  const width = e.state === "lit" ? 6 : e.state === "done" ? 5.5 : 4.5;
  const alpha = e.state === "dim" ? 0.6 : e.state === "open" ? 0.7 : 1;
  return (
    <g opacity={op * alpha} data-edge={e.key} data-state={e.state}>
      <path d={e.d} stroke={m.colors.ink} strokeOpacity={0.55} strokeWidth={(width + 3) * k} />
      <path
        d={e.d}
        stroke={color}
        strokeWidth={width * k}
        strokeDasharray={e.kind === "transfer" ? "6 6" : undefined}
      />
      {e.state === "lit" || e.state === "dim" ? (
        <path
          d={e.d}
          stroke="var(--lumen)"
          strokeWidth={2}
          strokeDasharray={e.kind === "transfer" ? "6 6" : undefined}
        />
      ) : null}
    </g>
  );
}

/** A little house: roof, walls, two windows. Windows glow Lumen when the town is lit. */
function House({
  fill,
  stroke,
  windows,
  dashed,
  roof,
}: {
  fill: string;
  stroke: string;
  windows: string;
  dashed?: boolean;
  /** Done: the roof filled in the line colour. */
  roof?: string;
}) {
  return (
    <g strokeLinejoin="round">
      <path
        d="M-9 2V-6L0 -13L9 -6V2Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray={dashed ? "2 2.5" : undefined}
      />
      {roof ? <path d="M-11 -5L0 -15L11 -5Z" fill={roof} stroke={stroke} strokeWidth={1.6} /> : null}
      <rect x={-5.5} y={-5} width={4} height={4} rx={0.6} fill={windows} />
      <rect x={1.5} y={-5} width={4} height={4} rx={0.6} fill={windows} />
    </g>
  );
}

function Town({ m, n }: { m: DrawModel; n: DrawNode }) {
  const reduced = m.props.reducedMotion;
  const s = n.state;
  const color = lineColor(m, n.color);
  const ground = m.colors.ground;
  if (s === "planned") return <PlannedSquare size={22} color={m.colors.muted} />;
  if (s === "building") return <BuildingRing r={13} color={color} reduced={reduced} />;
  const locked = s === "locked";
  const windows = s === "lit" ? "var(--lumen)" : s === "fading" ? "var(--ember)" : s === "done" ? color : ground;
  return (
    <g>
      {n.pulse ? <OncePulse key={m.props.hoverId} r={14} reduced={reduced} /> : null}
      {n.focus ? <FocusHalo r={16} /> : null}
      {s === "ready" || s === "in-progress" ? <ReadyHalo r={15} reduced={reduced} /> : null}
      {/* The town's dot on the road. */}
      <ellipse
        cx={0}
        cy={8}
        rx={12}
        ry={5}
        fill={locked ? ground : color}
        stroke={locked ? m.colors.muted : m.colors.ink}
        strokeWidth={1.5}
        strokeDasharray={locked ? "2 2.5" : undefined}
      />
      <g filter={s === "lit" ? `url(#${m.uid}-glow)` : undefined}>
        {s === "fading" ? <Flicker reduced={reduced} /> : null}
        <House
          fill={locked ? ground : ground}
          stroke={locked ? m.colors.muted : m.colors.ink}
          windows={windows}
          dashed={locked}
          {...(s === "done" ? { roof: color } : {})}
        />
        {s === "lit" && !reduced ? <DuskLights /> : null}
        {s === "done" ? (
          <g transform="translate(0 -9)">
            <DoneTick size={4.5} color={ground} />
          </g>
        ) : null}
      </g>
      {/* Name flag: Sea when ready, the line colour otherwise. */}
      {locked ? null : (
        <g>
          <path d="M9 -6V-22" stroke={m.colors.ink} strokeWidth={1.5} strokeLinecap="round" />
          <path
            d="M9 -22H19L16 -18.5L19 -15H9Z"
            fill={s === "ready" || s === "in-progress" ? "var(--sea)" : color}
            stroke={m.colors.ink}
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
        </g>
      )}
      {s === "in-progress" ? <ProgressArc r={20} /> : null}
      {n.view.durable && (s === "lit" || s === "fading") ? (
        <path
          d="M-9 -6V-18L-15 -15.5L-9 -13"
          fill={color}
          stroke={m.colors.ink}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      ) : null}
    </g>
  );
}

/** Windows that come on one by one at dusk (lit towns only). */
function DuskLights() {
  return (
    <g>
      {[
        [-3.5, -3, "0s"],
        [3.5, -3, "1.1s"],
      ].map(([x, y, begin]) => (
        <circle key={String(begin)} cx={Number(x)} cy={Number(y)} r={3.5} fill="var(--lumen)" opacity={0}>
          <animate
            attributeName="opacity"
            values="0;0.55;0.2;0.55;0"
            dur="4.8s"
            begin={String(begin)}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </g>
  );
}

/**
 * Checkpoint: a stone arch standing over the road with a wooden two-leaf door. Each leaf narrows towards
 * its hinge as it swings: shut (Locked), ajar with a sliver of light (Ready), flung open with Lumen light
 * through the arch (Open).
 */
function Arch({ m, n }: { m: DrawModel; n: DrawNode }) {
  const ground = m.colors.ground;
  const ink = m.colors.ink;
  return (
    <GateGlyph
      m={m}
      n={n}
      upright
      draw={({ angle, across, along, tone, open, planned, color }) => {
        const w = along;
        const h = across;
        const iw = w * 0.58;
        const top = -h / 2 + 4;
        const spring = top + iw / 2 + 4;
        const base = h / 2 - 4;
        const opening = `M${-iw / 2} ${base}V${spring}A${iw / 2} ${iw / 2} 0 0 1 ${iw / 2} ${spring}V${base}Z`;
        const k = 1 - (angle / 90) * 0.88;
        const leaf = (dir: 1 | -1) => {
          const x0 = (dir * iw) / 2;
          const x1 = x0 - dir * (iw / 2) * k;
          return (
            <path
              d={`M${x0} ${base}V${spring}A${iw / 2} ${iw / 2} 0 0 ${dir === 1 ? 0 : 1} ${x1} ${top + 4 + (1 - k) * 6}V${base}Z`}
              fill={planned ? ground : mix(ground, color, 0.45)}
              stroke={tone}
              strokeWidth={1.8}
              strokeDasharray={planned ? "3 3" : undefined}
            />
          );
        };
        return (
          <g data-part="arch">
            {/* Stonework: two pillars and the arch, with a keystone. */}
            <path
              d={`M${-w / 2} ${base}V${spring - 2}A${w / 2} ${w / 2} 0 0 1 ${w / 2} ${spring - 2}V${base}Z`}
              fill={planned ? ground : mix(ground, ink, 0.12)}
              stroke={planned ? m.colors.muted : ink}
              strokeWidth={2}
              strokeDasharray={planned ? "4 3" : undefined}
            />
            <path d={opening} fill={open ? "var(--lumen)" : mix(ground, ink, 0.45)} />
            {leaf(1)}
            {leaf(-1)}
            <path
              d={`M-4 ${top - 2}H4L3 ${top + 7}H-3Z`}
              fill={open ? "var(--lumen)" : tone}
              stroke={ink}
              strokeWidth={1}
            />
            <path d={`M${-w / 2 - 4} ${base}H${w / 2 + 4}`} stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
          </g>
        );
      }}
    />
  );
}
