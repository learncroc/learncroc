/**
 * "@learncroc/widgets/spec" — every widget's pure spec (zod props, goal, answer, grade, validate…).
 * NO React. Core lint, grading and services receive `widgetSpecRegistry` as an injected
 * WidgetSpecRegistry; the AI layer reads the specs (or the generated "./catalog").
 *
 * This entry is complete and synchronous, so it includes the token-splitter's tokenizer (about
 * 450 KB gzipped). Browser screens should load specs per widget instead: `loadWidget(id)` from
 * "@learncroc/widgets", or the light registry in "@learncroc/widgets/host/specs".
 */
import type { WidgetSpecRegistry } from "@learncroc/core";
// Side effect: install the cl100k_base tokenizer so token-splitter grades synchronously here.
import "./token-splitter/tokenizer-eager";
import {
  lightSpecRegistry,
  MODAL_CANVAS,
  WIDGET_CANVAS,
  WIDGET_SPECS,
  type WidgetCanvas,
  widgetCanvas,
} from "./host/specs";

export * from "./ab-compare/spec";
export * from "./attention-weights/spec";
export * from "./code-stepper/spec";
export * from "./dialogue/spec";
export * from "./embedding-plane/spec";
export * from "./hotspot/spec";
export * from "./light-clock/spec";
export * from "./listen/spec";
export * from "./plot/spec";
export * from "./probability-bars/spec";
export * from "./sorter/spec";
export * from "./spacetime-diagram/spec";
export * from "./tile-builder/spec";
export * from "./token-splitter/spec";
export * from "./train-scene/spec";

export { MODAL_CANVAS, WIDGET_CANVAS, WIDGET_SPECS, type WidgetCanvas, widgetCanvas };

/** The registry injected into core (lint L010, grading, services). */
export const widgetSpecRegistry: WidgetSpecRegistry = lightSpecRegistry;
