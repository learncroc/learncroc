/**
 * train-scene view: Einstein's train. The learner picks first, then plays the scene (or scrubs time, in slow
 * motion if they like), switches frame, and can subtract light-travel time on the observer's stopwatch.
 */
import { AnswerKey, Button, cn } from "@learncroc/ui";
import { useEffect, useId, useMemo, useState } from "react";
import { fmt } from "../light-clock/relativity";
import { Readout, Segmented, useAnswer, useSimClock } from "../light-clock/view-kit";
import { WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import { pulseX, type SceneModel, sceneModel, seenAt } from "./scene";
import {
  SCENARIO_PICKS,
  type TrainSceneAnswer,
  type TrainSceneGoal,
  type TrainSceneProps,
  trainSceneSpec,
} from "./spec";

type Props = WidgetViewProps<TrainSceneProps, TrainSceneGoal, TrainSceneAnswer>;
type Frame = TrainSceneProps["frame"];

const W = 800;
const H = 300;
const CAR_TOP = 104;
const CAR_BOTTOM = 196;
const PULSE_Y = 150;
const PLATFORM_Y = 222;
/** Real seconds for a whole scene at normal speed. */
const SCENE_SECONDS = 3.2;
const SLOW_FACTOR = 4;

export default function TrainSceneView(p: Props) {
  const props = useMemo(() => withReveal(p.props, p.revealProps), [p.props, p.revealProps]);
  const readOnly = p.mode === "review";
  const [answer, setAnswer] = useAnswer(p.value, () => trainSceneSpec.initialAnswer(props), p.onChange);
  const [picked, setPicked] = useState(p.value !== undefined);
  const [frame, setFrame] = useState<Frame>(props.frame);
  useEffect(() => setFrame(props.frame), [props.frame]);
  const [slow, setSlow] = useState(props.slowMo ?? false);
  const [corrected, setCorrected] = useState(false);

  const v = Math.max(0, Math.min(0.99, props.v));
  const model = useMemo(() => sceneModel(props.scenario, v, frame), [props.scenario, v, frame]);
  const locked = p.mode === "answer" && !picked;

  const rate = (model.tEnd - model.tStart) / SCENE_SECONDS / (slow ? SLOW_FACTOR : 1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useSimClock(playing, rate);
  // Start each scene (and each frame) at its first moment.
  useEffect(() => {
    setTime(model.tStart);
    setPlaying(false);
  }, [model, setTime]);
  // Stop at the end.
  useEffect(() => {
    if (playing && time >= model.tEnd) {
      setPlaying(false);
      setTime(model.tEnd);
      p.announce(summary(model));
    }
  }, [playing, time, model, setTime, p.announce]);
  // Review acts out the truth once.
  useEffect(() => {
    if (p.mode !== "review") return;
    if (p.reducedMotion) setTime(model.tEnd);
    else {
      setTime(model.tStart);
      setPlaying(true);
    }
  }, [p.mode, p.reducedMotion, model, setTime]);

  const t = Math.min(Math.max(time, model.tStart), model.tEnd);

  const play = () => {
    if (p.reducedMotion) {
      setTime(model.tEnd);
      p.announce(summary(model));
      return;
    }
    if (t >= model.tEnd - 1e-9) setTime(model.tStart);
    setPlaying(true);
  };

  const pick = (value: TrainSceneAnswer["pick"], label: string) => {
    if (readOnly) return;
    setAnswer({ pick: value });
    const first = !picked;
    setPicked(true);
    p.announce(`Picked: ${label}.${first && p.mode === "answer" ? " Now play the scene to watch it happen." : ""}`);
  };

  const titleId = useId();
  const descId = useId();
  const picks = SCENARIO_PICKS[props.scenario];
  const solution = p.solution?.pick;

  return (
    <WidgetShell id="train-scene" mode={p.mode} label={trainSceneSpec.title}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-stage bg-surface-2"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{trainSceneSpec.title}</title>
        <desc id={descId}>{trainSceneSpec.textAlternative({ ...props, frame })}</desc>
        <Scene
          model={model}
          t={t}
          showReadouts={!locked && props.scenario === "headlight"}
          showObservers={props.showDelayCorrection ?? false}
        />
      </svg>

      <div className="flex flex-wrap items-center gap-3">
        {props.allowFrameSwitch ? (
          <Segmented<Frame>
            label="Point of view"
            value={frame}
            onChange={(f) => {
              setFrame(f);
              setCorrected(false);
              p.announce(f === "platform" ? "Seen from the platform." : "Seen from inside the train.");
            }}
            options={[
              { value: "train", label: "From the train" },
              { value: "platform", label: "From the platform" },
            ]}
          />
        ) : null}
        <Button size="sm" variant="primary" onClick={play} disabled={locked}>
          {p.reducedMotion ? "Show what happens" : t >= model.tEnd - 1e-9 ? "Replay" : playing ? "Playing…" : "Play"}
        </Button>
        {playing ? (
          <Button size="sm" variant="ghost" onClick={() => setPlaying(false)}>
            Pause
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" aria-pressed={slow} onClick={() => setSlow((s) => !s)} disabled={locked}>
          Slow motion
        </Button>
      </div>

      <label className={cn("flex flex-col gap-1", locked && "opacity-50")}>
        <span className="flex items-baseline justify-between text-small text-ink-2">
          <span>Time ({frame === "platform" ? "platform clocks" : "train clocks"})</span>
          <span className="tabular text-ink">t = {fmt(t)}</span>
        </span>
        <input
          type="range"
          min={model.tStart}
          max={model.tEnd}
          step={(model.tEnd - model.tStart) / 120}
          value={t}
          disabled={locked}
          aria-valuetext={`time ${fmt(t)}`}
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.currentTarget.value));
          }}
          className="w-full accent-[var(--sea)]"
        />
      </label>
      {locked ? <Readout>Pick your answer first, then play the scene to see what happens.</Readout> : null}

      {props.showDelayCorrection && model.timed.length > 0 && !locked ? (
        <Stopwatch
          model={model}
          t={t}
          corrected={corrected}
          onCorrect={() => setCorrected(true)}
          announce={p.announce}
        />
      ) : null}

      {p.mode !== "explore" ? (
        // biome-ignore lint/a11y/useSemanticElements: a labelled group of answer keys.
        <div role="group" aria-label="Your answer" className="grid gap-2 @md:grid-cols-3">
          {picks.map((o, i) => (
            <AnswerKey
              key={o.value}
              n={i + 1}
              disabled={readOnly}
              state={
                readOnly
                  ? o.value === answer.pick && picked
                    ? "down"
                    : "dimmed"
                  : picked && answer.pick === o.value
                    ? "selected"
                    : "rest"
              }
              onPress={() => pick(o.value, o.label)}
            >
              {o.label}
              {readOnly && solution === o.value ? (
                <span className="ml-2 text-small text-sea-text">(answer)</span>
              ) : null}
            </AnswerKey>
          ))}
        </div>
      ) : null}
    </WidgetShell>
  );
}

