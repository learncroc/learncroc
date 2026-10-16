/**
 * /dev/widgets — the widget gallery: every widget, every example, live-editable props and goal,
 * Check graded by the spec, both themes, reduced motion, the three modes, and the sandboxed pack
 * interactives (a good one and a hostile one).
 */
import type { WidgetId, WidgetSpec } from "@learncroc/core";
import { cn } from "@learncroc/ui";
import { preloadWidget } from "@learncroc/widgets";
import { WIDGET_SPECS } from "@learncroc/widgets/host/specs";
import { type CSSProperties, useEffect, useState } from "react";
import { type CanvasSize, ExampleCard, type GalleryExample } from "./ExampleCard";
import { SandboxSection } from "./SandboxSection";

type Mode = "explore" | "answer" | "review";
type AnySpec = WidgetSpec<unknown, unknown, unknown>;

const FAMILIES: { id: AnySpec["family"]; label: string }[] = [
  { id: "llm", label: "LLM" },
  { id: "generic", label: "Generic" },
  { id: "physics", label: "Physics" },
  { id: "language", label: "Language" },
  { id: "code", label: "Code" },
];

const SPECS = Object.values(WIDGET_SPECS) as AnySpec[];

/**
 * The un-themed world defaults, re-declared on the gallery root: the :root defaults resolve against
 * the page's theme, so without this a dark gallery would keep a light canvas under dark ink.
 */
const GALLERY_WORLD = {
  "--w-ground": "var(--surface-2)",
  "--w-ink": "var(--ink)",
  "--w-ink-2": "var(--ink-2)",
  "--w-grid": "var(--line)",
} as CSSProperties;

function Segmented<T extends string>(p: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="sr-only">{p.label}</legend>
      <span className="text-small text-ink-2" aria-hidden="true">
        {p.label}
      </span>
      <span className="inline-flex rounded-sm border border-line-strong bg-surface p-0.5">
        {p.options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "cursor-pointer rounded-xs px-2.5 py-1 text-small has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
              p.value === o.value ? "bg-ink text-surface" : "text-ink-2 hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={p.label}
              value={o.value}
              checked={p.value === o.value}
              onChange={() => p.onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </span>
    </fieldset>
  );
}

export function DevWidgetsScreen() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mode, setMode] = useState<Mode>("answer");
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [family, setFamily] = useState<AnySpec["family"] | "all">("all");
  const [canvas, setCanvas] = useState<CanvasSize>("full");

  useEffect(() => {
    for (const s of SPECS) preloadWidget(s.id);
  }, []);

  const shown = SPECS.filter((s) => family === "all" || s.family === family);

  return (
    <div
      data-theme={theme}
      className="min-h-full bg-bg text-ink"
      style={{ colorScheme: theme, ...GALLERY_WORLD }}
      data-screen="Widget gallery"
    >
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-bg/95 px-8 py-4 backdrop-blur">
        <div className="mr-auto flex flex-col">
          <h1 className="t-title text-ink">Widget gallery</h1>
          <p className="text-small text-ink-3">
            {SPECS.length} widgets · {SPECS.reduce((n, s) => n + s.examples.length, 0)} examples ·{" "}
            <code>/dev/widgets</code>
          </p>
        </div>
        <Segmented
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <Segmented
          label="Mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "explore", label: "Explore" },
            { value: "answer", label: "Answer" },
            { value: "review", label: "Review" },
          ]}
        />
        <Segmented
          label="Canvas"
          value={canvas}
          onChange={setCanvas}
          options={[
            { value: "full", label: "Full width" },
            { value: "modal", label: "Modal width" },
            { value: "modal-canvas", label: "700×340" },
          ]}
        />
        <label className="inline-flex items-center gap-2 text-small text-ink-2">
          <input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.currentTarget.checked)} />
          Reduced motion
        </label>
      </header>
      <div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-8 px-8 py-6">
        <nav aria-label="Widgets" className="sticky top-28 flex h-fit flex-col gap-4 text-small">
          <button
            type="button"
            className={cn(
              "w-fit text-left text-small text-ink-2 hover:text-ink",
              family === "all" && "font-semibold text-ink",
            )}
            onClick={() => setFamily("all")}
            aria-pressed={family === "all"}
          >
            All families
          </button>
          {FAMILIES.map((f) => {
            const list = SPECS.filter((s) => s.family === f.id);
            if (!list.length) return null;
            return (
              <div key={f.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  className={cn("w-fit text-left text-micro text-ink-3 hover:text-ink", family === f.id && "text-ink")}
                  onClick={() => setFamily(family === f.id ? "all" : f.id)}
                  aria-pressed={family === f.id}
                >
                  {f.label}
                </button>
                <ul className="flex flex-col gap-0.5">
                  {list.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#w-${s.id}`}
                        className="flex justify-between rounded-xs px-1.5 py-0.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
                      >
                        <span>{s.id}</span>
                        <span className="text-ink-3 tabular">{s.examples.length}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <a href="#sandboxed" className="rounded-xs px-1.5 py-0.5 text-ink-2 hover:bg-surface-2 hover:text-ink">
            Sandboxed interactives
          </a>
        </nav>
        <main className="flex min-w-0 flex-col gap-12">
          {shown.map((spec) => (
            <WidgetSection
              key={spec.id}
              spec={spec}
              mode={mode}
              theme={theme}
              reducedMotion={reducedMotion}
              canvas={canvas}
            />
          ))}
          <SandboxSection theme={theme} reducedMotion={reducedMotion} mode={mode} />
        </main>
      </div>
    </div>
  );
}

function WidgetSection(p: {
  spec: AnySpec;
  mode: Mode;
  theme: "light" | "dark";
  reducedMotion: boolean;
  canvas: CanvasSize;
}) {
  const { spec } = p;
  return (
    <section
      id={`w-${spec.id}`}
      aria-labelledby={`w-${spec.id}-title`}
      className="flex scroll-mt-28 flex-col gap-4"
      data-gallery-widget={spec.id}
    >
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id={`w-${spec.id}-title`} className="text-heading text-ink">
            {spec.title}
          </h2>
          <code className="text-small text-ink-3">{spec.id}</code>
          <span className="rounded-xs bg-surface-2 px-1.5 text-micro text-ink-2">{spec.family}</span>
        </div>
        <p className="max-w-[72ch] text-body text-ink-2">{spec.description}</p>
        <details className="max-w-[72ch] text-small text-ink-2">
          <summary className="cursor-pointer hover:text-ink">For authors and the AI</summary>
          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-ink-3">Use when</dt>
            <dd>{spec.llmDoc.useWhen}</dd>
            <dt className="text-ink-3">Not for</dt>
            <dd>{spec.llmDoc.notFor}</dd>
            <dt className="text-ink-3">Learner does</dt>
            <dd>{spec.llmDoc.learnerDoes}</dd>
            <dt className="text-ink-3">Reports</dt>
            <dd>
              <code>{spec.llmDoc.reports}</code>
            </dd>
          </dl>
        </details>
      </header>
      {spec.examples.length === 0 ? (
        <p className="text-small text-ink-3">No examples yet.</p>
      ) : (
        <div className={cn("grid gap-6", p.canvas === "full" && "2xl:grid-cols-2")}>
          {spec.examples.map((ex, i) => (
            <ExampleCard
              key={`${spec.id}-${ex.note}`}
              widgetId={spec.id as WidgetId}
              index={i}
              example={ex as GalleryExample}
              mode={p.mode}
              theme={p.theme}
              reducedMotion={p.reducedMotion}
              canvas={p.canvas}
            />
          ))}
        </div>
      )}
    </section>
  );
}
