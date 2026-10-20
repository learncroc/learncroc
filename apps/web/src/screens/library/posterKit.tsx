/**
 * Shared poster pieces for the Library and the Marketplace: the world-grounded frame with its
 * texture, and small helpers over packs and progress. Posters are the pack's real map on its own
 * ground (worlds keep their ground whatever the app theme), not a SaaS card.
 */
import type { CompiledPack, InstalledPackSummary, NodeId, NodeView, PackProgress, PackTheme } from "@learncroc/core";
import { cn, WorldTheme } from "@learncroc/ui";
import type { CSSProperties, ReactNode } from "react";

/** A quiet CSS texture per theme texture, drawn in --w-grid (decorative; the renderer draws the real one on the map). */
export function textureStyle(texture: PackTheme["texture"]): CSSProperties {
  const g = "var(--w-grid)";
  switch (texture) {
    case "grid-fine":
    case "blueprint":
    case "spacetime":
      return {
        backgroundImage: `linear-gradient(${g} 1px, transparent 1px), linear-gradient(90deg, ${g} 1px, transparent 1px)`,
        backgroundSize: texture === "blueprint" ? "32px 32px" : "24px 24px",
      };
    case "pcb":
    case "night-fair":
      return { backgroundImage: `radial-gradient(${g} 1.2px, transparent 1.6px)`, backgroundSize: "16px 16px" };
    case "meadow":
      return { backgroundImage: `radial-gradient(${g} 1.4px, transparent 1.8px)`, backgroundSize: "22px 22px" };
    case "topo":
    case "marble":
    case "snow":
      // Contour arcs sweeping from a hill beyond the top-right corner (not a bullseye).
      return {
        backgroundImage: `repeating-radial-gradient(ellipse 150% 110% at 92% -18%, transparent 0 30px, ${g} 31px 32px)`,
      };
    case "world":
    case "ice":
      return { backgroundImage: `linear-gradient(${g} 1px, transparent 1px)`, backgroundSize: "100% 28px" };
    case "paper":
    case "corkboard":
    case "watercolour":
      return {
        backgroundImage: `linear-gradient(90deg, transparent 47px, ${g} 47px 48px, transparent 48px), linear-gradient(${g} 1px, transparent 1px)`,
        backgroundSize: "100% 100%, 100% 26px",
      };
    default:
      return {};
  }
}

/**
 * Classes for the box that holds a `MapPoster` inside a `PosterFrame`. The poster's own ground rect
 * and the renderer's ground layer are dropped there, so the frame's ground and texture run unbroken
 * behind the lines (otherwise the map sits in a visible rectangle with a second, misaligned texture).
 * The SVG fills the box and keeps its aspect ratio.
 */
export const POSTER_MAP_SLOT =
  "[&_svg]:h-full [&_svg]:w-full [&_svg>g>rect:first-child]:fill-transparent [&_[data-layer=ground]]:hidden";

export interface PosterFrameProps {
  theme: Pick<PackTheme, "ground" | "mode" | "ink" | "lines" | "texture">;
  className?: string;
  /** Desaturate (invalid packs). */
  muted?: boolean;
  children: ReactNode;
}

/** The world-grounded poster surface: ground colour, texture, world tokens, the stage radius. */
export function PosterFrame({ theme, className, muted, children }: PosterFrameProps) {
  return (
    <WorldTheme
      theme={theme}
      className={cn(
        "relative isolate overflow-hidden rounded-stage border border-line text-w-ink",
        muted && "grayscale-[0.85]",
        className,
      )}
      style={{ backgroundColor: theme.ground }}
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-70 [mask-image:linear-gradient(to_bottom,black_45%,rgb(0_0_0/0.35))]"
        style={textureStyle(theme.texture)}
      />
      {children}
    </WorldTheme>
  );
}

/** Checkpoints on a map and how many are open (a passed gate is `lit`, labelled Open). */
export function gateCounts(
  pack: Pick<CompiledPack, "map"> | undefined,
  views: Record<NodeId, NodeView> | undefined,
  fallbackTotal = 0,
): { open: number; total: number } {
  if (!pack) return { open: 0, total: fallbackTotal };
  let open = 0;
  let total = 0;
  for (const n of Object.values(pack.map.nodes)) {
    if (n.kind !== "checkpoint" || n.status === "planned") continue;
    total++;
    if (views?.[n.id]?.state === "lit") open++;
  }
  return { open, total };
}

/** "6 of 11 cards lit · 2 of 4 checkpoints open". */
export function progressLine(lit: number, total: number, gates: { open: number; total: number }): string {
  const cards = `${lit} of ${total} ${total === 1 ? "card" : "cards"} lit`;
  return gates.total > 0 ? `${cards} · ${gates.open} of ${gates.total} checkpoints open` : cards;
}

export interface FadingStop {
  packId: string;
  packTitle: string;
  nodeId: NodeId;
  title: string;
  retrievability: number;
}

/** Fading cards of one map, weakest first. */
export function fadingStops(pack: CompiledPack, progress: PackProgress): FadingStop[] {
  return Object.values(progress.views)
    .filter((v) => v.state === "fading")
    .map((v) => ({
      packId: pack.manifest.id,
      packTitle: pack.manifest.title,
      nodeId: v.id,
      title: pack.map.nodes[v.id]?.title ?? v.id,
      retrievability: v.retrievability ?? v.brightness,
    }))
    .sort((a, b) => a.retrievability - b.retrievability);
}

/**
 * Counts for "N of M lit": `lit` includes fading cards (they were lit and still count), `fading` is
 * the dimming part of it. From views when loaded, else from the summary.
 */
export function stateCounts(summary: InstalledPackSummary, views?: Record<NodeId, NodeView>) {
  if (!views)
    return {
      lit: summary.lit + summary.fading,
      done: summary.done,
      fading: summary.fading,
      playable: summary.playable,
    };
  let lit = 0;
  let done = 0;
  let fading = 0;
  for (const v of Object.values(views)) {
    if (v.state === "lit") lit++;
    else if (v.state === "done") done++;
    else if (v.state === "fading") fading++;
  }
  return { lit: lit + fading, done, fading, playable: summary.playable };
}

/** A slim progress meter: Lumen for lit (mastery shown), ember for the fading part, ink for done (never gold). */
export function LitMeter({
  lit,
  fading,
  done,
  total,
  className,
}: {
  lit: number;
  fading: number;
  done: number;
  total: number;
  className?: string;
}) {
  const pct = (n: number) => `${total ? Math.min(100, (n / total) * 100) : 0}%`;
  return (
    <div aria-hidden className={cn("flex h-1.5 w-full overflow-hidden rounded-pill bg-w-grid", className)}>
      <span className="h-full bg-lumen" style={{ width: pct(lit - fading) }} />
      <span className="h-full bg-ember" style={{ width: pct(fading) }} />
      <span className="h-full bg-w-ink-2/60" style={{ width: pct(done) }} />
    </div>
  );
}

/** A small badge on the poster ground ("AI-drafted, review pending", "Custom interactive"). */
export function PosterBadge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-6 items-center rounded-xs border border-w-ink-2/60 px-2 text-micro whitespace-nowrap text-w-ink-2"
    >
      {children}
    </span>
  );
}
