/**
 * ab-compare view: two versions, one difference.
 *
 * side-by-side  both panels at once.
 * toggle        one card you flip (button or F key while focused); the flip count is a small nudge
 *               to look twice.
 * wipe          drag the divider across, before/after style (arrow keys on the divider).
 * Then pick A, B or Same with the answer keys.
 */
import type { AssetPath } from "@learncroc/core";
import { cn } from "@learncroc/ui";
import { useRef, useState } from "react";
import { useDragPoint } from "../shared/drag";
import { clamp } from "../shared/math";
import {
  InlineMarkdown,
  KeyButton,
  motionStyle,
  ReviewNote,
  radioGroupKeys,
  WidgetShell,
  withReveal,
} from "../shared/ui";
import type { WidgetViewProps } from "../types";
import type { AbCompareAnswer, AbCompareGoal, AbComparePanel, AbCompareProps } from "./spec";

type Props = WidgetViewProps<AbCompareProps, AbCompareGoal, AbCompareAnswer>;
type Pick = AbCompareAnswer["pick"];

export default function AbCompareView(p: Props) {
  const props = withReveal(p.props, p.revealProps);
  const review = p.mode === "review";
  const interactive = !review && !!p.onChange;
  const picked = p.value?.pick;
  const answer = review ? (p.goal?.answer ?? p.solution?.pick) : undefined;

  const choose = (k: Pick) => {
    p.onChange?.({ pick: k });
    p.announce(k === "same" ? "Picked: the same." : `Picked ${k.toUpperCase()}: ${props[k].label}.`);
  };

  return (
    <WidgetShell id="ab-compare" mode={p.mode} label={`Compare ${props.a.label} and ${props.b.label}`}>
      {props.layout === "side-by-side" ? (
        <div className="grid gap-4 @xl:grid-cols-2">
          <Panel k="a" panel={props.a} assetUrl={p.assetUrl} picked={picked === "a"} isAnswer={answer === "a"} />
          <Panel k="b" panel={props.b} assetUrl={p.assetUrl} picked={picked === "b"} isAnswer={answer === "b"} />
        </div>
      ) : props.layout === "toggle" ? (
        <Toggle {...p} props={props} answer={answer} picked={picked} />
      ) : (
        <Wipe {...p} props={props} answer={answer} picked={picked} />
      )}
      <div
        className="flex flex-wrap items-center gap-3"
        role="radiogroup"
        aria-label="Your pick"
        onKeyDown={radioGroupKeys}
      >
        {(["a", "b", ...(props.allowSame ? (["same"] as const) : [])] as Pick[]).map((k, i) => (
          // biome-ignore lint/a11y/useSemanticElements: an answer-key button acting as a radio (WAI-ARIA radio group pattern).
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={picked === k}
            disabled={!interactive}
            onClick={() => choose(k)}
            className={cn(
              "relative inline-flex h-14 min-w-32 items-center gap-3 rounded-key border-[1.5px] border-ink px-4 text-body font-semibold text-ink transition-[transform,box-shadow,background-color] duration-press ease-out disabled:cursor-default",
              picked === k
                ? "translate-y-0.5 bg-sea-soft shadow-key-down"
                : "bg-surface shadow-key-rest active:translate-y-0.5 active:shadow-key-down",
              answer === k && "outline-2 outline-dashed outline-sea outline-offset-4",
            )}
          >
            <span
              className="flex size-6 items-center justify-center rounded-xs border border-ink-3 text-micro text-ink-2 tabular"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            {k === "same" ? "Same" : `${k.toUpperCase()} · ${props[k].label}`}
          </button>
        ))}
        {answer && picked && picked !== answer ? (
          <ReviewNote>The answer: {answer === "same" ? "the same" : answer.toUpperCase()}</ReviewNote>
        ) : null}
      </div>
    </WidgetShell>
  );
}

function Media({
  panel,
  assetUrl,
  className,
}: {
  panel: AbComparePanel;
  assetUrl: (a: AssetPath) => string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {panel.asset ? (
        <img
          src={assetUrl(panel.asset)}
          alt={panel.caption ?? panel.label}
          className="w-full rounded-sm object-contain"
          draggable={false}
        />
      ) : null}
      {panel.text ? (
        <p className="voice-casual text-lead text-w-ink">
          <InlineMarkdown text={panel.text} />
        </p>
      ) : null}
      {panel.caption && panel.text ? <p className="text-small text-w-ink-2">{panel.caption}</p> : null}
    </div>
  );
}

function Panel(p: {
  k: "a" | "b";
  panel: AbComparePanel;
  assetUrl: (a: AssetPath) => string;
  picked: boolean;
  isAnswer: boolean;
}) {
  return (
    <section
      aria-label={`${p.k.toUpperCase()}: ${p.panel.label}`}
      data-panel={p.k}
      className={cn(
        "flex flex-col gap-3 rounded-md border-[1.5px] bg-surface p-4 transition-[border-color,box-shadow] duration-quick",
        p.picked ? "border-ink shadow-2" : "border-line",
        p.isAnswer && "outline-2 outline-dashed outline-sea outline-offset-4",
      )}
    >
      <PanelHeader k={p.k} label={p.panel.label} />
      <Media panel={p.panel} assetUrl={p.assetUrl} />
    </section>
  );
}

function PanelHeader({ k, label }: { k: "a" | "b"; label: string }) {
  return (
    <header className="flex items-center gap-2">
      <span
        className="flex size-7 items-center justify-center rounded-sm bg-ink text-small font-bold text-surface"
        aria-hidden="true"
      >
        {k.toUpperCase()}
      </span>
      <span className="text-body font-semibold text-ink">{label}</span>
    </header>
  );
}

