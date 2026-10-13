/**
 * MiniMap: a small, simplified map (the Relight header, revisit routes) and the card modal's section
 * strip. Shape-coded entries: Later dotted ring, Ready ring + Sea dot, Done disc in the line colour with
 * a ground tick (never gold), Lit Lumen disc, Fading lower half, Planned dashed square, and gates as a
 * small barrier (closed, ajar, open). The emphasised path is numbered in order with a Sea overlay.
 *
 * `variant="strip"` (or a path with height ≤ 48): the path in one row, ○──●──◉══[gate], with the current
 * card ringed in Sea and Done ticks shown live.
 */
import type { NodeId, NodeState } from "@learncroc/core";
import { useId } from "react";
import { type WorldColors, worldColors } from "./lib/color";
import { isLitLike, viewFor } from "./lib/graph";
import { buildScene } from "./lib/scene";
import { TokenArt } from "./renderers/glyphs";
import type { MiniMapProps } from "./types";

const TICK = (r: number) => `M${-0.55 * r} ${0.02 * r}l${0.38 * r} ${0.38 * r} ${0.72 * r} ${-0.78 * r}`;

/** One entry, centred on the origin, radius r (in the caller's units). */
function MiniGlyph({
  state,
  gate,
  color,
  colors,
  r,
  k,
}: {
  state: NodeState;
  gate: boolean;
  color: string;
  colors: WorldColors;
  r: number;
  /** Stroke scale (1 / map scale). */
  k: number;
}) {
  const ground = colors.ground;
  if (gate) {
    const open = state === "lit" || state === "done" || state === "fading";
    const ready = state === "ready" || state === "in-progress";
    const tone = open ? "var(--lumen)" : ready ? "var(--sea)" : colors.muted;
    const a = open ? 70 : ready ? 14 : 0;
    const h = r * 1.5;
    return (
      <g data-gate={state}>
        <rect
          x={-r * 0.7}
          y={-h}
          width={r * 1.4}
          height={h * 2}
          rx={2 * k}
          fill={ground}
          stroke={tone}
          strokeWidth={1.4 * k}
          strokeDasharray={state === "planned" ? `${2 * k} ${2 * k}` : undefined}
        />
        {[-1, 1].map((d) => (
          <path
            key={d}
            d={`M0 ${-d * h * 0.85}V${-d * h * 0.1}`}
            transform={`rotate(${-d * a} 0 ${-d * h * 0.85})`}
            stroke={tone}
            strokeWidth={2.2 * k}
            strokeLinecap="round"
          />
        ))}
      </g>
    );
  }
  switch (state) {
    case "planned":
      return (
        <rect
          x={-r}
          y={-r}
          width={r * 2}
          height={r * 2}
          fill="none"
          stroke={colors.muted}
          strokeWidth={1.5 * k}
          strokeDasharray={`${2 * k} ${2 * k}`}
        />
      );
    case "lit":
      return <circle r={r} fill="var(--lumen)" stroke={colors.ink} strokeWidth={1.2 * k} />;
    case "fading":
      return (
        <>
          <circle r={r} fill={ground} stroke="var(--ember)" strokeWidth={1.5 * k} />
          <path d={`M${-r} 0A${r} ${r} 0 0 0 ${r} 0Z`} fill="var(--ember)" />
        </>
      );
    case "done":
      return (
        <g data-done>
          <circle r={r} fill={color} />
          <path
            d={TICK(r)}
            fill="none"
            stroke={ground}
            strokeWidth={Math.max(1.2 * k, r * 0.28)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    default:
      return (
        <>
          <circle
            r={r}
            fill={ground}
            stroke={state === "locked" || state === "building" ? colors.muted : colors.ink}
            strokeWidth={1.5 * k}
            strokeDasharray={state === "locked" ? `${1.5 * k} ${1.5 * k}` : undefined}
          />
          {state === "ready" || state === "in-progress" ? <circle r={r * 0.4} fill="var(--sea)" /> : null}
        </>
      );
  }
}

export function MiniMap(props: MiniMapProps) {
  const { path = [], height = 120, variant } = props;
  const strip = variant === "strip" || (variant !== "map" && path.length > 0 && height <= 48);
  return strip ? <SectionStrip {...props} /> : <WholeMap {...props} />;
}

function SectionStrip({ pack, views, path = [], focusId, width = 240, height = 28 }: MiniMapProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const map = pack.map;
  const theme = pack.manifest.theme;
  const colors = worldColors(theme);
  const ids = path.filter((id) => map.nodes[id]);
  const n = ids.length;
  const pad = height * 0.7;
  const step = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const cy = height / 2;
  const r = Math.min(7, height * 0.26);
  const title = (id: NodeId) => map.nodes[id]?.title ?? id;
  const lineOf = (id: NodeId) => {
    const lineId = map.nodes[id]?.line;
    const idx = Math.max(0, Math.min(4, (map.lines.find((l) => l.id === lineId)?.color ?? 1) - 1));
    return colors.lines[idx] ?? colors.ink;
  };
  const label = `This section: ${ids
    .map(
      (id) =>
        `${map.nodes[id]?.kind === "checkpoint" ? "checkpoint" : title(id)} (${viewFor(map, views, id).state === "lit" && map.nodes[id]?.kind === "checkpoint" ? "open" : viewFor(map, views, id).state})`,
    )
    .join(", ")}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      data-minimap={pack.manifest.id}
      data-variant="strip"
      data-theme={theme.mode}
    >
      <title>{label}</title>
      <defs>
        <clipPath id={`${uid}-c`}>
          <rect width={width} height={height} rx={height / 2} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid}-c)`}>
        <rect width={width} height={height} fill={theme.ground} />
        {ids.slice(1).map((id, i) => {
          const a = ids[i] as NodeId;
          const sa = viewFor(map, views, a).state;
          const sb = viewFor(map, views, id).state;
          const laid =
            (sa === "done" || isLitLike(sa)) &&
            (sb === "done" || isLitLike(sb) || sb === "ready" || sb === "in-progress");
          const lit = isLitLike(sa) && isLitLike(sb);
          const x1 = pad + i * step + r + 2;
          const x2 = pad + (i + 1) * step - r - 2;
          return (
            <g key={`${a}-${id}`}>
              <path
                d={`M${x1} ${cy}H${x2}`}
                stroke={laid ? lineOf(a) : colors.muted}
                strokeWidth={laid ? 3 : 2}
                strokeDasharray={laid ? undefined : "2 4"}
                strokeLinecap="round"
              />
              {lit ? <path d={`M${x1} ${cy}H${x2}`} stroke="var(--lumen)" strokeWidth={1.2} /> : null}
            </g>
          );
        })}
        {ids.map((id, i) => {
          const v = viewFor(map, views, id);
          const gate = map.nodes[id]?.kind === "checkpoint";
          return (
            <g key={id} transform={`translate(${pad + i * step} ${cy})`} data-state={v.state} data-strip-node={id}>
              <MiniGlyph state={v.state} gate={gate} color={lineOf(id)} colors={colors} r={r} k={1} />
              {id === focusId ? <circle r={r + 3.5} fill="none" stroke="var(--sea)" strokeWidth={2} /> : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function WholeMap({ pack, views, path = [], focusId, tokenAt, width = 240, height = 120 }: MiniMapProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const map = pack.map;
  const theme = pack.manifest.theme;
  const colors = worldColors(theme);
  const scene = buildScene(map, "octilinear", pack.manifest.id);
  const pad = 22;
  const s = Math.min((width - pad * 2) / map.layout.width, (height - pad * 2) / map.layout.height);
  const ox = (width - map.layout.width * s) / 2;
  const oy = (height - map.layout.height * s) / 2;
  const onPath = new Map(path.map((id, i) => [id, i] as const));
  const k = 1 / Math.max(s, 0.08);
  const r = Math.min(18, 7 * k);
  const title = (id: NodeId) => map.nodes[id]?.title ?? id;
  const label = path.length ? `Mini map: ${path.map(title).join(", then ")}` : `Mini map of ${theme.world}`;
  const pathEdges = scene.edges.filter((e) => {
    const a = onPath.get(e.from);
    const b = onPath.get(e.to);
    return a !== undefined && b !== undefined && Math.abs(a - b) === 1;
  });
  const token = tokenAt ? scene.byId.get(tokenAt) : undefined;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      data-minimap={pack.manifest.id}
      data-theme={theme.mode}
    >
      <title>{label}</title>
      <defs>
        <clipPath id={`${uid}-c`}>
          <rect width={width} height={height} rx={12} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid}-c)`}>
        <rect width={width} height={height} fill={theme.ground} />
        <g transform={`translate(${ox} ${oy}) scale(${s})`}>
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {scene.edges.map((e) => {
              const sa = viewFor(map, views, e.from).state;
              const sb = viewFor(map, views, e.to).state;
              const lit = isLitLike(sa) && isLitLike(sb);
              const laid = lit || ((sa === "done" || isLitLike(sa)) && (sb === "done" || isLitLike(sb)));
              const color = colors.lines[scene.byId.get(e.to)?.color ?? 0] ?? colors.ink;
              return (
                <g key={e.key} opacity={path.length && !onPath.has(e.from) ? 0.5 : 1}>
                  <path
                    d={e.d}
                    stroke={laid ? color : colors.muted}
                    strokeWidth={(laid ? 3 : 2) * k}
                    strokeDasharray={laid ? undefined : `${3 * k} ${3 * k}`}
                  />
                  {lit ? <path d={e.d} stroke="var(--lumen)" strokeWidth={1.2 * k} /> : null}
                </g>
              );
            })}
            {pathEdges.map((e) => (
              <path
                key={`p-${e.key}`}
                d={e.d}
                stroke="var(--sea)"
                strokeWidth={4 * k}
                strokeDasharray={`${5 * k} ${4 * k}`}
              />
            ))}
          </g>
          {scene.nodes.map((n) => {
            const v = viewFor(map, views, n.id);
            const idx = onPath.get(n.id);
            const rr = n.gate ? r * 1.2 : r;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                data-state={v.state}
                opacity={path.length && idx === undefined ? 0.55 : 1}
              >
                <MiniGlyph
                  state={v.state}
                  gate={n.gate}
                  color={colors.lines[n.color] ?? colors.ink}
                  colors={colors}
                  r={rr}
                  k={k}
                />
                {idx !== undefined || n.id === focusId ? (
                  <circle r={rr + 4 * k} fill="none" stroke="var(--sea)" strokeWidth={2 * k} />
                ) : null}
                {idx !== undefined ? (
                  <text
                    y={-rr - 6 * k}
                    textAnchor="middle"
                    fontSize={11 * k}
                    fontWeight={700}
                    fill={colors.ink}
                    stroke={theme.ground}
                    strokeWidth={3 * k}
                    style={{ paintOrder: "stroke" }}
                  >
                    {idx + 1}
                  </text>
                ) : null}
              </g>
            );
          })}
          {token ? (
            <g
              transform={`translate(${token.x - 2.2 * r} ${token.y - 2.2 * r}) scale(${0.8 * k * 0.9})`}
              data-token-at={token.id}
            >
              <TokenArt
                kind={theme.token}
                ink={colors.ink}
                accent={colors.lines[token.color] ?? colors.ink}
                ground={theme.ground}
              />
            </g>
          ) : null}
        </g>
      </g>
    </svg>
  );
}
