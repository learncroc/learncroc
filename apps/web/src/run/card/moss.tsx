/**
 * The pieces of the card conversation (docs/design/teach-first.md): Moss's bubbles with a mood, the
 * learner's replies, the article passage, the typing dots, the reply bar and read-aloud. Moss speaks in
 * the guide voice; the article speaks in its own words, in green, with its source.
 */
import type { QuoteBlock } from "@learncroc/core";
import { CROC_NAME } from "@learncroc/core";
import { Croc, type CrocState, cn, Kbd } from "@learncroc/ui";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useKeys } from "../keys";
import { Md } from "../Markdown";

export type MossMood = "idle" | "curious" | "happy" | "thinking" | "cheering";

const ROW_IN = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.24 } };

/** One thing Moss says. `text` is Markdown; `children` for anything richer. */
export function MossLine(p: {
  text?: string;
  children?: ReactNode;
  mood?: MossMood;
  packId: string;
  /** The lantern is lit (mastery only). */
  lumen?: boolean;
  reducedMotion?: boolean;
  className?: string;
  /** The line goes beyond the source article. */
  outside?: boolean;
}) {
  const state: CrocState = p.mood ?? "idle";
  return (
    <motion.div
      {...(p.reducedMotion ? {} : ROW_IN)}
      className={cn("flex items-end gap-2.5 pr-6 sm:pr-14", p.className)}
      data-moss-line
      data-mood={state}
    >
      <Croc state={state} size={40} lumen={p.lumen ?? false} decorative className="mb-0.5" />
      <div className="voice-guide min-w-0 rounded-[18px] rounded-bl-[6px] border border-line bg-surface px-4 py-2.5 text-ink shadow-1">
        <span className="sr-only">{CROC_NAME}: </span>
        {p.text !== undefined ? <Md text={p.text} packId={p.packId} /> : p.children}
        {p.outside ? (
          <span
            className="mt-1 block w-fit rounded-pill border border-line px-2 py-0.5 text-micro text-ink-3"
            data-outside
          >
            not from the article
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}

/** What the learner said (a reply chip, a hunch, an answer). */
export function MeLine({ text, reducedMotion }: { text: string; reducedMotion?: boolean }) {
  return (
    <motion.div {...(reducedMotion ? {} : ROW_IN)} className="flex justify-end pl-16 sm:pl-28" data-me-line>
      <p className="rounded-[18px] rounded-br-[6px] bg-ink px-4 py-2.5 text-body text-surface">
        <span className="sr-only">You: </span>
        {text}
      </p>
    </motion.div>
  );
}

/** Moss is about to say something. */
export function Typing() {
  return (
    <div className="flex items-end gap-2.5" aria-hidden data-moss-typing>
      <Croc state="thinking" size={40} decorative className="mb-0.5" />
      <div className="flex gap-1 rounded-[18px] rounded-bl-[6px] border border-line bg-surface px-4 py-3.5 shadow-1">
        {[0, 150, 300].map((d) => (
          <span key={d} className="size-1.5 animate-pulse rounded-full bg-ink-3" style={{ animationDelay: `${d}ms` }} />
        ))}
      </div>
    </div>
  );
}

/** Content that isn't Moss talking (the article, a figure, a question), indented under Moss. */
export function Indent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-w-0 sm:pl-[50px]", className)}>{children}</div>;
}

/** The article in its own words. */
export function Passage({ block }: { block: QuoteBlock }) {
  return (
    <figure
      className="m-0 rounded-r-md border-l-4 border-sea bg-sea-soft px-4 pt-3 pb-2.5 text-ink"
      data-block="quote"
      data-passage
    >
      <p className="t-micro mb-1 text-sea-text uppercase tracking-wide">From the article</p>
      <blockquote className="m-0 text-body">{block.text}</blockquote>
      <figcaption className="mt-1.5 text-small font-semibold text-sea-text">
        {block.cite.url ? (
          <a href={block.cite.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
            {block.cite.title}
          </a>
        ) : (
          block.cite.title
        )}
        {block.cite.para ? ` · ${block.cite.para}` : null}
      </figcaption>
    </figure>
  );
}

// ── replies

export interface Reply {
  label: string;
  /** The way on (one per moment): dark, and Enter picks it. */
  primary?: boolean;
  disabled?: boolean;
  /** Shown as the learner's line in the thread (default: the label). Empty: say nothing. */
  echo?: string;
  icon?: ReactNode;
  onSelect(): void;
}

export function ReplyBar({ replies, keysActive, note }: { replies: Reply[]; keysActive: boolean; note?: string }) {
  const primary = replies.find((r) => r.primary && !r.disabled);
  useKeys(
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.key !== "Enter" || !primary) return false;
      primary.onSelect();
      return true;
    },
    { enabled: keysActive && Boolean(primary) },
  );
  if (replies.length === 0 && !note) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2" data-replies>
      {note ? <span className="mr-auto text-small text-ink-3">{note}</span> : null}
      {replies.map((r) => (
        <button
          key={r.label}
          type="button"
          disabled={r.disabled}
          onClick={r.onSelect}
          className={cn(
            "inline-flex items-center gap-2 rounded-pill border px-3.5 py-1.5 text-body font-semibold transition-colors duration-quick disabled:opacity-50",
            r.primary
              ? "border-ink bg-ink text-surface hover:bg-ink-2"
              : "border-line-strong bg-surface text-ink hover:border-ink-3",
          )}
          data-reply={r.primary ? "primary" : "side"}
        >
          {r.icon}
          {r.label}
          {r.primary ? <Kbd keys="⏎" className="border-surface/50 bg-transparent text-surface" /> : null}
        </button>
      ))}
    </div>
  );
}

// ── pacing

/** How long Moss "types" before a line of this many characters. */
export function typingMs(text: string): number {
  return Math.min(1100, 320 + text.length * 8);
}

/**
 * Show `delays.length` items one after another. Item i waits delays[i] ms after item i−1. With
 * `animate` off (resumed run, reduced motion) everything is shown at once.
 */
export function useReveal(delays: number[], animate: boolean): { shown: number; typing: boolean } {
  const total = delays.length;
  const [shown, setShown] = useState(animate ? 0 : total);
  const animated = useRef(animate);
  const next = delays[shown] ?? 0;
  useEffect(() => {
    if (!animated.current) {
      setShown(total);
      return;
    }
    if (shown >= total) return;
    const t = setTimeout(() => setShown((n) => n + 1), next);
    return () => clearTimeout(t);
  }, [shown, total, next]);
  return { shown: Math.min(shown, total), typing: shown < total && (delays[shown] ?? 0) > 200 };
}
