/**
 * The canvas: the big manipulable visual on the left of a run (8 columns). It sits on the world's
 * ground, performs `visualState` after answers, and morphs in place between screens (a crossfade of
 * content, never a page slide). Widgets that fail to load fall back without stopping the run.
 */
import type { FrameToHost, PackTheme, Visual, VisualState, WidgetRef } from "@learncroc/core";
import { cn } from "@learncroc/ui";
import { SandboxFrame, WidgetHost } from "@learncroc/widgets";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import { AnimatePresence, motion } from "motion/react";
import { Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from "react";
import { assetUrl } from "../api/client";
import { useRunApi } from "./api";
import { worldVars } from "./world";

export type HtmlReport = Extract<FrameToHost, { type: "report" }>["value"];

export type CanvasContent =
  | { kind: "visual"; key: string; visual: Visual }
  | {
      kind: "widget";
      key: string;
      widget: WidgetRef;
      mode: "explore" | "answer" | "review";
      value?: unknown;
      onChange?: (v: unknown) => void;
      onCommit?: (v: unknown) => void;
      solution?: unknown;
      alt?: string;
    }
  | {
      kind: "html";
      key: string;
      asset: string;
      height: number;
      alt: string;
      mode: "explore" | "answer" | "review";
      onReport?: (v: HtmlReport) => void;
    };

export interface CanvasProps {
  packId: string;
  nodeId?: string;
  theme: PackTheme;
  content?: CanvasContent;
  /** Applied after answering, or while a chosen option is acted out. */
  visualState?: VisualState;
  reducedMotion: boolean;
  /** The canvas failed to show its interactive; the caller switches to the built-in fallback. */
  onFail?: (reason: string) => void;
  className?: string;
  /** Full-bleed (toy screen) rather than the run's 8-column card. */
  size?: "run" | "full";
}

export function Canvas({
  packId,
  nodeId,
  theme,
  content,
  visualState,
  reducedMotion,
  onFail,
  className,
  size = "run",
}: CanvasProps) {
  return (
    <section
      id="run-canvas"
      aria-label="Canvas"
      data-theme={theme.mode}
      data-canvas
      className={cn(
        "relative isolate flex min-h-[360px] flex-col overflow-hidden rounded-stage text-[var(--w-ink)] shadow-2",
        size === "full" ? "min-h-[70dvh]" : "",
        className,
      )}
      style={{ ...worldVars(theme), background: "var(--w-ground)" }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {content ? (
          <motion.div
            key={content.key}
            className="flex min-h-0 flex-1 flex-col p-6"
            initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? { duration: 0.12 } : { duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <CanvasBoundary key={content.key} onFail={onFail}>
              <CanvasBody
                packId={packId}
                nodeId={nodeId}
                theme={theme}
                content={content}
                visualState={visualState}
                reducedMotion={reducedMotion}
                onFail={onFail}
              />
            </CanvasBoundary>
          </motion.div>
        ) : (
          <div key="empty" className="flex-1" aria-hidden />
        )}
      </AnimatePresence>
    </section>
  );
}

function widgetAlt(widget: WidgetRef, alt?: string): string {
  if (alt) return alt;
  const spec = widgetSpecRegistry.get(widget.id);
  try {
    return spec?.textAlternative(widget.props) ?? spec?.title ?? widget.id;
  } catch {
    return spec?.title ?? widget.id;
  }
}

function CanvasBody({
  packId,
  nodeId,
  theme,
  content,
  visualState,
  reducedMotion,
  onFail,
}: Required<Pick<CanvasProps, "packId" | "theme" | "reducedMotion">> &
  Pick<CanvasProps, "nodeId" | "visualState" | "onFail"> & { content: CanvasContent }) {
  const toUrl = (p: string) => assetUrl(packId, p);
  const mode = theme.mode;
  if (content.kind === "widget") {
    return (
      <WidgetHost
        widget={content.widget}
        mode={content.mode}
        value={content.value}
        onChange={content.onChange}
        onCommit={content.onCommit}
        solution={content.solution}
        visualState={visualState}
        reducedMotion={reducedMotion}
        theme={mode}
        assetUrl={toUrl}
        alt={widgetAlt(content.widget, content.alt)}
        fallback={<CanvasLoading />}
        className="flex min-h-0 flex-1 flex-col"
      />
    );
  }
  if (content.kind === "html") {
    return (
      <HtmlFrame
        packId={packId}
        asset={content.asset}
        height={content.height}
        alt={content.alt}
        mode={content.mode}
        theme={mode}
        reducedMotion={reducedMotion}
        onReport={content.onReport}
        onFail={onFail}
      />
    );
  }
  const v = content.visual;
  switch (v.kind) {
    case "widget":
      return (
        <WidgetHost
          widget={v.widget}
          mode="explore"
          visualState={visualState}
          reducedMotion={reducedMotion}
          theme={mode}
          assetUrl={toUrl}
          alt={widgetAlt(v.widget, v.alt)}
          fallback={<CanvasLoading />}
          className="flex min-h-0 flex-1 flex-col"
        />
      );
    case "figure":
      return (
        <figure className="relative flex flex-1 flex-col items-center justify-center gap-2">
          <ThemedFigure url={toUrl(v.asset)} alt={v.alt} ground={theme.ground} />
          {v.caption ? <figcaption className="text-small text-[var(--w-ink-2)]">{v.caption}</figcaption> : null}
          {visualState?.note ? <NotePin text={visualState.note} /> : null}
        </figure>
      );
    case "html":
      return (
        <HtmlFrame
          packId={packId}
          asset={v.asset}
          height={v.height}
          alt={v.alt}
          mode="explore"
          theme={mode}
          reducedMotion={reducedMotion}
          onFail={onFail}
        />
      );
    case "generated-html":
      return (
        <HtmlFrame
          packId={packId}
          nodeId={nodeId}
          generated
          height={v.height}
          alt={v.alt}
          mode="explore"
          theme={mode}
          reducedMotion={reducedMotion}
          onFail={onFail}
        />
      );
  }
}

/** Figure colours that mean the world's, not the app's: the canvas ground may be dark in a light app. */
const FIGURE_VAR_ALIASES: Record<string, string> = { "--ink": "--w-ink", "--ink-2": "--w-ink-2" };

/**
 * Figures colour themselves with var(--ink), var(--w-1)…, which an <img> can't see (strokes vanish,
 * fills turn black). Resolve them against the canvas's world colours and show the result as a data
 * URL, so the SVG still never runs in the page.
 */
function ThemedFigure({ url, alt, ground }: { url: string; alt: string; ground: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new ground means new world colours to resolve
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctl = new AbortController();
    fetch(url, { credentials: "same-origin", signal: ctl.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((svg) => {
        const css = getComputedStyle(el);
        const font = css.fontFamily.replace(/['"]/g, "");
        const themed = svg
          .replace(/var\((--[a-z0-9-]+)\)/g, (m, name: string) => {
            return css.getPropertyValue(FIGURE_VAR_ALIASES[name] ?? name).trim() || m;
          })
          .replace(/<svg\b(?![^>]*font-family)/, `<svg font-family="${font}"`);
        setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(themed)}`);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setSrc(url);
      });
    return () => ctl.abort();
  }, [url, ground]);
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      className={cn("max-h-[440px] w-full object-contain", src ? "" : "invisible")}
      draggable={false}
    />
  );
}

/** A label pinned on the canvas (VisualState.note, ≤ 8 words). */
export function NotePin({ text }: { text: string }) {
  return (
    <p
      data-visual-note
      className="absolute top-4 right-4 rounded-sm border border-[var(--w-grid)] bg-[var(--w-ground)] px-2 py-1 text-small font-semibold text-[var(--w-ink)] shadow-1"
    >
      {text}
    </p>
  );
}

function CanvasLoading() {
  return (
    <div className="flex flex-1 items-center justify-center text-small text-[var(--w-ink-2)]" role="status">
      Setting up the canvas…
    </div>
  );
}

interface HtmlFrameProps {
  packId: string;
  nodeId?: string;
  asset?: string;
  generated?: boolean;
  height: number;
  alt: string;
  mode: "explore" | "answer" | "review";
  theme: "light" | "dark";
  reducedMotion: boolean;
  onReport?: (v: HtmlReport) => void;
  onFail?: (reason: string) => void;
}

/** A sandbox-origin frame: registers a one-time URL (POST /frames) just before mounting. */
function HtmlFrame(p: HtmlFrameProps) {
  const client = useRunApi();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const { packId, nodeId, asset, generated, onFail } = p;
  useEffect(() => {
    let alive = true;
    client
      .registerFrame({
        packId,
        ...(asset ? { asset } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(generated ? { generated: true } : {}),
      })
      .then((r) => alive && setUrl(r.url))
      .catch(() => {
        if (!alive) return;
        setFailed("frame");
        onFail?.("This interactive needs the local app.");
      });
    return () => {
      alive = false;
    };
  }, [client, packId, nodeId, asset, generated, onFail]);
  if (failed) return <FrameFallback alt={p.alt} />;
  if (!url) return <CanvasLoading />;
  return (
    <div className="flex flex-col gap-2">
      <p className="self-start rounded-pill border border-[var(--w-grid)] px-2 text-micro text-[var(--w-ink-2)]">
        Custom interactive
      </p>
      <SandboxFrame
        url={url}
        title={p.alt}
        height={Math.min(900, Math.max(120, p.height))}
        mode={p.mode}
        theme={p.theme}
        reducedMotion={p.reducedMotion}
        onReport={p.onReport}
        onAnnounce={setLive}
        onFail={(reason) => {
          setFailed(reason);
          p.onFail?.(reason);
        }}
      />
      <div aria-live="polite" className="sr-only">
        {live}
      </div>
    </div>
  );
}

function FrameFallback({ alt }: { alt: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center" role="note">
      <p className="text-body text-[var(--w-ink)]">{alt}</p>
      <p className="text-small text-[var(--w-ink-2)]">This interactive didn't load. The question still works.</p>
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  onFail?: (reason: string) => void;
}

/** Widget error boundary: shows a calm note and lets the run continue on the fallback interaction. */
class CanvasBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onFail?.(error.message || "widget failed");
  }
  override render() {
    if (this.state.failed) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center" role="note">
          <p className="text-body text-[var(--w-ink)]">This interactive didn't load.</p>
          <p className="text-small text-[var(--w-ink-2)]">The question still works in the coach column.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
