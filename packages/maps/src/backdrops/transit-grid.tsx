/**
 * transit-grid (metro default): city blocks, a river winding through, a park and faint district names,
 * the way a transit map shows the city underneath.
 */
import { smoothPath } from "../lib/geometry";
import { rng } from "../lib/random";
import { type BackdropArtProps, blobPath, INK, inkStroke, LINE, line, scatter } from "./kit";

const DISTRICTS = ["NORTH BANK", "OLD TOWN", "THE YARDS", "HARBOUR", "MARKET", "WEST END"];

export function TransitGridArt({ uid, seed, width, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:transit`);
  const blocks = `${uid}-blocks`;
  const river: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    river.push([b.x + b.w * t, height * (0.75 + Math.sin(t * 5 + r() * 0.6) * 0.2)]);
  }
  const parks = scatter(r, 3, { x: 0, y: 0, w: width, h: height }, 300);
  const names = scatter(r, 5, { x: b.x + 160, y: b.y + 160, w: b.w - 320, h: b.h - 320 }, 320);
  return (
    <g data-backdrop="transit-grid">
      <defs>
        <pattern id={blocks} width={84} height={64} patternUnits="userSpaceOnUse">
          <rect x={6} y={6} width={72} height={52} rx={6} fill={c.ink2} fillOpacity={INK.faint} />
        </pattern>
      </defs>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={`url(#${blocks})`} />
      {parks.map(([x, y], i) => (
        <path key={`p${x}`} d={blobPath(x, y, 110 + i * 20, 80, r, 8, 0.2)} fill={line(c, 3)} fillOpacity={LINE.soft} />
      ))}
      <path d={smoothPath(river, 0.6)} stroke={line(c, 0)} strokeOpacity={LINE.firm} strokeWidth={70} fill="none" />
      <path d={smoothPath(river, 0.6)} {...inkStroke(c, INK.faint, 2)} transform="translate(0 37)" />
      <path d={smoothPath(river, 0.6)} {...inkStroke(c, INK.faint, 2)} transform="translate(0 -37)" />
      {names.map(([x, y], i) => (
        <text
          key={`n${x}`}
          x={x}
          y={y}
          textAnchor="middle"
          fontSize={18}
          fontWeight={700}
          letterSpacing={6}
          fill={c.ink2}
          fillOpacity={INK.firm}
        >
          {DISTRICTS[i % DISTRICTS.length]}
        </text>
      ))}
    </g>
  );
}
