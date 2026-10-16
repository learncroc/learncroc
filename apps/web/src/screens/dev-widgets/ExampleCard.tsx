/**
 * One widget example in the gallery: the live widget on a canvas, Check (graded by the spec, as the
 * server would), Show answer / Show a wrong answer / Reset, and live-editable props and goal JSON
 * validated by the widget's own schema and semantic checks.
 */
import type { GradeResult, WidgetId, WidgetRef } from "@learncroc/core";
import { Button, cn } from "@learncroc/ui";
import { loadWidget, WidgetHost } from "@learncroc/widgets";
import { MODAL_CANVAS, widgetCanvas } from "@learncroc/widgets/host/specs";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { galleryAssetUrl } from "./demo-assets";

export interface GalleryExample {
  note: string;
  props: unknown;
  goal: unknown;
  correctAnswer: unknown;
  wrongAnswer: unknown;
}

type Mode = "explore" | "answer" | "review";

/**
 * Where the example renders: the full gallery column, the card modal's width (700 px), or the modal's
 * whole canvas (700 × 340 px, or the widget's declared `canvas.minHeight`), clipped so overflow shows.
 */
export type CanvasSize = "full" | "modal" | "modal-canvas";

/** How far the content of `el` overflows its box, in px (0 when it fits). */
function useOverflow(on: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) {
      setOver({ x: 0, y: 0 });
      return;
    }
    const measure = () => {
      const x = Math.max(0, el.scrollWidth - el.clientWidth);
      const y = Math.max(0, el.scrollHeight - el.clientHeight);
      setOver((o) => (o.x === x && o.y === y ? o : { x, y }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.querySelectorAll("*")) if (child.parentElement === el) ro.observe(child);
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    mo?.observe(el, { subtree: true, childList: true, attributes: true });
    return () => {
      ro.disconnect();
      mo?.disconnect();
    };
  }, [on]);
  return { ref, over };
}

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2) ?? "";
}

