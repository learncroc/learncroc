/**
 * tile-builder view: tap tiles to build a sentence (or a program), reorder by dragging or with Space + arrow
 * keys, set indents with ←/→ in lines mode. With showAgreement, gender is shape and colour (masculine: square,
 * sea; feminine: round, iris; plural: a double edge) and clashing neighbours get a dashed outline.
 */
import { Button, cn } from "@learncroc/ui";
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePhrase } from "../audio/usePhrase";
import { useAnswer } from "../light-clock/view-kit";
import { useButtonsMode } from "../shared/drag";
import { hashString, rng } from "../shared/math";
import { KeyButton, WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import {
  agreementClashes,
  joinTiles,
  MAX_INDENT,
  type Tile,
  type TileBuilderAnswer,
  type TileBuilderGoal,
  type TileBuilderProps,
  tileBuilderSpec,
} from "./spec";

type Props = WidgetViewProps<TileBuilderProps, TileBuilderGoal, TileBuilderAnswer>;

export default function TileBuilderView(p: Props) {
  const props = useMemo(() => withReveal(p.props, p.revealProps), [p.props, p.revealProps]);
  const lines = props.mode === "lines";
  const readOnly = p.mode === "review";
  const [answer, setAnswer] = useAnswer(p.value, () => tileBuilderSpec.initialAnswer(props), p.onChange);
  const [buttons] = useButtonsMode();
  const byId = useMemo(() => new Map(props.tiles.map((t) => [t.id, t])), [props.tiles]);

  const seq = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of answer.sequence) {
      if (byId.has(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }, [answer.sequence, byId]);
  const indents = seq.map((_, i) => (lines ? (answer.indents?.[i] ?? 0) : 0));

  // The tray keeps a stable shuffled order, so authored order never gives the answer away.
  const trayOrder = useMemo(() => {
    const r = rng(hashString(props.tiles.map((t) => t.id).join("|")));
    const order = props.tiles.map((t) => t.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [order[i], order[j]] = [order[j] as string, order[i] as string];
    }
    return order;
  }, [props.tiles]);
  const tray = trayOrder.filter((id) => !seq.includes(id));

  const text = (id: string) => byId.get(id)?.text ?? id;
  const readBack = (s: readonly string[]) =>
    s.length === 0 ? "Nothing placed yet." : lines ? `${s.length} lines placed.` : `Now: ${joinTiles(s.map(text))}`;

  const commit = (nextSeq: string[], nextIndents: number[], say?: string) => {
    setAnswer(lines ? { sequence: nextSeq, indents: nextIndents } : { sequence: nextSeq });
    if (say) p.announce(say);
  };
  const add = (id: string) => {
    if (readOnly) return;
    const next = [...seq, id];
    commit(next, [...indents, 0], `Added ${text(id)}. ${readBack(next)}`);
  };
  const remove = (index: number) => {
    if (readOnly) return;
    const id = seq[index];
    if (id === undefined) return;
    const next = seq.filter((_, i) => i !== index);
    commit(
      next,
      indents.filter((_, i) => i !== index),
      `Removed ${text(id)}. ${readBack(next)}`,
    );
  };
  const move = (from: number, to: number, say = true) => {
    if (readOnly || from === to || to < 0 || to >= seq.length) return;
    const s = [...seq];
    const ind = [...indents];
    const [id] = s.splice(from, 1);
    const [n] = ind.splice(from, 1);
    s.splice(to, 0, id as string);
    ind.splice(to, 0, n ?? 0);
    commit(s, ind, say ? `${text(id as string)}, position ${to + 1} of ${s.length}.` : undefined);
  };
  const indent = (index: number, delta: number) => {
    if (readOnly || !lines) return;
    const cur = indents[index] ?? 0;
    const n = Math.max(0, Math.min(MAX_INDENT, cur + delta));
    if (n === cur) return;
    const ind = indents.map((x, i) => (i === index ? n : x));
    commit(seq, ind, `${text(seq[index] as string)}: indent ${n}.`);
  };

  // Keyboard carry: Space picks up, arrows move, Space drops, Escape puts it back.
  const [held, setHeld] = useState<{ id: string; from: number } | null>(null);
  const onPlacedKey = (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (readOnly) return;
    const id = seq[index] as string;
    const isHeld = held?.id === id;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (isHeld) {
        setHeld(null);
        p.announce(`Dropped ${text(id)} at position ${index + 1}.`);
      } else {
        setHeld({ id, from: index });
        p.announce(
          `Picked up ${text(id)}, position ${index + 1} of ${seq.length}. Arrow keys move it, Space drops, Escape cancels.`,
        );
      }
      return;
    }
    if (e.key === "Escape" && isHeld && held) {
      e.preventDefault();
      e.stopPropagation();
      const from = held.from;
      setHeld(null);
      move(index, from, false);
      p.announce(`${text(id)} put back at position ${from + 1}.`);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setHeld(null);
      remove(index);
      return;
    }
    if (isHeld) {
      const prev = lines ? "ArrowUp" : "ArrowLeft";
      const next = lines ? "ArrowDown" : "ArrowRight";
      if (e.key === prev || e.key === next) {
        e.preventDefault();
        move(index, index + (e.key === prev ? -1 : 1));
      }
      return;
    }
    if (lines && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      indent(index, e.key === "ArrowRight" ? 1 : -1);
    }
  };

  // Pointer drag to reorder placed tiles.
  const listRef = useRef<HTMLOListElement>(null);
  // Reordering can re-insert the held tile's DOM node, which drops focus in real browsers: put it back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run whenever the order changes.
  useEffect(() => {
    if (!held) return;
    const li = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-placed]") ?? []).find(
      (x) => x.dataset.placed === held.id,
    );
    const el = li?.querySelector<HTMLElement>("button");
    if (el && document.activeElement !== el) el.focus();
  }, [held, seq]);
  const drag = useRef<{ id: string; x: number; y: number; pid: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const seqRef = useRef(seq);
  seqRef.current = seq;
  const moveRef = useRef(move);
  moveRef.current = move;
  const moveRemove = useRef(remove);
  moveRemove.current = remove;
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: globalThis.PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pid) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
      d.moved = true;
      const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-placed]") ?? []);
      const cur = seqRef.current.indexOf(d.id);
      let target = cur;
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const mid = lines ? r.top + r.height / 2 : r.left + r.width / 2;
        const pos = lines ? e.clientY : e.clientX;
        if (i < cur && pos < mid) target = Math.min(target, i);
        if (i > cur && pos > mid) target = Math.max(target, i);
      });
      if (target !== cur) moveRef.current(cur, target, false);
    };
    const onUp = (e: globalThis.PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pid) return;
      drag.current = null;
      setDragging(null);
      const at = seqRef.current.indexOf(d.id);
      if (d.moved) p.announce(`${byId.get(d.id)?.text ?? d.id}, position ${at + 1} of ${seqRef.current.length}.`);
      else if (!lines) moveRemove.current(at);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, lines, byId, p.announce]);
  const onPlacedPointerDown = (id: string) => (e: PointerEvent<HTMLButtonElement>) => {
    if (readOnly || e.button !== 0 || buttons) return;
    drag.current = { id, x: e.clientX, y: e.clientY, pid: e.pointerId, moved: false };
    setDragging(id);
  };

  // Audio: read the built sentence aloud.
  const phrase = usePhrase();
  const canSpeak = !lines && props.speak && props.lang;
  const speakSentence = (ids: readonly string[]) => {
    if (!canSpeak || ids.length === 0) return;
    void phrase.play({ tts: { text: joinTiles(ids.map(text)), lang: props.lang as string }, assetUrl: p.assetUrl });
  };
  const spokeReview = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: speak once when the answer is checked.
  useEffect(() => {
    if (p.mode === "review" && !spokeReview.current && seq.length > 0) {
      spokeReview.current = true;
      speakSentence(seq);
    }
  }, [p.mode]);

  const clashes = props.showAgreement ? agreementClashes(props.tiles, seq) : [];
  const clashWith = (i: number) =>
    clashes.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : [])).map((j) => text(seq[j] as string));
  const helpId = useId();
  const solution = readOnly ? p.solution : undefined;
  const solutionDiffers =
    solution &&
    (solution.sequence.join("\u0000") !== seq.join("\u0000") ||
      (lines && (solution.indents ?? []).join() !== indents.join()));

  return (
    <WidgetShell
      id="tile-builder"
      mode={p.mode}
      label={tileBuilderSpec.title}
      buttonsToggle={!readOnly}
      toolbar={props.showAgreement && !lines ? <AgreementKey /> : undefined}
    >
      {props.meaning ? (
        <p className="voice-casual text-lead text-ink">
          <span className="text-ink-2">Say: </span>
          {props.meaning}
        </p>
      ) : null}
      <p id={helpId} className="sr-only">
        {lines
          ? "Placed lines: Space picks a line up, up and down arrows move it, Space drops it. Left and right arrows change its indent. Delete removes it."
          : "Placed tiles: Space picks a tile up, arrow keys move it, Space drops it. Delete removes it."}
      </p>

      <ol
        ref={listRef}
        aria-label={lines ? "Your program" : "Your sentence"}
        aria-describedby={helpId}
        className={cn(
          "min-h-16 rounded-stage border-[1.5px] border-dashed border-line-strong bg-surface-2 p-3",
          lines ? "flex flex-col gap-1.5" : "flex flex-wrap items-center gap-2",
        )}
      >
        {seq.length === 0 ? (
          <li className="list-none self-center text-small text-ink-3">
            {lines ? "Tap lines below to build the program." : "Tap tiles below to build the sentence."}
          </li>
        ) : null}
        {seq.map((id, i) => {
          const tile = byId.get(id) as Tile;
          const clash = clashWith(i);
          const isHeld = held?.id === id || dragging === id;
          return (
            <li key={id} className={cn("flex list-none items-center gap-1", lines && "w-full")} data-placed={id}>
              {lines ? <IndentGuides n={indents[i] ?? 0} /> : null}
              <button
                type="button"
                disabled={readOnly}
                aria-pressed={held?.id === id}
                aria-roledescription={lines ? "movable line" : "movable tile"}
                aria-label={`${tile.text}${lines ? `, indent ${indents[i] ?? 0}` : ""}, position ${i + 1} of ${seq.length}${
                  clash.length ? `, doesn't agree with ${clash.join(" and ")}` : ""
                }`}
                onKeyDown={onPlacedKey(i)}
                onPointerDown={onPlacedPointerDown(id)}
                style={{ touchAction: "none" }}
                className={cn(
                  tileClass(tile, props.showAgreement ?? false, lines),
                  isHeld && "-translate-y-0.5 shadow-2 ring-2 ring-focus",
                  clash.length > 0 && "outline-2 outline-offset-[5px] outline-dashed outline-ink-2",
                  !readOnly && "cursor-grab",
                )}
              >
                {props.showAgreement && !lines ? <GenderGlyph tags={tile.tags} /> : null}
                <span className={lines ? "voice-mono text-code" : undefined}>{tile.text}</span>
              </button>
              {(buttons || lines) && !readOnly ? (
                <span className="ml-auto flex items-center gap-1">
                  {lines ? (
                    <>
                      <KeyButton
                        size="sm"
                        tone="quiet"
                        aria-label={`Outdent ${tile.text}`}
                        onClick={() => indent(i, -1)}
                      >
                        ⇤
                      </KeyButton>
                      <KeyButton size="sm" tone="quiet" aria-label={`Indent ${tile.text}`} onClick={() => indent(i, 1)}>
                        ⇥
                      </KeyButton>
                    </>
                  ) : null}
                  {buttons ? (
                    <>
                      <KeyButton
                        size="sm"
                        tone="quiet"
                        aria-label={`Move ${tile.text} ${lines ? "up" : "left"}`}
                        disabled={i === 0}
                        onClick={() => move(i, i - 1)}
                      >
                        {lines ? "↑" : "←"}
                      </KeyButton>
                      <KeyButton
                        size="sm"
                        tone="quiet"
                        aria-label={`Move ${tile.text} ${lines ? "down" : "right"}`}
                        disabled={i === seq.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        {lines ? "↓" : "→"}
                      </KeyButton>
                    </>
                  ) : null}
                  {buttons || lines ? (
                    <KeyButton size="sm" tone="quiet" aria-label={`Remove ${tile.text}`} onClick={() => remove(i)}>
                      ×
                    </KeyButton>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {clashes.length > 0 ? (
        <p className="text-small text-ink-2" data-clash>
          {clashes.map(([a, b]) => `${text(seq[b] as string)} doesn't agree with ${text(seq[a] as string)}`).join("; ")}
          .
        </p>
      ) : null}

      {tray.length > 0 && !readOnly ? (
        <div>
          <p className="mb-2 text-small text-ink-2">{lines ? "Unused lines" : "Tiles"}</p>
          <ul
            aria-label={lines ? "Unused lines" : "Tiles to use"}
            className={cn(lines ? "flex flex-col gap-1.5" : "flex flex-wrap gap-2")}
          >
            {tray.map((id) => {
              const tile = byId.get(id) as Tile;
              return (
                <li key={id} className="list-none">
                  <button
                    type="button"
                    onClick={() => add(id)}
                    aria-label={`Add ${tile.text}`}
                    className={cn(tileClass(tile, props.showAgreement ?? false, lines), "cursor-pointer")}
                  >
                    {props.showAgreement && !lines ? <GenderGlyph tags={tile.tags} /> : null}
                    <span className={lines ? "voice-mono text-code" : undefined}>{tile.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {canSpeak ? (
          <Button size="sm" onClick={() => speakSentence(seq)} disabled={seq.length === 0}>
            Hear it
          </Button>
        ) : null}
        {!readOnly && seq.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              commit([], [], "Cleared.");
              setHeld(null);
            }}
          >
            Start over
          </Button>
        ) : null}
        {phrase.status === "unavailable" ? (
          <span className="text-small text-ink-2">No voice for this language here, so read it aloud yourself.</span>
        ) : null}
      </div>

      {solutionDiffers && solution ? (
        <div className="rounded-md bg-surface-2 p-3 text-small text-ink-2" data-solution>
          <p className="mb-1">One way that works:</p>
          {lines ? (
            <pre className="voice-mono text-code text-ink">
              {solution.sequence.map((id, i) => `${"    ".repeat(solution.indents?.[i] ?? 0)}${text(id)}`).join("\n")}
            </pre>
          ) : (
            <p className="text-body text-ink">{joinTiles(solution.sequence.map(text))}</p>
          )}
        </div>
      ) : null}
    </WidgetShell>
  );
}

function tileClass(tile: Tile, agreement: boolean, lines: boolean): string {
  const tags = tile.tags ?? [];
  const m = agreement && tags.includes("m");
  const f = agreement && tags.includes("f");
  const pl = agreement && tags.includes("pl");
  return cn(
    "inline-flex min-h-10 select-none items-center gap-1.5 border-[1.5px] px-3 text-body text-ink shadow-key-rest transition-[transform,box-shadow] duration-press ease-out active:translate-y-0.5 active:shadow-key-down disabled:cursor-default",
    lines ? "w-full rounded-sm border-ink bg-surface text-left" : "rounded-key border-ink bg-surface",
    m && "rounded-xs border-sea bg-sea-soft",
    f && "rounded-pill border-iris bg-iris-soft",
    pl && "ring-2 ring-offset-2 ring-offset-surface-2",
    pl && m && "ring-sea",
    pl && f && "ring-iris",
  );
}

function GenderGlyph({ tags }: { tags?: Tile["tags"] }) {
  const t = tags ?? [];
  if (t.includes("m")) {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <rect x="1" y="1" width="8" height="8" fill="var(--sea)" />
      </svg>
    );
  }
  if (t.includes("f")) {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <circle cx="5" cy="5" r="4" fill="var(--iris)" />
      </svg>
    );
  }
  return null;
}

function AgreementKey() {
  return (
    <span className="inline-flex items-center gap-3 text-small text-ink-2">
      <span className="inline-flex items-center gap-1">
        <GenderGlyph tags={["m"]} /> masculine
      </span>
      <span className="inline-flex items-center gap-1">
        <GenderGlyph tags={["f"]} /> feminine
      </span>
      <span>double edge: plural</span>
    </span>
  );
}

function IndentGuides({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 self-stretch">
      {Array.from({ length: n }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: indent levels are positional.
        <span key={i} className="w-8 border-l-2 border-dotted border-line-strong" />
      ))}
    </span>
  );
}