function Toggle(p: Props & { answer?: Pick; picked?: Pick }) {
  const { props } = p;
  const [side, setSide] = useState<"a" | "b">("a");
  const [flips, setFlips] = useState(0);
  const flip = () => {
    const next = side === "a" ? "b" : "a";
    setSide(next);
    setFlips((n) => n + 1);
    p.announce(`Showing ${next.toUpperCase()}: ${props[next].label}.`);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="relative" style={{ perspective: "1200px" }}>
        <div
          className="relative grid"
          style={{
            transformStyle: "preserve-3d",
            transform: !p.reducedMotion && side === "b" ? "rotateY(180deg)" : undefined,
            ...motionStyle(p.reducedMotion, "transform", "var(--dur-move)"),
          }}
        >
          {(["a", "b"] as const).map((k) => (
            <section
              key={k}
              aria-label={`${k.toUpperCase()}: ${props[k].label}`}
              aria-hidden={side !== k}
              data-panel={k}
              className={cn(
                "col-start-1 row-start-1 flex flex-col gap-3 rounded-md border-[1.5px] bg-surface p-4",
                p.picked === k ? "border-ink shadow-2" : "border-line",
                p.answer === k && "outline-2 outline-dashed outline-sea outline-offset-4",
                p.reducedMotion && side !== k && "invisible",
              )}
              style={
                p.reducedMotion
                  ? undefined
                  : { backfaceVisibility: "hidden", transform: k === "b" ? "rotateY(180deg)" : undefined }
              }
            >
              <PanelHeader k={k} label={props[k].label} />
              <Media panel={props[k]} assetUrl={p.assetUrl} />
            </section>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <KeyButton
          size="sm"
          onClick={flip}
          aria-label={`Flip to ${side === "a" ? "B" : "A"}`}
          aria-keyshortcuts="F"
          onKeyDown={(e) => {
            if (e.key === "f" || e.key === "F") {
              e.preventDefault();
              flip();
            }
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2 5h8.5L8 2.5M12 9H3.5L6 11.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Flip to {side === "a" ? "B" : "A"}
        </KeyButton>
        <span className="text-small text-w-ink-2 tabular" aria-hidden="true">
          {flips === 0 ? "Showing A" : `${flips} flip${flips === 1 ? "" : "s"}`}
        </span>
      </div>
    </div>
  );
}

function Wipe(p: Props & { answer?: Pick; picked?: Pick }) {
  const { props } = p;
  const [at, setAt] = useState(0.5);
  const stage = useRef<HTMLDivElement>(null);
  const announceAt = (v: number) =>
    p.announce(
      v <= 0.05
        ? `All ${props.b.label}.`
        : v >= 0.95
          ? `All ${props.a.label}.`
          : `${Math.round(v * 100)}% ${props.a.label}.`,
    );
  const { handlers, dragging } = useDragPoint({
    areaRef: stage,
    onMove: (nx) => setAt(nx),
    onEnd: () => announceAt(at),
  });
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={stage}
        className="relative w-full touch-none select-none overflow-hidden rounded-md border-[1.5px] border-line bg-surface"
        {...handlers}
      >
        <div className="p-4" data-panel="b">
          <Media panel={props.b} assetUrl={p.assetUrl} />
        </div>
        <div
          className="absolute inset-0 bg-surface p-4"
          data-panel="a"
          style={{
            clipPath: `inset(0 ${(1 - at) * 100}% 0 0)`,
            ...(dragging ? {} : motionStyle(p.reducedMotion, "clip-path", "var(--dur-quick)")),
          }}
        >
          <Media panel={props.a} assetUrl={p.assetUrl} />
        </div>
        <span
          className="pointer-events-none absolute top-2 left-2 rounded-xs bg-ink px-1.5 text-micro font-bold text-surface"
          aria-hidden="true"
        >
          A
        </span>
        <span
          className="pointer-events-none absolute top-2 right-2 rounded-xs bg-ink px-1.5 text-micro font-bold text-surface"
          aria-hidden="true"
        >
          B
        </span>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Wipe between A and B"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(at * 100)}
          aria-valuetext={`${Math.round(at * 100)}% ${props.a.label}`}
          className="absolute top-0 bottom-0 flex w-8 -translate-x-1/2 cursor-ew-resize justify-center"
          style={{
            left: `${at * 100}%`,
            ...(dragging ? {} : motionStyle(p.reducedMotion, "left", "var(--dur-quick)")),
          }}
          onKeyDown={(e) => {
            let next: number | null = null;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = at - (e.shiftKey ? 0.25 : 0.05);
            else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = at + (e.shiftKey ? 0.25 : 0.05);
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = 1;
            if (next === null) return;
            e.preventDefault();
            const v = clamp(Math.round(next * 100) / 100, 0, 1);
            setAt(v);
            announceAt(v);
          }}
        >
          <span className="h-full w-0.5 bg-ink" />
          <span className="absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-pill border-[1.5px] border-ink bg-surface shadow-2">
            <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
              <path
                d="M4 1L1 5l3 4M10 1l3 4-3 4"
                fill="none"
                stroke="var(--ink)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>
      <div className="flex justify-between text-small text-w-ink-2">
        <span>
          {props.a.label}
          {props.a.caption ? ` · ${props.a.caption}` : ""}
          {p.answer === "a" ? " (the answer)" : ""}
        </span>
        <span>
          {props.b.label}
          {props.b.caption ? ` · ${props.b.caption}` : ""}
          {p.answer === "b" ? " (the answer)" : ""}
        </span>
      </div>
    </div>
  );
}
