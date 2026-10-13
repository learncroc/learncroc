/**
 * iberia-road (spanish-tapas-bar): the Iberian outline, a winding road under the atlas routes, olive
 * trees, a sun disc in the fifth line colour, and the Giralda (Sevilla) and a Madrid skyline.
 */
import { smoothPath } from "../lib/geometry";
import { rng } from "../lib/random";
import { type BackdropArtProps, closedSmooth, INK, inkStroke, LINE, line, place, scatter } from "./kit";

/** A loose Iberian peninsula, normalised to its bounding box (x east, y south). */
const IBERIA: readonly (readonly [number, number])[] = [
  [0.02, 0.14],
  [0.2, 0.06],
  [0.42, 0.07],
  [0.62, 0.06],
  [0.78, 0.12],
  [0.92, 0.16],
  [0.97, 0.28],
  [0.86, 0.42],
  [0.8, 0.55],
  [0.84, 0.66],
  [0.74, 0.8],
  [0.6, 0.88],
  [0.48, 0.97],
  [0.38, 0.9],
  [0.24, 0.86],
  [0.12, 0.88],
  [0.08, 0.72],
  [0.04, 0.5],
  [0.06, 0.32],
];

export function IberiaRoadArt({ seed, width, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:iberia`);
  // The peninsula sits a little larger than the map, centred.
  const pw = Math.max(width * 1.25, 900);
  const ph = Math.max(height * 1.35, 700);
  const px = width / 2 - pw / 2;
  const py = height / 2 - ph / 2;
  const coast = closedSmooth(place(IBERIA, px, py, pw, ph), 0.45);

  // A winding road from the west coast to the east, bowing up and down across the map.
  const roadPts: [number, number][] = [];
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    roadPts.push([px + pw * (0.08 + t * 0.82), height * (0.5 + Math.sin(t * Math.PI * 2.2 + r()) * 0.32)]);
  }
  const road = smoothPath(roadPts, 0.6);

  const trees = scatter(r, 26, { x: px + 60, y: py + 60, w: pw - 120, h: ph - 120 }, 90);
  const sun = { x: px + pw * 0.86, y: py - 40, r: 110 };

  // Giralda: a tall square tower with a belfry and a lantern, near the south-west (Sevilla).
  const gx = px + pw * 0.3;
  const gy = py + ph * 0.8;
  const giralda = `M${gx - 22} ${gy}V${gy - 150}H${gx - 16}V${gy - 190}H${gx - 10}V${gy - 214}L${gx} ${gy - 236}L${gx + 10} ${gy - 214}V${gy - 190}H${gx + 16}V${gy - 150}H${gx + 22}V${gy}Z`;
  // Madrid: a palace front with two domes, near the centre-north.
  const mx = px + pw * 0.5;
  const my = py + ph * 0.3;
  const madrid = `M${mx - 120} ${my}V${my - 50}H${mx - 90}V${my - 70}Q${mx - 75} ${my - 100} ${mx - 60} ${my - 70}V${my - 50}H${mx + 60}V${my - 70}Q${mx + 75} ${my - 100} ${mx + 90} ${my - 70}V${my - 50}H${mx + 120}V${my}Z`;

  return (
    <g data-backdrop="iberia-road">
      <path d={coast} fill={line(c, 2)} fillOpacity={LINE.faint} />
      <path d={coast} {...inkStroke(c, INK.firm, 3)} />
      <circle cx={sun.x} cy={sun.y} r={sun.r} fill={line(c, 4)} fillOpacity={LINE.firm} />
      <circle cx={sun.x} cy={sun.y} r={sun.r + 26} {...inkStroke(c, INK.faint, 2)} strokeDasharray="4 14" />
      <path d={road} stroke={c.ink2} strokeOpacity={INK.faint} strokeWidth={26} fill="none" strokeLinecap="round" />
      <path d={road} {...inkStroke(c, INK.firm, 2)} strokeDasharray="14 16" />
      {trees.map(([x, y]) => (
        <g key={`${Math.round(x)}-${Math.round(y)}`}>
          <path d={`M${x} ${y + 16}V${y + 4}`} {...inkStroke(c, INK.soft, 3)} />
          <ellipse cx={x} cy={y} rx={15} ry={11} fill={line(c, 2)} fillOpacity={LINE.firm} />
          <ellipse cx={x} cy={y} rx={15} ry={11} {...inkStroke(c, INK.soft, 1.5)} />
        </g>
      ))}
      <path d={giralda} fill={c.ink2} fillOpacity={INK.soft} />
      <path d={madrid} fill={c.ink2} fillOpacity={INK.soft} />
      <text
        x={gx}
        y={gy + 30}
        textAnchor="middle"
        fontSize={22}
        fontStyle="italic"
        fill={c.ink2}
        fillOpacity={INK.firm}
      >
        Sevilla
      </text>
      <text
        x={mx}
        y={my + 30}
        textAnchor="middle"
        fontSize={22}
        fontStyle="italic"
        fill={c.ink2}
        fillOpacity={INK.firm}
      >
        Madrid
      </text>
      {/* A few waves off the coast, in the bleed. */}
      {[0, 1, 2, 3].map((i) => {
        const x = b.x + 80 + i * 70;
        const y = py + ph * (0.35 + i * 0.12);
        return <path key={i} d={`M${x} ${y}q15 -10 30 0t30 0t30 0`} {...inkStroke(c, INK.soft, 2)} />;
      })}
    </g>
  );
}
