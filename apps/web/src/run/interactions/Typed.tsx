/**
 * Typed answers: numeric (with unit) and text (with an accent-tolerant hint after a near miss).
 * ⏎ commits from the field; the button is the same commit for pointer users.
 */
import { solutionOf } from "@learncroc/core";
import { Button } from "@learncroc/ui";
import { useEffect, useRef, useState } from "react";
import type { Ask } from "../content";
import { formatNumber } from "../content";
import { accentHint } from "../text";
import { type InputProps, parseNumber } from "./types";

type NumericAsk = Extract<Ask, { kind: "numeric" }>;
type TextAsk = Extract<Ask, { kind: "text" }>;

const field =
  "h-14 rounded-key border-[1.5px] border-ink bg-surface px-4 text-lead text-ink tabular shadow-key-rest outline-none placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-70";

/** The expected number, with parametric items worked out from the server's vars. */
function workedNumber(ask: NumericAsk, vars?: Record<string, number>): number {
  try {
    const sol = solutionOf(ask, vars ? { vars } : {});
    if (sol?.kind === "numeric" && Number.isFinite(sol.value)) return sol.value;
  } catch {
    // An unparseable answerExpr falls back to the authored default.
  }
  return ask.answer;
}

export function NumericInput(p: InputProps<NumericAsk>) {
  const { ask, locked, last } = p;
  const [raw, setRaw] = useState(() => (typeof p.draft === "string" ? p.draft : ""));
  const ref = useRef<HTMLInputElement>(null);
  const value = parseNumber(raw);
  const invalid = raw.trim() !== "" && value === undefined;

  useEffect(() => {
    if (last && !last.correct) ref.current?.select();
  }, [last]);

  const submit = () => {
    if (locked || value === undefined) return;
    p.onSubmit({ kind: "numeric", value });
  };

  return (
    <form
      className="flex flex-col gap-2"
      data-input="numeric"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-3">
        <input
          ref={ref}
          data-autofocus
          className={`${field} w-44`}
          inputMode="decimal"
          autoComplete="off"
          aria-labelledby={p.promptId}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${p.promptId}-err` : undefined}
          value={raw}
          disabled={locked}
          onChange={(e) => {
            setRaw(e.target.value);
            p.onDraft?.(e.target.value);
          }}
        />
        {ask.unit ? <span className="text-lead text-ink-2">{ask.unit}</span> : null}
        <Button type="submit" variant="primary" kbd="⏎" disabled={locked || value === undefined}>
          {p.submitLabel}
        </Button>
      </div>
      {invalid ? (
        <p id={`${p.promptId}-err`} className="text-small text-ink-2">
          A number, like 12 or 0.5.
        </p>
      ) : null}
      {last?.showSolution && !last.correct ? (
        <p className="text-small text-ink-2">
          The answer is {formatNumber(workedNumber(ask, p.vars))}
          {ask.unit ? ` ${ask.unit}` : ""}. Type it in to carry on.
        </p>
      ) : null}
    </form>
  );
}

export function TextInput(p: InputProps<TextAsk>) {
  const { ask, locked, last } = p;
  const [value, setValue] = useState(() => (typeof p.draft === "string" ? p.draft : ""));
  const ref = useRef<HTMLInputElement>(null);
  const lastValue = last?.answer.kind === "text" ? last.answer.value : undefined;
  const nearly =
    last && !last.correct && lastValue !== undefined ? accentHint(lastValue, ask.accept, ask.normalize) : undefined;

  useEffect(() => {
    if (last && !last.correct) ref.current?.focus();
  }, [last]);

  const submit = () => {
    if (locked || !value.trim()) return;
    p.onSubmit({ kind: "text", value });
  };

  return (
    <form
      className="flex flex-col gap-2"
      data-input="text"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-3">
        <input
          ref={ref}
          data-autofocus
          className={`${field} min-w-0 flex-1`}
          lang={ask.lang}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-labelledby={p.promptId}
          value={value}
          disabled={locked}
          onChange={(e) => {
            setValue(e.target.value);
            p.onDraft?.(e.target.value);
          }}
        />
        <Button type="submit" variant="primary" kbd="⏎" disabled={locked || !value.trim()}>
          {p.submitLabel}
        </Button>
      </div>
      {nearly ? (
        <p className="text-small text-ink-2" role="status">
          Nearly: check the accents. It's written{" "}
          <span lang={ask.lang} className="font-semibold">
            {nearly}
          </span>
          .
        </p>
      ) : null}
      {last?.showSolution && !last.correct && !nearly ? (
        <p className="text-small text-ink-2">
          One way to write it:{" "}
          <span lang={ask.lang} className="font-semibold">
            {ask.accept[0]}
          </span>
        </p>
      ) : null}
    </form>
  );
}
