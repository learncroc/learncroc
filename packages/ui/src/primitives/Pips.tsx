import { type CSSProperties, useEffect, useRef, useState } from "react";
import { cn } from "../cn";

/**
 * One checkpoint question's pip:
 * - `pending` (ahead): a hollow ink-3 ring;
 * - `right`: a Sea disc with a tick drawn in;
 * - `hinted`: right with a first hint (it still counts): the same, plus a small iris dot;
 * - `missed`: a sunk disc, a dashed ink-3 ring and a tiny curved revisit arrow. Never red, never ember, no X.
 */
export type PipState = "pending" | "right" | "hinted" | "missed";

export interface PipsProps {
  /** One entry per checkpoint question (3–5), in order. */
  results: PipState[];
  /** Index of the question on screen: a breathing Sea ring. */
  current?: number;
  /** The pass sweep: every pip turns Lumen, left to right, 90 ms apart. Lumen only on a pass. */
  sweep?: boolean;
  /** Accessible label, e.g. "Question 2 of 4, 1 right". */
  label: string;
  /** Pip diameter in px (default 14, 10 px gap). */
  size?: number;
  className?: string;
}

const SWEEP_STAGGER_MS = 90;
/** The revisit glyph: a small curved arrow coming back on itself. */
const REVISIT = "M4.6 9.2a2.9 2.9 0 1 0 .3-3.7M4.6 3.9l.3 1.7-1.7.3";
const TICK = "M4.2 7.2l1.9 1.9 3.8-4";

/**
 * Checkpoint progress pips. Shape carries the meaning, colour backs it up: a tick for
 * right, a revisit arrow for missed, an empty ring for ahead. On a pass, `sweep` turns every pip Lumen.
 */
export function Pips({ results, current, sweep, label, size = 14, className }: PipsProps) {
  // Remember which pips were already right, so only a newly landed one plays its tick and spring.
  const seen = useRef<PipState[] | null>(null);
  const [landing, setLanding] = useState<Set<number>>(new Set());
  useEffect(() => {
    const prev = seen.current;
    seen.current = results;
    if (!prev) return;
    const fresh = new Set<number>();
    results.forEach((r, i) => {
      if ((r === "right" || r === "hinted") && prev[i] !== r) fresh.add(i);
    });
    if (fresh.size === 0) return;
    setLanding(fresh);
    const t = setTimeout(() => setLanding(new Set()), 400);
    return () => clearTimeout(t);
  }, [results]);

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("flex items-center", className)}
      style={{ gap: Math.round(size * 0.72) }}
      data-sweep={sweep || undefined}
    >
      {results.map((r, i) => (
        <Pip
          // biome-ignore lint/suspicious/noArrayIndexKey: pips are positional
          key={i}
          state={r}
          current={i === current && !sweep}
          sweep={!!sweep}
          sweepAt={i * SWEEP_STAGGER_MS}
          land={landing.has(i)}
          size={size}
        />
      ))}
    </div>
  );
}

