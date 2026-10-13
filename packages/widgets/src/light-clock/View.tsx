/**
 * light-clock view: two light clocks (one on the train, one on the platform). The clock that moves in the
 * chosen frame runs its pulse along a zigzag of diagonals and ticks γ times slower. Tasks: watch (view), trace
 * the pulse path (pointer or arrow-key pen, or buttons), set the speed (speed, tick).
 */
import { AnswerKey, Button, cn } from "@learncroc/ui";
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useButtonsMode } from "../shared/drag";
import { WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import { clockGeometry, fmt, gamma, MIRROR_GAP, V_MAX } from "./relativity";
import { isFixedSpeed, type LightClockAnswer, type LightClockGoal, type LightClockProps, lightClockSpec } from "./spec";
import { classifyTrace, type TraceShape } from "./trace";
import { Readout, Segmented, svgPoint, useAnswer, useSimClock } from "./view-kit";

type Props = WidgetViewProps<LightClockProps, LightClockGoal, LightClockAnswer>;
type Frame = LightClockProps["frame"];

const W = 800;
const LANE_H = 220;
const UNIT = 34; // px per unit; the mirror gap is 4 units = 136 px
const GAP_PX = MIRROR_GAP * UNIT;
const BOTTOM = 182; // bottom mirror, from the lane top
const MIRROR_W = 64;
/** Simulation units per real second: one crossing at rest takes about 1.1 s. */
const SIM_RATE = MIRROR_GAP / 1.1;
const WRAP_LO = -90;
const WRAP_SPAN = W + 180;

const TRACE_CHOICES: { value: TraceShape; label: string }[] = [
  { value: "straight", label: "Straight up and down" },
  { value: "diagonal", label: "A zigzag of slanted diagonals" },
  { value: "curve", label: "A curve that bends" },
];

function wrap(x: number): number {
  return ((((x - WRAP_LO) % WRAP_SPAN) + WRAP_SPAN) % WRAP_SPAN) + WRAP_LO;
}

/** Height of a pulse (0 bottom mirror … 1 top mirror) after `time`, for a clock whose crossing takes `tick`. */
function pulseHeight(time: number, tick: number): number {
  const phase = (((time / tick) % 2) + 2) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

export default function LightClockView(p: Props) {
  const props = useMemo(() => withReveal(p.props, p.revealProps), [p.props, p.revealProps]);
  const readOnly = p.mode === "review";
  const [answer, setAnswer] = useAnswer(p.value, () => lightClockSpec.initialAnswer(props), p.onChange);
  const [frame, setFrame] = useState<Frame>(props.frame);
  useEffect(() => setFrame(props.frame), [props.frame]);

  const fixed = isFixedSpeed(props);
  const speedTask = props.task === "speed" || props.task === "tick";
  const [localV, setLocalV] = useState(props.v);
  const shownV = readOnly && p.solution?.v !== undefined && answer.v === undefined ? p.solution.v : undefined;
  const v = clampV(speedTask ? (shownV ?? answer.v ?? props.v) : fixed ? props.v : localV, props.vRange);
  const geo = clockGeometry(v);

  const tracing = props.task === "trace" && p.mode === "answer";
  const [playing, setPlaying] = useState(!p.reducedMotion && !tracing);
  const [time, setTime] = useSimClock(playing && !tracing, SIM_RATE);
  // A still frame should still show the zigzag: start reduced-motion views two moving ticks in.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (p.reducedMotion) setTime(2 * geo.tickTime);
  }, [p.reducedMotion, geo.tickTime, setTime]);

  // Easter egg: pushing past the top of a near-c slider.
  const [egg, setEgg] = useState(false);
  useEffect(() => {
    if (!egg) return;
    p.announce("Mira says: Nice try.");
    const id = setTimeout(() => setEgg(false), 3200);
    return () => clearTimeout(id);
  }, [egg, p.announce]);
  const eggAllowed = props.vRange[1] >= 0.99 - 1e-9;

  const setSpeed = (next: number) => {
    const nv = clampV(Math.round(next * 100) / 100, props.vRange);
    if (speedTask) setAnswer({ ...answer, v: nv });
    else setLocalV(nv);
    p.announce(
      nv > 0
        ? `Speed ${fmt(nv)}c. The moving clock ticks ${fmt(gamma(nv))} times slower.`
        : "At rest. Both clocks agree.",
    );
  };

  const movingLane: "train" | "platform" = frame === "platform" ? "train" : "platform";
  const ticksMoving = Math.floor((time + 1e-9) / geo.tickTime);
  const ticksRest = Math.floor((time + 1e-9) / MIRROR_GAP);
  const titleId = useId();
  const descId = useId();

  const onSpeedKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!eggAllowed || readOnly) return;
    // The slider moves in 0.01 steps, so its reachable top is the last step at or below the range's max.
    const top = clampV(Math.floor(props.vRange[1] * 100 + 1e-6) / 100, props.vRange);
    const atTop = v >= top - 1e-9;
    if (atTop && ["ArrowRight", "ArrowUp", "End", "PageUp"].includes(e.key)) setEgg(true);
  };
  const onSpeedPointerMove = (e: PointerEvent<HTMLInputElement>) => {
    if (!eggAllowed || readOnly || e.buttons === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width > 0 && e.clientX > rect.right + 6) setEgg(true);
  };

  return (
    <WidgetShell id="light-clock" mode={p.mode} label={lightClockSpec.title} buttonsToggle={tracing}>
      {tracing ? (
        <TracePad
          props={props}
          frame={frame}
          answer={answer}
          onTrace={(traced) => setAnswer({ ...answer, traced })}
          announce={p.announce}
        />
      ) : (
        <svg
          viewBox={`0 0 ${W} ${LANE_H * 2}`}
          className="w-full rounded-stage bg-surface-2"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
        >
          <title id={titleId}>{lightClockSpec.title}</title>
          <desc id={descId}>{lightClockSpec.textAlternative({ ...props, v, frame })}</desc>
          {(["train", "platform"] as const).map((lane, i) => (
            <Lane
              key={lane}
              lane={lane}
              top={i * LANE_H}
              moving={lane === movingLane}
              frame={frame}
              v={v}
              time={time}
              anchorTime={p.reducedMotion ? 2 * geo.tickTime : 0}
              ticks={lane === movingLane ? ticksMoving : ticksRest}
              showTicks={props.showTicks ?? false}
              showTriangle={(props.showTriangle ?? false) && lane === movingLane && v > 0}
              highlight={props.highlight === undefined ? undefined : props.highlight === lane}
              traced={readOnly && lane === movingLane ? answer.traced : undefined}
            />
          ))}
          {egg ? <EggBubble /> : null}
        </svg>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {props.allowFrameSwitch ? (
          <Segmented<Frame>
            label="Point of view"
            value={frame}
            onChange={(f) => {
              setFrame(f);
              p.announce(f === "platform" ? "Seen from the platform." : "Seen from the train.");
            }}
            options={[
              { value: "platform", label: "From the platform" },
              { value: "train", label: "From the train" },
            ]}
          />
        ) : null}
        {!tracing ? (
          <>
            <Button size="sm" onClick={() => setPlaying((x) => !x)} aria-pressed={playing}>
              {playing ? "Pause" : "Play"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPlaying(false);
                setTime((t) => t + MIRROR_GAP);
              }}
            >
              Step one tick
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTime(0)}>
              Reset counters
            </Button>
          </>
        ) : null}
      </div>

      {!fixed ? (
        <label className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between text-small text-ink-2">
            <span>Speed</span>
            <span className="tabular text-ink">{egg ? "0.999c" : `${fmt(v)}c`}</span>
          </span>
          <input
            type="range"
            min={props.vRange[0]}
            max={props.vRange[1]}
            step={0.01}
            value={v}
            disabled={readOnly}
            aria-valuetext={`${fmt(v)} times light speed`}
            onChange={(e) => setSpeed(Number(e.currentTarget.value))}
            onKeyDown={onSpeedKey}
            onPointerMove={onSpeedPointerMove}
            className="w-full accent-[var(--sea)]"
          />
        </label>
      ) : null}

      {!tracing && (props.showTicks || speedTask) ? (
        <Readout>
          {v > 0
            ? `The moving clock ticks once for every ${fmt(geo.gamma)} ticks of the resting one (γ = ${fmt(geo.gamma)}).`
            : "At rest the two clocks tick together."}
        </Readout>
      ) : null}
      {readOnly && p.solution?.v !== undefined && speedTask ? (
        <Readout>
          Target speed: {fmt(p.solution.v)}c (γ = {fmt(gamma(Math.min(p.solution.v, V_MAX)))}).
        </Readout>
      ) : null}
    </WidgetShell>
  );
}

