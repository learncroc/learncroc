/**
 * View-side widget contracts. Specs (pure) live in "./spec".
 */
import type { AssetPath } from "@learncroc/core";

/** Props every packages/widgets/src/<id>/View.tsx receives from WidgetHost. */
export interface WidgetViewProps<P, G, A> {
  props: P;
  goal?: G;
  mode: "explore" | "answer" | "review";
  /** Controlled current answer (restored from run scratch). */
  value?: A;
  /** Every change (the host persists it to scratch and enables Check). */
  onChange?: (value: A) => void;
  /** Widget-native commit (e.g. dialogue reached an ending); otherwise the host's Check commits `value`. */
  onCommit?: (value: A) => void;
  /** Review mode. */
  solution?: A;
  /** VisualState.props, merged after answering. */
  revealProps?: Partial<P>;
  reducedMotion: boolean;
  theme: "light" | "dark";
  /** Forwarded to the host aria-live region. */
  announce: (text: string) => void;
  assetUrl: (path: AssetPath) => string;
}
// VisualState.note is drawn by WidgetHost, not by the widget.
