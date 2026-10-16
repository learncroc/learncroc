import type { RegistryPack } from "@learncroc/core";
import { cn } from "@learncroc/ui";

export interface SketchPosterProps {
  sketch: RegistryPack["sketch"];
  title: string;
  /** Lines stroke in by line colour, once (after an install). */
  drawing?: boolean;
  className?: string;
}

/** A transit-style route: horizontal, then a 45° diagonal into the target. */
export function routePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dy) < 0.5 || Math.abs(dx) < 0.5) return `M${x1} ${y1}L${x2} ${y2}`;
  const diag = Math.min(Math.abs(dx), Math.abs(dy));
  const straight = Math.sign(dx) * (Math.abs(dx) - diag);
  const mid = x1 + straight;
  if (Math.abs(dy) > Math.abs(dx)) {
    // Steeper than 45°: diagonal first, then vertical.
    const midY = y1 + Math.sign(dy) * Math.abs(dx);
    return `M${x1} ${y1}L${x2} ${midY}L${x2} ${y2}`;
  }
  return `M${x1} ${y1}L${mid} ${y1}L${x2} ${y2}`;
}

/**
 * A registry pack's map drawn from its sketch (enough for a poster without downloading). Uses the
 * world tokens, so wrap it in a PosterFrame / WorldTheme.
 */
export function SketchPoster({ sketch, title, drawing, className }: SketchPosterProps) {
  const pad = 40;
  const nodes = new Map(sketch.nodes.map((n) => [n.id, n]));
  const lineColor = new Map(sketch.lines.map((l) => [l.id, `var(--w-${l.color})`]));
  const order = new Map(sketch.lines.map((l, i) => [l.id, i]));
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${sketch.width + pad * 2} ${sketch.height + pad * 2}`}
      className={cn("h-full w-full", className)}
      role="img"
      aria-label={`Map of ${title}: ${sketch.nodes.length} cards and checkpoints on ${sketch.lines.length} ${sketch.lines.length === 1 ? "line" : "lines"}`}
    >
      <title>{`Map of ${title}`}</title>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {sketch.edges.map((e) => {
          const a = nodes.get(e.from);
          const b = nodes.get(e.to);
          if (!a || !b) return null;
          const planned = b.status === "planned";
          const dashed = e.kind === "transfer" || planned;
          const delay = `${(order.get(b.line) ?? 0) * 120}ms`;
          return (
            <path
              key={`${e.from}-${e.to}`}
              d={routePath(a.x, a.y, b.x, b.y)}
              stroke={lineColor.get(b.line) ?? "var(--w-1)"}
              strokeWidth={e.kind === "line" ? 9 : 5}
              strokeDasharray={dashed ? "2 12" : undefined}
              opacity={planned ? 0.55 : 1}
              // Solid strokes draw along their length; dashed ones fade in (a dash offset would erase the dashes).
              className={drawing ? (dashed ? "lm-fade-in" : "lm-draw") : undefined}
              style={
                drawing
                  ? ({
                      ...(dashed ? { animationDelay: delay } : { "--lm-len": 2400, "--lm-draw-delay": delay }),
                    } as Record<string, string | number>)
                  : undefined
              }
            />
          );
        })}
      </g>
      {sketch.nodes.map((n) =>
        n.status === "planned" ? (
          <rect
            key={n.id}
            x={n.x - 9}
            y={n.y - 9}
            width={18}
            height={18}
            rx={3}
            fill="var(--w-ground)"
            stroke="var(--w-ink-2)"
            strokeWidth={2.5}
            strokeDasharray="4 3"
          />
        ) : n.kind === "checkpoint" ? (
          <rect
            key={n.id}
            x={n.x - 6}
            y={n.y - 20}
            width={12}
            height={40}
            rx={6}
            fill="var(--w-ink)"
            stroke="var(--w-ground)"
            strokeWidth={3}
          />
        ) : (
          <circle
            key={n.id}
            cx={n.x}
            cy={n.y}
            r={11}
            fill="var(--w-ground)"
            stroke={lineColor.get(n.line) ?? "var(--w-ink)"}
            strokeWidth={5}
          />
        ),
      )}
    </svg>
  );
}
