/**
 * pond (trail default): a meadow seen from above. Faint ripple rings around the middle of the map, a pond
 * with lily pads above the map's right end, a second small pad pool off the bottom-right, a dragonfly and tufts of
 * grass scattered between the paths. Water and grass are the world's own line colours mixed into the ground.
 */
import { mix } from "../lib/color";
import { rng } from "../lib/random";
import { type BackdropArtProps, blobPath, INK, inkStroke, line, scatter } from "./kit";

/** Three grass blades from (x, y), leaning by `lean`. */
const tuft = (x: number, y: number, s: number, lean: number) =>
  `M${x - 3} ${y}q${-2 + lean} ${-s * 0.6} ${-6 + lean} ${-s}` +
  `M${x} ${y}q${lean} ${-s * 0.75} ${1 + lean} ${-s * 1.25}` +
  `M${x + 3} ${y}q${3 + lean} ${-s * 0.55} ${8 + lean} ${-s * 0.85}`;

/** A lily pad: a disc with a notch to its centre. */
function pad(cx: number, cy: number, r: number, turn: number): string {
  const a0 = turn + 0.32;
  const a1 = turn - 0.32 + Math.PI * 2;
  const p = (a: number) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
  return `M${cx} ${cy}L${p(a0)}A${r} ${r} 0 1 1 ${p(a1)}Z`;
}

export function PondArt({ seed, width, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:pond`);
  const water = mix(c.ground, line(c, 1), c.mode === "dark" ? 0.3 : 0.26);
  const shore = mix(c.ground, line(c, 1), 0.4);
  const leaf = mix(c.ground, line(c, 3), 0.42);
  const grass = mix(c.ground, line(c, 3), 0.55);
  const cx = width / 2;
  const cy = height / 2;
  // Close enough to the map to show in a fitted view; the mask keeps it clear of every path and label.
  const pond = { x: width * 0.82 - r() * 60, y: -150, rx: 130, ry: 70 };
  const pool = { x: width + 200 + r() * 60, y: height + 120, rx: 70, ry: 44 };
  const tufts = scatter(r, 22, b, 150).filter(
    ([x, y]) => Math.hypot((x - pond.x) / (pond.rx + 40), (y - pond.y) / (pond.ry + 40)) > 1,
  );
  const fly = { x: pond.x - pond.rx - 70, y: pond.y + 30 };
  return (
    <g data-backdrop="pond">
      {/* Ripple rings: the meadow's contour around the middle of the map. */}
      {[0.62, 0.8, 0.98, 1.16].map((k) => (
        <ellipse
          key={k}
          cx={cx}
          cy={cy}
          rx={(width / 2 + 220) * k}
          ry={(height / 2 + 160) * k}
          {...inkStroke(c, INK.faint, 2)}
        />
      ))}
      <path d={blobPath(pond.x, pond.y, pond.rx, pond.ry, r, 10, 0.12)} fill={water} />
      <path
        d={blobPath(pond.x, pond.y, pond.rx + 6, pond.ry + 5, r, 10, 0.1)}
        fill="none"
        stroke={shore}
        strokeWidth={2}
      />
      {[
        [pond.x - 40, pond.y - 20, 18],
        [pond.x + 50, pond.y + 22, 24],
      ].map(([x, y, s]) => (
        <path key={`${x}`} d={pad(x as number, y as number, s as number, r() * 6)} fill={leaf} />
      ))}
      <g stroke={c.ground} strokeOpacity={0.7} strokeWidth={2.5} strokeLinecap="round" fill="none">
        <path d={`M${pond.x - 90} ${pond.y - 30}q14 -8 28 0`} />
        <path d={`M${pond.x + 10} ${pond.y - 50}q12 -7 24 0`} />
        <path d={`M${pond.x - 20} ${pond.y + 40}q10 -6 20 0`} />
      </g>
      <path d={blobPath(pool.x, pool.y, pool.rx, pool.ry, r, 9, 0.14)} fill={leaf} fillOpacity={0.7} />
      {/* A dragonfly over the water. */}
      <g transform={`translate(${fly.x} ${fly.y}) rotate(-24)`}>
        <path d="M-16 0H16" stroke={line(c, 0)} strokeOpacity={0.55} strokeWidth={3} strokeLinecap="round" />
        <circle cx={16} cy={0} r={3.4} fill={line(c, 0)} fillOpacity={0.55} />
        <ellipse cx={6} cy={-7} rx={9} ry={4} fill={c.ground} stroke={c.ink2} strokeOpacity={INK.firm} />
        <ellipse cx={6} cy={7} rx={9} ry={4} fill={c.ground} stroke={c.ink2} strokeOpacity={INK.firm} />
      </g>
      <g stroke={grass} strokeWidth={2.4} strokeLinecap="round" fill="none">
        {tufts.map(([x, y], i) => (
          <path key={`${x.toFixed(0)}:${y.toFixed(0)}`} d={tuft(x, y, 16 + (i % 3) * 5, (i % 2 ? 1 : -1) * 2)} />
        ))}
      </g>
    </g>
  );
}
