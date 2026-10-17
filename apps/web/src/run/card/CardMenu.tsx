/**
 * The card header's ⋯ menu, drawn inside the modal (no portal), so it sits above the card and stays in
 * the modal's focus trap. Arrow keys move, Enter picks, Esc closes the menu only.
 */
import { cn } from "@learncroc/ui";
import { DotsThree } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useId, useRef } from "react";

export interface CardMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect(): void;
}

export interface CardMenuProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  items: CardMenuItem[];
}

export function CardMenu({ open, onOpenChange, items }: CardMenuProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open, onOpenChange]);

  const move = (dir: 1 | -1) => {
    const els = [...(listRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + dir + els.length) % els.length]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => onOpenChange(!open)}
        className="inline-grid size-9 place-items-center rounded-sm text-ink-2 hover:bg-surface hover:text-ink"
        data-card-menu
      >
        <DotsThree size={20} weight="bold" aria-hidden />
      </button>
      {open ? (
        <div
          ref={listRef}
          id={id}
          role="menu"
          tabIndex={-1}
          className="lm-pop-in absolute top-full right-0 z-10 mt-1.5 min-w-56 rounded-md border border-line bg-surface p-1.5 text-ink shadow-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              e.preventDefault();
              onOpenChange(false);
              triggerRef.current?.focus();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            }
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-small text-ink outline-none",
                "hover:bg-surface-2 focus-visible:bg-surface-2",
              )}
              onClick={() => {
                onOpenChange(false);
                it.onSelect();
              }}
            >
              {it.icon ? <span className="text-ink-2">{it.icon}</span> : null}
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
