/**
 * token-splitter `split` goal: the learner marks where the tokenizer cuts a short text.
 *
 * The word is laid out on a fixed grid (every character in its own cell, a gap between every two
 * cells), so letters never move: cuts are 24 px handles that sit in the gaps and the chunks are
 * pills drawn behind the letters in the world's line colours (--w-1…--w-5, cycling).
 *
 * - Pointer: click anywhere along the word to add (or remove) the nearest cut; drag a handle along
 *   the word to move it (it stays between its neighbours); drag it off the word to remove it.
 *   A drop that changes nothing glides home on springs.wobble.
 * - Keyboard: one tab stop; ←/→ move the caret between gaps, Home/End jump, Space toggles a cut,
 *   Delete removes one, Enter checks (onCommit).
 * - Review (after Check, or the worked answer after two misses): the pills slide to the real
 *   cl100k boundaries with springs.snap and a 60 ms stagger, token ids appear under them, and the
 *   learner's own cuts stay readable underneath, misplaced chunks with a dotted ink-3 underline.
 */
import { cn, springs } from "@learncroc/ui";
import { motion, type Transition } from "motion/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { normaliseBoundaries, splitBoundaries, type TokenSplitterAnswer, type TokenSplitterGoal } from "./spec";
import { tokenizerReady, tokenPieces } from "./tokenize";

type SplitGoal = Extract<TokenSplitterGoal, { kind: "split" }>;

export interface SplitTaskProps {
  goal: SplitGoal;
  mode: "explore" | "answer" | "review";
  value?: TokenSplitterAnswer;
  onChange?: (value: TokenSplitterAnswer) => void;
  onCommit?: (value: TokenSplitterAnswer) => void;
  solution?: TokenSplitterAnswer;
  showIds: boolean;
  reducedMotion: boolean;
  announce: (text: string) => void;
}

/** Grid, in em of the word's font size. */
const CELL = 0.78;
const GAP = 0.62;
const PAD = 0.45;
const HANDLE_W = 22;
const BAR_H = 24;
const INSTANT: Transition = { duration: 0 };

/** Characters of `chunks` split at gap indices (gap g sits before character g). */
function chunksOf(chars: readonly string[], gaps: readonly number[]): { a: number; b: number; text: string }[] {
  const edges = [0, ...gaps, chars.length];
  const out: { a: number; b: number; text: string }[] = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const a = edges[k] as number;
    const b = edges[k + 1] as number;
    if (b > a) out.push({ a, b, text: chars.slice(a, b).join("") });
  }
  return out;
}

function said(text: string): string {
  return text.replace(/ /g, "␣");
}

function charName(ch: string | undefined): string {
  if (ch === undefined) return "";
  return ch === " " ? "space" : ch;
}

