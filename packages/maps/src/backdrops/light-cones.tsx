/** light-cones (special-relativity): a sparse starfield, two faint light cones and a platform clock. */
import { rng } from "../lib/random";
import { type BackdropArtProps, INK, inkStroke, LINE, line, scatter } from "./kit";

export function LightConesArt({ seed, width, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:cones`);
  const stars = scatter(r, 120, b, 48);
  const cones = [
    { x: width * 0.28, y: height * 0.5, s: Math.max(height * 0.7, 360) },
    { x: width * 0.78, y: height * 0.42, s: Math.max(height * 0.55, 300) },
  ];
  const clock = { x: width + 160, y: -80, r: 70 };
  return (
    <g data-backdrop="light-cones">
      {stars.map(([x, y], i) => (
        <circle
          key={`s${x}:${y}`}
          cx={x}
          cy={y}
          r={i % 7 === 0 ? 2.6 : 1.4}
          fill={c.ink2}
          fillOpacity={i % 7 === 0 ? INK.firm : INK.soft}
        />
      ))}
      {cones.map((k, i) => (
        <g key={k.x}>
          <path
            d={`M${k.x - k.s} ${k.y - k.s}L${k.x} ${k.y}L${k.x + k.s} ${k.y - k.s}Z`}
            fill={line(c, i)}
            fillOpacity={LINE.faint}
          />
          <path
            d={`M${k.x - k.s} ${k.y + k.s}L${k.x} ${k.y}L${k.x + k.s} ${k.y + k.s}Z`}
            fill={line(c, i)}
            fillOpacity={LINE.faint}
          />
          <path
            d={`M${k.x - k.s} ${k.y - k.s}L${k.x + k.s} ${k.y + k.s}M${k.x + k.s} ${k.y - k.s}L${k.x - k.s} ${k.y + k.s}`}
            {...inkStroke(c, INK.soft, 1.5)}
            strokeDasharray="6 8"
          />
          <path d={`M${k.x} ${k.y - k.s * 1.1}V${k.y + k.s * 1.1}`} {...inkStroke(c, INK.faint, 1.5)} />
        </g>
      ))}
      <circle cx={clock.x} cy={clock.y} r={clock.r} {...inkStroke(c, INK.firm, 4)} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <path
            key={`t${a.toFixed(3)}`}
            d={`M${clock.x + Math.cos(a) * clock.r * 0.82} ${clock.y + Math.sin(a) * clock.r * 0.82}L${clock.x + Math.cos(a) * clock.r * 0.94} ${clock.y + Math.sin(a) * clock.r * 0.94}`}
            {...inkStroke(c, INK.firm, 3)}
          />
        );
      })}
      <path
        d={`M${clock.x} ${clock.y}V${clock.y - clock.r * 0.6}M${clock.x} ${clock.y}L${clock.x + clock.r * 0.4} ${clock.y + clock.r * 0.2}`}
        {...inkStroke(c, INK.firm, 4)}
      />
      <path d={`M${clock.x} ${clock.y + clock.r}V${clock.y + clock.r + 120}`} {...inkStroke(c, INK.soft, 5)} />
    </g>
  );
}
