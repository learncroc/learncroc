/**
 * @learncroc/maps — renderers, backdrops, StopLayer, MapView, MapPoster (+ PNG export), MapBadge,
 * ListView, MiniMap.
 * Preview maps for every world live under `@learncroc/maps/gallery`.
 */

export {
  BACKDROPS,
  type BackdropArtProps,
  type BackdropColors,
  BackdropLayer,
  DEFAULT_BACKDROP,
  resolveBackdrop,
} from "./backdrops/index";
export { ListView } from "./ListView";
export { type EffectItem, EffectsLayer, type EffectsLayerProps } from "./layers/EffectsLayer";
export { peeksOnly, StopLayer, type StopLayerProps } from "./layers/StopLayer";
export {
  announceMap,
  describeChanges,
  describeStop,
  gateHint,
  gateMissing,
  gateName,
  listJoin,
  stateWord,
} from "./lib/a11y";
export { contrast, dawnColors, mix, type WorldColors, worldColors, worldStyle } from "./lib/color";
export {
  type EdgeState,
  edgeState,
  everythingLit,
  type FogLevel,
  finalGate,
  fogLevels,
  gateCovers,
  gateOf,
  gateSize,
  isLitLike,
  isOpen,
  mapGraph,
  navigate,
  nextGate,
  readingOrder,
  satisfies,
  sectionIndex,
  sectionsOf,
  tokenPath,
  unmetAncestors,
  viewFor,
} from "./lib/graph";
export {
  type GlyphKind,
  gateLine,
  glyphSize,
  labelCollisions,
  type PlacedLabel,
  placeLabels,
  wrapLabel,
} from "./lib/labels";
export { provisionalLayout, topoOrder } from "./lib/layout";
export {
  buildScene,
  CLEARANCE,
  ROUTE_STYLE,
  type RouteStyle,
  type Scene,
  type SceneEdge,
  type SceneNode,
} from "./lib/scene";
export { MapBadge } from "./MapBadge";
export {
  exportMapPosterPng,
  inlineCssVars,
  litSummary,
  MapPoster,
  type MapPosterExtraProps,
  posterFileName,
  renderMapPosterSvg,
} from "./MapPoster";
export { MapView } from "./MapView";
export { MiniMap } from "./MiniMap";
export { MAX_NODES_FOR_THEMED_RENDERER, RENDERERS, resolveRenderer } from "./renderers/index";
export type * from "./types";