function summary(m: SceneModel): string {
  if (m.scenario === "headlight") return "The pulse pulls ahead. Measured in this frame, it moves at exactly c.";
  const items = [...m.stamps].sort((a, b) => a.t - b.t);
  const parts = items.map((s) => `${s.label} at t = ${fmt(s.t)}`);
  return `${parts.join(", ")}.`;
}

// ─── The drawing ────────────────────────────────────────────────────────────────────────────────

function Scene({
  model,
  t,
  showReadouts,
  showObservers,
}: {
  model: SceneModel;
  t: number;
  showReadouts: boolean;
  showObservers: boolean;
}) {
  const [lo, hi] = model.bounds;
  const scale = Math.min(60, (W - 80) / (hi - lo));
  const ox = W / 2 - ((lo + hi) / 2) * scale;
  const X = (x: number) => ox + x * scale;
  const cc = model.carCenter(t);
  const rear = X(cc - model.carHalf);
  const front = X(cc + model.carHalf);
  const ticks = platformTicks(model, t, lo, hi);
  const firedStamps = model.stamps.filter((s) => t >= s.t - 1e-9);
  const clipId = `${useId().replace(/:/g, "")}-clip`;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={W} height={H} rx={28} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {/* Platform: a slab with marks that ride along with it. */}
        <rect x={0} y={PLATFORM_Y} width={W} height={H - PLATFORM_Y} fill="var(--surface-sunk)" />
        <line x1={0} x2={W} y1={PLATFORM_Y} y2={PLATFORM_Y} stroke="var(--line-strong)" strokeWidth={2} />
        {ticks.map((x) => (
          <line
            key={x.toFixed(3)}
            x1={X(x)}
            x2={X(x)}
            y1={PLATFORM_Y + 6}
            y2={PLATFORM_Y + 18}
            stroke="var(--line-strong)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}
        {model.scorch
          .filter((s) => t >= s.t - 1e-9)
          .map((s) => (
            <g key={s.p}>
              <ellipse cx={X(model.platformX(s.p, t))} cy={PLATFORM_Y + 4} rx={12} ry={4} fill="var(--ink-3)" />
              <text
                x={X(model.platformX(s.p, t))}
                y={PLATFORM_Y + 36}
                textAnchor="middle"
                fontSize={14}
                fill="var(--ink-2)"
              >
                scorch
              </text>
            </g>
          ))}

        {/* The car. */}
        <rect
          x={rear}
          y={CAR_TOP}
          width={front - rear}
          height={CAR_BOTTOM - CAR_TOP}
          rx={14}
          fill="var(--iris-soft)"
          stroke="var(--iris)"
          strokeWidth={2}
        />
        <line
          x1={rear}
          x2={rear}
          y1={CAR_TOP}
          y2={CAR_BOTTOM}
          stroke="var(--ink)"
          strokeWidth={5}
          strokeLinecap="round"
        />
        <line
          x1={front}
          x2={front}
          y1={CAR_TOP}
          y2={CAR_BOTTOM}
          stroke="var(--ink)"
          strokeWidth={5}
          strokeLinecap="round"
        />
        <circle cx={rear + 26} cy={CAR_BOTTOM + 10} r={8} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={2} />
        <circle
          cx={front - 26}
          cy={CAR_BOTTOM + 10}
          r={8}
          fill="var(--surface)"
          stroke="var(--ink-2)"
          strokeWidth={2}
        />
        <text x={rear + 10} y={CAR_TOP + 22} fontSize={14} fill="var(--ink-2)">
          rear
        </text>
        <text x={front - 10} y={CAR_TOP + 22} textAnchor="end" fontSize={14} fill="var(--ink-2)">
          front
        </text>

        {/* Motion arrow: who is moving in this frame. */}
        {model.v > 0 ? (
          model.frame === "platform" ? (
            <MotionArrow x={X(cc)} y={CAR_TOP - 30} dir={1} label={`${fmt(model.v)}c`} />
          ) : (
            <MotionArrow x={W - 170} y={H - 18} dir={-1} label={`platform ${fmt(model.v)}c`} />
          )
        ) : null}

        {/* Props of each scenario. */}
        {model.scenario === "lamp" ? (
          <g>
            <line x1={X(cc)} x2={X(cc)} y1={CAR_TOP} y2={CAR_TOP + 14} stroke="var(--ink-2)" strokeWidth={2} />
            <circle cx={X(cc)} cy={CAR_TOP + 22} r={8} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2} />
          </g>
        ) : null}
        {model.scenario === "lamp" && showObservers ? (
          model.frame === "platform" ? (
            <Person x={X(model.platformX(0, t))} y={PLATFORM_Y} tone="var(--ink-2)" label="observer" below />
          ) : (
            <Person x={X(cc)} y={CAR_BOTTOM - 4} tone="var(--iris)" label="passenger" />
          )
        ) : null}
        {model.scenario === "headlight" ? (
          <rect x={front - 4} y={PULSE_Y - 8} width={10} height={16} rx={3} fill="var(--ink)" />
        ) : null}
        {model.scenario === "lightning" ? (
          <>
            <Person x={X(cc)} y={CAR_BOTTOM - 4} tone="var(--iris)" label="passenger" />
            <Person x={X(model.platformX(0, t))} y={PLATFORM_Y} tone="var(--ink-2)" label="observer" below />
            {model.stamps
              .filter((s) => s.id === "flash-front" || s.id === "flash-rear")
              .map((s) =>
                // The bolt flashes just after its strike, never before it.
                t >= s.t - 1e-9 && t - s.t < (model.tEnd - model.tStart) * 0.05 ? <Bolt key={s.id} x={X(s.x)} /> : null,
              )}
          </>
        ) : null}

        {/* Light pulses. */}
        {model.pulses.map((pl) => {
          const x = pulseX(pl, t);
          if (x === null) return null;
          const x0 = X(pl.x);
          const x1 = X(x);
          return (
            <g key={`${pl.x}-${pl.t}-${pl.dir}`} opacity={pl.main ? 1 : 0.3}>
              <line
                x1={x0}
                x2={x1}
                y1={PULSE_Y}
                y2={PULSE_Y}
                stroke="var(--sea)"
                strokeOpacity={0.35}
                strokeWidth={3}
              />
              <circle cx={x1} cy={PULSE_Y} r={13} fill="var(--sea)" opacity={0.2} />
              <circle cx={x1} cy={PULSE_Y} r={6} fill="var(--sea)" />
            </g>
          );
        })}

        {/* Stamps: each event, stamped with this frame's time. */}
        {firedStamps
          .filter((s) => s.id === "hit-front" || s.id === "hit-rear")
          .map((s) => {
            const wall = model.scenario === "lamp" ? (s.id === "hit-front" ? front : rear) : X(model.carCenter(s.t));
            const anchor =
              model.scenario === "lamp"
                ? s.id === "hit-front"
                  ? "end"
                  : "start"
                : s.id === "hit-front"
                  ? "start"
                  : "end";
            const dy = model.scenario === "lightning" && s.id === "hit-rear" ? -22 : 0;
            return (
              <g key={s.id} data-stamp={s.id}>
                {model.scenario === "lamp" ? (
                  <circle cx={wall} cy={PULSE_Y} r={16} fill="none" stroke="var(--sea)" strokeWidth={3} />
                ) : null}
                <text
                  x={wall + (anchor === "start" ? 8 : -8)}
                  y={CAR_TOP - 10 + dy}
                  textAnchor={anchor}
                  fontSize={14}
                  fontWeight={650}
                  fill="var(--ink)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {model.scenario === "lamp"
                    ? `t = ${fmt(s.t)}`
                    : `${s.id === "hit-front" ? "front" : "rear"} flash seen, t = ${fmt(s.t)}`}
                </text>
              </g>
            );
          })}

        {showReadouts ? (
          <text x={24} y={34} fontSize={15} fontWeight={650} fill="var(--ink)">
            Measured here: light {"1.00"}c, train {model.frame === "platform" ? `${fmt(model.v)}c` : "at rest"}
          </text>
        ) : null}
      </g>
    </g>
  );
}

