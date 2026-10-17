/**
 * Estimate on a number line (linear or log). The learner slides (or types) a value; after grading the
 * accepted band and the true value slide in beside their marker.
 */
import { solutionOf } from "@learncroc/core";
import { Button } from "@learncroc/ui";
import { useId, useState } from "react";
import type { Ask } from "../content";
import { formatNumber } from "../content";
import { type InputProps, parseNumber } from "./types";

type EstimateAsk = Extract<Ask, { kind: "estimate" }>;
type Scale = EstimateAsk["scale"];

export function toT(scale: Scale, v: number): number {
  const { min, max } = scale;
  if (scale.log && min > 0 && max > 0) {
    const t = (Math.log(Math.max(min, v)) - Math.log(min)) / (Math.log(max) - Math.log(min));
    return Math.min(1, Math.max(0, t));
  }
  return Math.min(1, Math.max(0, (v - min) / (max - min || 1)));
}

export function fromT(scale: Scale, t: number): number {
  const { min, max } = scale;
  if (scale.log && min > 0 && max > 0) return Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min)));
  return min + t * (max - min);
}

/** A friendly rounding for slider values: 2–3 significant figures. */
export function niceValue(v: number): number {
  if (v === 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(v)));
  const step = mag / (Math.abs(v) / mag < 2 ? 10 : 5);
  return Math.round(v / step) * step;
}

export function acceptBand(ask: Pick<EstimateAsk, "answer" | "accept">): [number, number] {
  const { answer, accept } = ask;
  if (accept.factor && accept.factor > 0) return [answer / accept.factor, answer * accept.factor];
  const abs = accept.abs ?? 0;
  return [answer - abs, answer + abs];
}

function ticks(scale: Scale): number[] {
  const { min, max } = scale;
  if (scale.log && min > 0) {
    const out: number[] = [];
    for (let e = Math.ceil(Math.log10(min)); 10 ** e <= max; e++) out.push(10 ** e);
    if (out.length >= 2) return out;
  }
  return Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
}

const W = 600;
const PAD = 24;
const x = (t: number) => PAD + t * (W - 2 * PAD);

/** The true value for this instance (parametric items use the server's vars). */
function expectedValue(ask: EstimateAsk, vars?: Record<string, number>): number {
  try {
    const sol = solutionOf(ask, vars ? { vars } : {});
    if (sol?.kind === "estimate" && Number.isFinite(sol.value)) return sol.value;
  } catch {
    // An unparseable answerExpr falls back to the authored default.
  }
  return ask.answer;
}

export function EstimateInput(p: InputProps<EstimateAsk>) {
  const { locked, last } = p;
  const ask = { ...p.ask, answer: expectedValue(p.ask, p.vars) };
  const { scale } = ask;
  const initial = typeof p.draft === "number" ? p.draft : niceValue(fromT(scale, 0.5));
  const [value, setValue] = useState<number>(initial);
  const [typed, setTyped] = useState<string>("");
  const id = useId();
  const unit = scale.unit ? ` ${scale.unit}` : "";
  const reveal = Boolean(last && (last.correct || last.showSolution));
  const [lo, hi] = acceptBand(ask);

  const set = (v: number) => {
    setValue(v);
    p.onDraft?.(v);
  };
  const submit = () => {
    if (locked) return;
    p.onSubmit({ kind: "estimate", value });
  };

  return (
    <form
      className="flex flex-col gap-3"
      data-input="estimate"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <svg
        viewBox={`0 0 ${W} 86`}
        className="w-full"
        role="img"
        aria-label={`Number line from ${formatNumber(scale.min)} to ${formatNumber(scale.max)}${unit}${scale.log ? ", log scale" : ""}`}
      >
        <title>{scale.label ?? "Number line"}</title>
        <line x1={PAD} x2={W - PAD} y1={44} y2={44} stroke="var(--line-strong)" strokeWidth={2} strokeLinecap="round" />
        {ticks(scale).map((tv) => (
          <g key={tv}>
            <line
              x1={x(toT(scale, tv))}
              x2={x(toT(scale, tv))}
              y1={38}
              y2={50}
              stroke="var(--ink-3)"
              strokeWidth={1.5}
            />
            <text
              x={x(toT(scale, tv))}
              y={70}
              textAnchor="middle"
              fontSize={13}
              fill="var(--ink-2)"
              className="tabular"
            >
              {formatNumber(tv)}
            </text>
          </g>
        ))}
        {reveal ? (
          <g data-band>
            <rect
              x={x(toT(scale, lo))}
              y={34}
              width={Math.max(4, x(toT(scale, hi)) - x(toT(scale, lo)))}
              height={20}
              rx={6}
              fill="var(--sea-soft)"
              stroke="var(--sea)"
              strokeWidth={1.5}
            />
            <line
              x1={x(toT(scale, ask.answer))}
              x2={x(toT(scale, ask.answer))}
              y1={28}
              y2={60}
              stroke="var(--sea-text)"
              strokeWidth={3}
              strokeLinecap="round"
            />
            <text
              x={x(toT(scale, ask.answer))}
              y={20}
              textAnchor="middle"
              fontSize={13}
              fontWeight={650}
              fill="var(--sea-text)"
            >
              {formatNumber(ask.answer)}
              {unit}
            </text>
          </g>
        ) : null}
        <circle cx={x(toT(scale, value))} cy={44} r={9} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2.5} />
      </svg>
      <label htmlFor={id} className="sr-only">
        {scale.label ?? "Your estimate"}
      </label>
      <input
        id={id}
        data-autofocus
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(toT(scale, value) * 1000)}
        disabled={locked}
        aria-valuetext={`${formatNumber(value)}${unit}`}
        aria-describedby={p.promptId}
        onChange={(e) => set(niceValue(fromT(scale, Number(e.target.value) / 1000)))}
        className="w-full accent-[var(--ink)]"
      />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-lead text-ink tabular" aria-live="polite">
          {formatNumber(value)}
          {unit}
        </p>
        <input
          className="h-10 w-28 rounded-sm border border-line-strong bg-surface px-2 text-body tabular"
          inputMode="decimal"
          placeholder="or type"
          aria-label={`Type an estimate${unit}`}
          value={typed}
          disabled={locked}
          onChange={(e) => {
            setTyped(e.target.value);
            const n = parseNumber(e.target.value);
            if (n !== undefined) set(Math.min(scale.max, Math.max(scale.min, n)));
          }}
        />
        <Button type="submit" variant="primary" kbd="⏎" disabled={locked}>
          {p.submitLabel}
        </Button>
      </div>
      {reveal ? (
        <p className="text-small text-ink-2">
          Anything from {formatNumber(Math.max(scale.min, lo))} to {formatNumber(Math.min(scale.max, hi))}
          {unit} counts. You said {formatNumber(last?.answer.kind === "estimate" ? last.answer.value : value)}
          {unit}.
        </p>
      ) : null}
    </form>
  );
}
