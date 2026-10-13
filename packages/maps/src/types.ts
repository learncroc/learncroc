/**
 * Map contracts (CONTRACTS §9.3). Renderers draw decorative SVG only; interaction lives in StopLayer.
 */
import type { CompiledPack, NodeId, NodeView, PackTheme, RendererId } from "@learncroc/core";
import type { ReactNode } from "react";

export interface MapRendererProps {
  pack: Pick<CompiledPack, "manifest" | "map">;
  views: Record<NodeId, NodeView>;
  theme: PackTheme;
  focusId?: NodeId;
  hoverId?: NodeId;
  tokenAt?: NodeId;
  /** Section fog and veil on (M held or Shift+M latched shows the whole map). */
  fog: boolean;
  /** 0.5..2.5 */
  zoom: number;
  reducedMotion: boolean;
}

/** A rectangle in viewport px (the map window beside an open modal). */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MapViewProps {
  pack: Pick<CompiledPack, "manifest" | "map">;
  views: Record<NodeId, NodeView>;
  selectedId?: NodeId;
  onSelect(nodeId: NodeId): void;
  onOpen(nodeId: NodeId): void;
  variant: "full" | "poster" | "mini";
  /** Relight return: play the light-up sequence when key changes. */
  lightUp?: { nodes: NodeId[]; key: string };
  /** A card just closed: its glyph fills in (Done, never gold), the track to `next` is laid. Plays when key changes. */
  cardDone?: { node: NodeId; next?: NodeId; key: number };
  /** A gate opened: the section lights card by card, the gate swings, newly ready cards breathe. Plays when key changes. */
  gateOpen?: { gate: NodeId; lit: NodeId[]; unlocked: NodeId[]; key: number };
  /** A checkpoint miss: a Sea route from the gate to the cards worth a second look. Plays when key changes. */
  revisit?: { from: NodeId; to: NodeId[]; key: number };
  /** Screen-space content drawn above the map (Moss's corner). */
  overlay?: ReactNode;
  /** Called with a moment's key when it has finished playing (or was skipped). */
  onMomentDone?(key: number): void;
  /** Camera target: pan so `node` sits inside `rect` (default: the visible map). Applies when key changes. */
  frame?: { node: NodeId; rect?: ScreenRect; key: number };
  /**
   * Pinned-peek anchor: Space on an entry, or a click / Enter on one that opens nothing (Later, Planned,
   * Writing… cards, Locked gates). `rect` is the glyph's box in viewport px, so a popover can sit beside it.
   * `onOpen` still fires for clicks and Enter.
   */
  onPeek?(nodeId: NodeId, rect: ScreenRect): void;
}

/** Share card export. */
export interface MapPosterPngOptions {
  width: number;
  height: number;
  scale: 1 | 2;
  caption?: string;
}

export interface MapPosterProps {
  pack: Pick<CompiledPack, "manifest" | "map">;
  views: Record<NodeId, NodeView>;
  /** px; the poster scales the layout to fit. */
  width: number;
  height: number;
  caption?: string;
  /** Library posters show the title; share cards add "Learncroc". */
  showTitle?: boolean;
  /** "finished": the share poster for a finished map (every card lit, the badge, the wordmark). */
  layout?: "default" | "finished";
}

export interface MapBadgeProps {
  pack: Pick<CompiledPack, "manifest">;
  /** Playable cards on the finished map. */
  cards: number;
  finishedAt?: number;
  /** px, default 96. */
  size?: number;
  className?: string;
  /** Play the mint (drop, rim draw, sheen, token wobble) on mount. Reduced motion: a 220 ms fade. */
  mint?: boolean;
}

export interface ListViewProps {
  pack: Pick<CompiledPack, "manifest" | "map">;
  views: Record<NodeId, NodeView>;
  selectedId?: NodeId;
  onSelect(nodeId: NodeId): void;
  onOpen(nodeId: NodeId): void;
}

export interface MiniMapProps {
  pack: Pick<CompiledPack, "manifest" | "map">;
  views: Record<NodeId, NodeView>;
  /** Nodes to emphasise in order (revisit route, relight strip). */
  path?: NodeId[];
  focusId?: NodeId;
  tokenAt?: NodeId;
  /** px */
  width?: number;
  height?: number;
  /**
   * "strip": the modal header's section strip: `path` (the section's cards plus its gate) in one row,
   * the current card (focusId) ringed in Sea. Default "map" (strip when height ≤ 48 and a path is given).
   */
  variant?: "map" | "strip";
}

export type RendererComponent = (props: MapRendererProps) => ReactNode;
export type { RendererId };
