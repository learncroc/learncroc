/** prism (color-theory): a prism splitting a beam into the five line colours, and paint-chip swatches. */
import { type BackdropArtProps, INK, inkStroke, LINE, line } from "./kit";

export function PrismArt({ width, height, bounds: b, c }: BackdropArtProps) {
  const px = width * 0.42;
  const py = height * 0.5;
  const s = Math.max(180, Math.min(320, height * 0.45));
  const tri = `M${px} ${py - s}L${px + s * 0.9} ${py + s * 0.6}L${px - s * 0.9} ${py + s * 0.6}Z`;
  const fan = [0, 1, 2, 3, 4].map((i) => {
    const y0 = py - 10 + i * 8;
    const y1 = py - 220 + i * 110;
    return (
      <path
        key={`f${i}`}
        d={`M${px + s * 0.45} ${y0}L${b.x + b.w} ${y1}L${b.x + b.w} ${y1 + 100}L${px + s * 0.45} ${y0 + 8}Z`}
        fill={line(c, i)}
        fillOpacity={LINE.firm}
      />
    );
  });
  const chips = [0, 1, 2, 3, 4, 0, 1, 2].map((ci, i) => {
    const x = b.x + 120 + i * 120;
    const y = height + 180;
    return (
      <g key={`ch${x}`} transform={`rotate(${(i % 3) - 1} ${x} ${y})`}>
        <rect x={x} y={y} width={90} height={120} rx={4} {...inkStroke(c, INK.soft, 1.5)} />
        <rect x={x + 8} y={y + 8} width={74} height={70} fill={line(c, ci)} fillOpacity={LINE.firm} />
        <path d={`M${x + 10} ${y + 96}H${x + 70}`} {...inkStroke(c, INK.soft, 2)} />
      </g>
    );
  });
  return (
    <g data-backdrop="prism">
      <path d={`M${b.x} ${py - 40}L${px - s * 0.45} ${py}`} stroke={c.ink2} strokeOpacity={INK.soft} strokeWidth={18} />
      {fan}
      <path d={tri} fill={c.ink2} fillOpacity={INK.faint} />
      <path d={tri} {...inkStroke(c, INK.firm, 3)} />
      {chips}
    </g>
  );
}
