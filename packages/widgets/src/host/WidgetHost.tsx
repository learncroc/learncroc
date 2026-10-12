/**
 * WidgetHost: loads a widget's view and spec by id, validates its props, handles the three modes
 * (explore toys get the spec's opened-up props), restores the learner's value, draws the
 * VisualState note pinned on the canvas, forwards announcements to an aria-live region, and falls
 * back to the screen's figure plus "This interactive didn't load" when anything goes wrong.
 *
 * The host root is a CSS size container (`@container`): views lay out with Tailwind's `@sm:`/`@lg:`
 * container variants, so a widget fits the ~700 px card-modal canvas the same way it fits a wide page.
 */
import type { AssetPath, VisualState, WidgetId, WidgetRef } from "@learncroc/core";
import { cn } from "@learncroc/ui";
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import { type AnySpec, type LoadedWidget, loadWidget } from "../registry";

export interface WidgetHostProps {
  widget: WidgetRef;
  mode: "explore" | "answer" | "review";
  /** Controlled answer (restored from run scratch). Omit to let the host keep it. */
  value?: unknown;
  onChange?: (value: unknown) => void;
  onCommit?: (value: unknown) => void;
  /** Review mode. */
  solution?: unknown;
  /** Applied after answering: props merged into the widget, note drawn by the host. */
  visualState?: VisualState;
  reducedMotion: boolean;
  theme: "light" | "dark";
  assetUrl: (path: AssetPath) => string;
  /** Accessible description of the canvas (the visual's `alt`). */
  alt?: string;
  /** Shown if the widget fails to load (e.g. the fallback figure). */
  fallback?: ReactNode;
  className?: string;
  /** Called once when the widget fails to load or render (logged locally for `learncroc doctor`). */
  onError?: (error: Error) => void;
}

/** Thrown (and caught by the host's boundary) when a widget's props or goal fail its schema. */
export class WidgetConfigError extends Error {
  constructor(
    readonly widgetId: string,
    readonly issues: string[],
  ) {
    super(`Widget "${widgetId}" has invalid configuration: ${issues.join("; ")}`);
    this.name = "WidgetConfigError";
  }
}

export function WidgetHost(p: WidgetHostProps) {
  const [local, setLocal] = useState<unknown>(undefined);
  const [live, setLive] = useState("");
  const [attempt, setAttempt] = useState(0);
  const lastLive = useRef({ text: "", flip: false });
  const descId = useId();
  const value = p.value !== undefined ? p.value : local;
  const { onChange } = p;

  const announce = useCallback((text: string) => {
    // Re-announce identical text by toggling a zero-width suffix (live regions ignore no-op updates).
    const flip = text === lastLive.current.text ? !lastLive.current.flip : false;
    lastLive.current = { text, flip };
    setLive(flip ? `${text}\u200b` : text);
  }, []);

  const handleChange = useCallback(
    (v: unknown) => {
      setLocal(v);
      onChange?.(v);
    },
    [onChange],
  );

  const note = p.visualState?.note;

  return (
    <figure
      className={cn("lm-widget-host @container relative m-0 w-full min-w-0", p.className)}
      data-widget-host={p.widget.id}
      data-mode={p.mode}
      aria-label={p.alt}
      aria-describedby={descId}
    >
      <WidgetBoundary
        key={`${p.widget.id}:${attempt}`}
        onError={p.onError}
        fallback={(error) => (
          <WidgetFallback
            widgetId={p.widget.id}
            alt={p.alt}
            figure={p.fallback}
            error={error}
            onRetry={() => {
              hostedCache.delete(p.widget.id);
              setAttempt((n) => n + 1);
            }}
          />
        )}
      >
        <Suspense fallback={<WidgetLoading alt={p.alt} />}>
          <Hosted id={p.widget.id} {...p} value={value} onChange={handleChange} announce={announce} descId={descId} />
        </Suspense>
      </WidgetBoundary>
      {note ? <VisualNote text={note} reducedMotion={p.reducedMotion} /> : null}
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-widget-live>
        {live}
      </div>
    </figure>
  );
}

type InnerProps = WidgetHostProps & {
  announce: (text: string) => void;
  descId: string;
  onChange: (v: unknown) => void;
};

const hostedCache = new Map<WidgetId, LazyExoticComponent<ComponentType<InnerProps>>>();

/** One lazy component per widget id: loads the view and its spec together, then renders. */
function Hosted({ id, ...p }: InnerProps & { id: WidgetId }) {
  let C = hostedCache.get(id);
  if (!C) {
    C = lazy(() =>
      loadWidget(id).then((loaded) => ({ default: (inner: InnerProps) => <HostedView {...inner} loaded={loaded} /> })),
    );
    hostedCache.set(id, C);
  }
  return <C {...p} />;
}

