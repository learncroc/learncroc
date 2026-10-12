/**
 * embedding-plane view: a meaning map you can put words on.
 *
 * place    carry tray words onto the map (pointer, or Space + arrows + Space); then the real
 *          positions slide in, each joined to your guess by a dotted line.
 * nearest  tap the word closest to the highlighted one; neighbour lines appear after.
 * analogy  an arrow runs b → a; carry it to c in your head and tap where it lands.
 * explore  tap any word to see its nearest neighbours.
 */
import { cn } from "@learncroc/ui";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { arrowDelta, useButtonsMode, useDragPoint } from "../shared/drag";
import { clamp, fmt } from "../shared/math";
import { KeyButton, lineColor, motionStyle, ReviewNote, radioGroupKeys, WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import {
  analogyTarget,
  dist,
  type EmbeddingPlaneAnswer,
  type EmbeddingPlaneGoal,
  type EmbeddingPlaneProps,
  type EmbeddingPoint,
  neighborsOf,
} from "./spec";

type Props = WidgetViewProps<EmbeddingPlaneProps, EmbeddingPlaneGoal, EmbeddingPlaneAnswer>;
type XY = [number, number];

const left = (x: number) => `${clamp(x, 0, 1) * 100}%`;
const top = (y: number) => `${(1 - clamp(y, 0, 1)) * 100}%`;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function colorOf(props: EmbeddingPlaneProps, pt: EmbeddingPoint): string {
  const c = props.clusters?.find((x) => x.id === pt.cluster);
  return c ? lineColor(c.color) : "var(--w-ink-2)";
}

/** Plain-language position for announcements ("upper left"). */
function where([x, y]: XY): string {
  const v = y > 0.66 ? "upper" : y < 0.33 ? "lower" : "middle";
  const h = x < 0.33 ? "left" : x > 0.66 ? "right" : "centre";
  return v === "middle" && h === "centre" ? "the centre" : `${v} ${h}`;
}

export default function EmbeddingPlaneView(p: Props) {
  const props = withReveal(p.props, p.revealProps);
  const goal = p.goal;
  const plane = useRef<HTMLDivElement>(null);
  const [buttons] = useButtonsMode();
  const interactive = p.mode !== "review" && !!p.onChange;
  const placeable = new Set(p.mode === "explore" && !goal ? [] : (props.placeable ?? []));
  const placed: Record<string, XY> = p.value?.placed ?? {};
  const [held, setHeld] = useState<{ id: string; prev: XY | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const review = p.mode === "review";
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const heldId = held?.id;
  // A tray chip becomes a placed chip when picked up: keep keyboard focus on the word.
  useEffect(() => {
    if (!heldId) return;
    const el = plane.current?.querySelector<HTMLElement>(`[data-placed="${CSS.escape(heldId)}"]`);
    if (el && document.activeElement !== el) el.focus();
  }, [heldId]);

  const isPick = goal?.kind === "nearest" || goal?.kind === "analogy";
  const picked = p.value?.picked;
  const label = (id: string) => props.points.find((x) => x.id === id)?.label ?? id;

  const setPlaced = (id: string, xy: XY | null) => {
    const next = { ...placed };
    if (xy) next[id] = [round3(clamp(xy[0], 0, 1)), round3(clamp(xy[1], 0, 1))];
    else delete next[id];
    p.onChange?.({ placed: next });
  };

  const { handlers, dragging } = useDragPoint({
    areaRef: plane,
    disabled: !interactive,
    onMove: (nx, ny) => {
      const id = dragId.current;
      if (id) setPlaced(id, [nx, 1 - ny]);
    },
    onEnd: () => {
      const id = dragId.current;
      dragId.current = null;
      if (id) p.announce(`${label(id)} placed in the ${where(placed[id] ?? [0.5, 0.5])}.`);
    },
  });

  const pickUp = (id: string) => {
    if (!interactive) return;
    const prev = placed[id] ?? null;
    setHeld({ id, prev });
    if (!prev) setPlaced(id, [0.5, 0.5]);
    p.announce(`Picked up ${label(id)}. Arrow keys move it, Space drops it, Escape puts it back.`);
  };
  const drop = () => {
    if (!held) return;
    p.announce(`${label(held.id)} dropped in the ${where(placed[held.id] ?? [0.5, 0.5])}.`);
    setHeld(null);
  };
  const cancel = () => {
    if (!held) return;
    setPlaced(held.id, held.prev);
    p.announce(`${label(held.id)} put back.`);
    setHeld(null);
  };
  const nudge = (id: string, dx: number, dy: number) => {
    const at = placed[id] ?? [0.5, 0.5];
    setPlaced(id, [at[0] + dx, at[1] + dy]);
  };

  const onChipKey = (id: string) => (e: KeyboardEvent) => {
    if (!interactive) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (held?.id === id) drop();
      else pickUp(id);
      return;
    }
    if (e.key === "Escape" && held?.id === id) {
      e.preventDefault();
      cancel();
      return;
    }
    const d = arrowDelta(e);
    if (d && held?.id === id) {
      e.preventDefault();
      nudge(id, d[0] * 0.02, -d[1] * 0.02);
    }
  };

  const pick = (id: string) => {
    if (isPick) {
      if (!interactive) return;
      p.onChange?.({ picked: id });
      p.announce(`Picked ${label(id)}.`);
    } else {
      setSelected((s) => (s === id ? null : id));
      const k = props.showNeighbors ?? 3;
      const near = neighborsOf(props.points, id, k);
      p.announce(`${label(id)}: nearest ${near.map((n) => n.point.label).join(", ")}.`);
    }
  };

  // Lines: neighbours of the selection (explore), of the goal word (nearest, review), or the analogy.
  const neighborFrom = !isPick && selected ? selected : review && goal?.kind === "nearest" ? goal.of : null;
  const neighbors = neighborFrom ? neighborsOf(props.points, neighborFrom, props.showNeighbors ?? 3) : [];
  const fromPt = props.points.find((x) => x.id === neighborFrom);
  const analogy = props.analogy;
  const ptXY = (id: string) => props.points.find((x) => x.id === id)?.xy;
  const showCarried = !!analogy && (review || p.mode === "explore");
  const target = analogy ? analogyTarget(props.points, analogy) : null;

  const onMap = props.points.filter((pt) => !placeable.has(pt.id));
  const tray = [...placeable].filter((id) => !placed[id]);
  const goalOf = goal?.kind === "nearest" ? goal.of : null;
  const solutionPick = review
    ? goal?.kind === "nearest"
      ? goal.answer
      : goal?.kind === "analogy"
        ? analogy?.answer
        : undefined
    : undefined;

  return (
    <WidgetShell
      id="embedding-plane"
      mode={p.mode}
      source={props.source}
      buttonsToggle={placeable.size > 0 && !review}
      label="Meaning map"
      toolbar={
        props.clusters?.length ? (
          <span className="flex flex-wrap gap-3" aria-hidden="true">
            {props.clusters.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-pill" style={{ background: lineColor(c.color) }} />
                {c.label}
              </span>
            ))}
          </span>
        ) : null
      }
    >
      <div
        ref={plane}
        className="relative aspect-[3/2] w-full touch-none select-none overflow-hidden rounded-md border border-w-grid bg-w-ground"
        data-plane
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <marker
              id={`${uid}-arrow`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="var(--w-ink)" />
            </marker>
            <marker
              id={`${uid}-arrow-sea`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="var(--sea)" />
            </marker>
          </defs>
          {[20, 40, 60, 80].map((v) => (
            <g key={v} stroke="var(--w-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.6">
              <line x1={v} y1={0} x2={v} y2={100} vectorEffect="non-scaling-stroke" />
              <line x1={0} y1={v} x2={100} y2={v} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {fromPt
            ? neighbors.map((n) => (
                <line
                  key={n.point.id}
                  x1={fromPt.xy[0] * 100}
                  y1={(1 - fromPt.xy[1]) * 100}
                  x2={n.point.xy[0] * 100}
                  y2={(1 - n.point.xy[1]) * 100}
                  stroke="var(--sea)"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                  data-neighbor={n.point.id}
                />
              ))
            : null}
          {analogy && ptXY(analogy.a) && ptXY(analogy.b) ? (
            <Arrow
              from={ptXY(analogy.b) as XY}
              to={ptXY(analogy.a) as XY}
              color="var(--w-ink)"
              marker={`${uid}-arrow`}
            />
          ) : null}
          {showCarried && analogy && target && ptXY(analogy.c) ? (
            <g data-carried>
              <Arrow from={ptXY(analogy.c) as XY} to={target} color="var(--sea)" marker={`${uid}-arrow-sea`} dashed />
            </g>
          ) : null}
          {review && goal?.kind === "place"
            ? goal.ids.map((id) => {
                const guess = placed[id];
                const truth = ptXY(id);
                return guess && truth ? (
                  <line
                    key={id}
                    x1={guess[0] * 100}
                    y1={(1 - guess[1]) * 100}
                    x2={truth[0] * 100}
                    y2={(1 - truth[1]) * 100}
                    stroke="var(--w-ink-2)"
                    strokeWidth="1.5"
                    strokeDasharray="2 4"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null;
              })
            : null}
        </svg>

        {showCarried && target ? (
          <span
            aria-hidden="true"
            className="absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-dashed border-sea"
            style={{ left: left(target[0]), top: top(target[1]) }}
          />
        ) : null}

        {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move focus within the radio group. */}
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is radiogroup or group, both take a label. */}
        <div
          className="absolute inset-0"
          role={isPick ? "radiogroup" : "group"}
          aria-label={isPick ? "Words on the map: pick one" : "Words on the map"}
          onKeyDown={isPick ? radioGroupKeys : undefined}
        >
          {onMap.map((pt) => {
            const isGoalOf = goalOf === pt.id;
            const isPicked = picked === pt.id;
            const isSolution = solutionPick === pt.id;
            const isSel = selected === pt.id;
            const disabled = isPick
              ? !interactive || isGoalOf || (analogy ? [analogy.a, analogy.b, analogy.c].includes(pt.id) : false)
              : false;
            return (
              // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is radio when picking (aria-checked), else a toggle (aria-pressed).
              <button
                key={pt.id}
                type="button"
                role={isPick ? "radio" : undefined}
                aria-checked={isPick ? isPicked : undefined}
                aria-pressed={!isPick ? isSel : undefined}
                aria-label={`${pt.label}${isGoalOf ? " (the word to match)" : ""}`}
                disabled={disabled && !isGoalOf}
                aria-disabled={isGoalOf || undefined}
                onClick={() => (isGoalOf ? undefined : pick(pt.id))}
                data-point={pt.id}
                className={cn(
                  "group absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-pill px-1 py-0.5 text-small font-semibold text-w-ink disabled:cursor-default",
                  isPick && !disabled && "hover:bg-surface/70",
                )}
                style={{ left: left(pt.xy[0]), top: top(pt.xy[1]), ...motionStyle(p.reducedMotion, "left, top") }}
              >
                <span
                  className={cn(
                    "size-3.5 shrink-0 rounded-pill border-2 border-w-ground",
                    (isPicked || isSel) && "ring-2 ring-w-ink ring-offset-1 ring-offset-w-ground",
                    isGoalOf && "size-4.5 ring-2 ring-sea",
                    isSolution && !isPicked && "outline-2 outline-dashed outline-sea outline-offset-2",
                  )}
                  style={{ background: colorOf(props, pt) }}
                />
                <span
                  className={cn(
                    "whitespace-nowrap rounded-xs bg-w-ground/80 px-0.5",
                    isPicked && "underline decoration-2 underline-offset-2",
                  )}
                >
                  {pt.label}
                </span>
              </button>
            );
          })}

          {/* Placed words (learner) and, in review, their true positions. */}
          {[...placeable].map((id) => {
            const at = placed[id];
            const truth = ptXY(id);
            const pt = props.points.find((x) => x.id === id);
            if (!pt) return null;
            return (
              <div key={id}>
                {review && truth ? (
                  <span
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 text-small font-semibold text-sea-text"
                    style={{ left: left(truth[0]), top: top(truth[1]) }}
                    data-truth={id}
                  >
                    <span className="size-3.5 rounded-pill bg-sea" aria-hidden="true" />
                    {pt.label}
                    <span className="sr-only">
                      : true position{at ? `, ${fmt(dist(at, truth), 2)} away from yours` : ""}
                    </span>
                  </span>
                ) : null}
                {at ? (
                  <button
                    type="button"
                    data-placed={id}
                    aria-pressed={held?.id === id}
                    aria-label={`${pt.label}, placed in the ${where(at)}${review ? " (your guess)" : ""}`}
                    disabled={!interactive}
                    onKeyDown={onChipKey(id)}
                    onPointerDown={(e) => {
                      dragId.current = id;
                      handlers.onPointerDown(e);
                    }}
                    className={cn(
                      "absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab items-center gap-1 rounded-pill border-[1.5px] border-dashed border-w-ink bg-surface px-2 py-0.5 text-small font-semibold text-ink shadow-2 active:cursor-grabbing disabled:cursor-default",
                      held?.id === id && "ring-2 ring-sea",
                    )}
                    style={{
                      left: left(at[0]),
                      top: top(at[1]),
                      ...(dragging ? {} : motionStyle(p.reducedMotion, "left, top", "var(--dur-quick)")),
                    }}
                  >
                    {pt.label}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {placeable.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3" data-tray>
          <span className="text-small text-w-ink-2">
            {tray.length ? "Place these:" : "All placed. Drag to adjust."}
          </span>
          {tray.map((id) => (
            <button
              key={id}
              type="button"
              aria-label={`${label(id)} (not placed yet)`}
              disabled={!interactive}
              onKeyDown={onChipKey(id)}
              onPointerDown={(e) => {
                dragId.current = id;
                handlers.onPointerDown(e);
              }}
              className="h-10 cursor-grab rounded-key border-[1.5px] border-ink bg-surface px-4 text-body font-semibold text-ink shadow-key-rest active:cursor-grabbing"
            >
              {label(id)}
            </button>
          ))}
        </div>
      ) : null}

      {buttons && interactive && placeable.size > 0 ? (
        <ButtonsPad
          ids={[...placeable]}
          label={label}
          placed={placed}
          onNudge={(id, dx, dy) => {
            nudge(id, dx, dy);
            p.announce(`${label(id)} in the ${where(placed[id] ?? [0.5, 0.5])}.`);
          }}
        />
      ) : null}

      {review && goal?.kind === "place" ? (
        <ReviewNote>Filled dots: where the model puts them. Dashed chips: your guesses.</ReviewNote>
      ) : null}
      {analogy && !review && p.mode !== "explore" ? (
        <p className="text-small text-w-ink-2">
          The arrow goes from {label(analogy.b)} to {label(analogy.a)}. Start at {label(analogy.c)} and take the same
          step.
        </p>
      ) : null}
    </WidgetShell>
  );
}

function Arrow({
  from,
  to,
  color,
  marker,
  dashed,
}: {
  from: XY;
  to: XY;
  color: string;
  marker: string;
  dashed?: boolean;
}) {
  return (
    <line
      x1={from[0] * 100}
      y1={(1 - from[1]) * 100}
      x2={to[0] * 100}
      y2={(1 - to[1]) * 100}
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeDasharray={dashed ? "5 4" : undefined}
      vectorEffect="non-scaling-stroke"
      markerEnd={`url(#${marker})`}
    />
  );
}

function ButtonsPad(p: {
  ids: string[];
  label: (id: string) => string;
  placed: Record<string, XY>;
  onNudge: (id: string, dx: number, dy: number) => void;
}) {
  const [id, setId] = useState(p.ids[0] ?? "");
  const step = 0.05;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-2 p-3" data-buttons-pad>
      <label className="flex items-center gap-2 text-small text-ink-2">
        Move
        <select
          value={id}
          onChange={(e) => setId(e.currentTarget.value)}
          className="h-8 rounded-sm border border-line-strong bg-surface px-2 text-body text-ink"
        >
          {p.ids.map((x) => (
            <option key={x} value={x}>
              {p.label(x)}
            </option>
          ))}
        </select>
      </label>
      <span className="flex gap-1">
        <KeyButton size="sm" aria-label="Left" onClick={() => p.onNudge(id, -step, 0)}>
          ←
        </KeyButton>
        <KeyButton size="sm" aria-label="Up" onClick={() => p.onNudge(id, 0, step)}>
          ↑
        </KeyButton>
        <KeyButton size="sm" aria-label="Down" onClick={() => p.onNudge(id, 0, -step)}>
          ↓
        </KeyButton>
        <KeyButton size="sm" aria-label="Right" onClick={() => p.onNudge(id, step, 0)}>
          →
        </KeyButton>
      </span>
      {!p.placed[id] ? <span className="text-small text-ink-3">Starts from the centre.</span> : null}
    </div>
  );
}
