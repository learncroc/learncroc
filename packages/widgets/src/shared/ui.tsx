/**
 * Small view atoms shared by the built-in widgets: the widget shell (toolbar line with the data
 * source and the "Use buttons instead" toggle), chips, buttons and a safe inline-Markdown renderer.
 * Styling uses the design tokens only (Tailwind utilities backed by tokens.css; SVG reads var(--…)).
 */
import { cn } from "@learncroc/ui";
import { type ButtonHTMLAttributes, Fragment, type ReactNode } from "react";
import { useButtonsMode } from "./drag";
import { sourceCaption } from "./source";

/** Outer wrapper every built-in widget renders. */
export function WidgetShell(p: {
  id: string;
  mode: "explore" | "answer" | "review";
  className?: string;
  children: ReactNode;
  /** Toolbar content on the left (task hint, readouts). */
  toolbar?: ReactNode;
  /** Data source string ("illustrative" | "precomputed:gpt2"), shown on the right. */
  source?: string;
  /** Show the "Use buttons instead" toggle (drag widgets). */
  buttonsToggle?: boolean;
  label?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group around a widget, not a form fieldset.
    <div
      data-widget={p.id}
      data-mode={p.mode}
      role="group"
      aria-label={p.label}
      className={cn("lm-widget @container flex w-full min-w-0 flex-col gap-3 text-w-ink", p.className)}
    >
      {p.children}
      {p.toolbar || p.source || p.buttonsToggle ? (
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-small text-w-ink-2">
          <div className="flex flex-wrap items-center gap-3">{p.toolbar}</div>
          <div className="flex flex-wrap items-center gap-3">
            {p.buttonsToggle ? <ButtonsToggle /> : null}
            {p.source ? <SourceTag source={p.source} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "computed with GPT-2" or "illustrative numbers". */
export function SourceTag({ source }: { source: string }) {
  const illustrative = !source.startsWith("precomputed:");
  return (
    <span
      data-source={source}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-micro",
        illustrative ? "border border-dashed border-line-strong text-ink-3" : "bg-surface-2 text-ink-2",
      )}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        {illustrative ? (
          <path d="M1 9 L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        ) : (
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        )}
      </svg>
      {sourceCaption(source)}
    </span>
  );
}

/** The persisted "Use buttons instead" switch. */
export function ButtonsToggle() {
  const [on, setOn] = useButtonsMode();
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-small text-ink-2">
      <input
        type="checkbox"
        role="switch"
        aria-checked={on}
        className="peer sr-only"
        checked={on}
        onChange={(e) => setOn(e.currentTarget.checked)}
      />
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-block h-4 w-7 rounded-pill border border-line-strong transition-colors duration-quick peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
          on ? "bg-sea" : "bg-surface-sunk",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-2.5 rounded-pill bg-surface shadow-1 transition-transform duration-quick",
            on ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      Use buttons instead
    </label>
  );
}

/** A chunky, tactile widget button (smaller sibling of the answer key). */
export function KeyButton({
  className,
  pressed,
  tone = "plain",
  size = "md",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pressed?: boolean;
  tone?: "plain" | "primary" | "quiet";
  size?: "sm" | "md";
}) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-key border-[1.5px] font-semibold transition-[transform,box-shadow,background-color] duration-press ease-out disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-10 px-4 text-body" : "min-h-8 px-3 py-1 text-small leading-tight",
        tone === "quiet"
          ? "border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink"
          : "border-ink shadow-key-rest active:translate-y-0.5 active:shadow-key-down",
        tone === "plain" && (pressed ? "translate-y-0.5 bg-sea-soft text-ink shadow-key-down" : "bg-surface text-ink"),
        tone === "primary" && "bg-ink text-surface",
        className,
      )}
      {...rest}
    />
  );
}

/**
 * Inline Markdown without raw HTML: **bold**, *italic* / _italic_, `code` and line breaks.
 * Links render as their text (packs link stops from the player, not from widget cards).
 */
export function InlineMarkdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split(/\n/);
  return (
    <span className={className}>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines of a static string.
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {renderInline(line)}
        </Fragment>
      ))}
    </span>
  );
}

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)]+\))/g;

function renderInline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of s.matchAll(INLINE_RE)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(s.slice(last, at));
    if (tok.startsWith("**")) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`"))
      out.push(
        <code key={k++} className="voice-mono rounded-xs bg-surface-2 px-1 text-[0.92em]">
          {tok.slice(1, -1)}
        </code>,
      );
    else if (tok.startsWith("[")) out.push(tok.slice(1, tok.indexOf("]")));
    else out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = at + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Plain text of inline Markdown (for aria labels and announcements). */
export function plainMarkdown(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, "$1$2");
}

/** A small dotted-outline note used for review feedback (never red, never an X). */
export function ReviewNote({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-small text-ink-2 voice-casual", className)}>{children}</span>;
}

/** Visually hidden text for screen readers. */
export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

/** Merge reveal props (VisualState.props) over the authored props. */
export function withReveal<P extends object>(props: P, revealProps?: Partial<P>): P {
  return revealProps ? { ...props, ...revealProps } : props;
}

/** CSS colour for a world line colour index 1..5 (falls back to line 1). */
export function lineColor(n: number | undefined): string {
  const i = n && n >= 1 && n <= 5 ? n : 1;
  return `var(--w-${i})`;
}

/** Transition style that respects reduced motion. */
export function motionStyle(reducedMotion: boolean, props: string, duration = "var(--dur-move)") {
  return reducedMotion
    ? { transition: "none" }
    : { transitionProperty: props, transitionDuration: duration, transitionTimingFunction: "var(--ease-out)" };
}

/**
 * Arrow-key focus movement inside a radiogroup of buttons (Left/Up previous, Right/Down next,
 * Home/End). Put it on the group's onKeyDown; selection still happens with Space or Enter.
 */
export function radioGroupKeys(e: { key: string; currentTarget: HTMLElement; preventDefault: () => void }): void {
  const keys = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')];
  if (radios.length === 0) return;
  const i = radios.indexOf(document.activeElement as HTMLElement);
  let next = i;
  if (e.key === "Home") next = 0;
  else if (e.key === "End") next = radios.length - 1;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = i <= 0 ? radios.length - 1 : i - 1;
  else next = i < 0 || i >= radios.length - 1 ? 0 : i + 1;
  e.preventDefault();
  radios[next]?.focus();
}
