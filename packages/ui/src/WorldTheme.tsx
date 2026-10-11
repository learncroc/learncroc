import type { PackTheme } from "@learncroc/core";
import { type CSSProperties, type HTMLAttributes, type ReactNode, useMemo } from "react";
import { worldVars } from "./color";

export interface WorldThemeProps extends Omit<HTMLAttributes<HTMLElement>, "style"> {
  /** manifest.theme (or the registry's theme subset). */
  theme: Pick<PackTheme, "ground" | "mode" | "ink" | "lines" | "texture">;
  as?: "div" | "section" | "article" | "main" | "figure" | "span";
  /**
   * Worlds keep their own ground whatever the app theme. With `chrome` on (the default), app tokens
   * inside the root follow the world's mode too, so panels over a dark world are dark.
   */
  chrome?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Sets the world tokens (--w-ground, --w-ink, --w-ink-2, --w-grid, --w-1…--w-5, --w-mode) on a root
 * element, from a pack's theme. Map, run and poster roots wrap their content in it.
 */
export function WorldTheme({ theme, as: Tag = "div", chrome = true, style, children, ...rest }: WorldThemeProps) {
  const vars = useMemo(() => worldVars(theme), [theme]);
  return (
    <Tag
      data-world={theme.mode}
      data-texture={theme.texture}
      {...(chrome ? { "data-theme": theme.mode } : {})}
      style={{ ...(vars as CSSProperties), ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
