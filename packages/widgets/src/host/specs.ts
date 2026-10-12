/**
 * The light spec registry for browser code: every widget's spec without the token-splitter's
 * tokenizer data. Props schemas, validate, initialAnswer, explore and textAlternative all work;
 * token-splitter's grade, validate and token counts need the tokenizer, which `loadWidget(id)` loads
 * with the widget (or call `loadTokenizer()` from "../token-splitter/tokenize"). Server, CLI and
 * the static demo should use "@learncroc/widgets/spec", which installs it eagerly.
 */
import type { WidgetId, WidgetSpec, WidgetSpecRegistry } from "@learncroc/core";
import { abCompareSpec } from "../ab-compare/spec";
import { attentionWeightsSpec } from "../attention-weights/spec";
import { codeStepperSpec } from "../code-stepper/spec";
import { dialogueSpec } from "../dialogue/spec";
import { embeddingPlaneCanvas, embeddingPlaneSpec } from "../embedding-plane/spec";
import { hotspotSpec } from "../hotspot/spec";
import { lightClockSpec } from "../light-clock/spec";
import { listenSpec } from "../listen/spec";
import { plotCanvas, plotSpec } from "../plot/spec";
import { probabilityBarsSpec } from "../probability-bars/spec";
import { MODAL_CANVAS, type WidgetCanvas } from "../shared/canvas";
import { sorterSpec } from "../sorter/spec";
import { spacetimeDiagramCanvas, spacetimeDiagramSpec } from "../spacetime-diagram/spec";
import { tileBuilderSpec } from "../tile-builder/spec";
import { tokenSplitterSpec } from "../token-splitter/spec";
import { trainSceneCanvas, trainSceneSpec } from "../train-scene/spec";

// biome-ignore lint/suspicious/noExplicitAny: a heterogeneous map of specs; narrow with the id.
type AnySpec = WidgetSpec<any, any, any>;

/** Every v0.1 widget spec, keyed by id. */
export const WIDGET_SPECS = {
  "probability-bars": probabilityBarsSpec,
  "token-splitter": tokenSplitterSpec,
  "attention-weights": attentionWeightsSpec,
  "embedding-plane": embeddingPlaneSpec,
  plot: plotSpec,
  sorter: sorterSpec,
  hotspot: hotspotSpec,
  "ab-compare": abCompareSpec,
  "light-clock": lightClockSpec,
  "train-scene": trainSceneSpec,
  "spacetime-diagram": spacetimeDiagramSpec,
  "tile-builder": tileBuilderSpec,
  dialogue: dialogueSpec,
  listen: listenSpec,
  "code-stepper": codeStepperSpec,
} as const satisfies Record<WidgetId, AnySpec>;

/** A WidgetSpecRegistry over WIDGET_SPECS. */
export const lightSpecRegistry: WidgetSpecRegistry = {
  get: (id) =>
    (WIDGET_SPECS as Record<string, AnySpec | undefined>)[id] as WidgetSpec<unknown, unknown, unknown> | undefined,
};

export { MODAL_CANVAS, type WidgetCanvas };

/** Widgets that need more than the default modal canvas (MODAL_CANVAS); the rest fit it. */
export const WIDGET_CANVAS: Partial<Record<WidgetId, WidgetCanvas>> = {
  plot: plotCanvas,
  "train-scene": trainSceneCanvas,
  "spacetime-diagram": spacetimeDiagramCanvas,
  "embedding-plane": embeddingPlaneCanvas,
};

/** The canvas a widget wants: `{}` means the default modal canvas is enough. */
export function widgetCanvas(id: WidgetId): WidgetCanvas {
  return WIDGET_CANVAS[id] ?? {};
}
