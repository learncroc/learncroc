/** mountain (money-snowball): a mountain silhouette with a switchback path, pines, and a snowball at the foot. */
import { rng } from "../lib/random";
import { type BackdropArtProps, INK, inkStroke, LINE, line, scatter } from "./kit";

export function MountainArt({ seed, width, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:mountain`);
  const peak = { x: width * 0.6, y: b.y + 80 };
  const foot = height + 300;
  const left = b.x + 40;
  const right = b.x + b.w - 40;
  const ridge = `M${left} ${foot}L${peak.x - 300} ${peak.y + 260}L${peak.x - 160} ${peak.y + 180}L${peak.x} ${peak.y}L${peak.x + 140} ${peak.y + 150}L${peak.x + 260} ${peak.y + 120}L${right} ${foot}Z`;
  const snow = `M${peak.x - 80} ${peak.y + 90}L${peak.x} ${peak.y}L${peak.x + 70} ${peak.y + 75}L${peak.x + 30} ${peak.y + 60}L${peak.x} ${peak.y + 90}L${peak.x - 40} ${peak.y + 70}Z`;
  let path = `M${peak.x - 40} ${foot - 20}`;
  for (let i = 0; i < 7; i++) {
    const y = foot - 20 - (i + 1) * ((foot - peak.y - 100) / 7);
    path += `L${peak.x + (i % 2 ? -1 : 1) * (220 - i * 26)} ${y}`;
  }
  const pines = scatter(r, 24, { x: b.x + 60, y: height * 0.55, w: b.w - 120, h: foot - height * 0.55 }, 70);
  return (
    <g data-backdrop="mountain">
      <path d={ridge} fill={c.ink2} fillOpacity={INK.faint} />
      <path d={ridge} {...inkStroke(c, INK.soft, 2.5)} />
      <path d={snow} fill={c.ink2} fillOpacity={INK.soft} />
      <path d={path} {...inkStroke(c, INK.firm, 2)} strokeDasharray="10 9" />
      {pines.map(([x, y]) => (
        <path
          key={`p${Math.round(x)}`}
          d={`M${x} ${y - 30}L${x + 13} ${y}H${x - 13}ZM${x} ${y}V${y + 8}`}
          fill={line(c, 2)}
          fillOpacity={LINE.firm}
          stroke={c.ink2}
          strokeOpacity={INK.faint}
        />
      ))}
      <circle cx={peak.x - 120} cy={foot - 60} r={48} fill={line(c, 4)} fillOpacity={LINE.soft} />
      <circle cx={peak.x - 120} cy={foot - 60} r={48} {...inkStroke(c, INK.firm, 2.5)} />
      <path
        d={`M${peak.x - 200} ${foot - 30}Q${peak.x - 170} ${foot - 50} ${peak.x - 168} ${foot - 30}`}
        {...inkStroke(c, INK.soft, 2)}
      />
    </g>
  );
}
