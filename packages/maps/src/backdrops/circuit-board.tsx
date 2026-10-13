/**
 * circuit-board (how-llms-work, circuit default): a big CPU die at the centre, bus lanes running out to
 * the edges, a heat-sink fin comb along the bottom, capacitor rows and faint silk-screen labels.
 */
import type { ReactNode } from "react";
import { rng } from "../lib/random";
import { type BackdropArtProps, INK, inkStroke, LINE, line, scatter } from "./kit";

const SILK = ["L1", "L2", "ATTN", "MLP", "EMB", "U3", "C12", "R7", "KV", "LN"];

export function CircuitBoardArt({ uid, seed, width, height, bounds: b, c }: BackdropArtProps) {
  const r = rng(`${seed}:bd:circuit`);
  const cx = width / 2;
  const cy = height / 2;
  const dw = Math.min(560, Math.max(260, width * 0.38));
  const dh = Math.min(400, Math.max(200, height * 0.5));
  const x0 = cx - dw / 2;
  const y0 = cy - dh / 2;
  const pins = `${uid}-pins`;
  const pinsV = `${uid}-pinsv`;
  const fins = `${uid}-fins`;
  const caps = `${uid}-caps`;

  // Bus lanes: four traces per side, leaving the die and bending once on the way to the edge.
  const lanes: ReactNode[] = [];
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 18;
      const bend = 60 + i * 22 + r() * 40;
      let d: string;
      if (side === 0) d = `M${x0} ${cy + off}H${x0 - bend}L${x0 - bend - 40} ${cy + off - 40 - i * 10}H${b.x}`;
      else if (side === 1)
        d = `M${x0 + dw} ${cy + off}H${x0 + dw + bend}L${x0 + dw + bend + 40} ${cy + off + 40 + i * 10}H${b.x + b.w}`;
      else if (side === 2) d = `M${cx + off * 2} ${y0}V${y0 - bend}L${cx + off * 2 - 40} ${y0 - bend - 40}V${b.y}`;
      else d = `M${cx + off * 2} ${y0 + dh}V${y0 + dh + bend}L${cx + off * 2 + 40} ${y0 + dh + bend + 40}V${b.y + b.h}`;
      lanes.push(<path key={`${side}-${i}`} d={d} {...inkStroke(c, INK.soft, 3)} />);
    }
  }

  const silk = scatter(r, 9, { x: b.x + 120, y: b.y + 120, w: b.w - 240, h: b.h - 240 }, 220).map(([x, y], i) => (
    <text
      key={`s${x}-${y}`}
      x={x}
      y={y}
      fontSize={20}
      fontWeight={700}
      letterSpacing={2}
      fill={c.ink2}
      fillOpacity={INK.firm}
      fontFamily="ui-monospace, Menlo, monospace"
    >
      {SILK[i % SILK.length]}
    </text>
  ));

  return (
    <g data-backdrop="circuit-board">
      <defs>
        <pattern id={pins} width={16} height={14} patternUnits="userSpaceOnUse">
          <rect x={4} y={0} width={8} height={14} rx={1.5} fill={c.ink2} fillOpacity={INK.firm} />
        </pattern>
        <pattern id={pinsV} width={14} height={16} patternUnits="userSpaceOnUse">
          <rect x={0} y={4} width={14} height={8} rx={1.5} fill={c.ink2} fillOpacity={INK.firm} />
        </pattern>
        <pattern id={fins} width={22} height={140} patternUnits="userSpaceOnUse">
          <rect x={6} y={0} width={10} height={140} rx={3} fill={c.ink2} fillOpacity={INK.soft} />
        </pattern>
        <pattern id={caps} width={56} height={56} patternUnits="userSpaceOnUse">
          <circle cx={28} cy={28} r={12} fill="none" stroke={c.ink2} strokeOpacity={INK.soft} strokeWidth={3} />
          <path d="M22 28H34" stroke={c.ink2} strokeOpacity={INK.soft} strokeWidth={2} />
        </pattern>
      </defs>
      {lanes}
      {/* The die: package, pin rows, the silicon window with a faint core grid. */}
      <rect x={x0} y={y0} width={dw} height={dh} rx={22} fill={line(c, 0)} fillOpacity={LINE.faint} />
      <rect x={x0} y={y0} width={dw} height={dh} rx={22} {...inkStroke(c, INK.firm, 3)} />
      <rect x={x0 + 24} y={y0 - 16} width={dw - 48} height={14} fill={`url(#${pins})`} />
      <rect x={x0 + 24} y={y0 + dh + 2} width={dw - 48} height={14} fill={`url(#${pins})`} />
      <rect x={x0 - 16} y={y0 + 24} width={14} height={dh - 48} fill={`url(#${pinsV})`} />
      <rect x={x0 + dw + 2} y={y0 + 24} width={14} height={dh - 48} fill={`url(#${pinsV})`} />
      <rect
        x={cx - dw * 0.28}
        y={cy - dh * 0.28}
        width={dw * 0.56}
        height={dh * 0.56}
        rx={8}
        {...inkStroke(c, INK.soft, 2)}
      />
      {[0.25, 0.5, 0.75].map((t) => (
        <path
          key={t}
          d={`M${cx - dw * 0.28 + dw * 0.56 * t} ${cy - dh * 0.28}V${cy + dh * 0.28}M${cx - dw * 0.28} ${cy - dh * 0.28 + dh * 0.56 * t}H${cx + dw * 0.28}`}
          {...inkStroke(c, INK.faint, 1.5)}
        />
      ))}
      {/* Heat-sink fin comb along the bottom edge. */}
      <rect x={b.x + 80} y={b.y + b.h - 220} width={b.w - 160} height={140} fill={`url(#${fins})`} />
      <rect
        x={b.x + 80}
        y={b.y + b.h - 236}
        width={b.w - 160}
        height={12}
        rx={4}
        fill={c.ink2}
        fillOpacity={INK.soft}
      />
      {/* Capacitor rows above the board and down the right edge. */}
      <rect x={b.x + 160} y={b.y + 90} width={Math.min(840, b.w - 320)} height={56} fill={`url(#${caps})`} />
      <rect x={b.x + b.w - 150} y={b.y + 240} width={56} height={Math.min(560, b.h - 480)} fill={`url(#${caps})`} />
      <rect x={b.x + 70} y={b.y + 300} width={56} height={Math.min(420, b.h - 600)} fill={`url(#${caps})`} />
      {silk}
    </g>
  );
}
