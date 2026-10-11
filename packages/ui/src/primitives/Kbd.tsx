import { cn } from "../cn";

export interface KbdProps {
  /** One key ("P") or a chord (["⌘", "K"]) or a sequence (["G", "L"]). */
  keys: string | string[];
  /** "chord" keys are pressed together, "sequence" one after the other (default: chord for 2+ keys with a modifier). */
  kind?: "chord" | "sequence";
  /** Hide the visual "then" between sequence keys (screen readers still hear it). */
  compact?: boolean;
  className?: string;
}

const MODIFIERS = new Set(["⌘", "Ctrl", "⇧", "Shift", "⌥", "Alt"]);

/** Keyboard keys as small sunk caps. Sequences read "G then L" to screen readers. */
export function Kbd({ keys, kind, compact, className }: KbdProps) {
  const list = Array.isArray(keys) ? keys : [keys];
  const isSequence = kind ? kind === "sequence" : list.length > 1 && !list.some((k) => MODIFIERS.has(k));
  return (
    <span
      className={cn("inline-flex items-center gap-1 align-middle", className)}
      aria-label={list.join(isSequence ? " then " : " ")}
      role="img"
    >
      {list.map((k, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: keys may repeat ("G", "G"); position is identity
        <span key={`${k}-${i}`} className="inline-flex items-center gap-1" aria-hidden>
          {isSequence && i > 0 && !compact ? <span className="text-micro text-ink-3">then</span> : null}
          <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-xs border border-line-strong border-b-2 bg-surface-2 px-1 font-sans text-micro text-ink-2">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  );
}
