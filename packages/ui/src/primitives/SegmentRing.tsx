export interface SegmentRingProps {
  /** Segments (cards in a section, items in a Relight). */
  total: number;
  /** Segments known (lit). */
  powered: number;
  /** Index of the current stage. */
  current?: number;
  /** px, default 96. */
  size?: number;
  label: string;
}

/**
 * Mastery shown: a ring of segments with gaps. Powered segments are Lumen (lit knowledge), the current
 * one gets a Sea outline, the rest are hollow; the count sits in the middle. For the Relight header and
 * the badge. Not used during a checkpoint (the gate charges in Sea there: `GateCharge`, `Pips`).
 */
export function SegmentRing({ total, powered, current, size = 96, label }: SegmentRingProps) {
  const n = Math.max(total, 1);
  const stroke = Math.max(6, Math.round(size / 12));
  const r = size / 2 - stroke;
  const c = size / 2;
  const gap = n > 1 ? 10 : 0; // degrees
  const sweep = 360 / n - gap;
  const arc = (i: number) => {
    const a0 = ((-90 + i * (360 / n) + gap / 2) * Math.PI) / 180;
    const a1 = a0 + (sweep * Math.PI) / 180;
    const large = sweep > 180 ? 1 : 0;
    const p = (a: number) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
    return n === 1
      ? `M${c} ${c - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`
      : `M${p(a0)}A${r} ${r} 0 ${large} 1 ${p(a1)}`;
  };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <title>{label}</title>
      {Array.from({ length: n }, (_, i) => {
        const state = i < powered ? "powered" : i === current ? "current" : "rest";
        return (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            key={i}
            d={arc(i)}
            fill="none"
            strokeLinecap="round"
            strokeWidth={stroke}
            data-segment={state}
            stroke={state === "powered" ? "var(--lumen)" : state === "current" ? "var(--sea)" : "var(--line-strong)"}
            style={state === "powered" ? { filter: "drop-shadow(0 0 4px rgb(255 194 61 / .55))" } : undefined}
          />
        );
      })}
      <text
        x={c}
        y={c}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--ink)"
        style={{ fontSize: Math.round(size / 4.2), fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
        aria-hidden
      >
        {powered}/{total}
      </text>
    </svg>
  );
}
