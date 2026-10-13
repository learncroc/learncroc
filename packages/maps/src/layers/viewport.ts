/**
 * Context MapView provides to overlay layers that must draw both inside the zoomed map (layout
 * coordinates) and in screen space (panels that must not scale), such as Run the Machine.
 */
import { createContext, useContext } from "react";
import type { Scene } from "../lib/scene";

export interface MapViewport {
  scene: Scene;
  /** Element inside the zoom/pan transform, sized to the layout (layout px). */
  layoutHost: HTMLElement | null;
  /** Element over the viewport in screen space (does not zoom), along its right edge. */
  screenHost: HTMLElement | null;
  /** Pan so a layout point stays clear of `insetRight` screen px on the right (the screen host's panel). */
  reveal?(p: { x: number; y: number }, insetRight: number): void;
}

export const MapViewportContext = createContext<MapViewport | null>(null);

export const useMapViewport = () => useContext(MapViewportContext);
