import {
  autoUpdate,
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../cn";
import { prefersReducedMotion } from "../motion";

export type ModalSize = "card" | "peek" | "sheet";

/** Why the modal is asking to close. */
export type ModalCloseReason = "escape" | "outside" | "action";

/** A viewport point (the clicked glyph) or an element the peek hangs from. */
export type ModalAnchor = { x: number; y: number } | Element;

export interface ModalProps {
  open: boolean;
  /** Called once the close animation has finished (220 ms; 120 ms under reduced motion). */
  onClose: () => void;
  /**
   * Called before an Esc or outside-click close. Return `false` to keep the modal open (e.g. Esc closes
   * Moss's pane first, or cancels a drag).
   */
  onDismiss?: (reason: Exclude<ModalCloseReason, "action">) => boolean | undefined;
  /** Accessible name; also the visible heading unless `hideTitle` or a `header` is given. */
  title: string;
  /** Keep the title for assistive tech only (the body draws its own header). No `h2` is rendered. */
  hideTitle?: boolean;
  /** id of the element that describes the dialog (the current step's prompt). */
  describedBy?: string;
  /**
   * "card": the card and checkpoint shell, min(960 px, 100vw − 160), height min(820 px, 100dvh − 80),
   *   centred right of the rail, the map visible on both sides. Below 900 px it becomes a full-height sheet.
   * "peek": a ≤ 280 px popover anchored to `anchor` (the glyph), no scrim, focus kept inside while open.
   * "sheet": a 720 px panel for intros, results, finish and share; full height below 900 px.
   */
  size?: ModalSize;
  /** "card" is the lighter scrim that keeps the map readable (no blur); "default" is the confirmation scrim. */
  scrim?: "default" | "card" | "none";
  /** CSS transform-origin for the open animation (the clicked glyph's position relative to the modal). */
  transformOrigin?: string;
  /** Compute transform-origin from a viewport point (the clicked glyph), clamped to the modal rect. */
  originPoint?: { x: number; y: number };
  /** Peek only: what the popover hangs from. */
  anchor?: ModalAnchor;
  /** Element to focus on open (default: the first tabbable element; `-1` focuses the dialog itself). */
  initialFocus?: RefObject<HTMLElement | null> | number;
  /** Return focus to this element on close (default: the element focused before opening). */
  returnFocus?: RefObject<HTMLElement | null> | boolean;
  /** Close on a scrim click (default true). */
  closeOnScrim?: boolean;
  /** Esc closes (default true). */
  closeOnEscape?: boolean;
  /** A fixed header strip (title, beads, the text "Back to map" button). Never an X. */
  header?: ReactNode;
  /** A fixed footer strip (Moss, feedback line, the primary action). */
  footer?: ReactNode;
  /** Extra classes on the dialog box. */
  className?: string;
  /** Extra classes on the scrolling body. */
  bodyClassName?: string;
  children?: ReactNode;
}

interface ModalContextValue {
  /** Play the close animation, then call `onClose`. Use it for the caller's own "Back to map" button. */
  requestClose: () => void;
  /** True while the close animation plays. */
  closing: boolean;
  titleId: string;
}

const ModalContext = createContext<ModalContextValue | null>(null);

/** Inside a Modal: `requestClose()` animates out, then calls the modal's `onClose`. Outside: a no-op. */
export function useModal(): ModalContextValue {
  return useContext(ModalContext) ?? { requestClose: () => {}, closing: false, titleId: "" };
}

const BOX: Record<ModalSize, string> = {
  card: cn(
    "w-[min(var(--modal-card-w,960px),calc(100vw-var(--modal-inset-left,64px)-96px))]",
    "h-[min(820px,calc(100dvh-80px))]",
    "max-[900px]:h-dvh max-[900px]:w-screen max-[900px]:rounded-none max-[900px]:border-0",
  ),
  peek: "w-[min(280px,calc(100vw-24px))] max-h-[min(420px,calc(100dvh-24px))]",
  sheet: cn(
    "w-[min(var(--modal-cp-w,720px),calc(100vw-48px))] max-h-[calc(100dvh-80px)]",
    "max-[900px]:h-dvh max-[900px]:max-h-none max-[900px]:w-screen max-[900px]:rounded-none max-[900px]:border-0",
  ),
};

const OVERLAY: Record<ModalSize, string> = {
  // Centre in the content area (right of the rail) when there's room; edge to edge below 900 px.
  card: "grid place-items-center p-6 min-[901px]:pl-[calc(var(--modal-inset-left,64px)+24px)] max-[900px]:p-0",
  peek: "",
  sheet: "grid place-items-center p-6 max-[900px]:p-0",
};

const CLOSE_MS = 220;
const CLOSE_MS_REDUCED = 120;

/**
 * The modal shell (card, checkpoint, peek, finish, share). One focus trap (`FloatingFocusManager modal`),
 * `aria-modal`, focus returns to the opener, and `useDismiss` owns Esc and the outside click. Header and
 * footer stay put; the body scrolls. There is no X: the caller supplies a text close button in the
 * header and calls `useModal().requestClose()` (or its own `onClose`). It never asks for confirmation:
 * runs are saved server-side.
 *
 * Open: the scrim fades 220 ms; the box scales 0.94 → 1 and fades over 360 ms ease-out from
 * `transformOrigin` (or `originPoint`). Close: 220 ms ease-in to 0.97. Reduced motion: 120 ms fades.
 */
export function Modal({
  open,
  onClose,
  onDismiss,
  title,
  hideTitle,
  describedBy,
  size = "card",
  scrim = size === "card" ? "card" : size === "peek" ? "none" : "default",
  transformOrigin,
  originPoint,
  anchor,
  initialFocus,
  returnFocus = true,
  closeOnScrim = true,
  closeOnEscape = true,
  header,
  footer,
  className,
  bodyClassName,
  children,
}: ModalProps) {
  const titleId = useId();
  // `rendered` outlives `open` by the close animation, so the box can animate out.
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const finish = useCallback(() => {
    closeTimer.current = null;
    setClosing(false);
    setRendered(false);
  }, []);

  const requestClose = useCallback(() => {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(
      () => {
        finish();
        onCloseRef.current();
      },
      prefersReducedMotion() ? CLOSE_MS_REDUCED : CLOSE_MS,
    );
  }, [finish]);

  // Parent-driven open/close: opening shows at once; closing from outside animates out without onClose.
  useEffect(() => {
    if (open) {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      setClosing(false);
      setRendered(true);
      return;
    }
    if (!rendered || closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(finish, prefersReducedMotion() ? CLOSE_MS_REDUCED : CLOSE_MS);
  }, [open, rendered, finish]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const isPeek = size === "peek";
  const { refs, context, floatingStyles } = useFloating({
    open: rendered,
    onOpenChange: (next, _event, reason) => {
      if (next) return;
      const why = reason === "escape-key" ? "escape" : "outside";
      if (onDismissRef.current?.(why) === false) return;
      requestClose();
    },
    placement: "bottom",
    strategy: "fixed",
    transform: false, // top/left, so the open animation owns `transform`
    middleware: isPeek ? [offset(12), flip({ padding: 12 }), shift({ padding: 12 })] : [],
    ...(isPeek ? { whileElementsMounted: autoUpdate } : {}),
  });

  // Peek: position against the anchor (an element, or a virtual point at the glyph).
  useLayoutEffect(() => {
    if (!isPeek || !anchor) return;
    if (anchor instanceof Element) refs.setReference(anchor);
    else {
      const { x, y } = anchor;
      refs.setPositionReference({
        getBoundingClientRect: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 }),
      });
    }
  }, [isPeek, anchor, refs]);

  const dismiss = useDismiss(context, {
    escapeKey: closeOnEscape,
    outsidePress: closeOnScrim,
    outsidePressEvent: "mousedown",
  });
  const role = useRole(context, { role: "dialog" });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  // transform-origin from the clicked glyph, clamped into the box once it has a size.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [computedOrigin, setComputedOrigin] = useState<string>();
  useLayoutEffect(() => {
    if (!rendered || !originPoint || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.min(Math.max(originPoint.x - r.left, 0), r.width);
    const y = Math.min(Math.max(originPoint.y - r.top, 0), r.height);
    setComputedOrigin(`${Math.round(x)}px ${Math.round(y)}px`);
  }, [rendered, originPoint]);

  const ctx = useMemo(() => ({ requestClose, closing, titleId }), [requestClose, closing, titleId]);

  if (!rendered) return null;

  const status = closing ? "closing" : "open";
  const labelled = !hideTitle && !header;
  const origin = transformOrigin ?? computedOrigin;
  const setBox = (el: HTMLDivElement | null) => {
    boxRef.current = el;
    refs.setFloating(el);
  };

  const box = (
    <div
      ref={setBox}
      role="dialog"
      aria-modal={isPeek ? undefined : true}
      {...(labelled ? { "aria-labelledby": titleId } : { "aria-label": title })}
      aria-describedby={describedBy}
      data-modal-size={size}
      data-status={status}
      style={{
        ...(isPeek
          ? anchor
            ? floatingStyles
            : { position: "fixed" as const, inset: 0, margin: "auto", height: "fit-content" }
          : {}),
        ...(origin ? { transformOrigin: origin } : {}),
        ...(closing ? { pointerEvents: "none" as const } : {}),
      }}
      className={cn(
        "lm-modal flex flex-col overflow-hidden border border-line bg-surface text-ink shadow-3 outline-none",
        isPeek ? "z-50 rounded-md" : "rounded-stage",
        BOX[size],
        className,
      )}
      {...getFloatingProps()}
    >
      {header ? <div className="shrink-0">{header}</div> : null}
      {labelled ? (
        <h2
          id={titleId}
          className={cn("shrink-0 t-heading", isPeek ? "px-4 pt-3 text-body font-semibold" : "px-6 pt-5")}
        >
          {title}
        </h2>
      ) : null}
      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", bodyClassName)}>{children}</div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>
  );

  const focusProps = {
    context,
    modal: true,
    initialFocus: initialFocus ?? 0,
    returnFocus,
    // The peek keeps focus while open but lets an outside click land on the map.
    closeOnFocusOut: false,
  };

  return (
    <ModalContext.Provider value={ctx}>
      <FloatingPortal>
        {isPeek ? (
          <FloatingFocusManager {...focusProps}>{box}</FloatingFocusManager>
        ) : (
          <FloatingOverlay
            lockScroll
            data-scrim={scrim}
            data-status={status}
            className={cn(
              "lm-modal-scrim z-50",
              OVERLAY[size],
              scrim === "card" ? "bg-scrim-card" : scrim === "default" ? "bg-scrim" : "bg-transparent",
            )}
          >
            <FloatingFocusManager {...focusProps}>{box}</FloatingFocusManager>
          </FloatingOverlay>
        )}
      </FloatingPortal>
    </ModalContext.Provider>
  );
}
