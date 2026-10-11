import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../cn";
import { isTypingTarget } from "../keys";

export interface AnswerKeyProps {
  /** Number badge and keyboard shortcut (1–9). */
  n?: number;
  children: ReactNode;
  /** rest → selected (chosen, not checked) → down (stays pressed while the canvas responds) → dimmed (other options after answering). */
  state?: "rest" | "selected" | "down" | "dimmed";
  disabled?: boolean;
  onPress: () => void;
  /** id of an element that describes the option (e.g. its "why"). */
  describedBy?: string;
  /** Listen for the digit `n` on the keyboard: the key drops like a real key, then presses (never inside text fields). */
  hotkey?: boolean;
  className?: string;
}

/**
 * The signature control (PLAN §6.3): 56 px tall, 12 px radius, a 1.5 px ink border, a 3 px hard bottom
 * edge and a number badge. On press it drops 2 px in 80 ms; in `down` it stays pressed.
 */
export function AnswerKey({
  n,
  children,
  state = "rest",
  disabled,
  onPress,
  describedBy,
  hotkey,
  className,
}: AnswerKeyProps) {
  const [flash, setFlash] = useState(false);
  const pressRef = useRef(onPress);
  pressRef.current = onPress;

  useEffect(() => {
    if (!hotkey || n === undefined || disabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== String(n) || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      setFlash(true);
      timer = setTimeout(() => {
        setFlash(false);
        pressRef.current();
      }, 80);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [hotkey, n, disabled]);

  const isDown = state === "down" || flash;
  return (
    <button
      type="button"
      className={cn(
        "group relative flex min-h-14 w-full items-center gap-3 rounded-key border-[1.5px] border-ink bg-surface py-3 pr-4 pl-3 text-left text-body text-ink",
        "shadow-key-rest transition-[transform,box-shadow,background-color,opacity] duration-press ease-out",
        "enabled:hover:bg-surface-2 enabled:active:translate-y-0.5 enabled:active:shadow-key-down",
        "disabled:cursor-not-allowed",
        isDown && "translate-y-0.5 shadow-key-down",
        (state === "selected" || state === "down") && "bg-sea-soft enabled:hover:bg-sea-soft",
        state === "dimmed" && "opacity-55",
        className,
      )}
      aria-pressed={state === "selected" || state === "down"}
      aria-describedby={describedBy}
      aria-keyshortcuts={n !== undefined && hotkey ? String(n) : undefined}
      disabled={disabled}
      data-state={state}
      onClick={onPress}
    >
      {n !== undefined ? (
        <span
          aria-hidden
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-xs border-[1.5px] border-ink-3 text-micro tabular text-ink-2",
            (state === "selected" || state === "down") && "border-sea-text text-sea-text",
          )}
        >
          {n}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
