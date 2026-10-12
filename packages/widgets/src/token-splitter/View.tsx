/**
 * token-splitter view: text shatters into the chips a model reads.
 *
 * Type and the split redraws live (colour cycles through the world's line colours, spaces show as a
 * faint dot so " strawberry" and "strawberry" look different). count seals a text and asks for a
 * number first; craft shows a live checklist; pick-token makes each chip a choice; split lets the
 * learner place the cuts (./SplitTask).
 */
import { cn } from "@learncroc/ui";
import { useId, useMemo, useState } from "react";
import { KeyButton, ReviewNote, radioGroupKeys, WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import { SplitTask } from "./SplitTask";
import {
  craftChecks,
  TOKEN_SPLITTER_MAX_CHARS,
  type TokenSplitterAnswer,
  type TokenSplitterGoal,
  type TokenSplitterProps,
} from "./spec";
import { type TokenPiece, tokenCount, tokenPieces, wordCount } from "./tokenize";

type Props = WidgetViewProps<TokenSplitterProps, TokenSplitterGoal, TokenSplitterAnswer>;

export default function TokenSplitterView(p: Props) {
  const props = withReveal(p.props, p.revealProps);
  const goal = p.goal;
  return (
    <WidgetShell
      id="token-splitter"
      mode={p.mode}
      label="Token splitter"
      toolbar={<span className="text-micro">cl100k_base (GPT-4) tokenizer</span>}
    >
      {goal?.kind === "count" ? (
        <CountTask {...p} props={props} goal={goal} />
      ) : goal?.kind === "pick-token" ? (
        <PickTask {...p} props={props} goal={goal} />
      ) : goal?.kind === "split" ? (
        <SplitTask
          goal={goal}
          mode={p.mode}
          value={p.value}
          onChange={p.onChange}
          onCommit={p.onCommit}
          solution={p.solution}
          showIds={props.showIds}
          reducedMotion={p.reducedMotion}
          announce={p.announce}
        />
      ) : (
        <Editor {...p} props={props} />
      )}
    </WidgetShell>
  );
}

/** Visible form of a piece: leading/trailing spaces as a faint dot, newlines as ⏎, tabs as →. */
function PieceText({ text }: { text: string }) {
  const parts: { s: string; ws: boolean }[] = [];
  for (const ch of text) {
    const ws = ch === " " || ch === "\n" || ch === "\t";
    const s = ch === " " ? "·" : ch === "\n" ? "⏎" : ch === "\t" ? "→" : ch;
    const last = parts[parts.length - 1];
    if (last && last.ws === ws) last.s += s;
    else parts.push({ s, ws });
  }
  return (
    <>
      {parts.map((x, i) =>
        x.ws ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: characters of a static string.
          <span key={i} className="text-ink-3" aria-hidden="true">
            {x.s}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: characters of a static string.
          <span key={i}>{x.s}</span>
        ),
      )}
    </>
  );
}

function spoken(text: string): string {
  if (text === " ") return "a space";
  const lead = text.startsWith(" ") ? "space, " : "";
  return `${lead}${text.trim() || text.replace(/\n/g, "newline")}`;
}

function inHighlight(piece: TokenPiece, text: string, highlight?: string): boolean {
  if (!highlight) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(highlight, from);
    if (at < 0) return false;
    const end = at + highlight.length;
    if (piece.start < end && piece.start + piece.text.length > at) return true;
    from = at + 1;
  }
}

