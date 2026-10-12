/**
 * plot view: a chart you steer.
 *
 * Sliders bend the curves live and readouts update as you move; a draggable marker reads values off
 * the curve; "you draw it" hides the real curve until you've sketched your prediction, then lays the
 * truth over your line with the gap shaded. Function, data and bar charts; linear or log axes.
 */
import { compileExpr } from "@learncroc/core";
import { cn } from "@learncroc/ui";
import { type RefObject, useMemo, useRef, useState } from "react";
import { useDragPoint } from "../shared/drag";
import { clamp, fmt, logTicks, niceTicks, snap, tickLabel } from "../shared/math";
import { Slider } from "../shared/Slider";
import { KeyButton, lineColor, motionStyle, ReviewNote, WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import { type PlotAnswer, type PlotGoal, type PlotProps, paramValues, readoutValue, seriesY } from "./spec";

type Props = WidgetViewProps<PlotProps, PlotGoal, PlotAnswer>;

const W = 640;
const H = 360;
const M = { left: 60, right: 20, top: 18, bottom: 48 };
const IW = W - M.left - M.right;
const IH = H - M.top - M.bottom;
const SAMPLES = 160;
export const DRAW_COLUMNS = 12;

interface Scale {
  (v: number): number;
  invert: (px: number) => number;
  ticks: number[];
  log: boolean;
}

function makeScale(min: number, max: number, log: boolean, r0: number, r1: number): Scale {
  const lmin = log ? Math.log10(Math.max(min, 1e-12)) : min;
  const lmax = log ? Math.log10(Math.max(max, 1e-12)) : max;
  const span = lmax - lmin || 1;
  const f = ((v: number) => {
    const t = ((log ? Math.log10(Math.max(v, 1e-12)) : v) - lmin) / span;
    return r0 + t * (r1 - r0);
  }) as Scale;
  f.invert = (px: number) => {
    const t = (px - r0) / (r1 - r0);
    const v = lmin + t * span;
    return log ? 10 ** v : v;
  };
  f.ticks = log ? logTicks(min, max) : niceTicks(min, max, 5);
  f.log = log;
  return f;
}

function sampleXs(min: number, max: number, log: boolean, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(log ? 10 ** (Math.log10(min) + t * (Math.log10(max) - Math.log10(min))) : min + t * (max - min));
  }
  return out;
}

/** Evaluate a series at many x for drawing (with params). */
function seriesPoints(
  props: PlotProps,
  s: PlotProps["series"][number],
  params: Record<string, number>,
): [number, number][] {
  if (s.expr) {
    try {
      const f = compileExpr(s.expr);
      return sampleXs(props.x.min, props.x.max, props.x.scale === "log", SAMPLES).map((x) => [x, f({ ...params, x })]);
    } catch {
      return [];
    }
  }
  return [...(s.points ?? [])].sort((a, b) => a[0] - b[0]);
}

/** y range: authored, else the extent of every series across each param's min, value and max. */
function yExtent(props: PlotProps): [number, number] {
  if (props.y.min !== undefined && props.y.max !== undefined) return [props.y.min, props.y.max];
  const ys: number[] = [];
  const base = paramValues(props);
  const variants: Record<string, number>[] = [base];
  for (const p of props.params ?? []) variants.push({ ...base, [p.name]: p.min }, { ...base, [p.name]: p.max });
  for (const params of variants)
    for (const s of props.series) {
      if (props.kind === "bar") for (const b of s.bars ?? []) ys.push(b.value);
      else for (const [, y] of seriesPoints(props, s, params)) if (Number.isFinite(y)) ys.push(y);
    }
  let lo = props.y.min ?? Math.min(0, ...ys);
  let hi = props.y.max ?? Math.max(...ys, lo + 1);
  if (props.y.scale === "log") {
    lo = props.y.min ?? Math.max(1e-6, Math.min(...ys.filter((y) => y > 0), 1));
  }
  if (!(hi > lo)) hi = lo + 1;
  const pad = props.y.max === undefined ? (hi - lo) * 0.08 : 0;
  return [lo, hi + pad];
}

