/** fairground (thinking-traps): striped tents, a Ferris wheel outline and bunting in line colours. */
import { type BackdropArtProps, INK, inkStroke, LINE, line } from "./kit";

export function FairgroundArt({ width, height, bounds: b, c }: BackdropArtProps) {
  const wheel = { x: width + 200, y: height * 0.4, r: 210 };
  const tents = [b.x + 180, b.x + 460, width * 0.5, width + 60].map((x, i) => {
    const y = height + 240;
    const w = 150 + (i % 2) * 40;
    return (
      <g key={`t${x}`}>
        <path
          d={`M${x - w / 2} ${y}L${x} ${y - w * 0.8}L${x + w / 2} ${y}Z`}
          fill={line(c, i)}
          fillOpacity={LINE.firm}
        />
        <path
          d={`M${x - w / 2} ${y}L${x} ${y - w * 0.8}L${x + w / 2} ${y}ZM${x - w / 6} ${y}L${x} ${y - w * 0.8}L${x + w / 6} ${y}`}
          {...inkStroke(c, INK.soft, 2)}
        />
        <path d={`M${x} ${y - w * 0.8}V${y - w * 0.8 - 30}l20 8l-20 8`} {...inkStroke(c, INK.soft, 2)} />
      </g>
    );
  });
  const spokes = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const x2 = wheel.x + Math.cos(a) * wheel.r;
    const y2 = wheel.y + Math.sin(a) * wheel.r;
    return (
      <g key={`s${a.toFixed(3)}`}>
        <path d={`M${wheel.x} ${wheel.y}L${x2} ${y2}`} {...inkStroke(c, INK.faint, 1.5)} />
        <rect x={x2 - 12} y={y2} width={24} height={18} rx={4} {...inkStroke(c, INK.soft, 1.5)} />
      </g>
    );
  });
  const bunting = (y: number, key: string) => {
    const flags = [];
    const n = Math.min(40, Math.floor(b.w / 60));
    for (let i = 0; i < n; i++) {
      const x = b.x + i * 60 + 20;
      const yy = y + Math.sin((i / n) * Math.PI * 6) * 20;
      flags.push(
        <path
          key={`${key}${i}`}
          d={`M${x} ${yy}L${x + 24} ${yy}L${x + 12} ${yy + 22}Z`}
          fill={line(c, i % 3)}
          fillOpacity={LINE.firm}
        />,
      );
    }
    return flags;
  };
  return (
    <g data-backdrop="fairground">
      <circle cx={wheel.x} cy={wheel.y} r={wheel.r} {...inkStroke(c, INK.soft, 3)} />
      <circle cx={wheel.x} cy={wheel.y} r={wheel.r * 0.2} {...inkStroke(c, INK.soft, 2)} />
      {spokes}
      <path
        d={`M${wheel.x - 120} ${wheel.y + wheel.r + 140}L${wheel.x} ${wheel.y}L${wheel.x + 120} ${wheel.y + wheel.r + 140}`}
        {...inkStroke(c, INK.soft, 3)}
      />
      {tents}
      {bunting(b.y + 120, "a")}
      {bunting(-150, "b")}
    </g>
  );
}
