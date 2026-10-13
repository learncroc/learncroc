/** staff-town (music-by-ear): a skyline built from piano keys, with five staff lines drifting across. */
import { rng } from "../lib/random";
import { type BackdropArtProps, INK, inkStroke, LINE, line } from "./kit";

export function StaffTownArt({ seed, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:staff`);
  const base = height + 260;
  const keys = [];
  const kw = 46;
  const n = Math.ceil(b.w / kw);
  for (let i = 0; i < Math.min(n, 60); i++) {
    const x = b.x + i * kw;
    const h = 120 + Math.round(r() * 5) * 40;
    keys.push(
      <g key={`k${i}`}>
        <rect x={x + 2} y={base - h} width={kw - 4} height={h} rx={4} fill={line(c, i % 5)} fillOpacity={LINE.faint} />
        <rect x={x + 2} y={base - h} width={kw - 4} height={h} rx={4} {...inkStroke(c, INK.soft, 1.5)} />
        {i % 7 !== 2 && i % 7 !== 6 ? (
          <rect x={x + kw - 12} y={base - h} width={22} height={h * 0.55} rx={3} fill={c.ink2} fillOpacity={INK.soft} />
        ) : null}
      </g>,
    );
  }
  const staff = (y0: number, amp: number, phase: number) =>
    [0, 1, 2, 3, 4].map((i) => {
      let d = "";
      for (let s = 0; s <= 24; s++) {
        const x = b.x + (b.w * s) / 24;
        const y = y0 + i * 16 + Math.sin(s * 0.5 + phase) * amp;
        d += `${s === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      return <path key={`${y0}-${i}`} d={d} {...inkStroke(c, INK.soft, 1.5)} />;
    });
  const notes = [0.15, 0.32, 0.5, 0.68, 0.85].map((t, i) => {
    const x = b.x + b.w * t;
    const y = -160 + Math.sin(t * 12 + 1) * 30 + (i % 3) * 16;
    return (
      <g key={`n${t}`}>
        <ellipse
          cx={x}
          cy={y}
          rx={11}
          ry={8}
          transform={`rotate(-20 ${x} ${y})`}
          fill={c.ink2}
          fillOpacity={INK.firm}
        />
        <path d={`M${x + 10} ${y - 2}V${y - 52}`} {...inkStroke(c, INK.firm, 2)} />
      </g>
    );
  });
  return (
    <g data-backdrop="staff-town">
      {staff(-200, 26, r() * 3)}
      {staff(height * 0.5 - 30, 40, r() * 3)}
      {notes}
      {keys}
    </g>
  );
}
