import { FloatingFocusManager, FloatingPortal, useFloating } from "@floating-ui/react";
import { type KeyboardEvent, type ReactNode, useId } from "react";
import { cn } from "../cn";
import { KbdHint } from "./Button";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "right" | "bottom";
  /** px; the Ask drawer is 440. */
  width?: number;
  /** Dim the page behind (default false: the Ask drawer leaves the canvas visible). */
  scrim?: boolean;
  /** Extra controls in the header, before the close button. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * A side (or bottom) drawer. Focus moves in and is kept inside while open, Esc closes it and focus
 * returns to the element that opened it. Slides in over 360 ms (a crossfade under reduced motion).
 */
export function Drawer({
  open,
  onClose,
  title,
  side = "right",
  width = 440,
  scrim = false,
  actions,
  className,
  children,
}: DrawerProps) {
  const titleId = useId();
  const { refs, context } = useFloating({ open, onOpenChange: (o) => (o ? undefined : onClose()) });
  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    // A nested layer (popover, menu) handles its own Esc first and marks the event.
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <FloatingPortal>
      {scrim ? <div aria-hidden className="lm-fade-in fixed inset-0 z-40 bg-scrim" onClick={onClose} /> : null}
      <FloatingFocusManager context={context} modal returnFocus>
        <aside
          ref={refs.setFloating}
          role="dialog"
          aria-modal
          aria-labelledby={titleId}
          onKeyDown={onKeyDown}
          className={cn(
            "fixed z-50 flex flex-col bg-surface text-ink shadow-3 dark:shadow-[var(--inset-dark)]",
            side === "right"
              ? "lm-slide-in-right inset-y-0 right-0 max-w-full border-l border-line"
              : "lm-slide-in-up inset-x-0 bottom-0 max-h-[85dvh] rounded-t-stage border-t border-line",
            className,
          )}
          style={side === "right" ? { width } : undefined}
        >
          <header className="flex items-center gap-2 border-b border-line px-5 py-4">
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-heading">
              {title}
            </h2>
            {actions}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-small text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              Close
              <KbdHint keyLabel="Esc" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </aside>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
