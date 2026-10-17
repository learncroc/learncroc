/**
 * Choice and multi-choice on AnswerKeys with 1–9. A single choice commits on the press (or, when
 * the ask wants confidence, on the "how sure?" tap that follows). Multi toggles and commits with ⏎.
 */
import type { Confidence } from "@learncroc/core";
import { AnswerKey, Button, cn } from "@learncroc/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Ask } from "../content";
import { digitIndex, useKeys } from "../keys";
import { Md } from "../Markdown";
import { type InputProps, seededOrder } from "./types";

type ChoiceAsk = Extract<Ask, { kind: "choice" }>;

const CONFIDENCE: { value: Confidence; label: string }[] = [
  { value: 3, label: "Sure" },
  { value: 2, label: "Think so" },
  { value: 1, label: "Guessing" },
];

export function ChoiceInput(p: InputProps<ChoiceAsk>) {
  const { ask, locked, last, keysActive } = p;
  const multi = ask.multi === true || Array.isArray(ask.answer);
  const order = useMemo(
    () => (ask.shuffle ? seededOrder(ask.options.length, `${p.seed}:${ask.id ?? ""}`) : ask.options.map((_, i) => i)),
    [ask.shuffle, ask.options, ask.id, p.seed],
  );
  const options = order.map((i) => ask.options[i]).filter((o) => o !== undefined);
  const [picked, setPicked] = useState<string[]>(() =>
    Array.isArray(p.draft) ? (p.draft as unknown[]).filter((x): x is string => typeof x === "string") : [],
  );
  const [askSure, setAskSure] = useState<string | null>(null);
  const [tried, setTried] = useState<Set<string>>(new Set());
  const sureRef = useRef<HTMLDivElement>(null);

  const lastSelected = last?.answer.kind === "choice" ? ([] as string[]).concat(last.answer.selected) : [];
  const lastKey = last && !last.correct ? `${last.attempts}:${lastSelected.join(",")}` : "";
  // A new wrong attempt: mark what was tried and reset the keys for one more go.
  useEffect(() => {
    if (!lastKey) return;
    const tried = lastKey
      .slice(lastKey.indexOf(":") + 1)
      .split(",")
      .filter(Boolean);
    setTried((t) => new Set([...t, ...tried]));
    setPicked([]);
    setAskSure(null);
  }, [lastKey]);

  useEffect(() => {
    if (askSure) sureRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [askSure]);

  const commit = (ids: string[], confidence?: Confidence) => {
    p.onSubmit({ kind: "choice", selected: multi ? ids : (ids[0] ?? "") }, confidence);
  };

  const press = (id: string) => {
    if (locked) return;
    if (multi) {
      const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
      setPicked(next);
      p.onDraft?.(next);
      return;
    }
    if (p.confidence) {
      setPicked([id]);
      setAskSure(id);
      return;
    }
    setPicked([id]);
    commit([id]);
  };

  const idk = () => {
    if (locked) return;
    p.onSubmit({ kind: "idk" });
  };

  useKeys(
    (e) => {
      if (locked) return false;
      const d = digitIndex(e);
      if (askSure) {
        if (d !== undefined && d < CONFIDENCE.length) {
          commit([askSure], CONFIDENCE[d]?.value);
          return true;
        }
        if (e.key === "Escape") {
          setAskSure(null);
          setPicked([]);
          return true;
        }
        return false;
      }
      if (d !== undefined) {
        const opt = options[d];
        if (opt) {
          press(opt.id);
          return true;
        }
        if (p.idk && d === options.length) {
          idk();
          return true;
        }
      }
      if (multi && e.key === "Enter" && picked.length > 0) {
        commit(picked);
        return true;
      }
      return false;
    },
    { enabled: keysActive },
  );

  const rightIds = ([] as string[]).concat(ask.answer);
  // One shot (checkpoint): the answer is final; the right option is outlined in Sea, theirs stays neutral.
  const settled = Boolean(last && !last.correct && last.showSolution && locked);
  const keyState = (id: string): "rest" | "selected" | "down" | "dimmed" => {
    if (last?.correct) return lastSelected.includes(id) ? "down" : "dimmed";
    if (settled) return rightIds.includes(id) ? "rest" : "dimmed";
    if (last?.showSolution && !last.correct) {
      const right = ([] as string[]).concat(ask.answer);
      return right.includes(id) ? "selected" : "dimmed";
    }
    if (picked.includes(id)) return "selected";
    if (tried.has(id)) return "dimmed";
    return "rest";
  };

  const n = options.length + (p.idk ? 1 : 0);
  return (
    <div className="flex flex-col gap-3" data-input="choice">
      <fieldset
        aria-labelledby={p.promptId}
        className={cn("grid gap-2", n >= 4 ? "sm:grid-cols-2" : "", n <= 2 ? "sm:grid-cols-2" : "")}
      >
        {options.map((o, i) => (
          <AnswerKey
            key={o.id}
            n={i + 1}
            state={keyState(o.id)}
            disabled={locked}
            onPress={() => press(o.id)}
            describedBy={last?.showSolution && o.why ? `${p.promptId}-why-${o.id}` : undefined}
            className={settled && rightIds.includes(o.id) ? "border-sea! shadow-[0_0_0_2px_var(--sea)]" : undefined}
          >
            <Md text={o.text} />
            {settled && rightIds.includes(o.id) ? <span className="sr-only"> (the right answer)</span> : null}
            {settled && lastSelected.includes(o.id) ? <span className="sr-only"> (your answer)</span> : null}
            {tried.has(o.id) && !last?.correct && !settled ? <span className="sr-only"> (tried)</span> : null}
          </AnswerKey>
        ))}
        {p.idk ? (
          <AnswerKey
            n={options.length + 1}
            state={picked.length === 0 && locked ? "dimmed" : "rest"}
            disabled={locked}
            onPress={idk}
          >
            <span className="text-ink-2">{p.idk}</span>
          </AnswerKey>
        ) : null}
      </fieldset>
      {askSure ? (
        <div ref={sureRef} className="flex flex-wrap items-center gap-2" data-confidence>
          <span className="text-small text-ink-2" id={`${p.promptId}-sure`}>
            How sure?
          </span>
          <fieldset className="flex gap-2" aria-labelledby={`${p.promptId}-sure`} disabled={locked}>
            {CONFIDENCE.map((c, i) => (
              <label
                key={c.value}
                className="cursor-pointer rounded-pill border border-line px-3 py-1 text-small text-ink-2 focus-within:outline-2 focus-within:outline-focus hover:border-ink"
              >
                <input
                  type="radio"
                  name={`${p.promptId}-sure`}
                  className="sr-only"
                  onChange={() => commit([askSure], c.value)}
                />
                <span className="mr-1 text-micro text-ink-3 tabular" aria-hidden>
                  {i + 1}
                </span>
                {c.label}
              </label>
            ))}
          </fieldset>
        </div>
      ) : null}
      {multi ? (
        <div className="flex items-center gap-3">
          <Button variant="primary" kbd="⏎" disabled={locked || picked.length === 0} onClick={() => commit(picked)}>
            {p.submitLabel}
          </Button>
          <span className="text-small text-ink-3">Pick every one that fits.</span>
        </div>
      ) : null}
      {last?.showSolution
        ? options
            .filter((o) => o.why)
            .map((o) => (
              <p key={o.id} id={`${p.promptId}-why-${o.id}`} className="text-small text-ink-2">
                <span className="font-semibold">
                  <Md text={o.text} />:
                </span>{" "}
                <Md text={o.why ?? ""} />
              </p>
            ))
        : null}
    </div>
  );
}
