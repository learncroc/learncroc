/** ice-core (climate-science): a vertical core cylinder in banded layers, trapped bubbles, a depth ruler. */
import { rng } from "../lib/random";
import { type BackdropArtProps, INK, inkStroke, LINE, line, scatter } from "./kit";

export function IceCoreArt({ seed, width, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:ice`);
  const cores = [b.x + 150, width + 220];
  const cw = 130;
  return (
    <g data-backdrop="ice-core">
      {cores.map((x, ci) => {
        const bands = [];
        let y = b.y + 60;
        let i = 0;
        while (y < b.y + b.h - 60 && i < 40) {
          const h = 18 + r() * 60;
          bands.push(
            <rect
              key={`b${i}`}
              x={x}
              y={y}
              width={cw}
              height={h}
              fill={line(c, (i + ci) % 3)}
              fillOpacity={i % 2 ? LINE.faint : LINE.soft}
            />,
          );
          y += h;
          i++;
        }
        const bubbles = scatter(r, 26, { x: x + 12, y: b.y + 80, w: cw - 24, h: b.h - 160 }, 40);
        return (
          <g key={x}>
            {bands}
            <rect x={x} y={b.y + 60} width={cw} height={b.h - 120} rx={cw / 2} {...inkStroke(c, INK.firm, 2.5)} />
            {bubbles.map(([bx, by], k) => (
              <circle key={`u${bx}:${by}`} cx={bx} cy={by} r={2 + (k % 4) * 1.5} {...inkStroke(c, INK.firm, 1.5)} />
            ))}
          </g>
        );
      })}
      {Array.from({ length: Math.floor((b.h - 160) / 60) }, (_, i) => {
        const y = b.y + 80 + i * 60;
        const x = (cores[0] ?? 0) + cw + 18;
        return (
          <g key={`r${y}`}>
            <path d={`M${x} ${y}H${x + (i % 5 === 0 ? 30 : 16)}`} {...inkStroke(c, INK.firm, 2)} />
            {i % 5 === 0 ? (
              <text x={x + 36} y={y + 5} fontSize={14} fill={c.ink2} fillOpacity={INK.firm}>
                {`${i * 50} m`}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}
