/**
 * @learncroc/widgets — React views, the host and the sandbox bridge.
 *
 * Pure specs live in "@learncroc/widgets/spec" and are deliberately not re-exported here: the
 * aggregated specs include the token-splitter's tokenizer (about 1 MB), and learner screens should
 * only pay for the widgets they show (WidgetHost loads each widget's view and spec on demand).
 */
export { resolveConfig, WidgetConfigError, WidgetHost, type WidgetHostProps } from "./host/WidgetHost";
export {
  type AnySpec,
  type AnyView,
  type LoadedWidget,
  loadWidget,
  preloadWidget,
  WIDGET_IDS,
  WIDGET_SPEC_LOADERS,
  WIDGET_VIEW_LOADERS,
  widgetView,
} from "./registry";
export * from "./sandbox/bridge";
export { type FrameReportValue, SandboxFrame, type SandboxFrameProps } from "./sandbox/SandboxFrame";
export type { WidgetViewProps } from "./types";
