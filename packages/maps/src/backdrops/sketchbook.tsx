/**
 * sketchbook (article maps, sketchbook default): a spiral binding down the left, a margin line, tape on
 * the corners, a coffee ring, and three margin doodles picked from the pack id.
 */
import type { ReactNode } from "react";
import { hashString, rng } from "../lib/random";
import { type BackdropArtProps, blobPath, INK, inkStroke, LINE, line } from "./kit";

const DOODLES = ["star", "spiral", "arrow", "cloud", "bulb", "cube", "question", "flower"] as const;
type Doodle = (typeof DOODLES)[number];

function doodle(kind: Doodle, x: number, y: number, s: number): string {
  switch (kind) {
    case "star":
      return `M${x} ${y - s}L${x + s * 0.3} ${y - s * 0.3}L${x + s} ${y - s * 0.25}L${x + s * 0.45} ${y + s * 0.2}L${x + s * 0.62} ${y + s}L${x} ${y + s * 0.55}L${x - s * 0.62} ${y + s}L${x - s * 0.45} ${y + s * 0.2}L${x - s} ${y - s * 0.25}L${x - s * 0.3} ${y - s * 0.3}Z`;
    case "spiral": {
      let d = `M${x} ${y}`;
      for (let i = 1; i <= 26; i++) {
        const a = i * 0.55;
        const rr = (i / 26) * s;
        d += `L${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`;
      }
      return d;
    }
    case "arrow":
      return `M${x - s} ${y + s * 0.4}Q${x} ${y - s * 0.8} ${x + s} ${y - s * 0.1}M${x + s * 0.55} ${y - s * 0.45}L${x + s} ${y - s * 0.1}L${x + s * 0.5} ${y + s * 0.2}`;
    case "cloud":
      return `M${x - s} ${y + s * 0.3}a${s * 0.35} ${s * 0.35} 0 0 1 ${s * 0.3} -${s * 0.6}a${s * 0.45} ${s * 0.45} 0 0 1 ${s * 0.85} -${s * 0.1}a${s * 0.35} ${s * 0.35} 0 0 1 ${s * 0.7} ${s * 0.4}a${s * 0.3} ${s * 0.3} 0 0 1 -${s * 0.1} ${s * 0.6}Z`;
    case "bulb":
      return `M${x - s * 0.3} ${y + s * 0.5}V${y + s * 0.2}A${s * 0.6} ${s * 0.6} 0 1 1 ${x + s * 0.3} ${y + s * 0.2}V${y + s * 0.5}ZM${x - s * 0.25} ${y + s * 0.7}H${x + s * 0.25}M${x - s * 0.2} ${y + s * 0.9}H${x + s * 0.2}`;
    case "cube":
      return `M${x - s * 0.6} ${y - s * 0.2}L${x} ${y - s * 0.6}L${x + s * 0.6} ${y - s * 0.2}V${y + s * 0.5}L${x} ${y + s * 0.9}L${x - s * 0.6} ${y + s * 0.5}ZM${x - s * 0.6} ${y - s * 0.2}L${x} ${y + s * 0.2}L${x + s * 0.6} ${y - s * 0.2}M${x} ${y + s * 0.2}V${y + s * 0.9}`;
    case "question":
      return `M${x - s * 0.4} ${y - s * 0.4}A${s * 0.45} ${s * 0.45} 0 1 1 ${x + s * 0.1} ${y + s * 0.1}Q${x} ${y + s * 0.2} ${x} ${y + s * 0.45}M${x} ${y + s * 0.75}V${y + s * 0.8}`;
    case "flower": {
      let d = "";
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const px = x + Math.cos(a) * s * 0.45;
        const py = y + Math.sin(a) * s * 0.45;
        d += `M${(px + s * 0.3).toFixed(1)} ${py.toFixed(1)}A${s * 0.3} ${s * 0.3} 0 1 0 ${(px - s * 0.3).toFixed(1)} ${py.toFixed(1)}A${s * 0.3} ${s * 0.3} 0 1 0 ${(px + s * 0.3).toFixed(1)} ${py.toFixed(1)}`;
      }
      return d;
    }
  }
}

export function SketchbookArt({ uid, seed, width, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:sketch`);
  const rings = `${uid}-rings`;
  const spineX = -170;
  const marginX = -96;
  const h = hashString(seed);
  const picks = [0, 1, 2].map((i) => DOODLES[(h >>> (i * 5)) % DOODLES.length] as Doodle);
  const doodleSpots: [number, number][] = [
    [marginX - 34, height * 0.22],
    [width + 120, -90],
    [width * 0.55, height + 140],
  ];
  const tape = (x: number, y: number, rot: number, key: string): ReactNode => (
    <rect
      key={key}
      x={-48}
      y={-14}
      width={96}
      height={28}
      transform={`translate(${x} ${y}) rotate(${rot})`}
      fill={c.ink2}
      fillOpacity={INK.faint}
      stroke={c.ink2}
      strokeOpacity={INK.faint}
      strokeDasharray="3 4"
    />
  );
  const ring = { x: width + 60 + r() * 120, y: height * (0.6 + r() * 0.3), r: 64 };

  return (
    <g data-backdrop="sketchbook">
      <defs>
        <pattern id={rings} width={40} height={34} patternUnits="userSpaceOnUse">
          <ellipse
            cx={22}
            cy={17}
            rx={16}
            ry={7}
            fill="none"
            stroke={c.ink2}
            strokeOpacity={INK.firm}
            strokeWidth={3}
          />
          <circle cx={34} cy={17} r={4} fill={c.ink2} fillOpacity={INK.soft} />
        </pattern>
      </defs>
      {/* Binding and the edge of the page. */}
      <rect x={spineX - 20} y={b.y} width={40} height={b.h} fill={`url(#${rings})`} />
      <path d={`M${spineX + 34} ${b.y}V${b.y + b.h}`} {...inkStroke(c, INK.soft, 2)} />
      <path d={`M${marginX} ${b.y}V${b.y + b.h}`} stroke={line(c, 1)} strokeOpacity={LINE.firm} strokeWidth={2} />
      {tape(-40, -60, -32, "t1")}
      {tape(width + 40, -60, 30, "t2")}
      {tape(-40, height + 60, 28, "t3")}
      {tape(width + 40, height + 60, -26, "t4")}
      {/* Coffee ring: two wobbly circles and a drip. */}
      <path d={blobPath(ring.x, ring.y, ring.r, ring.r, r, 12, 0.05)} {...inkStroke(c, INK.soft, 7)} />
      <path d={blobPath(ring.x, ring.y, ring.r - 9, ring.r - 9, r, 12, 0.06)} {...inkStroke(c, INK.faint, 2)} />
      <circle cx={ring.x + ring.r + 16} cy={ring.y + 22} r={6} fill={c.ink2} fillOpacity={INK.faint} />
      {picks.map((k, i) => {
        const [x, y] = doodleSpots[i] as [number, number];
        return <path key={k + String(i)} d={doodle(k, x, y, 34)} {...inkStroke(c, INK.firm, 2.5)} data-doodle={k} />;
      })}
      {/* A pencilled title rule at the top of the page. */}
      <path d={`M${0} ${-150}H${Math.min(width, 520)}`} {...inkStroke(c, INK.soft, 2)} />
    </g>
  );
}