function HostedView(p: InnerProps & { loaded: LoadedWidget }) {
  const { View, spec } = p.loaded;
  const { props, goal } = resolveConfig(spec, p.widget, p.mode);
  const value = p.value === undefined ? undefined : safeAnswer(spec, p.value);
  const solution = p.solution === undefined ? undefined : safeAnswer(spec, p.solution);
  return (
    <>
      <span id={p.descId} className="sr-only">
        {describe(spec, props, goal, p.mode, p.widget.id)}
      </span>
      <View
        props={props}
        goal={goal}
        mode={p.mode}
        value={value}
        onChange={p.mode === "review" ? undefined : p.onChange}
        onCommit={p.onCommit}
        solution={solution}
        revealProps={p.visualState?.props}
        reducedMotion={p.reducedMotion}
        theme={p.theme}
        announce={p.announce}
        assetUrl={p.assetUrl}
      />
    </>
  );
}

/**
 * The screen-reader description. While a task is open, widgets whose description computes the
 * answer (token-splitter reads out the real split) describe only the text, so the description
 * never gives the answer away before review.
 */
function describe(spec: AnySpec, props: unknown, goal: unknown, mode: WidgetHostProps["mode"], id: WidgetId): string {
  if (id === "token-splitter" && goal !== undefined && mode === "answer") {
    const text = (props as { text?: string }).text ?? "";
    return text ? `The text “${text}”, ready for your answer.` : "A token task, ready for your answer.";
  }
  return spec.textAlternative(props);
}

const configCache = new WeakMap<object, Map<string, { props: unknown; goal: unknown }>>();

/** Parse props and goal with the widget's schemas (cached per WidgetRef object and mode). */
export function resolveConfig(
  spec: AnySpec,
  ref: WidgetRef,
  mode: WidgetHostProps["mode"],
): { props: unknown; goal: unknown } {
  let byMode = configCache.get(ref);
  const hit = byMode?.get(mode);
  if (hit) return hit;
  const parsed = spec.props.safeParse(ref.props);
  if (!parsed.success) {
    throw new WidgetConfigError(
      ref.id,
      parsed.error.issues.map((i) => `${i.path.join(".") || "props"}: ${i.message}`),
    );
  }
  let goal: unknown;
  if (ref.goal !== undefined && spec.goal) {
    const g = spec.goal.safeParse(ref.goal);
    if (!g.success)
      throw new WidgetConfigError(
        ref.id,
        g.error.issues.map((i) => `goal.${i.path.join(".")}: ${i.message}`),
      );
    goal = g.data;
  }
  const props = mode === "explore" && spec.explore ? spec.explore(parsed.data) : parsed.data;
  const out = { props, goal };
  if (!byMode) {
    byMode = new Map();
    configCache.set(ref, byMode);
  }
  byMode.set(mode, out);
  return out;
}

/** A restored answer that no longer fits the schema (an older scratch) is dropped, not crashed on. */
function safeAnswer(spec: AnySpec, v: unknown): unknown {
  const r = spec.answer.safeParse(v);
  return r.success ? r.data : undefined;
}

interface BoundaryProps {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
  onError?: (error: Error) => void;
}

class WidgetBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  override componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error);
  }
  override render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

function WidgetFallback(p: { widgetId: string; alt?: string; figure?: ReactNode; error: Error; onRetry: () => void }) {
  const config = p.error instanceof WidgetConfigError;
  return (
    <div
      className="flex flex-col gap-3"
      data-widget-fallback={p.widgetId}
      data-widget-error={config ? "config" : "load"}
      title={config ? p.error.message : undefined}
    >
      {p.figure ? <div className="overflow-hidden rounded-md">{p.figure}</div> : null}
      {!p.figure && p.alt ? (
        <div className="rounded-md border border-dashed border-line-strong bg-surface-2 p-4 text-body text-ink-2">
          {p.alt}
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ember-text" role="status">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.5v4.2M8 11v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>
          This interactive didn't load.{" "}
          {p.figure ? "Here's the picture; the question still works." : "The question still works."}
        </span>
        {config ? null : (
          <button
            type="button"
            className="rounded-xs text-ink-2 underline underline-offset-2 hover:text-ink"
            onClick={p.onRetry}
          >
            Try again
          </button>
        )}
      </p>
    </div>
  );
}

function WidgetLoading({ alt }: { alt?: string }) {
  return (
    <div
      className="flex min-h-48 items-center justify-center rounded-md bg-surface-2/60 text-small text-ink-3"
      data-widget-loading
      aria-busy="true"
    >
      <span className="sr-only">Loading the interactive{alt ? `: ${alt}` : ""}</span>
    </div>
  );
}

/** VisualState.note: a short label pinned on the canvas after answering. */
function VisualNote({ text, reducedMotion }: { text: string; reducedMotion: boolean }) {
  return (
    <figcaption
      data-visual-note
      className={cn(
        "pointer-events-none absolute top-3 left-3 z-10 inline-flex max-w-[60%] items-center gap-2 rounded-sm border border-line-strong bg-surface px-3 py-1.5 text-small text-ink shadow-2 voice-casual",
        !reducedMotion &&
          "transition-[opacity,transform] duration-base ease-out starting:-translate-y-1 starting:opacity-0",
      )}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="4.5" r="3" fill="var(--sea)" />
        <path d="M6 7.5V11" stroke="var(--ink-2)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {text}
    </figcaption>
  );
}
