import {
  autoUpdate,
  FloatingFocusManager,
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { cloneElement, isValidElement, type ReactElement, type ReactNode, type Ref } from "react";
import { cn } from "../cn";

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element the popover is anchored to (rendered as is; it receives the ref and aria props). */
  anchor: ReactNode;
  /** Accessible name of the popover. */
  label: string;
  placement?: "top" | "bottom" | "left" | "right";
  /** "dialog" (default) moves focus inside; "tooltip"-like content can pass false to keep focus on the anchor. */
  focus?: boolean;
  className?: string;
  children: ReactNode;
}

type AnchorEl = ReactElement<{ ref?: Ref<Element> } & Record<string, unknown>>;

/**
 * A popover anchored to an element (floating-ui): flips and shifts to stay on screen, Esc and outside
 * clicks close it, focus moves in and returns to the anchor. One layer at a time.
 */
export function Popover({
  open,
  onOpenChange,
  anchor,
  label,
  placement = "bottom",
  focus = true,
  className,
  children,
}: PopoverProps) {
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);

  const reference = isValidElement(anchor) ? (
    cloneElement(anchor as AnchorEl, {
      ...getReferenceProps((anchor as AnchorEl).props as Record<string, unknown>),
      ref: refs.setReference,
    })
  ) : (
    <span ref={refs.setReference} {...getReferenceProps()}>
      {anchor}
    </span>
  );

  return (
    <>
      {reference}
      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={focus ? 0 : -1} returnFocus>
            <div
              ref={refs.setFloating}
              role="dialog"
              aria-label={label}
              style={floatingStyles}
              className={cn(
                "lm-pop-in z-40 max-w-sm rounded-md border border-line bg-surface p-4 text-body text-ink shadow-2",
                "dark:shadow-none",
                className,
              )}
              {...getFloatingProps()}
            >
              {children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
