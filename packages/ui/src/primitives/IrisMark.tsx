import type { ReactNode } from "react";
import { cn } from "../cn";

export interface IrisMarkProps {
  children: ReactNode;
  as?: "div" | "p" | "span";
  className?: string;
}

/** Live AI text: an Iris left border and the ◆ glyph, "Drafted by AI" on hover and for screen readers. */
export function IrisMark({ children, as: Tag = "div", className }: IrisMarkProps) {
  return (
    <Tag className={cn("border-l-2 border-iris pl-3", className)} data-ai-text title="Drafted by AI">
      <span aria-hidden className="mr-1.5 text-iris">
        ◆
      </span>
      <span className="sr-only">Drafted by AI: </span>
      {children}
    </Tag>
  );
}
