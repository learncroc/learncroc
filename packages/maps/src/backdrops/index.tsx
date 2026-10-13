/**
 * Backdrops: one code-drawn illustration per world (02 §1.2), drawn between the ground and the texture.
 *
 * - Self-contained SVG (no <img>), so poster export works offline and never taints the canvas.
 * - World colours only, at low opacity; never Lumen, Sea or Ember.
 * - Masked out within 28 layout px of every route, stop and label: the art lives between the lines.
 * - Static and seeded per pack; memoised per scene so it draws once.
 * - `theme.backdrop` picks one; when it is absent, or names a drawing that does not exist, the renderer's
 *   default is used. `none` draws nothing.
 */
import type { BackdropId, PackTheme, RendererId } from "@learncroc/core";
import { type ComponentType, memo } from "react";
import { AgoraArt } from "./agora";
import { CableGlobeArt } from "./cable-globe";
import { CaseBoardArt } from "./case-board";
import { CircuitBoardArt } from "./circuit-board";
import { FactoryFloorArt } from "./factory-floor";
import { FairgroundArt } from "./fairground";
import { IberiaRoadArt } from "./iberia-road";
import { IceCoreArt } from "./ice-core";
import type { BackdropArtProps, BackdropColors, DrawnBackdropId } from "./kit";
import { LightConesArt } from "./light-cones";
import { MountainArt } from "./mountain";
import { PrismArt } from "./prism";
import { SketchbookArt } from "./sketchbook";
import { StaffTownArt } from "./staff-town";
import { TerrainArt } from "./terrain";
import { TransitGridArt } from "./transit-grid";

export type { BackdropArtProps, BackdropColors } from "./kit";

/** Every drawn backdrop. `none` is the only BackdropId without a drawing. */
export const BACKDROPS: Partial<Record<DrawnBackdropId, ComponentType<BackdropArtProps>>> = {
  "circuit-board": CircuitBoardArt,
  "iberia-road": IberiaRoadArt,
  sketchbook: SketchbookArt,
  "transit-grid": TransitGridArt,
  terrain: TerrainArt,
  "factory-floor": FactoryFloorArt,
  "light-cones": LightConesArt,
  "ice-core": IceCoreArt,
  "cable-globe": CableGlobeArt,
  "staff-town": StaffTownArt,
  agora: AgoraArt,
  mountain: MountainArt,
  fairground: FairgroundArt,
  "case-board": CaseBoardArt,
  prism: PrismArt,
};

/** The renderer's own backdrop when a theme names none. */
export const DEFAULT_BACKDROP: Record<RendererId, DrawnBackdropId> = {
  circuit: "circuit-board",
  metro: "transit-grid",
  atlas: "terrain",
  sketchbook: "sketchbook",
};

/**
 * The backdrop a map draws: the theme's when it has a drawing, else the renderer's default.
 * `none` turns it off. Returns undefined for no backdrop.
 */
export function resolveBackdrop(theme: Pick<PackTheme, "backdrop">, renderer: RendererId): DrawnBackdropId | undefined {
  const id: BackdropId | undefined = theme.backdrop;
  if (id === "none") return undefined;
  if (id && BACKDROPS[id]) return id;
  return DEFAULT_BACKDROP[renderer];
}

export interface BackdropLayerProps extends Omit<BackdropArtProps, "c"> {
  id: DrawnBackdropId;
  colors: BackdropColors;
  /** Clear zone: route paths (stroked 56 px wide), stop circles and label boxes, in layout px. */
  clear: {
    paths: string[];
    circles: { x: number; y: number; r: number }[];
    boxes: { x: number; y: number; w: number; h: number }[];
  };
}

/** The masked backdrop layer. Memoised: the art and its mask draw once per scene. */
export const BackdropLayer = memo(function BackdropLayer({ id, colors, clear, ...art }: BackdropLayerProps) {
  const Art = BACKDROPS[id] ?? BACKDROPS[DEFAULT_BACKDROP.metro];
  if (!Art) return null;
  const mask = `${art.uid}-bdmask`;
  const b = art.bounds;
  // The clear zone is drawn three times, widening and fading, so the art fades out towards the track
  // instead of ending on a hard edge (a blur filter would be clipped to the SVG viewport in Chrome).
  const rings = [
    { grow: 18, alpha: 0.35 },
    { grow: 9, alpha: 0.55 },
    { grow: 0, alpha: 1 },
  ];
  return (
    <g aria-hidden data-layer="backdrop" data-backdrop-id={id} pointerEvents="none">
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x={b.x} y={b.y} width={b.w} height={b.h}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#FFFFFF" />
          {rings.map(({ grow, alpha }) => (
            <g key={grow} opacity={alpha}>
              <g stroke="#000000" strokeWidth={56 + grow * 2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                {clear.paths.map((d, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static per scene
                  <path key={i} d={d} />
                ))}
              </g>
              {clear.circles.map((c) => (
                <circle key={`${c.x}:${c.y}`} cx={c.x} cy={c.y} r={c.r + grow} fill="#000000" />
              ))}
              {clear.boxes.map((r) => (
                <rect
                  key={`${r.x}:${r.y}`}
                  x={r.x - 8 - grow}
                  y={r.y - 6 - grow}
                  width={r.w + 16 + grow * 2}
                  height={r.h + 12 + grow * 2}
                  rx={8 + grow}
                  fill="#000000"
                />
              ))}
            </g>
          ))}
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>
        <Art {...art} c={colors} />
      </g>
    </g>
  );
});
