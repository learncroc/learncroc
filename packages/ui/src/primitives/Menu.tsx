import {
  autoUpdate,
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListItem,
  useListNavigation,
  useRole,
} from "@floating-ui/react";
import { DotsThree } from "@phosphor-icons/react";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { cn } from "../cn";

interface MenuCtx {
  activeIndex: number | null;
  getItemProps: (p?: Record<string, unknown>) => Record<string, unknown>;
  close: () => void;
}
const Ctx = createContext<MenuCtx | null>(null);

export interface MenuProps {
  /** Accessible name of the trigger, e.g. "More". */
  label: string;
  /** Custom trigger content; default is a ⋯ icon. */
  trigger?: ReactNode;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  triggerClassName?: string;
  children: ReactNode;
}

/** A ⋯ menu: arrow keys move, Enter picks, Esc closes and returns focus to the trigger. */
export function Menu({ label, trigger, placement = "bottom-end", triggerClassName, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const elementsRef = useRef<(HTMLElement | null)[]>([]);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: "menu" }),
    useListNavigation(context, { listRef: elementsRef, activeIndex, onNavigate: setActiveIndex, loop: true }),
  ]);
  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={label}
        className={cn(
          "inline-grid size-9 place-items-center rounded-sm text-ink-2 hover:bg-surface-2 hover:text-ink",
          triggerClassName,
        )}
        {...getReferenceProps()}
      >
        {trigger ?? <DotsThree size={20} weight="bold" aria-hidden />}
      </button>
      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={0} returnFocus>
            {/* Position on the outer box, animate the inner one: the pop-in's transform would otherwise replace the placement. */}
            <div ref={refs.setFloating} style={floatingStyles} className="z-40" {...getFloatingProps()}>
              <div className="lm-pop-in min-w-56 rounded-md border border-line bg-surface p-1.5 text-ink shadow-2">
                <Ctx.Provider value={{ activeIndex, getItemProps, close: () => setOpen(false) }}>
                  <FloatingList elementsRef={elementsRef}>{children}</FloatingList>
                </Ctx.Provider>
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export interface MenuItemProps {
  onSelect: () => void;
  icon?: ReactNode;
  /** Keyboard hint on the right. */
  hint?: string;
  children: ReactNode;
}

export function MenuItem({ onSelect, icon, hint, children }: MenuItemProps) {
  const ctx = useContext(Ctx);
  const { ref, index } = useListItem();
  if (!ctx) throw new Error("MenuItem must be inside a Menu");
  const active = ctx.activeIndex === index;
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      tabIndex={active ? 0 : -1}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-small text-ink outline-none",
        active && "bg-surface-2",
      )}
      {...ctx.getItemProps({
        onClick: () => {
          onSelect();
          ctx.close();
        },
      })}
    >
      {icon ? (
        <span aria-hidden className="text-ink-2">
          {icon}
        </span>
      ) : null}
      <span className="flex-1">{children}</span>
      {hint ? <span className="text-micro text-ink-3">{hint}</span> : null}
    </button>
  );
}
