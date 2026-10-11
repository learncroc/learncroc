import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../cn";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: "section" | "div" | "aside" | "article";
  tone?: "surface" | "surface-2" | "sunk";
  padding?: "none" | "sm" | "md" | "lg";
  children: ReactNode;
}

/** A panel (16 px radius). In dark mode depth comes from the surface step and a 1 px top highlight. */
export function Panel({
  as: Tag = "section",
  tone = "surface",
  padding = "md",
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <Tag
      className={cn(
        "rounded-md border border-line",
        tone === "surface" && "bg-surface shadow-1 dark:shadow-[var(--inset-dark)]",
        tone === "surface-2" && "bg-surface-2",
        tone === "sunk" && "bg-surface-sunk",
        padding === "sm" && "p-3",
        padding === "md" && "p-4",
        padding === "lg" && "p-6",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