function Chips(p: {
  text: string;
  showIds: boolean;
  highlight?: string;
  reducedMotion: boolean;
  /** pick mode */
  onPick?: (index: number) => void;
  picked?: number;
  correct?: number;
  interactive?: boolean;
  label: string;
}) {
  const pieces = useMemo(() => tokenPieces(p.text), [p.text]);
  if (pieces.length === 0)
    return <p className="min-h-14 text-body text-w-ink-2 italic">Type something to see it split.</p>;
  const radio = !!p.onPick;
  const Group = radio ? "div" : "ul";
  const Item = radio ? "span" : "li";
  return (
    <Group
      className="flex flex-wrap items-start gap-x-1 gap-y-2"
      role={radio ? "radiogroup" : "list"}
      aria-label={p.label}
      data-token-count={pieces.reduce((n, x) => n + x.ids.length, 0)}
      onKeyDown={radio ? radioGroupKeys : undefined}
    >
      {pieces.map((piece, i) => {
        const color = `var(--w-${(i % 5) + 1})`;
        const hl = inHighlight(piece, p.text, p.highlight);
        const isPicked = p.picked === piece.index;
        const isCorrect = p.correct === piece.index;
        const chip = (
          <>
            <span
              className={cn(
                "voice-mono inline-flex min-h-9 min-w-6 items-center justify-center whitespace-pre rounded-sm border-[1.5px] px-1.5 text-code text-ink",
                hl && "underline decoration-sea decoration-2 underline-offset-4",
                isPicked && "ring-2 ring-w-ink ring-offset-2 ring-offset-w-ground",
                isCorrect && !isPicked && "outline-2 outline-dashed outline-sea outline-offset-2",
              )}
              style={{
                background: `color-mix(in srgb, ${color} 28%, var(--surface))`,
                borderColor: `color-mix(in srgb, ${color} 80%, var(--ink))`,
              }}
            >
              <PieceText text={piece.text} />
            </span>
            {p.showIds ? (
              <span className="voice-mono text-micro text-w-ink-2 tabular">{piece.ids.join(" ")}</span>
            ) : null}
          </>
        );
        const animate = p.reducedMotion ? undefined : { transitionDelay: `${Math.min(i, 20) * 18}ms` };
        return radio ? (
          // biome-ignore lint/a11y/useSemanticElements: an answer-key button acting as a radio (WAI-ARIA radio group pattern).
          <button
            key={`${piece.index}-${piece.text}`}
            type="button"
            role="radio"
            aria-checked={isPicked}
            aria-label={`Token ${i + 1}: ${spoken(piece.text)}${p.showIds ? `, id ${piece.ids.join(" ")}` : ""}`}
            disabled={!p.interactive}
            onClick={() => p.onPick?.(piece.index)}
            className="flex flex-col items-center gap-0.5 rounded-sm p-0.5 transition-transform duration-quick hover:-translate-y-0.5 disabled:hover:translate-y-0"
          >
            {chip}
          </button>
        ) : (
          <Item
            key={`${piece.index}-${piece.text}`}
            className={cn(
              "flex flex-col items-center gap-0.5",
              !p.reducedMotion &&
                "transition-[opacity,transform] duration-base ease-out starting:translate-y-1 starting:opacity-0",
            )}
            style={animate}
            aria-label={`${spoken(piece.text)}${p.showIds ? `, id ${piece.ids.join(" ")}` : ""}`}
          >
            {chip}
          </Item>
        );
      })}
    </Group>
  );
}

function Counts({ text }: { text: string }) {
  const t = tokenCount(text);
  const w = wordCount(text);
  return (
    <p className="flex flex-wrap gap-x-5 gap-y-1 text-small text-w-ink-2" aria-live="off">
      <span>
        <strong className="text-lead text-w-ink tabular">{t}</strong> token{t === 1 ? "" : "s"}
      </span>
      <span>
        <strong className="tabular text-w-ink">{w}</strong> word{w === 1 ? "" : "s"}
      </span>
      <span>
        <strong className="tabular text-w-ink">{[...text].length}</strong> characters
      </span>
    </p>
  );
}

// ── editor (explore, craft, or static view) ──────────────────────────────────────────────

