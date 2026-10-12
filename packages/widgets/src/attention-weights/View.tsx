/**
 * attention-weights view: arcs fan out from the token doing the looking, thick where it looks hard.
 *
 * edit  drag each word's fader; raising one lowers the rest, because attention always sums to 100%.
 * tap   tap the words that matter, then the real arcs appear.
 * swap  try another word in one slot and watch every arc redraw.
 * Causal mode hatches the words after the focus: a model writing left to right can't look ahead.
 */
import { cn } from "@learncroc/ui";
import { useId, useRef } from "react";
import { useDragPoint } from "../shared/drag";
import { clamp, pct } from "../shared/math";
import { motionStyle, ReviewNote, radioGroupKeys, WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import {
  type AttentionWeightsAnswer,
  type AttentionWeightsGoal,
  type AttentionWeightsProps,
  attendable,
  redistribute,
  swapWeights,
  uniformWeights,
} from "./spec";

type Props = WidgetViewProps<AttentionWeightsProps, AttentionWeightsGoal, AttentionWeightsAnswer>;

const ARC_H = 150;
const VB_W = 1000;

/** Column layout: widths proportional to word length, so arcs and chips line up without measuring. */
export function columns(tokens: readonly string[]): { x: number; w: number }[] {
  const widths = tokens.map((t) => Math.max(3, [...t].length) + 2.5);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return widths.map((w) => {
    const c = { x: ((acc + w / 2) / total) * VB_W, w: w / total };
    acc += w;
    return c;
  });
}

function arcPath(xf: number, xi: number): string {
  const base = ARC_H - 6;
  if (Math.abs(xi - xf) < 1) {
    return `M ${xf - 14} ${base} C ${xf - 30} ${base - 60}, ${xf + 30} ${base - 60}, ${xf + 14} ${base}`;
  }
  const h = Math.min(ARC_H - 16, 34 + Math.abs(xi - xf) * 0.32);
  return `M ${xf} ${base} Q ${(xf + xi) / 2} ${base - h * 2 + 6} ${xi} ${base}`;
}

function Arcs(p: {
  cols: { x: number }[];
  focus: number;
  weights: readonly number[];
  color: string;
  dashed?: boolean;
  reducedMotion: boolean;
  layer: string;
}) {
  const xf = p.cols[p.focus]?.x ?? 0;
  return (
    <g data-arcs={p.layer}>
      {p.cols.map((c, i) => {
        const w = clamp(p.weights[i] ?? 0, 0, 1);
        const visible = w >= 0.005;
        return (
          <g
            // biome-ignore lint/suspicious/noArrayIndexKey: one arc per token position; positions are the identity.
            key={`${p.layer}-${i}-${c.x}`}
            style={{ opacity: visible ? 0.28 + 0.72 * w : 0, ...motionStyle(p.reducedMotion, "opacity") }}
          >
            <path
              d={arcPath(xf, c.x)}
              fill="none"
              stroke={p.color}
              strokeLinecap="round"
              strokeDasharray={p.dashed ? "6 6" : undefined}
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: 1.5 + 13 * w, ...motionStyle(p.reducedMotion, "stroke-width") }}
            />
            <circle cx={c.x} cy={ARC_H - 6} r={3 + 5 * w} fill={p.color} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </g>
  );
}

export default function AttentionWeightsView(p: Props) {
  const props = withReveal(p.props, p.revealProps);
  const { tokens, focus } = props;
  const cols = columns(tokens);
  const interactive = p.mode !== "review" && !!p.onChange;
  const swapped = p.value?.swapped;
  const shownTokens = props.swap && swapped ? tokens.map((t, i) => (i === props.swap?.index ? swapped : t)) : tokens;
  const allowed = tokens.map((_, i) => attendable(props, i));

  const editMode = props.mode === "edit";
  const tapMode = props.mode === "tap";
  const learner = editMode
    ? p.value?.weights?.length === tokens.length
      ? p.value.weights
      : uniformWeights(props)
    : undefined;
  const showRef = props.swap ? true : props.mode === "view" || !props.hideWeights || p.mode === "review";
  const refWeights = props.swap ? swapWeights(props, swapped) : props.weights;
  const tapped = new Set(p.value?.tapped ?? []);
  const correctTaps = p.mode === "review" && p.goal?.kind === "tap" ? new Set(p.goal.correct) : null;
  const focusWord = shownTokens[focus] ?? "";

  const setWeight = (i: number, v: number) => {
    if (!learner || !interactive) return;
    const next = redistribute(learner, i, v, allowed);
    p.onChange?.({ weights: next });
    p.announce(`${shownTokens[i]}: ${pct(next[i] ?? 0)}. The other words now share ${pct(1 - (next[i] ?? 0))}.`);
  };

  const toggleTap = (i: number) => {
    if (!interactive) return;
    const next = new Set(tapped);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    const list = [...next].sort((a, b) => a - b);
    p.onChange?.({ tapped: list });
    p.announce(
      `${shownTokens[i]} ${next.has(i) ? "tapped" : "untapped"}. ${list.length} word${list.length === 1 ? "" : "s"} tapped.`,
    );
  };

  const gridTemplateColumns = cols.map((c) => `${c.w}fr`).join(" ");

  return (
    <WidgetShell id="attention-weights" mode={p.mode} source={props.source} label={`Attention from “${focusWord}”`}>
      <div className="flex flex-col gap-1">
        <svg
          viewBox={`0 0 ${VB_W} ${ARC_H}`}
          preserveAspectRatio="none"
          className="block h-[104px] w-full overflow-visible"
          aria-hidden="true"
        >
          {showRef && refWeights ? (
            <Arcs
              cols={cols}
              focus={focus}
              weights={refWeights}
              color="var(--sea)"
              dashed={!!learner}
              reducedMotion={p.reducedMotion}
              layer="reference"
            />
          ) : null}
          {learner ? (
            <Arcs
              cols={cols}
              focus={focus}
              weights={learner}
              color="var(--w-1)"
              reducedMotion={p.reducedMotion}
              layer="learner"
            />
          ) : null}
          {tapMode && !showRef ? (
            <Arcs
              cols={cols}
              focus={focus}
              weights={tokens.map((_, i) => (tapped.has(i) ? 0.5 : 0))}
              color="var(--w-1)"
              reducedMotion={p.reducedMotion}
              layer="taps"
            />
          ) : null}
        </svg>
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is list or group, both take a label. */}
        <div
          className="grid items-start gap-x-1"
          style={{ gridTemplateColumns }}
          role={tapMode ? "group" : "list"}
          aria-label="Words"
        >
          {shownTokens.map((t, i) => {
            const isFocus = i === focus;
            const masked = !allowed[i];
            const isSwap = props.swap?.index === i;
            const label = `${t}${isFocus ? " (looking from here)" : ""}${masked ? " (masked, after the focus)" : ""}`;
            const chipClass = cn(
              "flex min-h-10 w-full min-w-0 items-center justify-center rounded-sm border-[1.5px] px-1 text-body text-ink",
              isFocus ? "border-w-ink bg-surface font-bold shadow-2" : "border-line-strong bg-surface",
              masked &&
                "border-dashed bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_4px,var(--surface-sunk)_4px_7px)] text-ink-3",
              tapped.has(i) && "border-w-ink bg-[color-mix(in_srgb,var(--w-1)_40%,var(--surface))]",
              correctTaps?.has(i) && "outline-2 outline-dashed outline-sea outline-offset-2",
              isSwap && "underline decoration-dotted decoration-2 underline-offset-4",
            );
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: words can repeat ("the" twice); the position is the identity.
                key={`${i}-${t}`}
                className="flex min-w-0 flex-col items-center gap-1"
                role={tapMode ? undefined : "listitem"}
              >
                {isFocus ? (
                  <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true" className="-mb-0.5 text-w-ink">
                    <path
                      d="M1 6c2.5-3.6 5.3-5 8-5s5.5 1.4 8 5c-2.5 3.6-5.3 5-8 5S3.5 9.6 1 6z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <circle cx="9" cy="6" r="2.2" fill="currentColor" />
                  </svg>
                ) : (
                  <span className="h-3" aria-hidden="true" />
                )}
                {tapMode ? (
                  <button
                    type="button"
                    aria-pressed={tapped.has(i)}
                    aria-label={label}
                    disabled={!interactive || masked || isFocus}
                    onClick={() => toggleTap(i)}
                    className={cn(
                      chipClass,
                      "truncate disabled:cursor-default",
                      !masked &&
                        !isFocus &&
                        interactive &&
                        "hover:-translate-y-0.5 transition-transform duration-quick",
                    )}
                  >
                    {t}
                  </button>
                ) : (
                  <span className={cn(chipClass, "truncate")} title={t}>
                    <span aria-hidden="true">{t}</span>
                    <span className="sr-only">{label}</span>
                  </span>
                )}
                {showRef && refWeights && !learner ? (
                  <span className="text-micro text-sea-text tabular" data-ref-weight={refWeights[i]}>
                    {masked ? "–" : pct(refWeights[i] ?? 0)}
                  </span>
                ) : null}
                {learner ? (
                  <Fader
                    word={t}
                    value={learner[i] ?? 0}
                    reference={showRef ? refWeights?.[i] : undefined}
                    disabled={!interactive || masked}
                    masked={masked}
                    onSet={(v) => setWeight(i, v)}
                    reducedMotion={p.reducedMotion}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {editMode ? (
        <p className="text-small text-w-ink-2">
          Attention always adds up to 100%: raising one word lowers the others.
          {p.mode === "review" && refWeights ? (
            <ReviewNote className="ml-2">Dashed: the reference weights.</ReviewNote>
          ) : null}
        </p>
      ) : null}
      {props.causal ? (
        <p className="text-small text-w-ink-2">
          Hatched words come later. Writing left to right, the model can't look at them yet.
        </p>
      ) : null}
      {props.swap ? (
        <SwapPicker
          options={props.swap.options}
          current={swapped}
          original={tokens[props.swap.index] ?? ""}
          interactive={interactive}
          onPick={(o) => {
            p.onChange?.({ swapped: o });
            const w = swapWeights(props, o);
            const top = w ? w.indexOf(Math.max(...w.filter((_, i) => i !== focus))) : -1;
            p.announce(`Swapped in “${o}”. “${focusWord}” now looks hardest at “${tokens[top] ?? ""}”.`);
          }}
        />
      ) : null}
    </WidgetShell>
  );
}

function Fader(p: {
  word: string;
  value: number;
  reference?: number;
  disabled: boolean;
  masked: boolean;
  onSet: (v: number) => void;
  reducedMotion: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const H = 56;
  const { handlers, dragging } = useDragPoint({
    areaRef: track,
    disabled: p.disabled,
    onMove: (_x, y) => p.onSet(Math.round((1 - y) * 100) / 100),
  });
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={track}
        role="slider"
        tabIndex={p.disabled ? -1 : 0}
        aria-label={`Attention to “${p.word}”`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p.value * 100)}
        aria-valuetext={p.masked ? "masked" : pct(p.value)}
        aria-disabled={p.disabled || undefined}
        className={cn("relative w-6 touch-none rounded-xs bg-surface-sunk", !p.disabled && "cursor-ns-resize")}
        style={{ height: H }}
        {...handlers}
        onKeyDown={(e) => {
          if (p.disabled) return;
          const step = e.shiftKey ? 0.2 : 0.05;
          let next: number | null = null;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") next = p.value + step;
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = p.value - step;
          else if (e.key === "PageUp") next = p.value + 0.2;
          else if (e.key === "PageDown") next = p.value - 0.2;
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = 1;
          if (next === null) return;
          e.preventDefault();
          p.onSet(Math.round(clamp(next, 0, 1) * 100) / 100);
        }}
      >
        <div
          className="absolute inset-x-0 bottom-0 rounded-xs"
          style={{
            height: p.value * H,
            background: "var(--w-1)",
            ...(dragging ? { transition: "none" } : motionStyle(p.reducedMotion, "height", "var(--dur-quick)")),
          }}
        />
        {p.reference !== undefined ? (
          <div
            className="absolute -inset-x-1 border-t-2 border-dashed border-sea"
            style={{ bottom: p.reference * H }}
            aria-hidden="true"
            data-ref-weight={p.reference}
          />
        ) : null}
      </div>
      <span className="text-micro font-semibold text-w-ink tabular">{p.masked ? "–" : pct(p.value)}</span>
    </div>
  );
}

function SwapPicker(p: {
  options: string[];
  current?: string;
  original: string;
  interactive: boolean;
  onPick: (o: string) => void;
}) {
  const current = p.current ?? p.original;
  const labelId = useId();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-small text-w-ink-2" id={labelId}>
        Try another word:
      </span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={labelId} onKeyDown={radioGroupKeys}>
        {p.options.map((o) => (
          // biome-ignore lint/a11y/useSemanticElements: an answer-key button acting as a radio (WAI-ARIA radio group pattern).
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={current === o}
            disabled={!p.interactive}
            onClick={() => p.onPick(o)}
            className={cn(
              "h-10 rounded-key border-[1.5px] border-ink px-4 text-body font-semibold text-ink shadow-key-rest transition-[transform,box-shadow] duration-press active:translate-y-0.5 active:shadow-key-down disabled:cursor-default",
              current === o ? "translate-y-0.5 bg-sea-soft shadow-key-down" : "bg-surface",
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
