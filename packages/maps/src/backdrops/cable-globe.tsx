/** cable-globe (how-the-internet-works): an equirectangular world outline with undersea cable arcs. */
import { rng } from "../lib/random";
import { type BackdropArtProps, closedSmooth, INK, inkStroke, LINE, line, place } from "./kit";

/** Very loose continents, normalised to a 2:1 world box. */
const LANDS: readonly (readonly (readonly [number, number])[])[] = [
  // North America
  [
    [0.05, 0.18],
    [0.2, 0.12],
    [0.3, 0.2],
    [0.28, 0.33],
    [0.22, 0.42],
    [0.2, 0.5],
    [0.14, 0.42],
    [0.08, 0.3],
  ],
  // South America
  [
    [0.25, 0.52],
    [0.33, 0.56],
    [0.36, 0.66],
    [0.31, 0.82],
    [0.28, 0.9],
    [0.26, 0.74],
    [0.24, 0.6],
  ],
  // Europe
  [
    [0.45, 0.18],
    [0.52, 0.14],
    [0.58, 0.2],
    [0.55, 0.3],
    [0.48, 0.32],
    [0.45, 0.26],
  ],
  // Africa
  [
    [0.45, 0.36],
    [0.55, 0.36],
    [0.62, 0.48],
    [0.58, 0.66],
    [0.53, 0.78],
    [0.5, 0.62],
    [0.44, 0.48],
  ],
  // Asia
  [
    [0.58, 0.14],
    [0.75, 0.1],
    [0.9, 0.18],
    [0.88, 0.32],
    [0.8, 0.42],
    [0.7, 0.46],
    [0.62, 0.36],
    [0.6, 0.24],
  ],
  // Australia
  [
    [0.8, 0.64],
    [0.9, 0.62],
    [0.93, 0.72],
    [0.86, 0.78],
    [0.79, 0.72],
  ],
];

const CABLES: readonly [number, number, number, number][] = [
  [0.28, 0.28, 0.46, 0.24],
  [0.22, 0.42, 0.47, 0.42],
  [0.33, 0.6, 0.5, 0.56],
  [0.56, 0.5, 0.8, 0.4],
  [0.62, 0.42, 0.86, 0.66],
  [0.12, 0.36, 0.84, 0.3],
];

export function CableGlobeArt({ seed, width, height, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:globe`);
  const w = Math.max(width * 1.3, 1100);
  const h = w / 2;
  const x = width / 2 - w / 2;
  const y = height / 2 - h / 2;
  return (
    <g data-backdrop="cable-globe">
      {[0.25, 0.5, 0.75].map((t) => (
        <path
          key={`lat${t}`}
          d={`M${x} ${y + h * t}H${x + w}`}
          {...inkStroke(c, INK.faint, 1.5)}
          strokeDasharray="4 10"
        />
      ))}
      {[1, 2, 3, 4, 5].map((i) => (
        <path
          key={`lon${i}`}
          d={`M${x + (w * i) / 6} ${y}V${y + h}`}
          {...inkStroke(c, INK.faint, 1.5)}
          strokeDasharray="4 10"
        />
      ))}
      {LANDS.map((land, i) => {
        const d = closedSmooth(place(land, x, y, w, h), 0.4);
        return (
          <g key={`l${land[0]?.[0]}:${land[0]?.[1]}`}>
            <path d={d} fill={line(c, i)} fillOpacity={LINE.faint} />
            <path d={d} {...inkStroke(c, INK.firm, 2)} />
          </g>
        );
      })}
      {CABLES.map(([a, b2, c2, d2], i) => {
        const x1 = x + a * w;
        const y1 = y + b2 * h;
        const x2 = x + c2 * w;
        const y2 = y + d2 * h;
        const bow = 40 + r() * 60;
        return (
          <g key={`c${a}:${b2}:${c2}`}>
            <path
              d={`M${x1} ${y1}Q${(x1 + x2) / 2} ${(y1 + y2) / 2 + bow} ${x2} ${y2}`}
              stroke={line(c, i + 1)}
              strokeOpacity={LINE.firm}
              strokeWidth={3}
              fill="none"
            />
            <circle cx={x1} cy={y1} r={5} fill={c.ink2} fillOpacity={INK.firm} />
            <circle cx={x2} cy={y2} r={5} fill={c.ink2} fillOpacity={INK.firm} />
          </g>
        );
      })}
    </g>
  );
}