function Editor(p: Props) {
  const { props } = p;
  const id = useId();
  const craft = p.goal?.kind === "craft" ? p.goal : undefined;
  const editable = props.editable && p.mode !== "review";
  const [local, setLocal] = useState(props.text);
  const text = p.value?.text ?? (p.onChange ? props.text : local);
  const checks = craft ? craftChecks(craft, text) : [];

  const onText = (next: string) => {
    const clipped = next.slice(0, TOKEN_SPLITTER_MAX_CHARS);
    if (p.onChange) p.onChange({ text: clipped });
    else setLocal(clipped);
    const n = tokenCount(clipped);
    const status = craft
      ? ` ${craftChecks(craft, clipped).filter((c) => c.ok).length} of ${checks.length} rules met.`
      : "";
    p.announce(`${n} token${n === 1 ? "" : "s"}.${status}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {props.editable ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-small text-w-ink-2">
            {craft ? "Write a string" : "Type anything"}
          </label>
          <textarea
            id={id}
            value={text}
            readOnly={!editable}
            rows={2}
            maxLength={TOKEN_SPLITTER_MAX_CHARS}
            spellCheck={false}
            onChange={(e) => onText(e.currentTarget.value)}
            className="voice-mono w-full resize-y rounded-sm border-[1.5px] border-line-strong bg-surface px-3 py-2 text-code text-ink focus-visible:border-focus"
          />
        </div>
      ) : null}
      <Chips
        text={text}
        showIds={props.showIds}
        highlight={props.highlight}
        reducedMotion={p.reducedMotion}
        label="Tokens"
      />
      <Counts text={text} />
      {craft ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Rules">
          {checks.map((c) => (
            <li key={c.id} className="inline-flex items-center gap-2 text-body text-w-ink" data-ok={c.ok}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                {c.ok ? (
                  <>
                    <circle cx="9" cy="9" r="8" fill="var(--sea)" />
                    <path
                      d="M5.2 9.4l2.5 2.4 5-5.4"
                      fill="none"
                      stroke="var(--surface)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                ) : (
                  <circle
                    cx="9"
                    cy="9"
                    r="7.25"
                    fill="none"
                    stroke="var(--w-ink-2)"
                    strokeWidth="1.5"
                    strokeDasharray="3 2.4"
                  />
                )}
              </svg>
              {c.label}
              <span className="sr-only">{c.ok ? "(met)" : "(not yet)"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ── count ────────────────────────────────────────────────────────────────────────────────

function CountTask(p: Props & { goal: Extract<TokenSplitterGoal, { kind: "count" }> }) {
  const { props, goal } = p;
  const id = useId();
  const [peek, setPeek] = useState(false);
  const count = p.value?.count;
  const interactive = p.mode !== "review" && !!p.onChange;
  const revealed = p.mode === "review" || (p.mode === "explore" && peek);
  const truth = tokenCount(goal.text);
  const words = wordCount(goal.text);

  const set = (n: number) => {
    const v = Math.max(0, Math.min(999, Math.round(n)));
    p.onChange?.({ count: v });
    p.announce(`Your guess: ${v} token${v === 1 ? "" : "s"}.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "voice-casual rounded-md border-[1.5px] border-dashed border-w-ink-2 px-4 py-3 text-lead text-w-ink",
          revealed && "border-solid",
        )}
      >
        “{goal.text}”
        <span className="ml-2 text-small text-w-ink-2">
          ({words} word{words === 1 ? "" : "s"})
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={id} className="text-body text-w-ink">
          How many tokens?
        </label>
        <KeyButton
          size="sm"
          aria-label="One fewer"
          disabled={!interactive || (count ?? 0) <= 0}
          onClick={() => set((count ?? 1) - 1)}
        >
          −
        </KeyButton>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          value={count ?? ""}
          placeholder="?"
          readOnly={!interactive}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === "") return;
            set(Number(v));
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              if (interactive) set((count ?? 0) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
            }
          }}
          className="voice-mono h-10 w-20 rounded-sm border-[1.5px] border-line-strong bg-surface text-center text-lead text-ink tabular"
        />
        <KeyButton size="sm" aria-label="One more" disabled={!interactive} onClick={() => set((count ?? 0) + 1)}>
          +
        </KeyButton>
        {p.mode === "explore" && !peek ? (
          <KeyButton size="sm" tone="quiet" onClick={() => setPeek(true)}>
            Reveal the split
          </KeyButton>
        ) : null}
      </div>
      {revealed ? (
        <div className="flex flex-col gap-2">
          <Chips text={goal.text} showIds={props.showIds} reducedMotion={p.reducedMotion} label="The real split" />
          <p className="text-body text-w-ink">
            <strong className="tabular">{truth}</strong> tokens.
            {count !== undefined && count !== truth ? (
              <ReviewNote className="ml-2">You guessed {count}.</ReviewNote>
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ── pick-token ───────────────────────────────────────────────────────────────────────────

function PickTask(p: Props & { goal: Extract<TokenSplitterGoal, { kind: "pick-token" }> }) {
  const { props, goal } = p;
  const interactive = p.mode !== "review" && !!p.onChange;
  return (
    <div className="flex flex-col gap-4">
      <Chips
        text={goal.text}
        showIds={props.showIds}
        highlight={p.mode === "review" ? undefined : props.highlight}
        reducedMotion={p.reducedMotion}
        label="Tap a token"
        interactive={interactive}
        picked={p.value?.index}
        correct={p.mode === "review" ? goal.index : undefined}
        onPick={(index) => {
          p.onChange?.({ index });
          p.announce(`Token ${index + 1} picked.`);
        }}
      />
      <Counts text={goal.text} />
    </div>
  );
}
