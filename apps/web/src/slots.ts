/**
 * Shared component contracts: components one area builds and other areas mount. Prop interfaces are
 * frozen after wave 0; each implementation lives in its owner's folder and is re-exported here, so
 * callers import from "./slots" and never from another area's files.
 */
import type { CompiledPack, NodeId, NodeView, PackId, Settings, SettingsPatch } from "@learncroc/core";
import type { MapPosterPngOptions } from "@learncroc/maps";
import type { ComponentType } from "react";
import { AiSettingsPanel as AiSettingsPanelImpl } from "./ai/AiSettingsPanel";
import { CrocCorner as CrocCornerImpl } from "./croc/CrocCorner";
import { CrocPane as CrocPaneImpl } from "./croc/CrocPane";
import { CardEmbed as CardEmbedImpl } from "./run/card/CardEmbed";
import { MapPosterPng as MapPosterPngImpl } from "./screens/map/MapPosterPng";

export {
  type CrocReaction,
  type CrocReactionType,
  crocReactions,
  REACTION_STATE,
  reactionLines,
} from "./croc/reactions";

/** Moss in the modals: a 240 px column (≥ 1280 px) or a collapsible footer bar. */
export interface CrocPaneProps {
  packId: PackId;
  nodeId?: NodeId;
  screenId?: string;
  runId?: string;
  context: "hook" | "card" | "checkpoint" | "checkpoint-result" | "relight";
  collapsed?: boolean;
}

/** Moss in the map's corner (MapView overlay): reactions and a non-modal chat about the map. */
export interface CrocCornerProps {
  packId: PackId;
  views?: Record<NodeId, NodeView>;
  selected?: NodeId;
}

/** "Try the first card" in the marketplace: a try-run that writes no progress. */
export interface CardEmbedProps {
  registry: string;
  packId: PackId;
  onExit(): void;
}

/** The AI section of Settings. */
export interface AiSettingsPanelProps {
  settings: Settings;
  onChange(patch: SettingsPatch): void;
}

/** Share card: renders a map poster and offers it as a PNG download. */
export interface MapPosterPngProps {
  pack: Pick<CompiledPack, "manifest" | "map">;
  views: Record<NodeId, NodeView>;
  options: MapPosterPngOptions;
  /** Button label, default "Download PNG". */
  label?: string;
  /** "finished": the finished-map poster. */
  layout?: "default" | "finished";
}

export const CrocCorner: ComponentType<CrocCornerProps> = CrocCornerImpl;
export const CrocPane: ComponentType<CrocPaneProps> = CrocPaneImpl;
export const CardEmbed: ComponentType<CardEmbedProps> = CardEmbedImpl;
export const AiSettingsPanel: ComponentType<AiSettingsPanelProps> = AiSettingsPanelImpl;
export const MapPosterPng: ComponentType<MapPosterPngProps> = MapPosterPngImpl;
