/** agora (art-of-persuasion): rows of columns, broad steps and a speaker's plinth. */
import { type BackdropArtProps, INK, inkStroke, LINE, line } from "./kit";

export function AgoraArt({ uid, width, height, bounds: b, c }: BackdropArtProps) {
  const cols = `${uid}-cols`;
  const rows = [b.y + 120, height + 140];
  const steps = [0, 1, 2, 3].map((i) => (
    <rect
      key={`st${i}`}
      x={b.x + 80 + i * 30}
      y={b.y + b.h - 120 - i * 26}
      width={b.w - 160 - i * 60}
      height={26}
      fill={c.ink2}
      fillOpacity={INK.faint + i * 0.01}
    />
  ));
  const px = width / 2;
  const py = height / 2;
  return (
    <g data-backdrop="agora">
      <defs>
        <pattern id={cols} width={90} height={260} patternUnits="userSpaceOnUse">
          <rect x={30} y={30} width={30} height={200} fill={c.ink2} fillOpacity={INK.faint} />
          <path d="M38 34V226M45 34V226M52 34V226" stroke={c.ink2} strokeOpacity={INK.faint} strokeWidth={1.5} />
          <rect x={22} y={14} width={46} height={16} rx={2} fill={c.ink2} fillOpacity={INK.soft} />
          <rect x={22} y={230} width={46} height={16} rx={2} fill={c.ink2} fillOpacity={INK.soft} />
        </pattern>
      </defs>
      {rows.map((y) => (
        <g key={y}>
          <path
            d={`M${b.x + 60} ${y + 4}L${b.x + b.w / 2} ${y - 90}L${b.x + b.w - 60} ${y + 4}Z`}
            fill={line(c, 0)}
            fillOpacity={LINE.faint}
          />
          <path
            d={`M${b.x + 60} ${y + 4}L${b.x + b.w / 2} ${y - 90}L${b.x + b.w - 60} ${y + 4}Z`}
            {...inkStroke(c, INK.soft, 2)}
          />
          <rect x={b.x + 60} y={y} width={b.w - 120} height={260} fill={`url(#${cols})`} />
        </g>
      ))}
      {steps}
      <rect x={px - 70} y={py - 40} width={140} height={80} rx={6} fill={line(c, 1)} fillOpacity={LINE.faint} />
      <rect x={px - 70} y={py - 40} width={140} height={80} rx={6} {...inkStroke(c, INK.soft, 2)} />
      <rect x={px - 90} y={py + 40} width={180} height={22} rx={4} {...inkStroke(c, INK.soft, 2)} />
    </g>
  );
}
