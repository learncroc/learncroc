import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * primary: the screen's one action, a chunky ink key with a hard bottom edge.
   * secondary: outlined. ghost: text only. quiet: a sunk chip for toolbars.
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (Phosphor, 16 px). */
  icon?: ReactNode;
  /** Keyboard hint shown at the end, e.g. "⏎" or "P". */
  kbd?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** Class names for a button look, so router links can wear it too. */
export function buttonClass({
  variant = "secondary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-[620] no-underline",
    "transition-[transform,box-shadow,background-color,color,border-color] duration-quick ease-out",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    size === "sm" && "h-8 rounded-sm px-3 text-small",
    size === "md" && "h-10 rounded-sm px-4 text-body",
    size === "lg" && "h-12 rounded-key px-5 text-body",
    variant === "primary" &&
      "border-[1.5px] border-ink bg-ink text-bg shadow-key-rest enabled:hover:bg-ink-2 enabled:active:translate-y-0.5 enabled:active:shadow-key-down [a&]:hover:bg-ink-2 [a&]:active:translate-y-0.5 [a&]:active:shadow-key-down",
    variant === "secondary" &&
      "border-[1.5px] border-line-strong bg-surface text-ink hover:border-ink-3 active:bg-surface-2",
    variant === "ghost" && "border border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
    variant === "quiet" && "border border-transparent bg-surface-sunk text-ink hover:bg-line",
    className,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  kbd,
  className,
  children,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button ref={ref} type={type} className={buttonClass({ variant, size, className })} {...rest}>
      {icon ? (
        <span aria-hidden className="grid place-items-center">
          {icon}
        </span>
      ) : null}
      {children}
      {kbd ? <KbdHint keyLabel={kbd} inverted={variant === "primary"} /> : null}
    </button>
  );
}

/** The small key hint inside a button. */
export function KbdHint({ keyLabel, inverted }: { keyLabel: string; inverted?: boolean }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "ml-0.5 inline-grid h-5 min-w-5 place-items-center rounded-xs border px-1 font-sans text-micro",
        inverted ? "border-bg/40 text-bg/80" : "border-line-strong text-ink-3",
      )}
    >
      {keyLabel}
    </kbd>
  );
}
