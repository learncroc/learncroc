/**
 * World helpers for run roots and canvases. Tokens (--w-*) come from the design system's worldVars;
 * each world keeps its own ground (dark or light) whatever the app theme.
 */
import type { PackTheme } from "@learncroc/core";
import { worldVars as uiWorldVars } from "@learncroc/ui";
import type { CSSProperties } from "react";

/** The world tokens as inline style. */
export function worldVars(theme: PackTheme): CSSProperties {
  return uiWorldVars(theme) as unknown as CSSProperties;
}

/** A soft tint of the world ground over the app background (the hook, relight items). */
export function worldTint(theme: Pick<PackTheme, "ground">, strength = 10): CSSProperties {
  return { backgroundColor: `color-mix(in srgb, ${theme.ground} ${strength}%, var(--bg))` };
}

/** Line colour for a node's line (theme.lines[line.color - 1]). */
export function lineColor(
  theme: PackTheme,
  lines: { id: string; color: number }[],
  lineId: string | undefined,
): string {
  const line = lines.find((l) => l.id === lineId);
  return theme.lines[(line?.color ?? 1) - 1] ?? theme.lines[0];
}
