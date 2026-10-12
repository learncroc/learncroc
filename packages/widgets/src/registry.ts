/**
 * Widget view registry: every v0.1 widget id → its lazily loaded React view and its spec.
 * The aggregated pure specs are in "./spec"; this module loads one widget's spec on demand so a
 * screen showing a sorter never downloads the tokenizer that token-splitter grades with.
 */
import { WIDGET_IDS, type WidgetId, type WidgetSpec } from "@learncroc/core";
import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import type { WidgetViewProps } from "./types";

// biome-ignore lint/suspicious/noExplicitAny: views are looked up by id; props are checked by the spec.
export type AnyView = ComponentType<WidgetViewProps<any, any, any>>;
// biome-ignore lint/suspicious/noExplicitAny: specs are looked up by id; narrow with the id.
export type AnySpec = WidgetSpec<any, any, any>;

export const WIDGET_VIEW_LOADERS: Record<WidgetId, () => Promise<{ default: AnyView }>> = {
  "probability-bars": () => import("./probability-bars/View"),
  "token-splitter": () => import("./token-splitter/View"),
  "attention-weights": () => import("./attention-weights/View"),
  "embedding-plane": () => import("./embedding-plane/View"),
  plot: () => import("./plot/View"),
  sorter: () => import("./sorter/View"),
  hotspot: () => import("./hotspot/View"),
  "ab-compare": () => import("./ab-compare/View"),
  "light-clock": () => import("./light-clock/View"),
  "train-scene": () => import("./train-scene/View"),
  "spacetime-diagram": () => import("./spacetime-diagram/View"),
  "tile-builder": () => import("./tile-builder/View"),
  dialogue: () => import("./dialogue/View"),
  listen: () => import("./listen/View"),
  "code-stepper": () => import("./code-stepper/View"),
};

/** One widget's spec, loaded on demand (same module the view imports, so no extra download). */
export const WIDGET_SPEC_LOADERS: Record<WidgetId, () => Promise<AnySpec>> = {
  "probability-bars": () => import("./probability-bars/spec").then((m) => m.probabilityBarsSpec),
  "token-splitter": () =>
    Promise.all([
      import("./token-splitter/spec"),
      import("./token-splitter/tokenize").then((m) => m.loadTokenizer()),
    ]).then(([m]) => m.tokenSplitterSpec),
  "attention-weights": () => import("./attention-weights/spec").then((m) => m.attentionWeightsSpec),
  "embedding-plane": () => import("./embedding-plane/spec").then((m) => m.embeddingPlaneSpec),
  plot: () => import("./plot/spec").then((m) => m.plotSpec),
  sorter: () => import("./sorter/spec").then((m) => m.sorterSpec),
  hotspot: () => import("./hotspot/spec").then((m) => m.hotspotSpec),
  "ab-compare": () => import("./ab-compare/spec").then((m) => m.abCompareSpec),
  "light-clock": () => import("./light-clock/spec").then((m) => m.lightClockSpec),
  "train-scene": () => import("./train-scene/spec").then((m) => m.trainSceneSpec),
  "spacetime-diagram": () => import("./spacetime-diagram/spec").then((m) => m.spacetimeDiagramSpec),
  "tile-builder": () => import("./tile-builder/spec").then((m) => m.tileBuilderSpec),
  dialogue: () => import("./dialogue/spec").then((m) => m.dialogueSpec),
  listen: () => import("./listen/spec").then((m) => m.listenSpec),
  "code-stepper": () => import("./code-stepper/spec").then((m) => m.codeStepperSpec),
};

export interface LoadedWidget {
  id: WidgetId;
  View: AnyView;
  spec: AnySpec;
}

const loaded = new Map<WidgetId, Promise<LoadedWidget>>();

/** Load a widget's view and spec together (cached; a failed load is retried next time). */
export function loadWidget(id: WidgetId): Promise<LoadedWidget> {
  let p = loaded.get(id);
  if (!p) {
    const viewLoader = WIDGET_VIEW_LOADERS[id];
    const specLoader = WIDGET_SPEC_LOADERS[id];
    if (!viewLoader || !specLoader) return Promise.reject(new Error(`Unknown widget "${id}"`));
    p = Promise.all([viewLoader(), specLoader()]).then(([v, spec]) => ({ id, View: v.default, spec }));
    p.catch(() => loaded.delete(id));
    loaded.set(id, p);
  }
  return p;
}

/** Start downloading a widget early (e.g. during the hook screen, behind the learner's thinking time). */
export function preloadWidget(id: WidgetId): void {
  loadWidget(id).catch(() => {
    // The host shows its fallback when the widget is actually rendered.
  });
}

const cache = new Map<WidgetId, LazyExoticComponent<AnyView>>();

/** The lazy React component for a widget id (one instance per id). */
export function widgetView(id: WidgetId): LazyExoticComponent<AnyView> {
  let view = cache.get(id);
  if (!view) {
    view = lazy(WIDGET_VIEW_LOADERS[id]);
    cache.set(id, view);
  }
  return view;
}

export { WIDGET_IDS };
