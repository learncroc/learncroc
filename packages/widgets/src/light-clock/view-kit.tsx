/**
 * Small view helpers shared by the physics widgets (light-clock, train-scene, spacetime-diagram):
 * a controlled-answer hook, a simulation clock, a frame switch and SVG pointer maths.
 */
import { cn } from "@learncroc/ui";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

/**
 * Controlled answer with a local mirror: reads `value` when the host supplies one, otherwise keeps its own
 * state seeded by `initial`. `set` updates both and notifies the host.
 */
export function useAnswer<A>(value: A | undefined, initial: () => A, onChange?: (a: A) => void) {
  const [local, setLocal] = useState<A>(() => value ?? initial());
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    // The host restored or replaced the answer (run scratch, review): adopt it.
    setSeen(value);
    if (value !== undefined) setLocal(value);
  }
  const set = useCallback(
    (next: A) => {
      setLocal(next);
      onChange?.(next);
    },
    [onChange],
  );
  return [local, set] as const;
}

/**
 * A simulation clock in widget time units. While `playing`, advances by `rate` units per real second using
 * requestAnimationFrame. Returns the time and a setter (for steps and resets).
 */
export function useSimClock(playing: boolean, rate: number) {
  const [time, setTime] = useState(0);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  useEffect(() => {
    if (!playing || typeof requestAnimationFrame !== "function") return;
    let raf = 0;
    let prev: number | undefined;
    const tick = (now: number) => {
      if (prev !== undefined) {
        const dt = Math.min(0.1, (now - prev) / 1000);
        setTime((t) => t + dt * rateRef.current);
      }
      prev = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return [time, setTime] as const;
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** A two-or-three way switch built from toggle buttons (aria-pressed), e.g. platform ↔ train. */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of toggle buttons; fieldset styling is heavier.
    <div
      role="group"
      aria-label={props.label}
      className="inline-flex rounded-sm border border-line-strong bg-surface-2 p-0.5"
    >
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={props.value === o.value}
          disabled={props.disabled}
          onClick={() => props.onChange(o.value)}
          className={cn(
            "h-8 rounded-xs px-3 text-small font-semibold transition-colors duration-quick disabled:opacity-50",
            props.value === o.value ? "bg-ink text-surface" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Convert a pointer event to SVG user-space coordinates (falls back to bounding-box scaling). */
export function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): [number, number] {
  const ctm = typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
  if (ctm && typeof svg.createSVGPoint === "function") {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox?.baseVal;
  const w = vb?.width ? vb.width : rect.width || 1;
  const h = vb?.height ? vb.height : rect.height || 1;
  return [((clientX - rect.left) / (rect.width || 1)) * w, ((clientY - rect.top) / (rect.height || 1)) * h];
}

/** Quiet caption row under a canvas. */
export function Readout(props: { children: ReactNode; className?: string }) {
  return <p className={cn("text-small text-ink-2 tabular", props.className)}>{props.children}</p>;
}
