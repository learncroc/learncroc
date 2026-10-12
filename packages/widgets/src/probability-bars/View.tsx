/**
 * probability-bars view: the next-token machine you can touch.
 *
 * predict  drag each bar to a guess (a shared 100% budget); the real bars slide in beside yours.
 * rank     order the candidate chips from most to least likely.
 * temperature  turn the dial and watch the bars sharpen or flatten; sample 10 and see the pile.
 * pick     tap the bar the model would pick.
 * loop     score → pick → append, by hand, with a run counter.
 * view     read the bars (explore toys get the dial too).
 */
import { cn } from "@learncroc/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { arrowDelta, useButtonsMode, useDragPoint, usePickPlace } from "../shared/drag";
import { clamp, drawIndex, hashString, pct, rng, snap, sum } from "../shared/math";
import { Slider } from "../shared/Slider";
import { KeyButton, motionStyle, ReviewNote, radioGroupKeys, WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import {
  applyTemperature,
  initialRanking,
  loopStep,
  otherMass,
  type ProbabilityBarsAnswer,
  type ProbabilityBarsGoal,
  type ProbabilityBarsProps,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  truthRanking,
} from "./spec";

type Props = WidgetViewProps<ProbabilityBarsProps, ProbabilityBarsGoal, ProbabilityBarsAnswer>;

const CHART_H = 140;

/** Visible token text: leading spaces are a tokenizer detail; keep punctuation-only tokens as is. */
export function tokenLabel(text: string): string {
  const t = text.trim();
  return t.length ? t : text.replace(/ /g, "␣").replace(/\n/g, "⏎");
}

export default function ProbabilityBarsView(p: Props) {
  const props = withReveal(p.props, p.revealProps);
  const { task } = props;
  return (
    <WidgetShell
      id="probability-bars"
      mode={p.mode}
      source={props.source}
      buttonsToggle={task === "rank" && p.mode !== "review"}
      label={`Next-token probabilities after “${props.context}”`}
    >
      {task === "predict" ? <Predict {...p} props={props} /> : null}
      {task === "rank" ? <Rank {...p} props={props} /> : null}
      {task === "temperature" || (task === "view" && p.mode === "explore") ? (
        <Temperature {...p} props={props} />
      ) : null}
      {task === "view" && p.mode !== "explore" ? <ViewOnly {...p} props={props} /> : null}
      {task === "pick" ? <Pick {...p} props={props} /> : null}
      {task === "loop" ? <Loop {...p} props={props} /> : null}
    </WidgetShell>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────

function Context({ text, appended = [], pending }: { text: string; appended?: string[]; pending?: string }) {
  return (
    <p className="voice-casual text-lead text-w-ink" data-context>
      <span>{text}</span>
      {appended.map((t, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: appended tokens are an append-only list.
        <span key={i} className="rounded-xs bg-sea-soft px-0.5 text-ink" data-appended>
          {t}
        </span>
      ))}
      {pending ? (
        <span className="rounded-xs border border-dashed border-sea px-0.5 text-w-ink">{pending}</span>
      ) : (
        <span aria-hidden="true" className="ml-1 inline-block h-[1.1em] w-3 translate-y-1 border-b-2 border-w-ink-2" />
      )}
    </p>
  );
}

function Gridlines({ yMax }: { yMax: number }) {
  const lines = [0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {lines.map((v) => (
        <div
          key={v}
          className="absolute inset-x-0 border-t border-dashed border-w-grid"
          style={{ bottom: `${(v / yMax) * 100}%` }}
        >
          <span className="absolute -top-2.5 -left-10 w-8 text-right text-micro text-w-ink-2 tabular">{pct(v)}</span>
        </div>
      ))}
    </div>
  );
}

/** A truth bar (the model's number): solid sea, narrower, with its value on top. */
function TruthBar({
  p,
  yMax,
  reducedMotion,
  show,
}: {
  p: number;
  yMax: number;
  reducedMotion: boolean;
  show: boolean;
}) {
  const h = show ? (clamp(p, 0, yMax) / yMax) * CHART_H : 0;
  return (
    <div className="relative flex w-5 flex-col justify-end" data-truth={show ? p : undefined}>
      <div
        className="w-full rounded-t-xs"
        style={{ height: h, background: "var(--sea)", ...motionStyle(reducedMotion, "height", "var(--dur-reveal)") }}
      />
      {show ? (
        <span
          className="absolute left-1/2 -translate-x-1/2 text-micro font-semibold text-sea-text tabular"
          style={{ bottom: h + 2 }}
        >
          {pct(p)}
        </span>
      ) : null}
    </div>
  );
}

function OtherColumn({
  label,
  guess,
  truth,
  yMax,
  showTruth,
  reducedMotion,
}: {
  label: string;
  guess?: number;
  truth: number;
  yMax: number;
  showTruth: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div className="flex min-w-16 flex-1 flex-col items-center gap-2" data-column="other">
      <div className="flex items-end gap-1" style={{ height: CHART_H }}>
        {guess !== undefined ? (
          <div className="flex w-8 flex-col justify-end" style={{ height: CHART_H }}>
            <div
              className="w-full rounded-t-xs border-[1.5px] border-dashed border-w-ink-2"
              style={{ height: (clamp(guess, 0, yMax) / yMax) * CHART_H, ...motionStyle(reducedMotion, "height") }}
            />
          </div>
        ) : null}
        <TruthBar p={truth} yMax={yMax} reducedMotion={reducedMotion} show={showTruth} />
      </div>
      <span className="max-w-20 text-center text-small leading-tight text-w-ink-2 italic">{label}</span>
    </div>
  );
}

// ── predict ──────────────────────────────────────────────────────────────────────────────

function Predict(p: Props) {
  const { props } = p;
  const n = props.tokens.length;
  const probs = useMemo(() => {
    const v = p.value?.probs;
    return v && v.length === n ? v : props.tokens.map(() => 0);
  }, [p.value?.probs, n, props.tokens]);
  const used = sum(probs);
  const left = Math.max(0, 1 - used);
  const interactive = p.mode !== "review" && !!p.onChange;
  const showTruth = p.mode === "review" || !props.hideTruth;
  const otherLabel = props.otherLabel ?? "everything else";
  const [wobble, setWobble] = useState<number | null>(null);
  const endWobble = useCallback(() => setWobble(null), []);

  const setAt = (i: number, raw: number) => {
    if (!interactive) return;
    const others = used - (probs[i] ?? 0);
    const cap = Math.max(0, 1 - others);
    let v = clamp(snap(raw, 0.01), 0, 1);
    if (v > cap + 1e-9) {
      v = snap(cap, 0.01) > cap + 1e-9 ? Math.floor(cap * 100) / 100 : snap(cap, 0.01);
      setWobble(i);
      p.announce(`Budget full. ${tokenLabel(props.tokens[i]?.text ?? "")} can go up to ${pct(cap)}.`);
    }
    if (v === probs[i]) return;
    const next = probs.map((x, j) => (j === i ? v : x));
    p.onChange?.({ probs: next });
    const remaining = Math.max(0, 1 - sum(next));
    p.announce(`${tokenLabel(props.tokens[i]?.text ?? "")}: ${pct(v)}. ${pct(remaining)} left for ${otherLabel}.`);
  };

  return (
    <div className="flex flex-col gap-3">
      <Context text={props.context} />
      <BudgetMeter used={used} reducedMotion={p.reducedMotion} />
      <div className="relative ml-10" style={{ height: CHART_H + 40 }}>
        <div className="absolute inset-x-0 top-0" style={{ height: CHART_H }}>
          <Gridlines yMax={1} />
        </div>
        <div className="relative flex items-start gap-3">
          {props.tokens.map((t, i) => (
            <GuessColumn
              key={t.text}
              label={tokenLabel(t.text)}
              value={probs[i] ?? 0}
              onSet={(v) => setAt(i, v)}
              interactive={interactive}
              wobble={wobble === i}
              onWobbleEnd={endWobble}
              reducedMotion={p.reducedMotion}
              truth={t.p}
              showTruth={showTruth}
              yMax={1}
            />
          ))}
          <OtherColumn
            label={otherLabel}
            guess={left}
            truth={otherMass(props.tokens)}
            yMax={1}
            showTruth={showTruth}
            reducedMotion={p.reducedMotion}
          />
        </div>
      </div>
      <Legend showTruth={showTruth} />
    </div>
  );
}

function BudgetMeter({ used, reducedMotion }: { used: number; reducedMotion: boolean }) {
  const full = used >= 0.995;
  return (
    <div className="flex items-center gap-3 text-small text-w-ink-2" data-budget={Math.round(used * 100)}>
      <span className="shrink-0">You have 100% to share</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-pill bg-surface-sunk" aria-hidden="true">
        <div
          className="absolute inset-y-0 left-0 rounded-pill"
          style={{
            width: `${clamp(used, 0, 1) * 100}%`,
            background: "var(--w-1)",
            ...motionStyle(reducedMotion, "width", "var(--dur-quick)"),
          }}
        />
      </div>
      <span className={cn("w-24 shrink-0 text-right tabular", full ? "text-w-ink" : "")}>
        {full ? "all shared" : `${pct(1 - used)} left`}
      </span>
    </div>
  );
}

function GuessColumn(p: {
  label: string;
  value: number;
  onSet: (v: number) => void;
  interactive: boolean;
  wobble: boolean;
  onWobbleEnd: () => void;
  reducedMotion: boolean;
  truth: number;
  showTruth: boolean;
  yMax: number;
}) {
  const track = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const { wobble, reducedMotion, onWobbleEnd } = p;
  useEffect(() => {
    if (!wobble) return;
    const el = bar.current;
    if (reducedMotion || !el || typeof el.animate !== "function") {
      onWobbleEnd();
      return;
    }
    // Budget full: a small wobble (Web Animations, so no inline <style> is needed under the app CSP).
    const a = el.animate(
      [
        { transform: "none" },
        { transform: "translateY(-5px)" },
        { transform: "translateY(2px)" },
        { transform: "none" },
      ],
      { duration: 300, easing: "ease-out" },
    );
    a.onfinish = onWobbleEnd;
    return () => a.cancel();
  }, [wobble, reducedMotion, onWobbleEnd]);
  const { handlers, dragging } = useDragPoint({
    areaRef: track,
    disabled: !p.interactive,
    onMove: (_x, y) => p.onSet((1 - y) * p.yMax),
  });
  const h = (clamp(p.value, 0, p.yMax) / p.yMax) * CHART_H;
  return (
    <div className="flex min-w-16 flex-1 flex-col items-center gap-2" data-column={p.label}>
      <div className="flex items-end gap-1" style={{ height: CHART_H }}>
        <div
          ref={track}
          role="slider"
          tabIndex={p.interactive ? 0 : -1}
          aria-label={`Your guess for “${p.label}”`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p.value * 100)}
          aria-valuetext={`${pct(p.value)}`}
          aria-readonly={!p.interactive || undefined}
          className={cn(
            "group relative flex w-8 touch-none flex-col justify-end rounded-xs outline-offset-4",
            p.interactive && "cursor-ns-resize",
          )}
          style={{ height: CHART_H }}
          {...handlers}
          onKeyDown={(e) => {
            if (!p.interactive) return;
            const d = arrowDelta(e);
            let next: number | null = null;
            if (d && d[1] !== 0) next = p.value - d[1] * 0.01;
            else if (d) next = p.value + d[0] * 0.01;
            else if (e.key === "PageUp") next = p.value + 0.1;
            else if (e.key === "PageDown") next = p.value - 0.1;
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = 1;
            if (next === null) return;
            e.preventDefault();
            p.onSet(next);
          }}
        >
          <div
            className={cn(
              "absolute inset-0 rounded-xs bg-surface-sunk/70 transition-opacity",
              p.interactive ? "opacity-100" : "opacity-0",
            )}
            aria-hidden="true"
          />
          <div
            ref={bar}
            className="relative w-full rounded-t-xs"
            style={{
              height: h,
              background:
                "repeating-linear-gradient(135deg, var(--w-1) 0 6px, color-mix(in srgb, var(--w-1) 78%, var(--w-ground)) 6px 9px)",
              ...(dragging ? { transition: "none" } : motionStyle(p.reducedMotion, "height", "var(--dur-quick)")),
            }}
          >
            {p.interactive ? (
              <span
                aria-hidden="true"
                className="absolute -top-2 left-1/2 flex h-3 w-9 -translate-x-1/2 items-center justify-center rounded-pill border-[1.5px] border-ink bg-surface shadow-1 group-focus-visible:border-focus"
              >
                <span className="h-0.5 w-4 rounded-pill bg-ink-3" />
              </span>
            ) : null}
          </div>
          <span
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-micro font-semibold text-w-ink tabular"
            style={{ bottom: h + (p.interactive ? 12 : 2) }}
          >
            {pct(p.value)}
          </span>
        </div>
        <TruthBar p={p.truth} yMax={p.yMax} reducedMotion={p.reducedMotion} show={p.showTruth} />
      </div>
      <span className="text-center text-body font-semibold text-w-ink">{p.label}</span>
    </div>
  );
}

function Legend({ showTruth, guessLabel = "your guess" }: { showTruth: boolean; guessLabel?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-small text-w-ink-2" aria-hidden="true">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block size-3 rounded-xs"
          style={{ background: "repeating-linear-gradient(135deg, var(--w-1) 0 3px, transparent 3px 5px)" }}
        />
        {guessLabel}
      </span>
      {showTruth ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-xs bg-sea" />
          the model
        </span>
      ) : null}
    </div>
  );
}

// ── rank ─────────────────────────────────────────────────────────────────────────────────

function Rank(p: Props) {
  const { props } = p;
  const root = useRef<HTMLDivElement>(null);
  const [buttons] = useButtonsMode();
  const start = useMemo(() => initialRanking(props.tokens), [props.tokens]);
  const texts = new Set(props.tokens.map((t) => t.text));
  const restored = p.value?.ranking;
  const ranking =
    restored &&
    restored.length === texts.size &&
    new Set(restored).size === texts.size &&
    restored.every((t) => texts.has(t))
      ? restored
      : start;
  const interactive = p.mode !== "review" && !!p.onChange;
  const showTruth = p.mode === "review" || !props.hideTruth;
  const truth = truthRanking(props.tokens);
  const byText = new Map(props.tokens.map((t) => [t.text, t]));
  const targets = ranking.map((_, i) => ({ id: `pos-${i}`, label: `position ${i + 1} of ${ranking.length}` }));

  const moveTo = (text: string, index: number) => {
    const next = ranking.filter((t) => t !== text);
    next.splice(clamp(index, 0, next.length), 0, text);
    p.onChange?.({ ranking: next });
  };
  const kit = usePickPlace({
    rootRef: root,
    targets,
    itemLabel: (t) => tokenLabel(t),
    locate: (t) => `pos-${ranking.indexOf(t)}`,
    onPlace: (t, target) => moveTo(t, Number(target.slice(4))),
    announce: p.announce,
    disabled: !interactive,
    verb: "moved to",
  });
  const goal = p.goal?.kind === "rank" ? p.goal : undefined;
  const yMax = Math.min(1, Math.max(0.2, Math.ceil(Math.max(...props.tokens.map((t) => t.p)) * 11) / 10));

  return (
    <div className="flex flex-col gap-3" ref={root}>
      <Context text={props.context} />
      <div className="flex items-start gap-4">
        <div
          className="flex w-20 shrink-0 flex-col justify-between self-stretch py-2 text-small text-w-ink-2"
          aria-hidden="true"
        >
          <span>most likely</span>
          <span>least likely</span>
        </div>
        <ol className="flex flex-1 flex-col gap-2" aria-label="Your ranking, most likely first">
          {ranking.map((text, i) => {
            const t = byText.get(text);
            const inTop = goal ? i < goal.topK : false;
            const truthIndex = truth.indexOf(text);
            return (
              <li
                key={text}
                {...kit.targetProps(`pos-${i}`)}
                className={cn(
                  "relative flex items-center gap-3 rounded-key",
                  kit.held &&
                    kit.over === `pos-${i}` &&
                    kit.held !== text &&
                    "outline-2 outline-dashed outline-sea outline-offset-2",
                )}
              >
                <span className="w-6 text-right text-small font-semibold text-w-ink-2 tabular">{i + 1}</span>
                <button
                  type="button"
                  {...kit.itemProps(text)}
                  disabled={!interactive}
                  aria-label={`${tokenLabel(text)}, position ${i + 1}`}
                  className={cn(
                    "flex h-11 min-w-36 items-center gap-2 rounded-key border-[1.5px] border-ink bg-surface px-4 text-left text-body font-semibold text-ink shadow-key-rest transition-shadow duration-press",
                    interactive && "cursor-grab active:cursor-grabbing",
                    kit.held === text && "shadow-2 ring-2 ring-sea",
                    goal && inTop && p.mode !== "review" && "border-w-1",
                  )}
                >
                  <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" className="text-ink-3">
                    <g fill="currentColor">
                      <circle cx="2.5" cy="3" r="1.2" />
                      <circle cx="7.5" cy="3" r="1.2" />
                      <circle cx="2.5" cy="7" r="1.2" />
                      <circle cx="7.5" cy="7" r="1.2" />
                      <circle cx="2.5" cy="11" r="1.2" />
                      <circle cx="7.5" cy="11" r="1.2" />
                    </g>
                  </svg>
                  {tokenLabel(text)}
                </button>
                {buttons && interactive ? (
                  <span className="flex gap-1">
                    <KeyButton
                      size="sm"
                      aria-label={`Move ${tokenLabel(text)} up`}
                      disabled={i === 0}
                      onClick={() => moveTo(text, i - 1)}
                    >
                      ↑
                    </KeyButton>
                    <KeyButton
                      size="sm"
                      aria-label={`Move ${tokenLabel(text)} down`}
                      disabled={i === ranking.length - 1}
                      onClick={() => moveTo(text, i + 1)}
                    >
                      ↓
                    </KeyButton>
                  </span>
                ) : null}
                {showTruth && t ? (
                  <span className="flex flex-1 items-center gap-2" data-truth={t.p}>
                    <span
                      className="h-3 rounded-r-xs bg-sea"
                      style={{
                        width: `${(t.p / yMax) * 60}%`,
                        ...motionStyle(p.reducedMotion, "width", "var(--dur-reveal)"),
                      }}
                    />
                    <span className="text-small font-semibold text-sea-text tabular">{pct(t.p)}</span>
                    {p.mode === "review" && truthIndex !== i ? (
                      <ReviewNote>model's #{truthIndex + 1}</ReviewNote>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      {goal && p.mode !== "review" ? <p className="text-small text-w-ink-2">Your top {goal.topK} count.</p> : null}
    </div>
  );
}

// ── temperature (and explore toys) ───────────────────────────────────────────────────────

function Temperature(p: Props) {
  const { props } = p;
  const interactive = p.mode !== "review";
  const fallback = props.temperature ?? 1;
  const [localT, setLocalT] = useState(fallback);
  const t = p.value?.temperature ?? (p.onChange ? fallback : localT);
  const [draws, setDraws] = useState<number[]>([]);
  const [rolls, setRolls] = useState(0);
  const dist = applyTemperature(props.tokens, t);
  const labels = [...props.tokens.map((x) => tokenLabel(x.text)), props.otherLabel ?? "everything else"];
  const goal = p.goal?.kind === "temperature" ? p.goal : undefined;

  const setT = (v: number) => {
    if (p.onChange) p.onChange({ temperature: v });
    else setLocalT(v);
    setDraws([]);
    const top = dist.indexOf(Math.max(...dist));
    const next = applyTemperature(props.tokens, v);
    p.announce(`Temperature ${v.toFixed(2)}. ${labels[top] ?? ""} now ${pct(next[top] ?? 0)}.`);
  };

  const sample = () => {
    const r = rng(hashString(`${props.context}|${t.toFixed(2)}|${rolls}`));
    const out = Array.from({ length: 10 }, () => drawIndex(dist, r()));
    setRolls((n) => n + 1);
    setDraws(out);
    const counts = labels.map((_, i) => out.filter((x) => x === i).length);
    p.announce(
      `Sampled 10: ${labels
        .map((l, i) => (counts[i] ? `${l} ${counts[i]}` : ""))
        .filter(Boolean)
        .join(", ")}.`,
    );
  };

  const counts = labels.map((_, i) => draws.filter((x) => x === i).length);
  const nearest = (props.samples ?? []).reduce<{ temperature: number; outputs: string[] } | undefined>(
    (best, s) => (!best || Math.abs(s.temperature - t) < Math.abs(best.temperature - t) ? s : best),
    undefined,
  );
  const mood = t < 0.45 ? "decisive" : t < 0.85 ? "focused" : t < 1.25 ? "as trained" : t < 1.6 ? "loose" : "wild";

  return (
    <div className="flex flex-col gap-3">
      <Context text={props.context} />
      <div className="relative ml-10" style={{ height: CHART_H + 40 }}>
        <div className="absolute inset-x-0 top-0" style={{ height: CHART_H }}>
          <Gridlines yMax={1} />
        </div>
        <div className="relative flex items-start gap-3">
          {dist.map((q, i) => (
            <div key={labels[i]} className="flex min-w-14 flex-1 flex-col items-center gap-2" data-column={labels[i]}>
              <div className="relative flex w-10 flex-col justify-end" style={{ height: CHART_H }}>
                <div
                  className="absolute inset-x-0 flex flex-wrap-reverse justify-center gap-0.5"
                  style={{ bottom: q * CHART_H + 18 }}
                  aria-hidden="true"
                >
                  {Array.from({ length: counts[i] ?? 0 }, (_, k) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: identical dots.
                    <span key={k} className="size-2 rounded-pill bg-w-ink" />
                  ))}
                </div>
                <span
                  className="absolute left-1/2 -translate-x-1/2 text-micro font-semibold text-sea-text tabular"
                  style={{ bottom: q * CHART_H + 2 }}
                >
                  {pct(q)}
                </span>
                <div
                  className={cn("w-full rounded-t-xs", i === dist.length - 1 && "opacity-60")}
                  style={{
                    height: q * CHART_H,
                    background: "var(--sea)",
                    ...motionStyle(p.reducedMotion, "height", "var(--dur-base)"),
                  }}
                />
              </div>
              <span
                className={cn(
                  "text-center text-body text-w-ink",
                  i === dist.length - 1 ? "text-small text-w-ink-2 italic" : "font-semibold",
                )}
              >
                {labels[i]}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-6">
        <Slider
          className="min-w-64 flex-1"
          label={
            <span className="inline-flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d="M6 2.5a1.5 1.5 0 0 1 3 0V8a3 3 0 1 1-3 0z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </svg>
              Temperature <span className="text-w-ink-2 italic">({mood})</span>
            </span>
          }
          ariaLabel="Temperature"
          value={t}
          min={TEMPERATURE_MIN}
          max={TEMPERATURE_MAX}
          step={0.05}
          disabled={!interactive}
          onChange={setT}
          format={(v) => v.toFixed(2)}
          band={p.mode === "review" && goal ? goal.range : undefined}
        />
        <KeyButton onClick={sample} disabled={!interactive && p.mode !== "review"}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="5.5" cy="5.5" r="1.2" fill="currentColor" />
            <circle cx="10.5" cy="10.5" r="1.2" fill="currentColor" />
            <circle cx="8" cy="8" r="1.2" fill="currentColor" />
          </svg>
          Sample 10
        </KeyButton>
      </div>
      {draws.length ? (
        <p className="text-small text-w-ink-2" data-draws>
          {props.context}{" "}
          {draws.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one roll of draws.
            <span key={i} className="mr-1 inline-block rounded-xs bg-surface-2 px-1 text-ink">
              {labels[d]}
            </span>
          ))}
        </p>
      ) : null}
      {nearest ? (
        <div className="flex flex-col gap-1 text-small text-w-ink-2" data-samples={nearest.temperature}>
          <span>Real continuations sampled at {nearest.temperature.toFixed(1)}:</span>
          <ul className="flex flex-col gap-0.5">
            {nearest.outputs.slice(0, 4).map((o) => (
              <li key={o} className="voice-casual text-w-ink">
                {props.context}
                <span className="text-sea-text">{o}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ── view ─────────────────────────────────────────────────────────────────────────────────

function StaticBars({
  tokens,
  otherLabel,
  reducedMotion,
  picked,
  onPick,
  interactive,
  highlight,
  revealed = true,
}: {
  tokens: { text: string; p: number }[];
  otherLabel: string;
  reducedMotion: boolean;
  picked?: string;
  onPick?: (text: string) => void;
  interactive?: boolean;
  highlight?: string;
  revealed?: boolean;
}) {
  const other = otherMass(tokens);
  const yMax = Math.min(1, Math.max(0.2, Math.ceil(Math.max(...tokens.map((t) => t.p), other) * 11) / 10));
  return (
    <div className="relative ml-10" style={{ height: CHART_H + 40 }}>
      <div className="absolute inset-x-0 top-0" style={{ height: CHART_H }}>
        <Gridlines yMax={yMax} />
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move focus within the radio group. */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: labelled only when it is a radiogroup. */}
      <div
        className="relative flex items-start gap-3"
        role={onPick ? "radiogroup" : undefined}
        aria-label={onPick ? "Pick a token" : undefined}
        onKeyDown={onPick ? radioGroupKeys : undefined}
      >
        {tokens.map((t) => {
          const h = revealed ? (t.p / yMax) * CHART_H : 0;
          const isPicked = picked === t.text;
          const body = (
            <>
              <div className="relative flex w-10 flex-col justify-end" style={{ height: CHART_H }}>
                {revealed ? (
                  <span
                    className="absolute left-1/2 -translate-x-1/2 text-micro font-semibold text-sea-text tabular"
                    style={{ bottom: h + 2 }}
                  >
                    {pct(t.p)}
                  </span>
                ) : null}
                <div
                  className={cn(
                    "w-full rounded-t-xs",
                    (isPicked || highlight === t.text) && "ring-2 ring-w-ink ring-offset-2 ring-offset-w-ground",
                  )}
                  style={{
                    height: h,
                    background: "var(--sea)",
                    ...motionStyle(reducedMotion, "height", "var(--dur-move)"),
                  }}
                />
              </div>
              <span
                className={cn(
                  "text-center text-body font-semibold text-w-ink",
                  isPicked && "underline decoration-2 underline-offset-4",
                )}
              >
                {tokenLabel(t.text)}
              </span>
            </>
          );
          return onPick ? (
            // biome-ignore lint/a11y/useSemanticElements: an answer-key button acting as a radio (WAI-ARIA radio group pattern).
            <button
              key={t.text}
              type="button"
              role="radio"
              aria-checked={isPicked}
              aria-label={`${tokenLabel(t.text)}${revealed ? `, ${pct(t.p)}` : ""}`}
              disabled={!interactive}
              onClick={() => onPick(t.text)}
              data-column={tokenLabel(t.text)}
              className="flex min-w-14 flex-1 flex-col items-center gap-2 rounded-key p-1 hover:bg-surface-2/60 disabled:cursor-default disabled:hover:bg-transparent"
            >
              {body}
            </button>
          ) : (
            <div
              key={t.text}
              className="flex min-w-14 flex-1 flex-col items-center gap-2"
              data-column={tokenLabel(t.text)}
            >
              {body}
            </div>
          );
        })}
        <OtherColumn label={otherLabel} truth={other} yMax={yMax} showTruth={revealed} reducedMotion={reducedMotion} />
      </div>
    </div>
  );
}

function ViewOnly(p: Props) {
  return (
    <div className="flex flex-col gap-3">
      <Context text={p.props.context} />
      <StaticBars
        tokens={p.props.tokens}
        otherLabel={p.props.otherLabel ?? "everything else"}
        reducedMotion={p.reducedMotion}
      />
    </div>
  );
}

// ── pick ─────────────────────────────────────────────────────────────────────────────────

function Pick(p: Props) {
  const { props } = p;
  const picked = p.value?.picked;
  const interactive = p.mode !== "review" && !!p.onChange;
  const solution = p.mode === "review" ? (p.goal?.kind === "pick" ? p.goal.token : p.solution?.picked) : undefined;
  return (
    <div className="flex flex-col gap-3">
      <Context text={props.context} pending={picked ? tokenLabel(picked) : undefined} />
      <StaticBars
        tokens={props.tokens}
        otherLabel={props.otherLabel ?? "everything else"}
        reducedMotion={p.reducedMotion}
        picked={picked}
        highlight={solution}
        interactive={interactive}
        revealed={!props.hideTruth || p.mode === "review"}
        onPick={(text) => {
          p.onChange?.({ picked: text });
          p.announce(`Picked ${tokenLabel(text)}.`);
        }}
      />
      {solution && picked !== solution ? <ReviewNote>The model's pick: {tokenLabel(solution)}</ReviewNote> : null}
    </div>
  );
}

// ── loop ─────────────────────────────────────────────────────────────────────────────────

type Phase = "idle" | "scored" | "picked";

function Loop(p: Props) {
  const { props } = p;
  const appended = p.value?.appended ?? [];
  const run = appended.length;
  const maxRuns = (props.loop?.steps.length ?? 0) + 1;
  const step = loopStep(props, Math.min(run, maxRuns - 1));
  const [phase, setPhase] = useState<Phase>(p.mode === "review" ? "scored" : "idle");
  const [choice, setChoice] = useState<string | null>(null);
  const [rolls, setRolls] = useState(0);
  const interactive = p.mode !== "review" && !!p.onChange;
  const done = run >= maxRuns;
  const goalRuns = p.goal?.kind === "loop" ? p.goal.runs : undefined;
  const contextNow = props.context;

  const score = () => {
    setPhase("scored");
    const top = truthRanking(step.tokens)[0];
    p.announce(`Scored. Top candidate: ${tokenLabel(top ?? "")}.`);
  };
  const roll = () => {
    const weights = [...step.tokens.map((t) => t.p)];
    const i = drawIndex(weights, rng(hashString(`${step.context}|${run}|${rolls}`))());
    setRolls((n) => n + 1);
    const tok = step.tokens[i]?.text ?? step.tokens[0]?.text ?? "";
    setChoice(tok);
    setPhase("picked");
    p.announce(`Rolled ${tokenLabel(tok)}.`);
  };
  const pick = (text: string) => {
    setChoice(text);
    setPhase("picked");
    p.announce(`Picked ${tokenLabel(text)}. Append it to continue.`);
  };
  const append = () => {
    if (!choice) return;
    const next = [...appended, choice];
    p.onChange?.({ appended: next });
    setChoice(null);
    setPhase("idle");
    p.announce(`Appended ${tokenLabel(choice)}. Run ${next.length}${goalRuns ? ` of ${goalRuns}` : ""}.`);
  };

  const pathNote =
    run > 0 &&
    props.loop?.steps[run - 1] &&
    !props.loop.steps[run - 1]?.context.endsWith(appended[run - 1] ?? "\u0000");

  return (
    <div className="flex flex-col gap-3">
      <Context text={contextNow} appended={appended} pending={choice ? tokenLabel(choice) : undefined} />
      <div className="flex flex-wrap items-center gap-3">
        <PhaseKey
          n={1}
          label="Score"
          active={phase === "idle" && !done}
          done={phase !== "idle"}
          onClick={score}
          disabled={!interactive || done || phase !== "idle"}
        />
        <span aria-hidden="true" className="text-w-ink-2">
          →
        </span>
        <PhaseKey
          n={2}
          label="Pick"
          active={phase === "scored"}
          done={phase === "picked"}
          onClick={roll}
          disabled={!interactive || phase !== "scored"}
          hint="roll the dice, or tap a bar"
        />
        <span aria-hidden="true" className="text-w-ink-2">
          →
        </span>
        <PhaseKey
          n={3}
          label="Append"
          active={phase === "picked"}
          done={false}
          onClick={append}
          disabled={!interactive || phase !== "picked"}
        />
        <span
          className="ml-auto inline-flex items-center gap-2 rounded-sm bg-surface-2 px-3 py-1 text-small text-ink"
          data-runs={run}
        >
          Runs <strong className="tabular">{run}</strong>
          {goalRuns ? <span className="text-ink-3">/ {goalRuns}</span> : null}
        </span>
      </div>
      {done ? (
        <p className="text-small text-w-ink-2">That's every step we computed. The real model just keeps going.</p>
      ) : (
        <StaticBars
          tokens={step.tokens}
          otherLabel={props.otherLabel ?? "everything else"}
          reducedMotion={p.reducedMotion}
          revealed={phase !== "idle"}
          picked={choice ?? undefined}
          interactive={interactive && phase === "scored"}
          onPick={pick}
        />
      )}
      {pathNote ? (
        <ReviewNote>The computed path continued from “{props.loop?.steps[run - 1]?.context}”.</ReviewNote>
      ) : null}
    </div>
  );
}

function PhaseKey(p: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
  disabled: boolean;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <KeyButton
      onClick={p.onClick}
      disabled={p.disabled}
      className={cn(p.active && "ring-2 ring-sea ring-offset-2 ring-offset-w-ground")}
      title={p.hint}
    >
      <span className="inline-flex size-5 items-center justify-center rounded-xs border border-current text-micro tabular">
        {p.n}
      </span>
      {p.label}
      {p.done ? <span className="sr-only">(done)</span> : null}
    </KeyButton>
  );
}