function Pip({
  state,
  current,
  sweep,
  sweepAt,
  land,
  size,
}: {
  state: PipState;
  current: boolean;
  sweep: boolean;
  sweepAt: number;
  land: boolean;
  size: number;
}) {
  const right = state === "right" || state === "hinted";
  const missed = state === "missed";
  // Colours: Sea while answering, Lumen only in the pass sweep.
  const discFill = sweep ? "var(--lumen)" : right ? "var(--sea)" : missed ? "var(--surface-sunk)" : "var(--surface)";
  const ringStroke = sweep ? "var(--lumen-text)" : right ? "var(--sea)" : current ? "var(--sea)" : "var(--ink-3)";
  const tickStroke = sweep ? "var(--lumen-text)" : "var(--surface)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden
      data-pip={state}
      data-current={current || undefined}
      data-land={land || undefined}
      className="lm-pip shrink-0 overflow-visible"
      style={{ "--lm-sweep-at": `${sweep ? sweepAt : 0}ms` } as CSSProperties}
    >
      {current ? <circle data-part="halo" cx={7} cy={7} r={9.5} fill="var(--sea)" opacity={0.2} /> : null}
      <circle
        data-part="disc"
        cx={7}
        cy={7}
        r={right || sweep ? 6.5 : 6}
        fill={discFill}
        stroke={ringStroke}
        strokeWidth={current && !right ? 2 : 1.5}
        strokeDasharray={missed && !sweep ? "2 1.6" : undefined}
      />
      {right ? (
        <path
          data-part="tick"
          d={TICK}
          fill="none"
          stroke={tickStroke}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {missed ? (
        <path
          data-part="revisit"
          d={REVISIT}
          fill="none"
          stroke={sweep ? "var(--lumen-text)" : "var(--ink-2)"}
          strokeWidth={1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {state === "hinted" ? (
        <circle data-part="hint" cx={12.2} cy={1.8} r={2} fill="var(--iris)" stroke="var(--surface)" strokeWidth={1} />
      ) : null}
    </svg>
  );
}

export interface GateChargeProps {
  /** Segments in the frame: one per checkpoint question. */
  total: number;
  /** Right answers so far: that many segments glow Sea. */
  lit: number;
  /** The pass: the whole frame turns Lumen (left to right). */
  open?: boolean;
  /** px, default 48. */
  size?: number;
  /** Accessible name; omit with `decorative`. */
  title?: string;
  decorative?: boolean;
  className?: string;
}

/** The gate frame (left post up, across the top, right post down), drawn as one path split into segments. */
const FRAME = "M8 42V12q0-4 4-4h24q4 0 4 4v30";
const GAP = 0.14;

/**
 * The gate charges: a small copy of the gate whose frame segments light in Sea, one per
 * right answer. Mastery isn't earned until the pass, so the frame turns Lumen only when `open`.
 */
export function GateCharge({ total, lit, open, size = 48, title, decorative, className }: GateChargeProps) {
  const n = Math.max(1, total);
  const label = title ?? (open ? "Gate open" : `Gate charging: ${Math.min(lit, n)} of ${n}`);
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: the <title> is rendered whenever the glyph is not decorative
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      data-open={open || undefined}
      data-lit={Math.min(lit, n)}
      className={cn("lm-gate-charge shrink-0 overflow-visible", className)}
      fill="none"
      strokeLinecap="round"
      {...a11y}
    >
      {decorative ? null : <title>{label}</title>}
      {/* ground line and the bar across, ajar until open */}
      <path d="M3 42h42" stroke="var(--line-strong)" strokeWidth={2} />
      {Array.from({ length: n }, (_, i) => {
        const on = open || i < lit;
        const stroke = open ? "var(--lumen-text)" : on ? "var(--sea)" : "var(--line-strong)";
        return (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            key={i}
            data-part="segment"
            data-on={on || undefined}
            d={FRAME}
            pathLength={n}
            stroke={stroke}
            strokeWidth={on ? 4 : 3}
            strokeDasharray={`${1 - GAP} ${n - 1 + GAP}`}
            strokeDashoffset={-(i + GAP / 2)}
            style={{ "--lm-sweep-at": `${open ? i * SWEEP_STAGGER_MS : 0}ms` } as CSSProperties}
          />
        );
      })}
      {open ? (
        <>
          {/* swung open: the leaf folds back against the left post, short Lumen rays */}
          <path d="M12 16l-6 14" stroke="var(--lumen-text)" strokeWidth={3} />
          <path d="M24 1.5v3.5M15 4l1.6 2.6M33 4l-1.6 2.6" stroke="var(--lumen-text)" strokeWidth={2} />
        </>
      ) : (
        <path d="M12 22l23-6" stroke={lit > 0 ? "var(--sea)" : "var(--ink-3)"} strokeWidth={3} />
      )}
    </svg>
  );
}
