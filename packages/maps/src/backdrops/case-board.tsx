/** case-board (bayesian-thinking): pinned index cards, string between pins (never red) and a magnifier. */
import { rng } from "../lib/random";
import { type BackdropArtProps, INK, inkStroke, LINE, line, scatter } from "./kit";

export function CaseBoardArt({ seed, width, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:case`);
  const cards = scatter(r, 12, { x: b.x + 120, y: b.y + 120, w: b.w - 240, h: b.h - 240 }, 230).map(([x, y], i) => ({
    x,
    y,
    rot: (r() - 0.5) * 14,
    i,
  }));
  const pins = cards.map((k) => [k.x, k.y - 40] as const);
  const strings = [];
  for (let i = 0; i + 1 < pins.length; i += 2) {
    const a = pins[i] as readonly [number, number];
    const bb = pins[(i + 3) % pins.length] as readonly [number, number];
    strings.push(
      <path
        key={`str${i}`}
        d={`M${a[0]} ${a[1]}Q${(a[0] + bb[0]) / 2} ${(a[1] + bb[1]) / 2 + 40} ${bb[0]} ${bb[1]}`}
        stroke={line(c, 1)}
        strokeOpacity={LINE.firm}
        strokeWidth={2.5}
        fill="none"
      />,
    );
  }
  const mag = { x: width + 180, y: height + 120 };
  return (
    <g data-backdrop="case-board">
      {cards.map((k) => (
        <g key={`c${k.i}`} transform={`translate(${k.x} ${k.y}) rotate(${k.rot})`}>
          <rect x={-70} y={-48} width={140} height={96} rx={3} fill={c.ink2} fillOpacity={INK.faint} />
          <rect x={-70} y={-48} width={140} height={96} rx={3} {...inkStroke(c, INK.soft, 1.5)} />
          <path d="M-56 -18H56M-56 2H56M-56 22H30" {...inkStroke(c, INK.faint, 1.5)} />
        </g>
      ))}
      {strings}
      {pins.map(([x, y]) => (
        <circle key={`p${Math.round(x)}`} cx={x} cy={y} r={7} fill={c.ink2} fillOpacity={INK.firm} />
      ))}
      <circle cx={mag.x} cy={mag.y} r={70} {...inkStroke(c, INK.firm, 6)} />
      <path d={`M${mag.x + 50} ${mag.y + 50}L${mag.x + 140} ${mag.y + 140}`} {...inkStroke(c, INK.firm, 14)} />
    </g>
  );
}