function pathFrom(pts: [number, number][], sx: Scale, sy: Scale, yLo: number, yHi: number): string {
  let d = "";
  let pen = false;
  for (const [x, y] of pts) {
    if (!Number.isFinite(y) || y < yLo - (yHi - yLo) * 2 || y > yHi + (yHi - yLo) * 2) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${sx(x).toFixed(2)} ${sy(clamp(y, yLo - (yHi - yLo), yHi + (yHi - yLo))).toFixed(2)} `;
    pen = true;
  }
  return d.trim();
}

const unitOf = (u?: string) => (u ? ` ${u}` : "");

/** Round a value to the precision a step implies. */
function tidy(v: number, step: number): number {
  return snap(v, step / 10 || 1e-6);
}

export default function PlotView(p: Props) {
  const props = withReveal(p.props, p.revealProps);
  const svgRef = useRef<SVGSVGElement>(null);
  const interactive = p.mode !== "review" && (!!p.onChange || p.mode === "explore");
  const [localParams, setLocalParams] = useState<Record<string, number>>({});
  const [localPoint, setLocalPoint] = useState<[number, number] | undefined>(undefined);
  const [localDrawn, setLocalDrawn] = useState<[number, number][] | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const goal = p.goal;
  const review = p.mode === "review";

  const answer: PlotAnswer = p.value ?? {};
  const params = { ...paramValues(props), ...localParams, ...(answer.params ?? {}) };
  const point = answer.point ?? localPoint;
  const drawn = answer.drawn ?? localDrawn;

  const emit = (patch: Partial<PlotAnswer>) => {
    const next: PlotAnswer = { ...answer, ...patch };
    if (p.onChange) p.onChange(next);
    else {
      if (patch.params) setLocalParams(patch.params);
      if (patch.point) setLocalPoint(patch.point);
      if (patch.drawn) setLocalDrawn(patch.drawn);
    }
  };

  const [yLo, yHi] = useMemo(() => yExtent(props), [props]);
  const sx = makeScale(props.x.min, props.x.max, props.x.scale === "log", M.left, M.left + IW);
  const sy = makeScale(yLo, yHi, props.y.scale === "log", M.top + IH, M.top);

  const drawing = !!props.drawPrediction && props.kind !== "bar";
  const drawTarget = goal?.kind === "draw" ? goal.series : undefined;
  const truthHidden = (id: string) => drawing && !review && !shown && (drawTarget === undefined || drawTarget === id);
  const firstSeries = props.series[0];

  const readouts = (props.readouts ?? []).map((r) => ({
    ...r,
    value: readoutValue(props, r.label, { params }),
  }));

  const setParam = (name: string, v: number) => {
    const next = { ...params, [name]: v };
    emit({ params: next });
    const pr = props.params?.find((x) => x.name === name);
    const ro = (props.readouts ?? [])
      .map((r) => {
        const val = readoutValue(props, r.label, { params: next });
        return val === undefined ? "" : `${r.label} ${fmt(val, r.digits ?? 2)}${unitOf(r.unit)}`;
      })
      .filter(Boolean)
      .join(", ");
    p.announce(`${pr?.label ?? name} ${v}${unitOf(pr?.unit)}.${ro ? ` ${ro}.` : ""}`);
  };

  return (
    <WidgetShell
      id="plot"
      mode={p.mode}
      label={props.title ?? `${props.y.label} against ${props.x.label}`}
      toolbar={
        props.dataSource === "illustrative" ? (
          <span className="rounded-xs border border-dashed border-line-strong px-1.5 py-0.5 text-micro text-ink-3">
            illustrative numbers
          </span>
        ) : props.dataSource === "sources" ? (
          <span className="text-micro text-ink-3">data from the stop's sources</span>
        ) : null
      }
    >
      {props.title ? <p className="text-body font-semibold text-w-ink">{props.title}</p> : null}
      <div className="relative w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-none overflow-visible"
          aria-hidden="true"
        >
          <Axes props={props} sx={sx} sy={sy} yLo={yLo} yHi={yHi} />
          {props.kind === "bar" ? (
            <Bars props={props} sy={sy} yLo={yLo} reducedMotion={p.reducedMotion} />
          ) : (
            props.series.map((s, i) => {
              const pts = seriesPoints(props, s, params);
              const color = lineColor(s.color ?? i + 1);
              const hidden = truthHidden(s.id);
              return (
                <g
                  key={s.id}
                  data-series={s.id}
                  data-hidden={hidden || undefined}
                  style={{ opacity: hidden ? 0 : 1, ...motionStyle(p.reducedMotion, "opacity", "var(--dur-reveal)") }}
                >
                  {s.expr || props.kind === "function" ? (
                    <path
                      d={pathFrom(pts, sx, sy, yLo, yHi)}
                      fill="none"
                      stroke={color}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : (
                    <>
                      <path
                        d={pathFrom(pts, sx, sy, yLo, yHi)}
                        fill="none"
                        stroke={color}
                        strokeWidth="2"
                        strokeDasharray="1 0"
                        opacity="0.6"
                      />
                      {pts.map(([x, y]) => (
                        <circle
                          key={`${x}-${y}`}
                          cx={sx(x)}
                          cy={sy(y)}
                          r="4.5"
                          fill={color}
                          stroke="var(--w-ground)"
                          strokeWidth="1.5"
                        />
                      ))}
                    </>
                  )}
                </g>
              );
            })
          )}
          {props.markerAt !== undefined ? (
            <line
              x1={sx(props.markerAt)}
              x2={sx(props.markerAt)}
              y1={M.top}
              y2={M.top + IH}
              stroke="var(--w-ink)"
              strokeWidth="2"
              strokeDasharray="5 4"
              data-marker-at={props.markerAt}
            />
          ) : null}
          {drawing && drawn?.length ? (
            <DrawnLayer
              props={props}
              drawn={drawn}
              sx={sx}
              sy={sy}
              params={params}
              showGap={review || shown}
              target={drawTarget ?? firstSeries?.id}
            />
          ) : null}
          {review && goal?.kind === "point" ? <PointTarget goal={goal} sx={sx} sy={sy} /> : null}
          {props.marker && point ? <MarkerGlyph kind={props.marker} point={point} sx={sx} sy={sy} /> : null}
        </svg>

        {/* Interaction layers: real focusable elements positioned over the plot area. */}
        {props.marker && props.kind !== "bar" ? (
          <MarkerHandle
            props={props}
            svgRef={svgRef}
            point={point}
            params={params}
            sx={sx}
            sy={sy}
            yLo={yLo}
            yHi={yHi}
            interactive={interactive}
            onPoint={(pt) => emit({ point: pt })}
            announce={p.announce}
          />
        ) : null}
        {drawing ? (
          <DrawPad
            props={props}
            svgRef={svgRef}
            drawn={drawn ?? []}
            yLo={yLo}
            yHi={yHi}
            sy={sy}
            interactive={interactive && !shown}
            onDrawn={(d) => emit({ drawn: d })}
            announce={p.announce}
          />
        ) : null}
      </div>

      {readouts.length ? (
        <div className="flex flex-wrap gap-2" aria-live="off">
          {readouts.map((r) => {
            const target = review && goal?.kind === "readout" && goal.label === r.label ? goal.target : undefined;
            return (
              <span
                key={r.label}
                className="inline-flex items-baseline gap-2 rounded-sm border border-w-grid bg-surface px-3 py-1.5 text-small text-ink-2"
                data-readout={r.label}
              >
                {r.label}
                <strong className="text-lead text-ink tabular">
                  {r.value === undefined ? "–" : fmt(r.value, r.digits ?? 2)}
                  {unitOf(r.unit)}
                </strong>
                {target !== undefined ? (
                  <span className="text-micro text-sea-text">
                    target {fmt(target, r.digits ?? 2)}
                    {unitOf(r.unit)}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}

      {props.params?.length ? (
        <div className="grid gap-4 @lg:grid-cols-2">
          {props.params.map((pr) => {
            const target = review && goal?.kind === "param" && goal.name === pr.name ? goal.target : undefined;
            return (
              <Slider
                key={pr.name}
                label={pr.label}
                ariaLabel={pr.label}
                value={params[pr.name] ?? pr.value}
                min={pr.min}
                max={pr.max}
                step={pr.step}
                disabled={!interactive}
                tone="world"
                format={(v) => `${tidy(v, pr.step)}${unitOf(pr.unit)}`}
                onChange={(v) => setParam(pr.name, v)}
                marks={target !== undefined ? [{ at: target, label: `target ${target}` }] : undefined}
              />
            );
          })}
        </div>
      ) : null}

      {drawing && p.mode === "explore" ? (
        <div className="flex gap-3">
          <KeyButton size="sm" disabled={!drawn?.length || shown} onClick={() => setShown(true)}>
            Show the real curve
          </KeyButton>
          {shown ? (
            <KeyButton
              size="sm"
              tone="quiet"
              onClick={() => {
                setShown(false);
                emit({ drawn: [] });
              }}
            >
              Draw again
            </KeyButton>
          ) : null}
        </div>
      ) : null}
      {drawing && !review && !shown && !drawn?.length ? (
        <p className="text-small text-w-ink-2">
          Sketch where you think the line goes. Drag across the chart, or focus it and use the arrow keys.
        </p>
      ) : null}
      {props.marker && props.kind !== "bar" && !point && interactive ? (
        <p className="text-small text-w-ink-2">
          {props.marker === "x"
            ? `Click or drag along the chart to place the marker, or focus it and use the arrow keys.`
            : `Click or drag to place the point, or focus the chart and use the arrow keys.`}
        </p>
      ) : null}
      {review && goal?.kind === "draw" ? (
        <ReviewNote>Shaded: the gap between your sketch and the real curve.</ReviewNote>
      ) : null}
      <Legend props={props} hiddenIds={props.series.filter((s) => truthHidden(s.id)).map((s) => s.id)} />
    </WidgetShell>
  );
}

function Axes({ props, sx, sy, yLo, yHi }: { props: PlotProps; sx: Scale; sy: Scale; yLo: number; yHi: number }) {
  return (
    <g>
      <rect x={M.left} y={M.top} width={IW} height={IH} fill="var(--w-ground)" />
      {sy.ticks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.left} x2={M.left + IW} y1={sy(t)} y2={sy(t)} stroke="var(--w-grid)" strokeWidth="1" />
          <text
            x={M.left - 8}
            y={sy(t)}
            dy="0.35em"
            textAnchor="end"
            fontSize="13"
            fill="var(--w-ink-2)"
            className="tabular"
          >
            {tickLabel(t)}
          </text>
        </g>
      ))}
      {props.kind !== "bar"
        ? sx.ticks.map((t) => (
            <g key={`x${t}`}>
              <line
                x1={sx(t)}
                x2={sx(t)}
                y1={M.top}
                y2={M.top + IH}
                stroke="var(--w-grid)"
                strokeWidth="1"
                opacity="0.6"
              />
              <text
                x={sx(t)}
                y={M.top + IH + 18}
                textAnchor="middle"
                fontSize="13"
                fill="var(--w-ink-2)"
                className="tabular"
              >
                {tickLabel(t)}
              </text>
            </g>
          ))
        : null}
      <line
        x1={M.left}
        x2={M.left + IW}
        y1={sy(Math.max(yLo, Math.min(yHi, props.y.scale === "log" ? yLo : 0)))}
        y2={sy(Math.max(yLo, Math.min(yHi, props.y.scale === "log" ? yLo : 0)))}
        stroke="var(--w-ink-2)"
        strokeWidth="1.5"
      />
      <line x1={M.left} x2={M.left} y1={M.top} y2={M.top + IH} stroke="var(--w-ink-2)" strokeWidth="1.5" />
      <text x={M.left + IW / 2} y={H - 6} textAnchor="middle" fontSize="14" fill="var(--w-ink)">
        {props.x.label}
        {props.x.unit ? ` (${props.x.unit})` : ""}
      </text>
      <text
        x={14}
        y={M.top + IH / 2}
        textAnchor="middle"
        fontSize="14"
        fill="var(--w-ink)"
        transform={`rotate(-90 14 ${M.top + IH / 2})`}
      >
        {props.y.label}
        {props.y.unit ? ` (${props.y.unit})` : ""}
      </text>
    </g>
  );
}

function Bars({ props, sy, yLo, reducedMotion }: { props: PlotProps; sy: Scale; yLo: number; reducedMotion: boolean }) {
  const labels = [...new Set(props.series.flatMap((s) => (s.bars ?? []).map((b) => b.label)))];
  const band = IW / Math.max(1, labels.length);
  const groupW = band * 0.7;
  const barW = groupW / Math.max(1, props.series.length);
  const base = sy(Math.max(yLo, 0));
  return (
    <g>
      {labels.map((label, li) => (
        <g key={label}>
          {props.series.map((s, si) => {
            const v = s.bars?.find((b) => b.label === label)?.value;
            if (v === undefined) return null;
            const x = M.left + li * band + (band - groupW) / 2 + si * barW;
            const y = sy(v);
            return (
              <g key={s.id}>
                <rect
                  x={x + 2}
                  y={Math.min(y, base)}
                  width={Math.max(2, barW - 4)}
                  height={Math.abs(base - y)}
                  rx="3"
                  fill={lineColor(s.color ?? si + 1)}
                  style={motionStyle(reducedMotion, "y, height")}
                />
                <text
                  x={x + barW / 2}
                  y={Math.min(y, base) - 6}
                  textAnchor="middle"
                  fontSize="12"
                  fill="var(--w-ink)"
                  className="tabular"
                >
                  {tickLabel(v)}
                </text>
              </g>
            );
          })}
          <text
            x={M.left + li * band + band / 2}
            y={M.top + IH + 18}
            textAnchor="middle"
            fontSize="13"
            fill="var(--w-ink-2)"
          >
            {label}
          </text>
        </g>
      ))}
    </g>
  );
}

function Legend({ props, hiddenIds }: { props: PlotProps; hiddenIds: string[] }) {
  if (props.series.length < 2 && !props.drawPrediction) return null;
  return (
    <div className="flex flex-wrap gap-4 text-small text-w-ink-2" aria-hidden="true">
      {props.series.map((s, i) => (
        <span key={s.id} className={cn("inline-flex items-center gap-1.5", hiddenIds.includes(s.id) && "italic")}>
          <span
            className={cn("h-1 w-4 rounded-pill", hiddenIds.includes(s.id) && "opacity-40")}
            style={{ background: lineColor(s.color ?? i + 1) }}
          />
          {s.label}
          {hiddenIds.includes(s.id) ? " (hidden for now)" : ""}
        </span>
      ))}
      {props.drawPrediction ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed border-w-ink" />
          your sketch
        </span>
      ) : null}
    </div>
  );
}

function MarkerGlyph({ kind, point, sx, sy }: { kind: "x" | "point"; point: [number, number]; sx: Scale; sy: Scale }) {
  const x = sx(point[0]);
  const y = sy(point[1]);
  return (
    <g data-marker={`${point[0]},${point[1]}`}>
      {kind === "x" ? <line x1={x} x2={x} y1={M.top} y2={M.top + IH} stroke="var(--w-ink)" strokeWidth="2" /> : null}
      <line x1={M.left} x2={x} y1={y} y2={y} stroke="var(--w-ink-2)" strokeWidth="1" strokeDasharray="3 3" />
      {kind === "point" ? (
        <line x1={x} x2={x} y1={y} y2={M.top + IH} stroke="var(--w-ink-2)" strokeWidth="1" strokeDasharray="3 3" />
      ) : null}
      <circle cx={x} cy={y} r="8" fill="var(--surface)" stroke="var(--w-ink)" strokeWidth="2.5" />
      <circle cx={x} cy={y} r="3" fill="var(--w-ink)" />
    </g>
  );
}

function PointTarget({ goal, sx, sy }: { goal: Extract<PlotGoal, { kind: "point" }>; sx: Scale; sy: Scale }) {
  if (goal.x !== undefined && goal.y === undefined) {
    const x0 = sx(goal.x - goal.tolerance);
    const x1 = sx(goal.x + goal.tolerance);
    return (
      <rect
        x={Math.min(x0, x1)}
        y={M.top}
        width={Math.max(3, Math.abs(x1 - x0))}
        height={IH}
        fill="var(--sea)"
        opacity="0.18"
        data-target
      />
    );
  }
  if (goal.y !== undefined && goal.x === undefined) {
    const y0 = sy(goal.y - goal.tolerance);
    const y1 = sy(goal.y + goal.tolerance);
    return (
      <rect
        x={M.left}
        y={Math.min(y0, y1)}
        width={IW}
        height={Math.max(3, Math.abs(y1 - y0))}
        fill="var(--sea)"
        opacity="0.18"
        data-target
      />
    );
  }
  return (
    <circle
      cx={sx(goal.x ?? 0)}
      cy={sy(goal.y ?? 0)}
      r="12"
      fill="none"
      stroke="var(--sea)"
      strokeWidth="2.5"
      strokeDasharray="4 3"
      data-target
    />
  );
}

/** Plot-area box of the SVG in client pixels → helper for pointer math via useDragPoint's inset. */
const INSET = { left: M.left, right: M.right, top: M.top, bottom: M.bottom };
const VIEW = { width: W, height: H };

function MarkerHandle(p: {
  props: PlotProps;
  svgRef: RefObject<SVGSVGElement | null>;
  point?: [number, number];
  params: Record<string, number>;
  sx: Scale;
  sy: Scale;
  yLo: number;
  yHi: number;
  interactive: boolean;
  onPoint: (pt: [number, number]) => void;
  announce: (t: string) => void;
}) {
  const { props } = p;
  const xStep = (props.x.max - props.x.min) / 100;
  const yStep = (p.yHi - p.yLo) / 100;
  const first = props.series[0];
  const toPoint = (x: number, y?: number): [number, number] => {
    const xx = tidy(clamp(x, props.x.min, props.x.max), xStep);
    if (props.marker === "x") {
      const yy = first ? seriesY(props, first.id, xx, p.params) : undefined;
      return [xx, tidy(yy ?? 0, yStep)];
    }
    return [xx, tidy(clamp(y ?? p.yLo, p.yLo, p.yHi), yStep)];
  };
  const describe = (pt: [number, number]) =>
    `${props.x.label} ${pt[0]}${unitOf(props.x.unit)}, ${props.y.label} ${pt[1]}${unitOf(props.y.unit)}`;
  const set = (pt: [number, number]) => {
    p.onPoint(pt);
    p.announce(describe(pt));
  };
  const { handlers } = useDragPoint({
    areaRef: p.svgRef,
    disabled: !p.interactive,
    inset: INSET,
    viewSize: VIEW,
    onMove: (nx, ny) => {
      const x = p.sx.invert(M.left + nx * IW);
      const y = p.sy.invert(M.top + ny * IH);
      p.onPoint(toPoint(x, y));
    },
    onEnd: () => {
      if (p.point) p.announce(describe(p.point));
    },
  });
  const current = p.point ?? toPoint((props.x.min + props.x.max) / 2, (p.yLo + p.yHi) / 2);
  return (
    <div
      role="slider"
      tabIndex={p.interactive ? 0 : -1}
      aria-label={props.marker === "x" ? `Marker along ${props.x.label}` : "Marker point"}
      aria-valuemin={props.x.min}
      aria-valuemax={props.x.max}
      aria-valuenow={current[0]}
      aria-valuetext={p.point ? describe(p.point) : "not placed yet"}
      aria-readonly={!p.interactive || undefined}
      data-marker-handle
      className={cn("absolute rounded-md", p.interactive && "cursor-crosshair")}
      style={{
        left: `${(M.left / W) * 100}%`,
        top: `${(M.top / H) * 100}%`,
        width: `${(IW / W) * 100}%`,
        height: `${(IH / H) * 100}%`,
      }}
      {...handlers}
      onKeyDown={(e) => {
        if (!p.interactive) return;
        const big = e.shiftKey ? 10 : 1;
        let [x, y] = current;
        if (e.key === "ArrowRight") x += xStep * big;
        else if (e.key === "ArrowLeft") x -= xStep * big;
        else if (e.key === "ArrowUp" && props.marker === "point") y += yStep * big;
        else if (e.key === "ArrowDown" && props.marker === "point") y -= yStep * big;
        else if (e.key === "Home") x = props.x.min;
        else if (e.key === "End") x = props.x.max;
        else return;
        e.preventDefault();
        set(toPoint(x, y));
      }}
    />
  );
}

/** Column x positions for drawing a prediction. */
export function drawColumns(props: PlotProps): number[] {
  return sampleXs(props.x.min, props.x.max, props.x.scale === "log", DRAW_COLUMNS - 1).map((x) =>
    Number(x.toPrecision(6)),
  );
}

function DrawPad(p: {
  props: PlotProps;
  svgRef: RefObject<SVGSVGElement | null>;
  drawn: [number, number][];
  yLo: number;
  yHi: number;
  sy: Scale;
  interactive: boolean;
  onDrawn: (d: [number, number][]) => void;
  announce: (t: string) => void;
}) {
  const cols = drawColumns(p.props);
  const [col, setCol] = useState(0);
  const yStep = (p.yHi - p.yLo) / 50;
  const byX = new Map(p.drawn.map(([x, y]) => [x, y] as const));
  const latest = useRef(p.drawn);
  latest.current = p.drawn;

  const setAt = (i: number, y: number, speak = false) => {
    const x = cols[i];
    if (x === undefined) return;
    const yy = tidy(clamp(y, p.yLo, p.yHi), yStep);
    const map = new Map(latest.current.map(([a, b]) => [a, b] as const));
    map.set(x, yy);
    const next = cols.filter((c) => map.has(c)).map((c) => [c, map.get(c) as number] as [number, number]);
    latest.current = next;
    p.onDrawn(next);
    if (speak)
      p.announce(`${p.props.x.label} ${x}: ${p.props.y.label} ${yy}. ${next.length} of ${cols.length} points drawn.`);
  };

  const { handlers } = useDragPoint({
    areaRef: p.svgRef,
    disabled: !p.interactive,
    inset: INSET,
    viewSize: VIEW,
    onMove: (nx, ny) => {
      const i = Math.round(nx * (cols.length - 1));
      setCol(i);
      setAt(i, p.sy.invert(M.top + ny * IH));
    },
    onEnd: () => p.announce(`${latest.current.length} of ${cols.length} points drawn.`),
  });

  const x = cols[col] ?? cols[0] ?? 0;
  const y = byX.get(x);
  return (
    <div
      role="slider"
      tabIndex={p.interactive ? 0 : -1}
      aria-label={`Draw your prediction. Left and right pick a ${p.props.x.label}, up and down set the ${p.props.y.label}.`}
      aria-orientation="vertical"
      aria-valuemin={p.yLo}
      aria-valuemax={p.yHi}
      aria-valuenow={y ?? p.yLo}
      aria-valuetext={`${p.props.x.label} ${x}: ${y === undefined ? "not drawn" : `${p.props.y.label} ${y}`}`}
      aria-readonly={!p.interactive || undefined}
      data-draw-pad
      className={cn("absolute rounded-md", p.interactive && "cursor-crosshair")}
      style={{
        left: `${(M.left / W) * 100}%`,
        top: `${(M.top / H) * 100}%`,
        width: `${(IW / W) * 100}%`,
        height: `${(IH / H) * 100}%`,
      }}
      {...handlers}
      onKeyDown={(e) => {
        if (!p.interactive) return;
        const big = e.shiftKey ? 5 : 1;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const i = clamp(col + (e.key === "ArrowRight" ? 1 : -1), 0, cols.length - 1);
          setCol(i);
          const cx = cols[i] as number;
          const cy = byX.get(cx);
          if (cy === undefined) {
            // Start a new column where the previous one was, so a line is easy to continue.
            setAt(i, y ?? (p.yLo + p.yHi) / 2, true);
          } else p.announce(`${p.props.x.label} ${cx}: ${p.props.y.label} ${cy}.`);
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const base = y ?? (p.yLo + p.yHi) / 2;
          setAt(col, base + (e.key === "ArrowUp" ? 1 : -1) * yStep * big, true);
        }
      }}
    >
      {p.interactive ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-w-ink-2/40"
          style={{ left: `${(col / Math.max(1, cols.length - 1)) * 100}%` }}
        />
      ) : null}
    </div>
  );
}

function DrawnLayer({
  props,
  drawn,
  sx,
  sy,
  params,
  showGap,
  target,
}: {
  props: PlotProps;
  drawn: [number, number][];
  sx: Scale;
  sy: Scale;
  params: Record<string, number>;
  showGap: boolean;
  target?: string;
}) {
  const d = drawn.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(2)} ${sy(y).toFixed(2)}`).join(" ");
  const truth = target ? drawn.map(([x]) => [x, seriesY(props, target, x, params)] as const) : [];
  const gap =
    showGap && truth.every(([, y]) => y !== undefined) && drawn.length > 1
      ? `${drawn.map(([x, y], i) => `${i ? "L" : "M"}${sx(x)} ${sy(y)}`).join(" ")} ${[...truth]
          .reverse()
          .map(([x, y]) => `L${sx(x)} ${sy(y as number)}`)
          .join(" ")} Z`
      : null;
  return (
    <g data-drawn={drawn.length}>
      {gap ? <path d={gap} fill="var(--sea)" opacity="0.16" data-gap /> : null}
      <path
        d={d}
        fill="none"
        stroke="var(--w-ink)"
        strokeWidth="2.5"
        strokeDasharray="7 5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {drawn.map(([x, y]) => (
        <circle key={x} cx={sx(x)} cy={sy(y)} r="4" fill="var(--surface)" stroke="var(--w-ink)" strokeWidth="2" />
      ))}
    </g>
  );
}
