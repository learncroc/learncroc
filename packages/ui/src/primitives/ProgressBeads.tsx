import { cn } from "../cn";

export interface ProgressBeadsProps {
  total: number;
  /** Beads completed. */
  done: number;
  /** Index of the current bead (0-based), if any. */
  current?: number;
  /** Accessible label from the caller, in card words: "Guess, beat 2 of 3, close" style, e.g. "Beat 2 of 3". */
  label: string;
  className?: string;
}

/** Progress through a card as beads on a thread (Guess, one per beat, Close): done = ink, current = a Sea ring, ahead = hollow. */
export function ProgressBeads({ total, done, current, label, className }: ProgressBeadsProps) {
  return (
    <div role="img" aria-label={label} className={cn("relative flex items-center gap-2", className)}>
      <span aria-hidden className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
      {Array.from({ length: total }, (_, i) => {
        const state = i < done ? "done" : i === current ? "current" : "ahead";
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: beads are positional
            key={i}
            data-bead={state}
            className={cn(
              "relative rounded-pill transition-[background-color,box-shadow,width] duration-base ease-out",
              state === "done" && "size-2.5 bg-ink",
              state === "current" && "size-3 bg-surface shadow-[0_0_0_2px_var(--sea)]",
              state === "ahead" && "size-2.5 border-[1.5px] border-ink-3 bg-surface",
            )}
          />
        );
      })}
    </div>
  );
}
