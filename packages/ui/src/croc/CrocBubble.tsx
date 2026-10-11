import { CROC_NAME } from "@learncroc/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { announce } from "../a11y/live";
import { cn } from "../cn";
import { prefersReducedMotion } from "../motion";
import { IrisMark } from "../primitives/IrisMark";

export interface CrocBubbleProps {
  /** One short canned line (≤ 12 words) or a short reply. Strings over `maxWords` are trimmed with "…". */
  children: ReactNode;
  /** Where the tail points: toward Moss. Default "bottom-left" (Moss sits in the bottom-left map corner). */
  tail?: "bottom-right" | "bottom-left" | "left" | "right";
  /**
   * "line": a canned reaction (default). "ai": AI-written text, wrapped in the Iris mark.
   * "notes": an offline answer, labelled "From this card's notes".
   */
  variant?: "line" | "ai" | "notes";
  /** Fade out and call this after `ms` (default 4000). Omit for a bubble that stays. */
  onDone?: () => void;
  ms?: number;
  /** Fade out (140 ms) on any click or key, then `onDone` (default: true when `onDone` is given). */
  dismissOnInput?: boolean;
  /** Words shown at most (default 25). */
  maxWords?: number;
  /**
   * What the shared live region says (default: the text of string children, prefixed with Moss's name).
   * `false` stays silent (the same words are already announced elsewhere).
   */
  announceText?: string | false;
  className?: string;
}

const FADE_MS = 140;
/** Ignore the input that caused the bubble (a click or key a moment before it mounted). */
const ARM_MS = 250;

function trimWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : `${words.slice(0, max).join(" ")}…`;
}

/**
 * Moss's speech bubble. Pops in (`lm-pop-in`), fades out in 140 ms on any click or key, and speaks once
 * through the app's single rate-limited live region (`announce`), so a screen reader never hears the same
 * moment twice. Voice-casual; no exclamation marks in its copy (the caller's job).
 */
export function CrocBubble(props: CrocBubbleProps) {
  // A new line is a new bubble: it pops in again and gets its own timer.
  const key = typeof props.children === "string" ? props.children : undefined;
  return <Bubble key={key} {...props} />;
}

function Bubble({
  children,
  tail = "bottom-left",
  variant = "line",
  onDone,
  ms = 4000,
  dismissOnInput,
  maxWords = 25,
  announceText,
  className,
}: CrocBubbleProps) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const text = typeof children === "string" ? trimWords(children, maxWords) : null;
  const spoken = announceText === false ? null : (announceText ?? (text ? `${CROC_NAME}: ${text}` : null));
  const dismissible = dismissOnInput ?? Boolean(onDone);

  // Speak once per distinct line.
  useEffect(() => {
    if (spoken) announce(spoken, { key: "croc" });
  }, [spoken]);

  // Leave: fade 140 ms (instant under reduced motion), then tell the caller.
  const leaveRef = useRef<() => void>(() => {});
  leaveRef.current = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(
      () => {
        setGone(true);
        onDoneRef.current?.();
      },
      prefersReducedMotion() ? 0 : FADE_MS,
    );
  };

  useEffect(() => {
    if (!onDone) return;
    const t = setTimeout(() => leaveRef.current(), Math.max(0, ms - FADE_MS));
    return () => clearTimeout(t);
  }, [onDone, ms]);

  useEffect(() => {
    if (!dismissible) return;
    const armedAt = Date.now();
    const onInput = () => {
      if (Date.now() - armedAt >= ARM_MS) leaveRef.current();
    };
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    return () => {
      window.removeEventListener("pointerdown", onInput, true);
      window.removeEventListener("keydown", onInput, true);
    };
  }, [dismissible]);

  if (gone) return null;
  const body = text ?? children;
  return (
    <div
      data-tail={tail}
      data-variant={variant}
      data-leaving={leaving || undefined}
      className={cn(
        "lm-pop-in relative max-w-[280px] rounded-md border border-line bg-surface px-3 py-2 text-small text-ink shadow-2 voice-casual",
        "transition-opacity duration-quick ease-in",
        leaving && "opacity-0",
        className,
      )}
    >
      {variant === "ai" ? <IrisMark as="p">{body}</IrisMark> : <p>{body}</p>}
      {variant === "notes" ? <p className="mt-1 text-micro text-ink-3 voice-linear">From this card's notes</p> : null}
      <span
        aria-hidden
        className={cn(
          "absolute size-2.5 rotate-45 border-line bg-surface",
          tail === "bottom-right" && "-bottom-[6px] right-6 border-r border-b",
          tail === "bottom-left" && "-bottom-[6px] left-6 border-r border-b",
          tail === "left" && "top-1/2 -left-[6px] -translate-y-1/2 border-b border-l",
          tail === "right" && "top-1/2 -right-[6px] -translate-y-1/2 border-t border-r",
        )}
      />
    </div>
  );
}
