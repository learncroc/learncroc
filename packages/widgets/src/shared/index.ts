/**
 * The shared widget kit: the drag kit (pointer + keyboard + "Use buttons instead"), the slider,
 * view atoms, and pure helpers. Every built-in widget uses these so they feel the same in the hand.
 */
export {
  arrowDelta,
  type DragPointOptions,
  type PickPlace,
  type PickPlaceOptions,
  type PickTarget,
  useButtonsMode,
  useDragPoint,
  usePickPlace,
} from "./drag";
export * from "./math";
export { Slider, type SliderProps } from "./Slider";
export { DataSource, modelName, sourceCaption, validateSource } from "./source";
export {
  ButtonsToggle,
  InlineMarkdown,
  KeyButton,
  lineColor,
  motionStyle,
  plainMarkdown,
  ReviewNote,
  radioGroupKeys,
  SourceTag,
  SrOnly,
  WidgetShell,
  withReveal,
} from "./ui";