function clampV(v: number, range: readonly [number, number]): number {
  const lo = Math.max(0, Math.min(range[0], range[1]));
  const hi = Math.min(V_MAX, Math.max(range[0], range[1]));
  return Math.max(lo, Math.min(hi, v));
}

// ─── One lane: a clock on the train or on the platform ──────────────────────────────────────────

function Lane(props: {
  lane: "train" | "platform";
  top: number;
  moving: boolean;
  frame: Frame;
  v: number;
  time: number;
  /** Time at which the moving clock is drawn at its anchor position. */
  anchorTime: number;
  ticks: number;
  showTicks: boolean;
  showTriangle: boolean;
  highlight: boolean | undefined;
  traced: TraceShape | undefined;
}) {
  const { lane, top, moving, frame, v, time } = props;
  const geo = clockGeometry(moving ? v : 0);
  const dir = frame === "platform" ? 1 : -1; // the moving clock goes right on the platform, left from the train
  // The moving clock sits at `anchor` at time `anchorTime` (the opening frame, or the reduced-motion still),
  // clear of the triangle inset on the side it comes from and of the labels.
  const anchor = frame === "platform" ? 560 : 240;
  const posAt = (s: number) => wrap(anchor + dir * v * (s - props.anchorTime) * UNIT);
  const x = moving ? posAt(time) : 400;
  const yB = top + BOTTOM;
  const yT = yB - GAP_PX;
  const h = pulseHeight(time, geo.tickTime);
  const groundShift = frame === "train" ? -v * time * UNIT : 0;

  // Trail: the pulse's path over the last two crossings, broken where the clock wraps around the canvas.
  // biome-ignore lint/correctness/useExhaustiveDependencies: posAt is derived from anchor, dir, v and anchorTime.
  const trail = useMemo(() => {
    if (!moving || v === 0) return [] as string[];
    const span = Math.min(time, 2 * geo.tickTime);
    const n = 72;
    const parts: string[] = [];
    let cur: string[] = [];
    let prevX: number | undefined;
    for (let i = 0; i <= n; i++) {
      const s = time - span + (span * i) / n;
      const px = posAt(s);
      const py = yB - pulseHeight(s, geo.tickTime) * GAP_PX;
      if (prevX !== undefined && Math.abs(px - prevX) > WRAP_SPAN / 2) {
        if (cur.length > 1) parts.push(cur.join(" "));
        cur = [];
      }
      cur.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      prevX = px;
    }
    if (cur.length > 1) parts.push(cur.join(" "));
    return parts;
  }, [moving, v, time, geo.tickTime, anchor, dir, yB, props.anchorTime]);

  const label = lane === "train" ? "Train clock" : "Platform clock";
  return (
    <g data-lane={lane} opacity={props.highlight === false ? 0.55 : 1}>
      {props.highlight ? (
        <rect
          x={6}
          y={top + 6}
          width={W - 12}
          height={LANE_H - 12}
          rx={20}
          fill="none"
          stroke="var(--sea)"
          strokeWidth={2.5}
        />
      ) : null}
      <text x={20} y={top + 30} fontSize={15} fontWeight={650} fill="var(--ink)">
        {label}
      </text>
      <text x={20} y={top + 50} fontSize={14} fill="var(--ink-2)">
        {moving ? `moving at ${fmt(v)}c` : "at rest in this view"}
      </text>
      {props.showTicks ? (
        <text
          x={W - 20}
          y={top + 30}
          textAnchor="end"
          fontSize={15}
          fontWeight={650}
          fill="var(--ink)"
          style={{ fontVariantNumeric: "tabular-nums" }}
          data-ticks={lane}
        >
          {props.ticks} {props.ticks === 1 ? "tick" : "ticks"}
        </text>
      ) : null}

      {/* Ground: rails under the train, a platform edge under the platform clock. Marks scroll when the ground moves. */}
      <line x1={0} x2={W} y1={yB + 22} y2={yB + 22} stroke="var(--line-strong)" strokeWidth={2} />
      {Array.from({ length: 22 }, (_, i) => {
        const gx = ((((i * 40 + groundShift) % 880) + 880) % 880) - 40;
        return (
          <line
            // biome-ignore lint/suspicious/noArrayIndexKey: ground marks are positional and scroll in place.
            key={i}
            x1={gx}
            x2={gx + (lane === "train" ? 14 : 0)}
            y1={yB + 22}
            y2={yB + (lane === "train" ? 30 : 34)}
            stroke="var(--line-strong)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}

      {lane === "train" ? (
        <g>
          <rect
            x={x - 66}
            y={yT - 22}
            width={132}
            height={GAP_PX + 40}
            rx={18}
            fill="var(--iris-soft)"
            stroke="var(--iris)"
            strokeWidth={2}
          />
          <circle cx={x - 38} cy={yB + 22} r={7} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={2} />
          <circle cx={x + 38} cy={yB + 22} r={7} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={2} />
        </g>
      ) : (
        <g>
          <rect x={x - 4} y={yB + 4} width={8} height={18} fill="var(--ink-3)" />
          <rect
            x={x - 50}
            y={yT - 16}
            width={100}
            height={GAP_PX + 28}
            rx={14}
            fill="var(--surface)"
            stroke="var(--line-strong)"
            strokeWidth={2}
          />
        </g>
      )}

      {/* Path of the pulse: a straight bar at rest, the zigzag trail when moving. */}
      {moving && v > 0 ? (
        trail.map((pts) => (
          <polyline
            key={pts}
            points={pts}
            fill="none"
            stroke="var(--sea)"
            strokeOpacity={0.55}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))
      ) : (
        <line x1={x} x2={x} y1={yB} y2={yT} stroke="var(--sea)" strokeOpacity={0.35} strokeWidth={2.5} />
      )}

      <MirrorsScaled x={x} yB={yB} gap={GAP_PX} />
      <circle cx={x} cy={yB - h * GAP_PX} r={7} fill="var(--sea)" />
      <circle cx={x} cy={yB - h * GAP_PX} r={13} fill="var(--sea)" opacity={0.18} />
      {/* The triangle is an inset on its own backing, drawn above the clock so it stays readable as the car passes. */}
      {props.showTriangle ? <Triangle top={top} v={v} dir={dir} /> : null}
      {props.traced ? (
        <text x={W - 20} y={top + 50} textAnchor="end" fontSize={14} fill="var(--ink-2)">
          You traced: {props.traced}
        </text>
      ) : null}
    </g>
  );
}

/** The 3-4-5 style triangle of one crossing: gap, sideways slide, diagonal. Scaled down when it would overflow. */
function Triangle({ top, v, dir }: { top: number; v: number; dir: number }) {
  const g = clockGeometry(v);
  const slidePx = g.slide * UNIT;
  const k = Math.min(1, 420 / Math.max(slidePx, 1));
  const x0 = dir > 0 ? 170 : 630;
  const x1 = x0 + dir * slidePx * k;
  const yB = top + BOTTOM;
  const yT = yB - GAP_PX * k;
  const mid = (a: number, b: number) => (a + b) / 2;
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  return (
    <g data-triangle aria-hidden>
      <rect
        x={lo - (dir > 0 ? 34 : 64)}
        y={yT - 14}
        width={hi - lo + 98}
        height={yB - yT + 42}
        rx={12}
        fill="var(--surface-2)"
        fillOpacity={0.94}
        stroke="var(--line)"
      />
      <line x1={x0} x2={x0} y1={yB} y2={yT} stroke="var(--ink-3)" strokeWidth={2} strokeDasharray="5 5" />
      <line x1={x0} x2={x1} y1={yB} y2={yB} stroke="var(--ink-3)" strokeWidth={2} strokeDasharray="5 5" />
      <line x1={x0} x2={x1} y1={yB} y2={yT} stroke="var(--sea)" strokeWidth={3} strokeLinecap="round" />
      <text x={x0 - dir * 10} y={mid(yB, yT)} textAnchor={dir > 0 ? "end" : "start"} fontSize={15} fill="var(--ink-2)">
        {fmt(MIRROR_GAP)}
      </text>
      <text x={mid(x0, x1)} y={yB + 18} textAnchor="middle" fontSize={15} fill="var(--ink-2)">
        {fmt(g.slide)}
      </text>
      <text
        x={mid(x0, x1) + dir * 12}
        y={mid(yB, yT) - 8}
        textAnchor={dir > 0 ? "start" : "end"}
        fontSize={16}
        fontWeight={700}
        fill="var(--sea-text)"
      >
        {fmt(g.diagonal)}
      </text>
      {k < 1 ? (
        <text x={x0} y={top + 70} textAnchor={dir > 0 ? "start" : "end"} fontSize={14} fill="var(--ink-3)">
          triangle drawn at {fmt(k * 100, 0)}% scale
        </text>
      ) : null}
    </g>
  );
}

function EggBubble() {
  return (
    <g data-easter-egg>
      <rect
        x={W / 2 - 150}
        y={LANE_H - 34}
        width={300}
        height={68}
        rx={16}
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth={1.5}
      />
      <text x={W / 2} y={LANE_H - 6} textAnchor="middle" fontSize={15} fill="var(--ink-2)">
        Mira, not looking up:
      </text>
      <text
        x={W / 2}
        y={LANE_H + 18}
        textAnchor="middle"
        fontSize={19}
        fontWeight={600}
        fill="var(--ink)"
        fontStyle="italic"
      >
        “Nice try.”
      </text>
    </g>
  );
}

// ─── Trace pad: draw the pulse's path for one crossing ──────────────────────────────────────────

const PAD_H = 260;
const PEN_STEP = 0.5;

function TracePad(props: {
  props: LightClockProps;
  frame: Frame;
  answer: LightClockAnswer;
  onTrace: (t: TraceShape) => void;
  announce: (text: string) => void;
}) {
  const { frame } = props;
  const v = props.props.v;
  const g = clockGeometry(v);
  const dir = frame === "platform" ? 1 : -1;
  const k = Math.min(1, 380 / Math.max(g.slide * UNIT, 1));
  const unit = UNIT * k;
  const x0 = W / 2 - (dir * g.slide * unit) / 2;
  const x1 = x0 + dir * g.slide * unit;
  const yB = 206;
  const yT = yB - MIRROR_GAP * unit;
  const svgRef = useRef<SVGSVGElement>(null);
  const [points, setPoints] = useState<[number, number][]>([]); // clock units, x on screen direction, y up
  const [drawing, setDrawing] = useState(false);
  const [buttons] = useButtonsMode();
  const hintId = useId();
  const titleId = useId();
  const arrowId = `${useId().replace(/:/g, "")}-arrow`;
  const movingName = frame === "platform" ? "train's" : "platform's";

  const toUnits = (sx: number, sy: number): [number, number] => [(sx - x0) / unit, (yB - sy) / unit];
  const toScreen = ([ux, uy]: readonly [number, number]): [number, number] => [x0 + ux * unit, yB - uy * unit];

  const finish = (pts: [number, number][]) => {
    const shape = classifyTrace(pts, MIRROR_GAP);
    if (!shape) {
      props.announce("That path is too short to read. Draw from the bottom mirror up to the top one.");
      return;
    }
    props.onTrace(shape);
    props.announce(
      `You drew ${shape === "straight" ? "a straight path" : shape === "diagonal" ? "a slanted diagonal" : "a curve"}.`,
    );
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture?.(e.pointerId);
    setDrawing(true);
    setPoints([toUnits(...svgPoint(svg, e.clientX, e.clientY))]);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!drawing || !svg) return;
    const pt = toUnits(...svgPoint(svg, e.clientX, e.clientY));
    setPoints((ps) => [...ps, pt]);
  };
  const onPointerUp = () => {
    if (!drawing) return;
    setDrawing(false);
    // A tap (no stroke) just focuses the pad; the keyboard pen then starts at the pulse.
    if (points.length < 3) {
      setPoints([]);
      return;
    }
    finish(points);
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? PEN_STEP / 5 : PEN_STEP;
    const last = points[points.length - 1] ?? [0, 0];
    let next: [number, number] | undefined;
    if (e.key === "ArrowUp") next = [last[0], Math.min(MIRROR_GAP, last[1] + step)];
    else if (e.key === "ArrowDown") next = [last[0], Math.max(0, last[1] - step)];
    else if (e.key === "ArrowRight") next = [last[0] + step, last[1]];
    else if (e.key === "ArrowLeft") next = [last[0] - step, last[1]];
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      finish(points.length ? points : [[0, 0]]);
      return;
    } else if (e.key === "Backspace") {
      e.preventDefault();
      setPoints((ps) => ps.slice(0, -1));
      return;
    } else if (e.key === "Escape") {
      setPoints([]);
      return;
    }
    if (!next) return;
    e.preventDefault();
    const base = points.length ? points : [[0, 0] as [number, number]];
    setPoints([...base, next]);
    const heightLeft = Math.max(0, MIRROR_GAP - next[1]);
    props.announce(
      heightLeft <= 1e-9
        ? "Pen at the top mirror. Press Enter to finish."
        : `Pen ${fmt(next[1], 1)} up, ${fmt(Math.abs(next[0]), 1)} ${next[0] * dir >= 0 ? "along" : "back"}.`,
    );
  };

  const path = points
    .map((pt) =>
      toScreen(pt)
        .map((n) => n.toFixed(1))
        .join(","),
    )
    .join(" ");
  const pen = points.length ? toScreen(points[points.length - 1] as [number, number]) : toScreen([0, 0]);

  return (
    <div className="flex flex-col gap-2">
      {buttons ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-small text-ink-2">
            Seen from the {frame}, the {movingName} pulse runs…
          </legend>
          {TRACE_CHOICES.map((c, i) => (
            <AnswerKey
              key={c.value}
              n={i + 1}
              state={props.answer.traced === c.value ? "selected" : "rest"}
              onPress={() => {
                props.onTrace(c.value);
                props.announce(`Chosen: ${c.label}.`);
              }}
            >
              {c.label}
            </AnswerKey>
          ))}
        </fieldset>
      ) : (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${PAD_H}`}
            className={cn("w-full touch-none rounded-stage bg-surface-2", drawing && "cursor-crosshair")}
            role="application"
            aria-roledescription="drawing pad"
            aria-labelledby={titleId}
            aria-describedby={hintId}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a drawing pad (role application) driven by arrow keys.
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrawing(false)}
            onKeyDown={onKeyDown}
          >
            <title id={titleId}>Trace the pulse</title>
            <text x={20} y={30} fontSize={15} fontWeight={650} fill="var(--ink)">
              {frame === "platform" ? "Train clock, seen from the platform" : "Platform clock, seen from the train"}
            </text>
            <text x={20} y={50} fontSize={14} fill="var(--ink-2)">
              moving at {fmt(v)}c
            </text>
            <line x1={0} x2={W} y1={yB + 22} y2={yB + 22} stroke="var(--line-strong)" strokeWidth={2} />
            <g opacity={0.9}>
              <MirrorsScaled x={x0} yB={yB} gap={MIRROR_GAP * unit} />
              <text x={x0} y={yB + 46} textAnchor="middle" fontSize={14} fill="var(--ink-2)">
                pulse leaves here
              </text>
            </g>
            {v > 0 ? (
              <g>
                <MirrorsScaled x={x1} yB={yB} gap={MIRROR_GAP * unit} ghost />
                <text x={x1} y={yT - 22} textAnchor="middle" fontSize={14} fill="var(--ink-2)">
                  mirrors, one tick later
                </text>
                <line
                  x1={x0 + dir * 70}
                  x2={x0 + dir * Math.max(120, Math.abs(x1 - x0) + 40)}
                  y1={yB + 41}
                  y2={yB + 41}
                  stroke="var(--ink-3)"
                  strokeWidth={2}
                  markerEnd={`url(#${arrowId})`}
                />
              </g>
            ) : null}
            <defs>
              <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-3)" />
              </marker>
            </defs>
            <circle cx={x0} cy={yB} r={7} fill="var(--sea)" />
            {points.length > 1 ? (
              <polyline
                points={path}
                fill="none"
                stroke="var(--ink)"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                data-trace
              />
            ) : null}
            <circle cx={pen[0]} cy={pen[1]} r={5} fill="none" stroke="var(--ink)" strokeWidth={2} />
          </svg>
          <p id={hintId} className="text-small text-ink-2">
            Draw the pulse's path from the bottom mirror to the top mirror. Keyboard: arrow keys move the pen, Enter
            finishes, Backspace undoes a step.
          </p>
        </>
      )}
      {!buttons && points.length > 0 ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setPoints([])}>
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MirrorsScaled({ x, yB, gap, ghost }: { x: number; yB: number; gap: number; ghost?: boolean }) {
  const common = {
    width: MIRROR_W,
    height: 7,
    rx: 3,
    fill: ghost ? "none" : "var(--ink)",
    stroke: ghost ? "var(--ink-2)" : "none",
    strokeDasharray: ghost ? "4 4" : undefined,
    strokeWidth: ghost ? 2 : 0,
  };
  return (
    <g>
      <rect x={x - MIRROR_W / 2} y={yB} {...common} />
      <rect x={x - MIRROR_W / 2} y={yB - gap - 7} {...common} />
    </g>
  );
}
