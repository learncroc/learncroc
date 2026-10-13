/**
 * spacetime-diagram view: a Minkowski diagram with equal x and t scales (light at 45°). Events and worldline
 * vertices drag with the pointer or the arrow keys; the boost slider tilts the observer's axes and
 * simultaneity lines; readouts show proper time, the interval and event order.
 */
import { AnswerKey } from "@learncroc/ui";
import { type KeyboardEvent, type PointerEvent, useCallback, useId, useMemo, useRef, useState } from "react";
import { fmt, gamma, orderInFrame, properTime, regionOf, separation, timeInFrame } from "../light-clock/relativity";
import { Readout, svgPoint, useAnswer } from "../light-clock/view-kit";
import { niceTicks } from "../shared/math";
import { WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import {
  draggableVertices,
  SAME_TIME,
  type SpacetimeDiagramAnswer,
  type SpacetimeDiagramGoal,
  type SpacetimeDiagramProps,
  spacetimeDiagramSpec,
} from "./spec";

type Props = WidgetViewProps<SpacetimeDiagramProps, SpacetimeDiagramGoal, SpacetimeDiagramAnswer>;
type Point = [number, number];

const W = 800;
const M = { left: 56, right: 28, top: 28, bottom: 52 };
const MAX_H = 520;
const FALLBACK = ["var(--iris)", "var(--sea)", "var(--ember)", "var(--ink-2)", "var(--ink)"];

function wlColor(n: number | undefined): string {
  const i = n && n >= 1 && n <= 5 ? n : 1;
  return `var(--w-${i}, ${FALLBACK[i - 1]})`;
}

type Handle = { kind: "event"; id: string } | { kind: "vertex"; id: string; index: number };
const handleKey = (h: Handle) => (h.kind === "event" ? `e:${h.id}` : `w:${h.id}:${h.index}`);

export default function SpacetimeDiagramView(p: Props) {
  const props = useMemo(() => withReveal(p.props, p.revealProps), [p.props, p.revealProps]);
  const readOnly = p.mode === "review";
  const [answer, setAnswer] = useAnswer(p.value, () => spacetimeDiagramSpec.initialAnswer(props), p.onChange);
  const goal = p.goal;

  // Geometry: equal scale on both axes.
  const [x0, x1] = props.range.x;
  const [t0, t1] = props.range.t;
  const spanX = Math.max(1e-6, x1 - x0);
  const spanT = Math.max(1e-6, t1 - t0);
  const s = Math.min((W - M.left - M.right) / spanX, (MAX_H - M.top - M.bottom) / spanT);
  const plotW = spanX * s;
  const plotH = spanT * s;
  const left = M.left + (W - M.left - M.right - plotW) / 2;
  const H = plotH + M.top + M.bottom;
  const X = useCallback((x: number) => left + (x - x0) * s, [left, x0, s]);
  const Y = useCallback((t: number) => M.top + (t1 - t) * s, [t1, s]);
  const span = Math.max(spanX, spanT);
  const snapStep = span <= 5 ? 0.1 : span <= 14 ? 0.25 : 0.5;
  const snap = (n: number) => Number((Math.round(n / snapStep) * snapStep).toFixed(4));

  // While "who came first?" is the question, readouts that state the order stay hidden (the tilted lines don't).
  const orderIsTheQuestion = goal?.kind === "order" && p.mode === "answer";

  // Current state: authored props overlaid with the learner's edits (or the review solution).
  const shown = readOnly && p.solution ? { ...answer, ...pickDefined(p.solution, answer) } : answer;
  const boost = props.boost ? clampBoost(shown.boost ?? props.boost.value, props.boost) : 0;
  const events = props.events.map((e) => {
    const moved = shown.events?.[e.id];
    return moved ? { ...e, x: moved[0], t: moved[1] } : e;
  });
  const worldlines = props.worldlines.map((w) => ({ ...w, points: shown.worldlines?.[w.id] ?? w.points }));

  // Drag state.
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Handle | null>(null);
  const titleId = useId();
  const descId = useId();
  const helpId = useId();
  const clipId = `${useId().replace(/:/g, "")}-plot`;

  const moveHandle = (h: Handle, pt: Point, announce: boolean) => {
    const x = Math.min(x1, Math.max(x0, snap(pt[0])));
    const t = Math.min(t1, Math.max(t0, snap(pt[1])));
    if (h.kind === "event") {
      const next = { ...answer, events: { ...(answer.events ?? {}), [h.id]: [x, t] as Point } };
      setAnswer(next);
      if (announce) p.announce(describeEvent(h.id, x, t));
    } else {
      const w = worldlines.find((wl) => wl.id === h.id);
      if (!w) return;
      const pts = w.points.map((q, i) => (i === h.index ? ([x, t] as Point) : ([q[0], q[1]] as Point)));
      setAnswer({ ...answer, worldlines: { ...(answer.worldlines ?? {}), [h.id]: pts } });
      if (announce) {
        const tau = properTime(pts);
        p.announce(
          `${w.label}'s turn point at x ${fmt(x)}, t ${fmt(t)}. ${
            tau.fasterThanLight.length
              ? "Part of the path is faster than light."
              : `Clock time ${fmt(tau.tau)} ${props.units.t}.`
          }`,
        );
      }
    }
  };

  const describeEvent = (id: string, x: number, t: number) => {
    const e = props.events.find((ev) => ev.id === id);
    let text = `${e?.label ?? id} at x ${fmt(x)}, t ${fmt(t)}.`;
    if (goal?.kind === "place" && goal.event === id) {
      const o = events.find((ev) => ev.id === goal.relativeTo);
      if (o && (props.readouts ?? []).includes("order")) {
        text += ` ${separation([o.x, o.t], [x, t]) === "spacelike" ? "Order can flip." : "Every observer agrees on the order."}`;
      }
    }
    return text;
  };

  const onPointerDown = (h: Handle) => (e: PointerEvent<SVGElement>) => {
    if (readOnly) return;
    e.preventDefault();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setDrag(h);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag || !svgRef.current) return;
    const [sx, sy] = svgPoint(svgRef.current, e.clientX, e.clientY);
    moveHandle(drag, [x0 + (sx - left) / s, t1 - (sy - M.top) / s], false);
  };
  const onPointerUp = () => {
    if (!drag) return;
    const h = drag;
    setDrag(null);
    if (h.kind === "event") {
      const e = events.find((ev) => ev.id === h.id);
      if (e) p.announce(describeEvent(h.id, e.x, e.t));
    } else {
      const w = worldlines.find((wl) => wl.id === h.id);
      const q = w?.points[h.index];
      if (w && q) moveHandle(h, [q[0], q[1]], true);
    }
  };
  const onHandleKey = (h: Handle, at: Point) => (e: KeyboardEvent<SVGElement>) => {
    if (readOnly) return;
    const k = e.shiftKey ? 5 : 1;
    const d: Record<string, Point> = {
      ArrowLeft: [-k, 0],
      ArrowRight: [k, 0],
      ArrowUp: [0, k],
      ArrowDown: [0, -k],
    };
    const delta = d[e.key];
    if (!delta) return;
    e.preventDefault();
    moveHandle(h, [at[0] + delta[0] * snapStep, at[1] + delta[1] * snapStep], true);
  };

  const setBoost = (b: number) => {
    if (!props.boost) return;
    const v = clampBoost(Math.round(b * 100) / 100, props.boost);
    setAnswer({ ...answer, boost: v });
    const ordered = orderInFrame(events, v);
    const firstTwo = ordered.slice(0, 2);
    let tail = "";
    if (firstTwo.length === 2 && (props.readouts ?? []).includes("order") && !orderIsTheQuestion) {
      const [a, b2] = firstTwo as [{ id: string; t: number }, { id: string; t: number }];
      const label = (id: string) => props.events.find((ev) => ev.id === id)?.label ?? id;
      tail = Math.abs(a.t - b2.t) < 1e-6 ? " Both happen at the same time." : ` ${label(a.id)} happens first.`;
    }
    p.announce(`Observer speed ${fmt(v)}c.${tail}`);
  };

  const gridX = niceTicks(x0, x1, Math.min(10, Math.round(spanX)));
  const gridT = niceTicks(t0, t1, Math.min(12, Math.round(spanT)));
  const lineIn = (a: Point, b: Point) => clipSegment(a, b, [x0, x1], [t0, t1]);

  // Order of the first two events in the current frame, for the readout.
  const [ea, eb] = events;
  const pair = ea && eb ? ([ea, eb] as const) : null;
  const readouts = props.readouts ?? [];
  const askTyped =
    goal?.kind === "proper-time" &&
    p.mode !== "explore" &&
    !(readouts.includes("proper-time") && props.worldlines.find((w) => w.id === goal.worldline)?.editable);

  return (
    <WidgetShell id="spacetime-diagram" mode={p.mode} label={spacetimeDiagramSpec.title}>
      <fieldset aria-describedby={`${descId} ${helpId}`} className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">{spacetimeDiagramSpec.title}</legend>
        <p id={helpId} className="sr-only">
          Movable points: Tab to one, then use the arrow keys (Shift for bigger steps).
        </p>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none select-none rounded-stage bg-surface-2"
          aria-labelledby={titleId}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          <title id={titleId}>{spacetimeDiagramSpec.title}</title>
          <desc id={descId}>{spacetimeDiagramSpec.textAlternative(props)}</desc>
          <defs>
            <clipPath id={clipId}>
              <rect x={left} y={M.top} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          {/* Grid and axes. */}
          <g aria-hidden>
            {gridX.map((gx) => (
              <g key={`gx${gx}`}>
                <line x1={X(gx)} x2={X(gx)} y1={M.top} y2={M.top + plotH} stroke="var(--line)" strokeWidth={1} />
                <text x={X(gx)} y={M.top + plotH + 20} textAnchor="middle" fontSize={14} fill="var(--ink-3)">
                  {fmt(gx)}
                </text>
              </g>
            ))}
            {gridT.map((gt) => (
              <g key={`gt${gt}`}>
                <line x1={left} x2={left + plotW} y1={Y(gt)} y2={Y(gt)} stroke="var(--line)" strokeWidth={1} />
                <text x={left - 10} y={Y(gt) + 5} textAnchor="end" fontSize={14} fill="var(--ink-3)">
                  {fmt(gt)}
                </text>
              </g>
            ))}
            <text x={left + plotW} y={M.top + plotH + 42} textAnchor="end" fontSize={14} fill="var(--ink-2)">
              x ({props.units.x})
            </text>
            <text x={left - 10} y={M.top - 10} textAnchor="end" fontSize={14} fill="var(--ink-2)">
              t ({props.units.t})
            </text>
          </g>

          <g clipPath={`url(#${clipId})`}>
            {x0 <= 0 && x1 >= 0 ? (
              <line x1={X(0)} x2={X(0)} y1={M.top} y2={M.top + plotH} stroke="var(--ink-3)" strokeWidth={1.5} />
            ) : null}
            {t0 <= 0 && t1 >= 0 ? (
              <line x1={left} x2={left + plotW} y1={Y(0)} y2={Y(0)} stroke="var(--ink-3)" strokeWidth={1.5} />
            ) : null}
            {/* Faint 45° light lines through the origin. */}
            {[1, -1].map((dir) => {
              const seg = lineIn([-span * 4 * dir, -span * 4], [span * 4 * dir, span * 4]);
              return seg ? (
                <line
                  key={`light${dir}`}
                  x1={X(seg[0][0])}
                  y1={Y(seg[0][1])}
                  x2={X(seg[1][0])}
                  y2={Y(seg[1][1])}
                  stroke="var(--sea)"
                  strokeOpacity={0.3}
                  strokeWidth={1.5}
                  strokeDasharray="6 6"
                />
              ) : null;
            })}

            {/* Light cones. */}
            {(props.lightCones ?? []).map((id) => {
              const e = events.find((ev) => ev.id === id);
              if (!e) return null;
              const far = span * 3;
              const fut = `${X(e.x)},${Y(e.t)} ${X(e.x - far)},${Y(e.t + far)} ${X(e.x + far)},${Y(e.t + far)}`;
              const past = `${X(e.x)},${Y(e.t)} ${X(e.x - far)},${Y(e.t - far)} ${X(e.x + far)},${Y(e.t - far)}`;
              return (
                <g key={`cone-${id}`} data-cone={id}>
                  <polygon
                    points={fut}
                    fill="var(--sea)"
                    fillOpacity={0.12}
                    stroke="var(--sea)"
                    strokeOpacity={0.6}
                    strokeWidth={1.5}
                  />
                  <polygon
                    points={past}
                    fill="var(--sea)"
                    fillOpacity={0.05}
                    stroke="var(--sea)"
                    strokeOpacity={0.35}
                    strokeWidth={1.5}
                  />
                  <text
                    x={X(e.x)}
                    y={Math.max(M.top + 18, Y(Math.min(t1, e.t + (t1 - e.t) * 0.85)))}
                    textAnchor="middle"
                    fontSize={14}
                    fill="var(--sea-text)"
                  >
                    future
                  </text>
                </g>
              );
            })}

            {/* Boosted axes and simultaneity lines. */}
            {props.boost ? <BoostAxes v={boost} X={X} Y={Y} lineIn={lineIn} span={span} /> : null}
            {props.showSimultaneity
              ? events.map((e) => {
                  const c = e.t - boost * e.x; // t − βx = const
                  const seg = lineIn([-span * 4, c - boost * span * 4], [span * 4, c + boost * span * 4]);
                  if (!seg) return null;
                  const tp = timeInFrame([e.x, e.t], boost);
                  return (
                    <g key={`sim-${e.id}`} data-simultaneity={e.id}>
                      <line
                        x1={X(seg[0][0])}
                        y1={Y(seg[0][1])}
                        x2={X(seg[1][0])}
                        y2={Y(seg[1][1])}
                        stroke="var(--iris)"
                        strokeOpacity={0.7}
                        strokeWidth={1.5}
                        strokeDasharray="3 5"
                      />
                      {orderIsTheQuestion ? null : (
                        <text
                          x={X(seg[0][0]) + 6}
                          y={Y(seg[0][1]) - 6}
                          textAnchor="start"
                          fontSize={14}
                          fill="var(--iris)"
                        >
                          t′ = {fmt(tp)}
                        </text>
                      )}
                    </g>
                  );
                })
              : null}

            {/* Worldlines. */}
            {worldlines.map((w) => (
              <Worldline key={w.id} w={w} X={X} Y={Y} />
            ))}
          </g>

          {/* Worldline labels and vertex handles (outside the clip so focus rings show). */}
          {worldlines.map((w) => {
            // Label at the middle of the first leg, so lines that share an end don't stack their labels.
            const a = w.points[0];
            const b = w.points[1];
            const mid = a && b ? ([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Point) : a;
            const editable = w.editable && !readOnly;
            return (
              <g key={`h-${w.id}`}>
                {mid ? (
                  <text x={X(mid[0]) + 10} y={Y(mid[1]) + 5} fontSize={14} fontWeight={650} fill={wlColor(w.color)}>
                    {w.label}
                  </text>
                ) : null}
                {editable
                  ? draggableVertices(w.points).map((i) => {
                      const q = w.points[i] as Point;
                      const h: Handle = { kind: "vertex", id: w.id, index: i };
                      return (
                        <DragHandle
                          key={handleKey(h)}
                          cx={X(q[0])}
                          cy={Y(q[1])}
                          color={wlColor(w.color)}
                          active={drag !== null && handleKey(drag) === handleKey(h)}
                          label={`${w.label}'s worldline point at x ${fmt(q[0])}, t ${fmt(q[1])}`}
                          onPointerDown={onPointerDown(h)}
                          onKeyDown={onHandleKey(h, q)}
                        />
                      );
                    })
                  : null}
              </g>
            );
          })}

          {/* Events. */}
          {events.map((e) => {
            const h: Handle = { kind: "event", id: e.id };
            const movable = e.draggable && !readOnly;
            const labelLeft = X(e.x) > left + plotW - 150;
            return (
              <g key={`ev-${e.id}`} data-event={e.id}>
                {movable ? (
                  <DragHandle
                    cx={X(e.x)}
                    cy={Y(e.t)}
                    color="var(--ink)"
                    active={drag !== null && handleKey(drag) === handleKey(h)}
                    label={`${e.label} at x ${fmt(e.x)}, t ${fmt(e.t)}`}
                    onPointerDown={onPointerDown(h)}
                    onKeyDown={onHandleKey(h, [e.x, e.t])}
                  />
                ) : (
                  <circle cx={X(e.x)} cy={Y(e.t)} r={6.5} fill="var(--ink)" />
                )}
                <text
                  x={X(e.x) + (labelLeft ? -12 : 12)}
                  y={Y(e.t) - 10}
                  textAnchor={labelLeft ? "end" : "start"}
                  fontSize={14}
                  fontWeight={600}
                  fill="var(--ink)"
                  aria-hidden
                >
                  {e.label}
                </text>
              </g>
            );
          })}
        </svg>
      </fieldset>

      {props.boost ? (
        <label className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between text-small text-ink-2">
            <span>Observer speed (tilts the axes)</span>
            <span className="tabular text-ink">{fmt(boost)}c</span>
          </span>
          <input
            type="range"
            min={props.boost.min}
            max={props.boost.max}
            step={0.01}
            value={boost}
            disabled={readOnly}
            aria-valuetext={`${fmt(boost)} times light speed`}
            onChange={(e) => setBoost(Number(e.currentTarget.value))}
            className="w-full accent-[var(--iris)]"
          />
        </label>
      ) : null}

      {readouts.includes("proper-time")
        ? worldlines.map((w) => {
            // Don't print the number the learner is asked to type.
            if (askTyped && goal?.kind === "proper-time" && w.id === goal.worldline) return null;
            const r = properTime(w.points);
            return (
              <Readout key={`pt-${w.id}`}>
                <span data-proper-time={w.id}>
                  {w.label}'s clock:{" "}
                  {r.fasterThanLight.length || r.backwards.length
                    ? "no reading (part of this path is faster than light)"
                    : `${fmt(r.tau)} ${props.units.t}`}
                </span>
              </Readout>
            );
          })
        : null}
      {readouts.includes("interval") && pair ? <IntervalReadout a={pair[0]} b={pair[1]} units={props.units} /> : null}
      {readouts.includes("order") && pair ? (
        <OrderReadout a={pair[0]} b={pair[1]} v={boost} verdict={!orderIsTheQuestion} />
      ) : null}

      {goal?.kind === "order" && p.mode !== "explore" ? (
        // biome-ignore lint/a11y/useSemanticElements: a labelled group of answer keys.
        <div role="group" aria-label="Which happens first?" className="grid gap-2 @md:grid-cols-3">
          {[
            ...props.events.map((e) => ({ value: e.id, label: e.label })),
            { value: SAME_TIME, label: "At the same time" },
          ].map((o, i) => (
            <AnswerKey
              key={o.value}
              n={i + 1}
              disabled={readOnly}
              state={answer.first === o.value ? (readOnly ? "down" : "selected") : readOnly ? "dimmed" : "rest"}
              onPress={() => {
                setAnswer({ ...answer, first: o.value });
                p.announce(`Picked: ${o.label}.`);
              }}
            >
              {o.label}
              {readOnly && p.solution?.first === o.value ? (
                <span className="ml-2 text-small text-sea-text">(answer)</span>
              ) : null}
            </AnswerKey>
          ))}
        </div>
      ) : null}

      {goal?.kind === "proper-time" && askTyped ? (
        <label className="flex flex-wrap items-center gap-2 text-body">
          <span>Clock time along {props.worldlines.find((w) => w.id === goal.worldline)?.label ?? goal.worldline}</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            disabled={readOnly}
            value={answer.properTime ?? ""}
            onChange={(e) => {
              const raw = e.currentTarget.value;
              const n = Number(raw);
              const { properTime: _drop, ...rest } = answer;
              setAnswer(raw === "" || !Number.isFinite(n) ? rest : { ...answer, properTime: n });
            }}
            className="h-10 w-28 rounded-sm border border-line-strong bg-surface px-3 tabular"
          />
          <span className="text-ink-2">{props.units.t}</span>
          {readOnly && p.solution?.properTime !== undefined ? (
            <span className="text-small text-ink-2">
              Answer: {fmt(p.solution.properTime)} {props.units.t}
            </span>
          ) : null}
        </label>
      ) : null}
    </WidgetShell>
  );
}

function pickDefined(sol: SpacetimeDiagramAnswer, mine: SpacetimeDiagramAnswer): SpacetimeDiagramAnswer {
  // In review, show the solution's edits where the learner's answer has none.
  const out: SpacetimeDiagramAnswer = {};
  if (sol.events && !mine.events) out.events = sol.events;
  if (sol.worldlines && !mine.worldlines) out.worldlines = sol.worldlines;
  return out;
}

function clampBoost(v: number, b: { min: number; max: number }): number {
  return Math.max(Math.max(b.min, -0.99), Math.min(Math.min(b.max, 0.99), v));
}

/** Clip the segment a–b to the plot rectangle (Liang–Barsky); null when it misses. */
function clipSegment(
  a: Point,
  b: Point,
  xr: readonly [number, number],
  tr: readonly [number, number],
): [Point, Point] | null {
  let u0 = 0;
  let u1 = 1;
  const dx = b[0] - a[0];
  const dt = b[1] - a[1];
  const checks: [number, number][] = [
    [-dx, a[0] - xr[0]],
    [dx, xr[1] - a[0]],
    [-dt, a[1] - tr[0]],
    [dt, tr[1] - a[1]],
  ];
  for (const [pp, q] of checks) {
    if (pp === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / pp;
    if (pp < 0) u0 = Math.max(u0, r);
    else u1 = Math.min(u1, r);
    if (u0 > u1) return null;
  }
  return [
    [a[0] + u0 * dx, a[1] + u0 * dt],
    [a[0] + u1 * dx, a[1] + u1 * dt],
  ];
}

function BoostAxes(props: {
  v: number;
  X: (x: number) => number;
  Y: (t: number) => number;
  lineIn: (a: Point, b: Point) => [Point, Point] | null;
  span: number;
}) {
  const { v, X, Y, lineIn, span } = props;
  const g = gamma(v);
  const far = span * 4;
  const tAxis = lineIn([-v * far, -far], [v * far, far]); // x = v t
  const xAxis = lineIn([-far, -v * far], [far, v * far]); // t = v x
  const ticks: Point[] = [];
  for (let k = -Math.ceil(span); k <= Math.ceil(span); k++) {
    if (k === 0) continue;
    ticks.push([g * v * k, g * k]); // t′ = k on the t′ axis
    ticks.push([g * k, g * v * k]); // x′ = k on the x′ axis
  }
  return (
    <g data-boost-axes aria-hidden>
      {tAxis ? (
        <g>
          <line
            x1={X(tAxis[0][0])}
            y1={Y(tAxis[0][1])}
            x2={X(tAxis[1][0])}
            y2={Y(tAxis[1][1])}
            stroke="var(--iris)"
            strokeWidth={2}
          />
          <text x={X(tAxis[1][0]) + 8} y={Y(tAxis[1][1]) + 16} fontSize={15} fontWeight={700} fill="var(--iris)">
            t′
          </text>
        </g>
      ) : null}
      {xAxis ? (
        <g>
          <line
            x1={X(xAxis[0][0])}
            y1={Y(xAxis[0][1])}
            x2={X(xAxis[1][0])}
            y2={Y(xAxis[1][1])}
            stroke="var(--iris)"
            strokeWidth={2}
          />
          <text x={X(xAxis[1][0]) - 18} y={Y(xAxis[1][1]) - 8} fontSize={15} fontWeight={700} fill="var(--iris)">
            x′
          </text>
        </g>
      ) : null}
      {ticks.map(([x, t]) => (
        <circle key={`${x.toFixed(4)},${t.toFixed(4)}`} cx={X(x)} cy={Y(t)} r={3} fill="var(--iris)" />
      ))}
    </g>
  );
}

function Worldline({
  w,
  X,
  Y,
}: {
  w: { id: string; label: string; points: Point[] | [number, number][]; color?: number };
  X: (x: number) => number;
  Y: (t: number) => number;
}) {
  const color = wlColor(w.color);
  const segs = [];
  for (let i = 1; i < w.points.length; i++) {
    const a = w.points[i - 1] as Point;
    const b = w.points[i] as Point;
    const ftl = separation(a, b) === "spacelike" || b[1] < a[1];
    segs.push(
      <line
        key={i}
        x1={X(a[0])}
        y1={Y(a[1])}
        x2={X(b[0])}
        y2={Y(b[1])}
        stroke={ftl ? "var(--ember-text)" : color}
        strokeWidth={ftl ? 2.5 : 4}
        strokeDasharray={ftl ? "6 6" : undefined}
        strokeLinecap="round"
        data-ftl={ftl || undefined}
      />,
    );
  }
  return <g data-worldline={w.id}>{segs}</g>;
}

function DragHandle(props: {
  cx: number;
  cy: number;
  color: string;
  active: boolean;
  label: string;
  onPointerDown: (e: PointerEvent<SVGElement>) => void;
  onKeyDown: (e: KeyboardEvent<SVGElement>) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG drag handle; <button> can't live inside SVG.
    <g
      role="button"
      tabIndex={0}
      aria-label={props.label}
      aria-roledescription="movable point"
      onPointerDown={props.onPointerDown}
      onKeyDown={props.onKeyDown}
      className="cursor-grab outline-none focus-visible:[&>circle:first-child]:stroke-[var(--focus)]"
      data-handle
    >
      <circle
        cx={props.cx}
        cy={props.cy}
        r={16}
        fill="var(--surface)"
        fillOpacity={0.01}
        stroke="var(--line-strong)"
        strokeWidth={props.active ? 3 : 2}
        strokeDasharray="3 3"
      />
      <circle cx={props.cx} cy={props.cy} r={8} fill={props.color} stroke="var(--surface)" strokeWidth={2} />
    </g>
  );
}

function IntervalReadout({
  a,
  b,
  units,
}: {
  a: { label: string; x: number; t: number };
  b: { label: string; x: number; t: number };
  units: { x: string; t: string };
}) {
  const dx = b.x - a.x;
  const dt = b.t - a.t;
  const s2 = dt * dt - dx * dx;
  const kind = separation([a.x, a.t], [b.x, b.t]);
  return (
    <Readout>
      Between {a.label} and {b.label}: Δt² − Δx² = {fmt(dt * dt)} − {fmt(dx * dx)} = {fmt(s2)} ({kind}
      {kind === "timelike" ? `: a clock could ride from one to the other, ${fmt(Math.sqrt(s2))} ${units.t}` : ""}).
    </Readout>
  );
}

function OrderReadout({
  a,
  b,
  v,
  verdict,
}: {
  a: { id: string; label: string; x: number; t: number };
  b: { id: string; label: string; x: number; t: number };
  v: number;
  /** Say which comes first (hidden while that is the question). */
  verdict: boolean;
}) {
  const ta = timeInFrame([a.x, a.t], v);
  const tb = timeInFrame([b.x, b.t], v);
  const kind = separation([a.x, a.t], [b.x, b.t]);
  const region = regionOf([b.x, b.t], [a.x, a.t]);
  const order = Math.abs(ta - tb) < 1e-6 ? "at the same moment" : ta < tb ? `${a.label} first` : `${b.label} first`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        data-order-badge={kind === "spacelike" ? "can-flip" : "agreed"}
        className={
          kind === "spacelike"
            ? "rounded-xs border border-dashed border-iris px-2 py-0.5 text-small text-ink"
            : "rounded-xs bg-sea-soft px-2 py-0.5 text-small text-sea-text"
        }
      >
        {kind === "spacelike" ? "Order can flip" : "Every observer agrees on the order"}
      </span>
      {verdict ? (
        <Readout>
          {v !== 0 ? `For the observer at ${fmt(v)}c: ` : "In this frame: "}
          {order}
          {kind !== "spacelike" && region === "future" ? ` (${b.label} is inside ${a.label}'s future light cone)` : ""}.
        </Readout>
      ) : null}
    </div>
  );
}