/** Platform marks (every 2 units of platform length) visible in [lo, hi] at time t. */
function platformTicks(model: SceneModel, t: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let p = -60; p <= 60; p += 2) {
    const x = model.platformX(p, t);
    if (x >= lo - 2 && x <= hi + 2) out.push(x);
  }
  return out;
}

function MotionArrow({ x, y, dir, label }: { x: number; y: number; dir: 1 | -1; label: string }) {
  const len = 46;
  return (
    <g aria-hidden>
      <line
        x1={x - (dir * len) / 2}
        x2={x + (dir * len) / 2}
        y1={y}
        y2={y}
        stroke="var(--ink-2)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <path
        d={`M${x + (dir * len) / 2} ${y} l${-dir * 8} -6 M${x + (dir * len) / 2} ${y} l${-dir * 8} 6`}
        stroke="var(--ink-2)"
        strokeWidth={2.5}
        strokeLinecap="round"
        fill="none"
      />
      <text
        x={x + dir * (len / 2 + 10)}
        y={y + 5}
        textAnchor={dir > 0 ? "start" : "end"}
        fontSize={14}
        fill="var(--ink-2)"
      >
        {label}
      </text>
    </g>
  );
}

function Person({ x, y, tone, label, below }: { x: number; y: number; tone: string; label: string; below?: boolean }) {
  return (
    <g aria-hidden>
      <line x1={x} x2={x} y1={y} y2={y - 22} stroke={tone} strokeWidth={3} strokeLinecap="round" />
      <circle cx={x} cy={y - 30} r={7} fill={tone} />
      <text x={x} y={below ? y + 54 : y - 44} textAnchor="middle" fontSize={14} fill="var(--ink-2)">
        {label}
      </text>
    </g>
  );
}