export function SplitTask(p: SplitTaskProps) {
  const text = p.goal.text;
  const chars = useMemo(() => [...text], [text]);
  const n = chars.length;
  /** UTF-16 offset of each code point: gap g's boundary is offsets[g]. */
  const offsets = useMemo(() => {
    const out: number[] = [];
    let at = 0;
    for (const ch of chars) {
      out.push(at);
      at += ch.length;
    }
    return out;
  }, [chars]);
  const toGaps = (boundaries: readonly number[] | undefined): number[] =>
    normaliseBoundaries(text, boundaries)
      .map((b) => offsets.indexOf(b))
      .filter((g) => g > 0);
  const toBoundaries = (gaps: readonly number[]): number[] =>
    [...gaps].sort((x, y) => x - y).map((g) => offsets[g] as number);

  const review = p.mode === "review";
  const interactive = !review && Boolean(p.onChange);
  const cuts = toGaps(p.value?.boundaries);
  const truth = !review
    ? null
    : p.solution?.boundaries
      ? toGaps(p.solution.boundaries)
      : tokenizerReady()
        ? toGaps(splitBoundaries(text))
        : null;

  // ── sizing: the word fits its container (the widget host is an @container) ───────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setAvail(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const units = n * CELL + Math.max(0, n - 1) * GAP + 2 * PAD;
  const fs = avail > 0 ? Math.max(14, Math.min(34, avail / units)) : 28;
  const cw = CELL * fs;
  const gw = GAP * fs;
  const pad = PAD * fs;
  const charLeft = (i: number) => pad + i * (cw + gw);
  const gapCenter = (g: number) => charLeft(g) - gw / 2;
  const width = units * fs;
  const rowH = Math.round(fs * 1.75);
  const pillH = Math.round(fs * 1.45);
  const nearestGap = (x: number) => Math.round((x - pad + gw / 2) / (cw + gw));

  // ── caret and drag ──────────────────────────────────────────────────────────────────────
  const [caret, setCaret] = useState(() => cuts[0] ?? 1);
  const [drag, setDrag] = useState<{ gap: number; x: number; target: number; off: boolean } | null>(null);
  const [landed, setLanded] = useState<{ gap: number; x: number; home: boolean } | null>(null);
  const dragRef = useRef<{
    gap: number;
    sx: number;
    sy: number;
    moved: boolean;
    min: number;
    max: number;
    pid: number;
  } | null>(null);

  const commit = (gaps: number[], verb: string) => {
    const boundaries = toBoundaries(gaps);
    p.onChange?.({ boundaries });
    const pieces = chunksOf(
      chars,
      [...gaps].sort((x, y) => x - y),
    ).map((c) => said(c.text));
    p.announce(`${verb}. ${pieces.length === 1 ? "One piece" : `${pieces.length} pieces`}: ${pieces.join(", ")}.`);
  };

  const toggle = (g: number) => {
    if (!interactive || g < 1 || g > n - 1) return;
    setLanded(null);
    if (cuts.includes(g))
      commit(
        cuts.filter((x) => x !== g),
        "Cut removed",
      );
    else commit([...cuts, g], "Cut added");
    setCaret(g);
  };

  const focusGap = (g: number) => {
    setCaret(g);
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-gap="${g}"]`);
    el?.focus();
  };

  const onGapKey = (e: ReactKeyboardEvent<HTMLButtonElement>, g: number) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      focusGap(Math.max(1, Math.min(n - 1, g + (e.key === "ArrowLeft" ? -1 : 1))));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      focusGap(e.key === "Home" ? 1 : n - 1);
    } else if ((e.key === "Delete" || e.key === "Backspace") && cuts.includes(g)) {
      e.preventDefault();
      toggle(g);
    } else if (e.key === "Enter") {
      // Enter checks; Space (the button's own click) toggles.
      e.preventDefault();
      if (interactive) p.onCommit?.({ boundaries: toBoundaries(cuts) });
    }
  };

  const onWordClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Keyboard clicks (detail 0) are the gap buttons' own; handles manage their own presses.
    if (!interactive || e.detail === 0) return;
    if (e.target instanceof Element && e.target.closest("[data-cut-handle]")) return;
    const box = wordRef.current?.getBoundingClientRect();
    if (!box) return;
    const g = nearestGap(e.clientX - box.left);
    if (g >= 1 && g <= n - 1) {
      toggle(g);
      focusGap(g);
    }
  };

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>, g: number) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sorted = [...cuts].sort((x, y) => x - y);
    const i = sorted.indexOf(g);
    const min = (sorted[i - 1] ?? 0) + 1;
    const max = (sorted[i + 1] ?? n) - 1;
    dragRef.current = { gap: g, sx: e.clientX, sy: e.clientY, moved: false, min, max, pid: e.pointerId };
    setLanded(null);
    setDrag({ gap: g, x: gapCenter(g), target: g, off: false });
    p.announce(`Picked up the cut before “${charName(chars[g])}”. Drag along the word, or off it to remove.`);

    const box = () => wordRef.current?.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      const r = box();
      if (!d || ev.pointerId !== d.pid || !r) return;
      if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 4) return;
      d.moved = true;
      const lo = gapCenter(d.min) - gw * 0.8;
      const hi = gapCenter(d.max) + gw * 0.8;
      const x = Math.max(lo, Math.min(hi, ev.clientX - r.left));
      const target = Math.max(d.min, Math.min(d.max, nearestGap(x)));
      const off = ev.clientY < r.top - 28 || ev.clientY > r.bottom + 28;
      setDrag({ gap: d.gap, x, target, off });
    };
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pid) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      dragRef.current = null;
      setDrag((cur) => {
        const last = cur ?? { gap: d.gap, x: gapCenter(d.gap), target: d.gap, off: false };
        queueMicrotask(() => settle(d, last, cancelled));
        return null;
      });
    };
    const onUp = (ev: PointerEvent) => finish(ev, false);
    const onCancel = (ev: PointerEvent) => finish(ev, true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !dragRef.current) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish({ pointerId: dragRef.current.pid } as PointerEvent, true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, { capture: true });
  };

  const settle = (
    d: { gap: number; moved: boolean },
    last: { x: number; target: number; off: boolean },
    cancelled: boolean,
  ) => {
    if (!d.moved && !cancelled) {
      toggle(d.gap); // a press without a drag removes the cut
      return;
    }
    if (cancelled) {
      setLanded({ gap: d.gap, x: last.x, home: true });
      p.announce("Cut put back.");
      return;
    }
    if (last.off) {
      commit(
        cuts.filter((x) => x !== d.gap),
        "Cut removed",
      );
      return;
    }
    if (last.target === d.gap) {
      setLanded({ gap: d.gap, x: last.x, home: true });
      return;
    }
    setLanded({ gap: last.target, x: last.x, home: false });
    setCaret(last.target);
    commit([...cuts.filter((x) => x !== d.gap), last.target], "Cut moved");
  };

  // ── what to draw ────────────────────────────────────────────────────────────────────────
  const previewCuts = drag
    ? drag.off
      ? cuts.filter((x) => x !== drag.gap)
      : [...cuts.filter((x) => x !== drag.gap), drag.target]
    : cuts;
  const shownCuts = [...(truth ?? previewCuts)].sort((x, y) => x - y);
  const pills = chunksOf(chars, shownCuts);
  const pieces = useMemo(() => (review && tokenizerReady() ? tokenPieces(text) : []), [review, text]);
  const idsAt = (a: number) => pieces.find((x) => x.start === offsets[a])?.ids;
  const mineChunks = chunksOf(
    chars,
    [...cuts].sort((x, y) => x - y),
  );
  const truthSet = new Set(truth ?? []);
  const exact = (c: { a: number; b: number }) =>
    (c.a === 0 || truthSet.has(c.a)) &&
    (c.b === n || truthSet.has(c.b)) &&
    ![...truthSet].some((g) => g > c.a && g < c.b);
  const allRight = truth !== null && cuts.length === truth.length && cuts.every((g) => truthSet.has(g));

  const pillMotion = (k: number): Transition =>
    p.reducedMotion ? INSTANT : review ? { ...springs.snap, delay: k * 0.06 } : springs.snap;

  return (
    <div className="flex flex-col gap-3" data-split-task data-cuts={toBoundaries(cuts).join(",")}>
      {review ? null : (
        <p className="text-small text-w-ink-2">
          Click between letters to cut. Drag a cut to move it, or off the word to remove it.
        </p>
      )}
      <div ref={rootRef} className="w-full overflow-x-auto overflow-y-visible py-2">
        {/* biome-ignore lint/a11y/useSemanticElements: a click shortcut over the gap buttons, laid out as one word. */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the gap buttons carry the keyboard path. */}
        <div
          ref={wordRef}
          role="group"
          aria-label={`“${text}”, with a cut button in every gap`}
          className={cn("relative mx-auto select-none", interactive && "cursor-text")}
          style={{ width, height: rowH + (review ? Math.round(fs * 0.9) : 0), fontSize: fs }}
          onClick={onWordClick}
          data-word
        >
          {/* chunk pills, behind the letters */}
          {pills.map((c, k) => {
            const color = `var(--w-${(k % 5) + 1})`;
            const ids = review ? idsAt(c.a) : undefined;
            return (
              <motion.div
                // biome-ignore lint/suspicious/noArrayIndexKey: pill k morphs to its new span when cuts change (the reveal slide).
                key={k}
                aria-hidden="true"
                data-chunk={c.text}
                className="pointer-events-none absolute rounded-key border-[1.5px]"
                initial={p.reducedMotion ? false : { opacity: 0 }}
                animate={{
                  left: charLeft(c.a) - gw * 0.3,
                  width: (c.b - c.a) * cw + (c.b - c.a - 1) * gw + gw * 0.6,
                  opacity: 1,
                }}
                transition={pillMotion(k)}
                style={{
                  top: (rowH - pillH) / 2,
                  height: pillH,
                  background: `color-mix(in srgb, ${color} 30%, var(--surface))`,
                  borderColor: `color-mix(in srgb, ${color} 80%, var(--ink))`,
                }}
              >
                {ids && p.showIds !== false ? (
                  <span
                    className="voice-mono absolute inset-x-0 text-center text-micro text-w-ink-2 tabular"
                    style={{ top: pillH + 4 }}
                  >
                    {ids.join(" ")}
                  </span>
                ) : null}
              </motion.div>
            );
          })}
          {/* the letters, fixed */}
          {chars.map((ch, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: characters of a fixed string.
              key={i}
              aria-hidden="true"
              className="voice-mono pointer-events-none absolute grid place-items-center text-w-ink"
              style={{ left: charLeft(i), width: cw, top: 0, height: rowH, lineHeight: 1 }}
            >
              {ch === " " ? <span className="text-ink-3">·</span> : ch}
            </span>
          ))}
          {/* valid target while dragging */}
          {drag && !drag.off ? (
            <div
              aria-hidden="true"
              data-drop-target-gap={drag.target}
              className="pointer-events-none absolute rounded-xs border-[1.5px] border-dashed border-sea bg-sea-soft/70"
              style={{ left: gapCenter(drag.target) - gw / 2, width: gw, top: 4, height: rowH - 8 }}
            />
          ) : null}
          {/* one button per gap: the keyboard and screen-reader path */}
          {chars.slice(1).map((ch, j) => {
            const g = j + 1;
            const isCut = cuts.includes(g);
            return (
              <button
                key={g}
                type="button"
                data-gap={g}
                tabIndex={caret === g ? 0 : -1}
                aria-pressed={isCut}
                aria-label={`Cut between “${charName(chars[g - 1])}” and “${charName(ch)}”`}
                disabled={!interactive}
                onFocus={() => setCaret(g)}
                onKeyDown={(e) => onGapKey(e, g)}
                onClick={(e) => {
                  if (e.detail === 0) toggle(g);
                }}
                className={cn(
                  "group absolute rounded-xs outline-offset-1 focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default",
                  interactive && "cursor-pointer",
                )}
                style={{ left: gapCenter(g) - Math.max(gw, 14) / 2, width: Math.max(gw, 14), top: 0, height: rowH }}
              >
                {interactive && !isCut ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 w-0 -translate-x-1/2 border-l-[1.5px] border-dashed border-line-strong opacity-0 transition-opacity duration-quick group-hover:opacity-100 group-focus-visible:opacity-100"
                    style={{ top: (rowH - BAR_H) / 2, height: BAR_H }}
                  />
                ) : null}
              </button>
            );
          })}
          {/* cut handles (the learner's; in review, the learner's cuts are listed below instead) */}
          {review
            ? null
            : cuts.map((g) => {
                const held = drag?.gap === g;
                const removing = held && drag.off;
                const fromDrop = landed && landed.gap === g ? landed : null;
                const left = (held ? drag.x : gapCenter(g)) - HANDLE_W / 2;
                const lifted = held && !p.reducedMotion && !removing;
                const transition: Transition = p.reducedMotion
                  ? INSTANT
                  : held
                    ? { left: INSTANT, default: springs.drag }
                    : fromDrop?.home
                      ? springs.wobble
                      : springs.snap;
                return (
                  <motion.div
                    key={g}
                    data-cut-handle={g}
                    aria-hidden="true"
                    className={cn(
                      "absolute z-10 flex touch-none flex-col items-center justify-center",
                      interactive ? (held ? "cursor-grabbing" : "cursor-grab") : "",
                    )}
                    style={{ top: 0, width: HANDLE_W, height: rowH }}
                    initial={fromDrop && !p.reducedMotion ? { left: fromDrop.x - HANDLE_W / 2 } : false}
                    animate={{
                      left,
                      scale: lifted ? 1.04 : 1,
                      rotate: lifted ? 1.5 : 0,
                      opacity: removing ? 0.35 : 1,
                    }}
                    transition={transition}
                    onPointerDown={(e) => onHandleDown(e, g)}
                  >
                    <span
                      className={cn(
                        "block w-1 rounded-pill bg-w-ink transition-shadow duration-quick",
                        lifted ? "shadow-3" : "shadow-1",
                      )}
                      style={{ height: BAR_H }}
                    />
                    <span
                      className={cn(
                        "mt-0.5 grid grid-cols-2 gap-[2px] rounded-xs px-[3px] py-[2px]",
                        lifted ? "bg-surface shadow-3" : "",
                      )}
                    >
                      {[0, 1, 2, 3, 4, 5].map((d) => (
                        <span key={d} className="block size-[3px] rounded-pill bg-w-ink-2" />
                      ))}
                    </span>
                  </motion.div>
                );
              })}
        </div>
      </div>
      {review ? (
        <div className="flex flex-col gap-1.5 text-body text-w-ink">
          <p>
            {truth ? (
              <>
                <strong className="tabular">{truth.length + 1}</strong> tokens:{" "}
                {chunksOf(chars, truth)
                  .map((c) => said(c.text))
                  .join(" · ")}
              </>
            ) : null}
          </p>
          {p.value ? (
            <p className="text-small text-w-ink-2" data-your-cuts>
              {allRight ? "Your cuts match. " : "Your cuts: "}
              {allRight
                ? null
                : mineChunks.map((c, k) => (
                    <span key={`${c.a}-${c.b}`}>
                      {k > 0 ? <span className="mx-1 text-ink-3">|</span> : null}
                      <span
                        data-misplaced={exact(c) ? undefined : true}
                        className={cn(
                          "voice-mono",
                          !exact(c) && "underline decoration-ink-3 decoration-dotted decoration-2 underline-offset-4",
                        )}
                      >
                        {said(c.text)}
                      </span>
                    </span>
                  ))}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-small text-w-ink-2" aria-live="off" data-split-count>
          {cuts.length === 0
            ? "No cuts yet: one piece."
            : `${cuts.length} cut${cuts.length === 1 ? "" : "s"}, ${cuts.length + 1} pieces.`}
          <span className="sr-only"> Arrow keys move between gaps, Space toggles a cut, Enter checks.</span>
        </p>
      )}
    </div>
  );
}