export function ExampleCard(p: {
  widgetId: WidgetId;
  index: number;
  example: GalleryExample;
  mode: Mode;
  theme: "light" | "dark";
  reducedMotion: boolean;
  canvas?: CanvasSize;
}) {
  const ids = useId();
  const size = p.canvas ?? "full";
  const boxed = size !== "full";
  const tall = Math.max(MODAL_CANVAS.height, widgetCanvas(p.widgetId).minHeight ?? 0);
  const { ref: canvasRef, over } = useOverflow(boxed);
  const [value, setValue] = useState<unknown>(undefined);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [checked, setChecked] = useState(false);
  const [propsText, setPropsText] = useState(() => pretty(p.example.props));
  const [goalText, setGoalText] = useState(() => pretty(p.example.goal));
  const [issues, setIssues] = useState<string[]>([]);
  const [config, setConfig] = useState<{ props: unknown; goal: unknown }>({
    props: p.example.props,
    goal: p.example.goal,
  });
  const [version, setVersion] = useState(0);

  const mode: Mode = checked ? "review" : p.mode;
  const widget: WidgetRef = useMemo(
    () => ({
      id: p.widgetId,
      v: 1,
      props: config.props as Record<string, unknown>,
      goal: mode === "explore" ? undefined : config.goal,
    }),
    [p.widgetId, config, mode],
  );

  const applyJson = async (nextProps: string, nextGoal: string) => {
    let props: unknown;
    let goal: unknown;
    try {
      props = JSON.parse(nextProps);
      goal = nextGoal.trim() ? JSON.parse(nextGoal) : undefined;
    } catch (e) {
      setIssues([`JSON: ${e instanceof Error ? e.message : String(e)}`]);
      return;
    }
    const { spec } = await loadWidget(p.widgetId);
    const pr = spec.props.safeParse(props);
    const gr = goal === undefined || !spec.goal ? { success: true as const, data: goal } : spec.goal.safeParse(goal);
    const found: string[] = [];
    if (!pr.success) for (const i of pr.error.issues) found.push(`props.${i.path.join(".")}: ${i.message}`);
    if (!gr.success) for (const i of gr.error.issues) found.push(`goal.${i.path.join(".")}: ${i.message}`);
    if (pr.success && gr.success) found.push(...spec.validate(pr.data, gr.data));
    setIssues(found);
    if (pr.success && gr.success) {
      setConfig({ props: pr.data, goal: gr.data });
      setValue(undefined);
      setResult(null);
      setChecked(false);
      setVersion((n) => n + 1);
    }
  };

  const check = async () => {
    const { spec } = await loadWidget(p.widgetId);
    const answer = spec.answer.safeParse(value ?? spec.initialAnswer(spec.props.parse(config.props)));
    if (!answer.success || !spec.goal) {
      setResult({ correct: false, score: 0, feedback: "The answer doesn't fit this widget's answer schema." });
      return;
    }
    setResult(
      spec.grade({ props: spec.props.parse(config.props), goal: spec.goal.parse(config.goal), answer: answer.data }),
    );
    setChecked(true);
  };

  const reset = () => {
    setValue(undefined);
    setResult(null);
    setChecked(false);
    setVersion((n) => n + 1);
  };

  return (
    <article
      className="flex flex-col gap-4 rounded-md border border-line bg-surface p-5 shadow-1"
      data-example={`${p.widgetId}:${p.index}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-body font-semibold text-ink">{p.example.note}</h3>
        <span className="text-micro text-ink-3 tabular">
          example {p.index + 1} · {mode}
        </span>
      </header>
      <div
        ref={canvasRef}
        className={cn("rounded-stage bg-w-ground p-6", boxed && "box-border shrink-0 overflow-hidden")}
        style={boxed ? { width: MODAL_CANVAS.width, height: size === "modal-canvas" ? tall : undefined } : undefined}
        data-canvas-size={size}
        data-overflow-x={over.x}
        data-overflow-y={over.y}
      >
        <WidgetHost
          key={version}
          widget={widget}
          mode={mode}
          value={value}
          onChange={setValue}
          solution={checked ? p.example.correctAnswer : undefined}
          reducedMotion={p.reducedMotion}
          theme={p.theme}
          assetUrl={galleryAssetUrl}
          alt={p.example.note}
        />
      </div>
      {boxed ? (
        <p className="-mt-2 text-micro text-ink-3 tabular" data-canvas-readout>
          {MODAL_CANVAS.width}×{size === "modal-canvas" ? tall : "auto"} px
          {over.x || over.y
            ? ` · overflows ${[over.x ? `${over.x} px wide` : "", over.y ? `${over.y} px tall` : ""].filter(Boolean).join(", ")}`
            : " · fits"}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={check} disabled={p.mode === "explore" || checked} kbd="⏎">
          Check
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setValue(p.example.correctAnswer);
            setResult(null);
            setChecked(false);
            setVersion((n) => n + 1);
          }}
        >
          Show answer
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setValue(p.example.wrongAnswer);
            setResult(null);
            setChecked(false);
            setVersion((n) => n + 1);
          }}
        >
          Show a wrong answer
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          Reset
        </Button>
        {result ? (
          <output
            className={cn("text-small", result.correct ? "font-semibold text-sea-text" : "text-ink-2")}
            data-result={result.correct}
          >
            {result.correct ? "Correct" : "Not yet"} · score {result.score.toFixed(2)}
            {result.feedback ? ` · ${result.feedback}` : ""}
          </output>
        ) : null}
      </div>
      <details className="group">
        <summary className="cursor-pointer text-small text-ink-2 hover:text-ink">Edit props and goal</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-small text-ink-2" htmlFor={`${ids}-props`}>
            props
            <textarea
              id={`${ids}-props`}
              value={propsText}
              spellCheck={false}
              rows={10}
              onChange={(e) => {
                setPropsText(e.currentTarget.value);
                void applyJson(e.currentTarget.value, goalText);
              }}
              className="voice-mono rounded-sm border border-line-strong bg-surface-2 p-2 text-code text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-small text-ink-2" htmlFor={`${ids}-goal`}>
            goal
            <textarea
              id={`${ids}-goal`}
              value={goalText}
              spellCheck={false}
              rows={10}
              onChange={(e) => {
                setGoalText(e.currentTarget.value);
                void applyJson(propsText, e.currentTarget.value);
              }}
              className="voice-mono rounded-sm border border-line-strong bg-surface-2 p-2 text-code text-ink"
            />
          </label>
        </div>
        {issues.length ? (
          <ul className="mt-2 flex flex-col gap-1 text-small text-ember-text" data-issues role="status">
            {issues.map((i, n) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: messages can repeat.
              <li key={n}>{i}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-small text-ink-3">Valid: the widget re-renders as you type.</p>
        )}
      </details>
    </article>
  );
}