function Bolt({ x }: { x: number }) {
  return (
    <path
      d={`M${x + 6} 10 L${x - 8} 60 L${x + 2} 60 L${x - 6} ${CAR_TOP + 4} L${x + 12} 46 L${x + 2} 46 L${x + 10} 10 Z`}
      fill="var(--sea)"
      stroke="var(--ink)"
      strokeWidth={1.5}
      strokeLinejoin="round"
    />
  );
}

// ─── Stopwatch: subtract light-travel time ──────────────────────────────────────────────────────

function Stopwatch(props: {
  model: SceneModel;
  t: number;
  corrected: boolean;
  onCorrect: () => void;
  announce: (s: string) => void;
}) {
  const { model, t, corrected } = props;
  const who = model.frame === "platform" ? "platform observer" : "passenger";
  const rows = model.timed.map((e) => ({ ...e, seen: seenAt(e) }));
  const order = (key: "seen" | "t") => {
    const [a, b] = rows;
    if (!a || !b) return "";
    if (Math.abs(a[key] - b[key]) < 1e-6) return "at the same moment";
    return `${(a[key] < b[key] ? a : b).label.toLowerCase()} first`;
  };
  return (
    <div className="rounded-md border border-line bg-surface p-3" data-stopwatch>
      <p className="mb-2 text-small text-ink-2">
        The {who}'s stopwatch: when the light reached her, and when each event happened.
      </p>
      <table className="w-full text-small tabular">
        <thead>
          <tr className="text-left text-ink-2">
            <th scope="col" className="font-semibold">
              Event
            </th>
            <th scope="col" className="font-semibold">
              Light reaches her
            </th>
            <th scope="col" className="font-semibold">
              Happened at
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="py-1 text-left font-normal">
                {r.label}
              </th>
              {/* Shown once the light gets to her (or at the end of the scene, when the wall flashes reach her later). */}
              <td>{t >= Math.min(r.seen, model.tEnd) - 1e-9 ? `t = ${fmt(r.seen)}` : "…"}</td>
              <td>{corrected ? `t = ${fmt(r.t)}` : "?"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={() => {
            props.onCorrect();
            props.announce(`After subtracting light-travel time: ${order("t")}. Before: ${order("seen")}.`);
          }}
          disabled={corrected}
        >
          Subtract light-travel time
        </Button>
        {corrected ? <span className="text-small text-ink-2">Corrected: {order("t")}.</span> : null}
      </div>
    </div>
  );
}
