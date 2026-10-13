/** factory-floor (programming-basics): conveyor belts, gear outlines and a blueprint title block. */
import { rng } from "../lib/random";
import { type BackdropArtProps, INK, inkStroke, LINE, line, scatter } from "./kit";

function gear(x: number, y: number, r: number, teeth: number): string {
  let d = "";
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.82;
    d += `${i === 0 ? "M" : "L"}${(x + Math.cos(a0) * rr).toFixed(1)} ${(y + Math.sin(a0) * rr).toFixed(1)}L${(x + Math.cos(a1) * rr).toFixed(1)} ${(y + Math.sin(a1) * rr).toFixed(1)}`;
  }
  return `${d}ZM${x + r * 0.3} ${y}A${r * 0.3} ${r * 0.3} 0 1 0 ${x - r * 0.3} ${y}A${r * 0.3} ${r * 0.3} 0 1 0 ${x + r * 0.3} ${y}`;
}

export function FactoryFloorArt({ uid, seed, width, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:factory`);
  const rollers = `${uid}-rollers`;
  const belts = [height * 0.18, height * 0.82, -180, height + 200];
  const gears = scatter(r, 6, { x: b.x + 140, y: b.y + 140, w: b.w - 280, h: b.h - 280 }, 280);
  const tb = { x: width + 120, y: height + 80, w: 300, h: 150 };
  return (
    <g data-backdrop="factory-floor">
      <defs>
        <pattern id={rollers} width={36} height={40} patternUnits="userSpaceOnUse">
          <circle cx={18} cy={20} r={9} fill="none" stroke={c.ink2} strokeOpacity={INK.soft} strokeWidth={2} />
        </pattern>
      </defs>
      {belts.map((y, i) => (
        <g key={y}>
          <rect
            x={b.x + 60}
            y={y - 20}
            width={b.w - 120}
            height={40}
            rx={20}
            fill={line(c, i)}
            fillOpacity={LINE.faint}
          />
          <rect x={b.x + 60} y={y - 20} width={b.w - 120} height={40} rx={20} {...inkStroke(c, INK.soft, 2)} />
          <rect x={b.x + 80} y={y - 20} width={b.w - 160} height={40} fill={`url(#${rollers})`} />
        </g>
      ))}
      {gears.map(([x, y], i) => (
        <path key={`g${x}`} d={gear(x, y, 50 + (i % 3) * 22, 10 + (i % 3) * 2)} {...inkStroke(c, INK.firm, 2)} />
      ))}
      <rect x={tb.x} y={tb.y} width={tb.w} height={tb.h} {...inkStroke(c, INK.firm, 2)} />
      <path
        d={`M${tb.x} ${tb.y + 50}H${tb.x + tb.w}M${tb.x} ${tb.y + 100}H${tb.x + tb.w}M${tb.x + 180} ${tb.y + 50}V${tb.y + tb.h}`}
        {...inkStroke(c, INK.soft, 1.5)}
      />
      <text
        x={tb.x + 16}
        y={tb.y + 34}
        fontSize={20}
        fontWeight={700}
        letterSpacing={3}
        fill={c.ink2}
        fillOpacity={INK.firm}
      >
        BIT'S FACTORY
      </text>
      <text x={tb.x + 16} y={tb.y + 82} fontSize={14} fill={c.ink2} fillOpacity={INK.firm}>
        SHEET 1 OF 1
      </text>
      <text x={tb.x + 196} y={tb.y + 82} fontSize={14} fill={c.ink2} fillOpacity={INK.firm}>
        SCALE 1:1
      </text>
    </g>
  );
}
