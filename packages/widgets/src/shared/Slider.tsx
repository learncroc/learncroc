/**
 * A labelled range slider used by widgets (temperature dial, plot params, wipe divider).
 * Native <input type="range"> for screen readers, with explicit key handling so arrows, Shift+arrows
 * (10×), PageUp/PageDown, Home and End behave the same in every browser.
 */
import { cn } from "@learncroc/ui";
import { type ReactNode, useId } from "react";
import { clamp, snap } from "./math";

export interface SliderProps {
  label: ReactNode;
  /** Accessible name when `label` isn't plain text. */
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange?: (v: number) => void;
  /** Human-readable value ("0.7", "45 km/h"). */
  format?: (v: number) => string;
  disabled?: boolean;
  /** A highlighted band on the track (e.g. a goal range shown in review). */
  band?: [number, number];
  /** Extra marks drawn on the track (e.g. the authored target in review). */
  marks?: { at: number; label: string }[];
  className?: string;
  /** Visual accent of the filled track. */
  tone?: "sea" | "world";
  id?: string;
}

export function Slider(p: SliderProps) {
  const autoId = useId();
  const id = p.id ?? autoId;
  const fmt = p.format ?? ((v: number) => String(v));
  const span = p.max - p.min || 1;
  const frac = clamp((p.value - p.min) / span, 0, 1);
  const set = (v: number) => {
    const next = clamp(snap(v, p.step, p.min), p.min, p.max);
    if (next !== p.value) p.onChange?.(next);
  };
  return (
    <div className={cn("flex flex-col gap-1.5", p.className)}>
      <div className="flex items-baseline justify-between gap-3 text-small">
        <label htmlFor={id} className="text-w-ink-2">
          {p.label}
        </label>
        <output htmlFor={id} className="tabular font-semibold text-w-ink">
          {fmt(p.value)}
        </output>
      </div>
      <div className="relative h-6">
        <div
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-pill bg-surface-sunk"
          aria-hidden="true"
        >
          {p.band ? (
            <div
              className="absolute inset-y-[-3px] rounded-pill border border-dashed border-sea bg-sea-soft"
              style={{
                left: `${clamp((p.band[0] - p.min) / span, 0, 1) * 100}%`,
                width: `${(clamp((p.band[1] - p.min) / span, 0, 1) - clamp((p.band[0] - p.min) / span, 0, 1)) * 100}%`,
              }}
            />
          ) : null}
          <div
            className="absolute inset-y-0 left-0 rounded-pill"
            style={{ width: `${frac * 100}%`, background: p.tone === "world" ? "var(--w-1)" : "var(--sea)" }}
          />
          {(p.marks ?? []).map((m) => (
            <span
              key={`${m.at}-${m.label}`}
              title={m.label}
              className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-w-ink"
              style={{ left: `${clamp((m.at - p.min) / span, 0, 1) * 100}%` }}
            />
          ))}
        </div>
        <input
          id={id}
          type="range"
          min={p.min}
          max={p.max}
          step={p.step}
          value={p.value}
          disabled={p.disabled}
          aria-label={p.ariaLabel}
          aria-valuetext={fmt(p.value)}
          onChange={(e) => set(Number(e.currentTarget.value))}
          onKeyDown={(e) => {
            const big = p.step * 10;
            let next: number | null = null;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") next = p.value + (e.shiftKey ? big : p.step);
            else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = p.value - (e.shiftKey ? big : p.step);
            else if (e.key === "PageUp") next = p.value + big;
            else if (e.key === "PageDown") next = p.value - big;
            else if (e.key === "Home") next = p.min;
            else if (e.key === "End") next = p.max;
            if (next === null) return;
            e.preventDefault();
            set(next);
          }}
          className="lm-range absolute inset-0 h-6 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-pill [&::-moz-range-thumb]:border-[1.5px] [&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:bg-surface [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:border-[1.5px] [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-surface [&::-webkit-slider-thumb]:shadow-[0_2px_0_var(--key-edge)]"
        />
      </div>
    </div>
  );
}
