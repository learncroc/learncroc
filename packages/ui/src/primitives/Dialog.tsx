import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { type ReactNode, useId } from "react";
import { cn } from "../cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One or two sentences under the title. */
  description?: ReactNode;
  /** Buttons, right-aligned; the primary action last. */
  actions?: ReactNode;
  /** "alertdialog" for confirmations that can't be undone. */
  role?: "dialog" | "alertdialog";
  className?: string;
  children?: ReactNode;
}

/** A centred modal for confirmations and short forms. Focus is trapped; Esc and the scrim close it. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  actions,
  role = "dialog",
  className,
  children,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const { refs, context } = useFloating({ open, onOpenChange: (o) => (o ? undefined : onClose()) });
  const dismiss = useDismiss(context, { outsidePressEvent: "mousedown" });
  const r = useRole(context, { role });
  const { getFloatingProps } = useInteractions([dismiss, r]);
  if (!open) return null;
  return (
    <FloatingPortal>
      <FloatingOverlay lockScroll className="z-50 grid place-items-center bg-scrim p-6">
        <FloatingFocusManager context={context} modal returnFocus>
          {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is "dialog" or "alertdialog", both take aria-labelledby */}
          <div
            ref={refs.setFloating}
            role={role}
            aria-modal
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            className={cn(
              "lm-pop-in w-full max-w-md rounded-md border border-line bg-surface p-6 text-ink shadow-3",
              className,
            )}
            {...getFloatingProps()}
          >
            <h2 id={titleId} className="text-heading">
              {title}
            </h2>
            {description ? (
              <div id={descId} className="mt-2 text-body text-ink-2">
                {description}
              </div>
            ) : null}
            {children ? <div className="mt-4">{children}</div> : null}
            {actions ? <div className="mt-6 flex justify-end gap-2">{actions}</div> : null}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
