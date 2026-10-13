/**
 * terrain (atlas default): rolling hills drawn as contour rings, a lake, a ridge of peaks along the top
 * and small stands of trees.
 */
import type { ReactNode } from "react";
import { rng } from "../lib/random";
import { type BackdropArtProps, blobPath, INK, inkStroke, LINE, line, scatter } from "./kit";

export function TerrainArt({ seed, width, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:terrain`);
  const hills = scatter(r, 6, { x: b.x + 200, y: b.y + 200, w: b.w - 400, h: b.h - 400 }, 360);
  const lake = { x: width * (0.2 + r() * 0.6), y: height + 160 };
  const peaks: ReactNode[] = [];
  const n = Math.ceil(b.w / 120);
  let d = `M${b.x} ${b.y + 220}`;
  for (let i = 0; i < n; i++) {
    const x = b.x + i * 120;
    const top = b.y + 90 + r() * 70;
    d += `L${x + 60} ${top}L${x + 120} ${b.y + 200 + r() * 30}`;
    if (i % 2 === 0)
      peaks.push(
        <path
          key={i}
          d={`M${x + 48} ${top + 22}L${x + 60} ${top}L${x + 72} ${top + 22}`}
          {...inkStroke(c, INK.soft, 2)}
        />,
      );
  }
  const groves = scatter(r, 9, { x: b.x + 100, y: b.y + 260, w: b.w - 200, h: b.h - 360 }, 200);
  return (
    <g data-backdrop="terrain">
      <path d={`${d}V${b.y}H${b.x}Z`} fill={c.ink2} fillOpacity={INK.faint} />
      <path d={d} {...inkStroke(c, INK.soft, 2)} />
      {peaks}
      {hills.map(([x, y], i) => {
        const rx = 150 + r() * 120;
        const ry = rx * (0.55 + r() * 0.25);
        return (
          <g key={`h${x}`}>
            {[1, 0.72, 0.46, 0.22].map((k) => (
              <path
                key={k}
                d={blobPath(x, y, rx * k, ry * k, rng(`${seed}:hill:${i}:${k}`), 9, 0.14)}
                {...inkStroke(c, INK.faint + k * 0.04, 1.6)}
              />
            ))}
          </g>
        );
      })}
      <path d={blobPath(lake.x, lake.y, 180, 70, r, 10, 0.12)} fill={line(c, 0)} fillOpacity={LINE.soft} />
      <path d={blobPath(lake.x, lake.y, 180, 70, r, 10, 0.12)} {...inkStroke(c, INK.faint, 2)} />
      {groves.map(([x, y]) => (
        <g key={`g${x}`}>
          {[
            [0, 0],
            [16, 6],
            [-14, 8],
          ].map(([dx, dy]) => (
            <path
              key={`${dx}`}
              d={`M${x + (dx ?? 0)} ${y + (dy ?? 0) - 14}L${x + (dx ?? 0) + 8} ${y + (dy ?? 0) + 4}H${x + (dx ?? 0) - 8}Z`}
              fill={line(c, 2)}
              fillOpacity={LINE.firm}
            />
          ))}
        </g>
      ))}
    </g>
  );
}
