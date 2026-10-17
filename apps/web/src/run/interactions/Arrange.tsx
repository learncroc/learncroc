/**
 * Arranging answers: order (put steps in order), match (pair left with right) and cloze (fill the
 * blanks from tiles or by typing). Keyboard first: Space picks up, arrows move, Space drops.
 */

import { Button, cn } from "@learncroc/ui";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Ask } from "../content";
import { Md, plainText } from "../Markdown";
import { type InputProps, seededOrder } from "./types";

type OrderAsk = Extract<Ask, { kind: "order" }>;
type MatchAsk = Extract<Ask, { kind: "match" }>;
type ClozeAsk = Extract<Ask, { kind: "cloze" }>;

const isIntArray = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every((x) => Number.isInteger(x) && x >= 0 && x < n);

// ── order

export function OrderInput(p: InputProps<OrderAsk>) {
  const { ask, locked, last } = p;
  const n = ask.items.length;
  const [order, setOrder] = useState<number[]>(() =>
    isIntArray(p.draft, n) ? p.draft : seededOrder(n, `${p.seed}:${ask.id ?? "order"}`),
  );
  const [held, setHeld] = useState<number | null>(null);
  const [live, setLive] = useState("");
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const solution = last?.showSolution && !last.correct ? ask.answer : null;
  const shown = order;
  // Not yet: the items stay where the learner put them; the misplaced ones get a dotted underline.
  const tried = last && !last.correct && !solution && last.answer.kind === "order" ? last.answer.order : null;
  const misplaced = (pos: number) =>
    tried !== null && order[pos] === tried[pos] && (ask.answer as readonly number[])[pos] !== order[pos];
  useEffect(() => {
    // Second miss: the worked order replaces theirs; they confirm it to carry on.
    if (solution && isIntArray(solution, n)) setOrder([...solution]);
  }, [solution, n]);

  const move = (from: number, to: number) => {
    if (locked || to < 0 || to >= n || from === to) return;
    const next = [...order];
    const [it] = next.splice(from, 1);
    if (it === undefined) return;
    next.splice(to, 0, it);
    setOrder(next);
    p.onDraft?.(next);
    setLive(`${plainText(ask.items[it] ?? "")}: position ${to + 1} of ${n}.`);
    requestAnimationFrame(() => rows.current[to]?.focus());
    if (held !== null) setHeld(to);
  };

  return (
    <form
      className="flex flex-col gap-3"
      data-input="order"
      onSubmit={(e) => {
        e.preventDefault();
        if (!locked) p.onSubmit({ kind: "order", order });
      }}
    >
      <ol aria-labelledby={p.promptId} className="flex flex-col gap-2">
        {shown.map((itemIndex, pos) => (
          <li
            key={itemIndex}
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-key border-[1.5px] border-ink bg-surface px-3 text-body shadow-key-rest",
              held === pos && "-translate-y-0.5 bg-sea-soft shadow-2",
              solution && "border-sea",
            )}
          >
            <button
              type="button"
              ref={(el) => {
                rows.current[pos] = el;
              }}
              disabled={locked}
              aria-pressed={held === pos}
              aria-roledescription="sortable item"
              aria-describedby={`${p.promptId}-order-help`}
              data-autofocus={pos === 0 || undefined}
              className="flex min-h-12 flex-1 items-center gap-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                if (locked) return;
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  setHeld(held === pos ? null : pos);
                  setLive(
                    held === pos
                      ? "Dropped."
                      : `Picked up ${plainText(ask.items[itemIndex] ?? "")}. Use the arrow keys.`,
                  );
                } else if (e.key === "ArrowUp" && (held === pos || e.altKey)) {
                  e.preventDefault();
                  move(pos, pos - 1);
                } else if (e.key === "ArrowDown" && (held === pos || e.altKey)) {
                  e.preventDefault();
                  move(pos, pos + 1);
                } else if (e.key === "Escape" && held !== null) {
                  e.preventDefault();
                  setHeld(null);
                }
              }}
            >
              <span
                aria-hidden
                className="grid size-6 place-items-center rounded-xs border border-line-strong text-micro tabular"
              >
                {pos + 1}
              </span>
              <span
                className={cn(
                  "flex-1",
                  misplaced(pos) && "underline decoration-ink-3 decoration-dotted decoration-2 underline-offset-4",
                )}
                data-misplaced={misplaced(pos) || undefined}
              >
                <Md text={ask.items[itemIndex] ?? ""} />
              </span>
            </button>
            <span className="flex gap-1">
              <button
                type="button"
                tabIndex={-1}
                className="grid size-8 place-items-center rounded-xs text-ink-2 hover:bg-surface-2 disabled:opacity-30"
                aria-label="Move up"
                disabled={locked || pos === 0}
                onClick={() => move(pos, pos - 1)}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                tabIndex={-1}
                className="grid size-8 place-items-center rounded-xs text-ink-2 hover:bg-surface-2 disabled:opacity-30"
                aria-label="Move down"
                disabled={locked || pos === n - 1}
                onClick={() => move(pos, pos + 1)}
              >
                <ArrowDown size={16} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" kbd="⏎" disabled={locked}>
          {p.submitLabel}
        </Button>
        <span id={`${p.promptId}-order-help`} className="text-small text-ink-3">
          Space picks up, arrows move.
        </span>
      </div>
      {solution ? <p className="text-small text-ink-2">That's the order. Check it to carry on.</p> : null}
      <div aria-live="polite" className="sr-only">
        {live}
      </div>
    </form>
  );
}

// ── match

export function MatchInput(p: InputProps<MatchAsk>) {
  const { ask, locked, last } = p;
  const rightOrder = useMemo(
    () => seededOrder(ask.right.length, `${p.seed}:${ask.id ?? "match"}`),
    [ask.right.length, ask.id, p.seed],
  );
  const [pairs, setPairs] = useState<[number, number][]>(() =>
    Array.isArray(p.draft) ? (p.draft as [number, number][]).filter((x) => Array.isArray(x) && x.length === 2) : [],
  );
  const [left, setLeft] = useState<number | null>(null);
  const solution = last?.showSolution && !last.correct ? ask.answer : null;
  const shown = pairs;
  useEffect(() => {
    if (solution) setPairs(solution.map(([a, b]) => [a, b] as [number, number]));
  }, [solution]);
  const pairOfLeft = (l: number) => shown.find(([a]) => a === l)?.[1];
  const pairOfRight = (r: number) => shown.find(([, b]) => b === r)?.[0];

  const pick = (r: number) => {
    if (locked || left === null) return;
    const next = pairs.filter(([a, b]) => a !== left && b !== r);
    next.push([left, r]);
    next.sort((a, b) => a[0] - b[0]);
    setPairs(next);
    p.onDraft?.(next);
    setLeft(null);
  };

  return (
    <form
      className="flex flex-col gap-3"
      data-input="match"
      onSubmit={(e) => {
        e.preventDefault();
        if (!locked) p.onSubmit({ kind: "match", pairs });
      }}
    >
      <p className="text-small text-ink-3">Pick one on the left, then its partner on the right.</p>
      <fieldset className="grid grid-cols-2 gap-3 min-w-0" aria-labelledby={p.promptId}>
        <div className="flex flex-col gap-2">
          {ask.left.map((text, l) => {
            const r = pairOfLeft(l);
            return (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: authored order
                key={l}
                type="button"
                data-autofocus={l === 0 || undefined}
                disabled={locked}
                aria-pressed={left === l}
                onClick={() => setLeft(left === l ? null : l)}
                className={cn(
                  "min-h-12 rounded-key border-[1.5px] border-ink bg-surface px-3 text-left text-body shadow-key-rest",
                  left === l && "bg-sea-soft",
                  r !== undefined && "border-sea",
                )}
              >
                <Md text={text} />
                {r !== undefined ? (
                  <span className="block text-small text-sea-text">
                    = <Md text={ask.right[r] ?? ""} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2">
          {rightOrder.map((r) => (
            <button
              key={r}
              type="button"
              disabled={locked || left === null}
              onClick={() => pick(r)}
              className={cn(
                "min-h-12 rounded-key border-[1.5px] border-line-strong bg-surface px-3 text-left text-body",
                left !== null && "border-ink shadow-key-rest",
                pairOfRight(r) !== undefined && "opacity-70",
              )}
            >
              <Md text={ask.right[r] ?? ""} />
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          kbd="⏎"
          disabled={locked || pairs.length < Math.min(ask.left.length, ask.right.length)}
        >
          {p.submitLabel}
        </Button>
        <span className="text-small text-ink-3 tabular">
          {pairs.length} of {Math.min(ask.left.length, ask.right.length)} paired
        </span>
      </div>
    </form>
  );
}

// ── cloze

export function ClozeInput(p: InputProps<ClozeAsk>) {
  const { ask, locked, last } = p;
  const parts = useMemo(
    () => ask.text.split(/(\{\{[^}]+\}\})/g).map((text, i) => ({ id: `${i}:${text}`, text })),
    [ask.text],
  );
  const keys = Object.keys(ask.blanks);
  const [values, setValues] = useState<Record<string, string>>(() =>
    p.draft && typeof p.draft === "object" ? (p.draft as Record<string, string>) : {},
  );
  const [active, setActive] = useState<string | undefined>(keys[0]);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const solution = last?.showSolution && !last.correct;
  useEffect(() => {
    if (!solution) return;
    const worked: Record<string, string> = {};
    for (const [k, b] of Object.entries(ask.blanks)) worked[k] = b.accept[0] ?? "";
    setValues(worked);
  }, [solution, ask.blanks]);
  const tiles = useMemo(() => {
    const all = keys.flatMap((k) => ask.blanks[k]?.tiles ?? []);
    const unique = [...new Set(all)];
    const order = seededOrder(unique.length, `${p.seed}:${ask.id ?? "cloze"}`);
    return order.map((i) => unique[i] ?? "");
  }, [keys, ask.blanks, ask.id, p.seed]);

  const set = (k: string, v: string) => {
    const next = { ...values, [k]: v };
    setValues(next);
    p.onDraft?.(next);
  };
  const fillTile = (t: string) => {
    if (locked) return;
    const target = active ?? keys.find((k) => !values[k]) ?? keys[0];
    if (!target) return;
    set(target, t);
    const nextEmpty = keys.find((k) => k !== target && !values[k]);
    setActive(nextEmpty ?? target);
    if (nextEmpty) inputs.current[nextEmpty]?.focus();
  };
  const ready = keys.every((k) => (values[k] ?? "").trim());

  return (
    <form
      className="flex flex-col gap-3"
      data-input="cloze"
      onSubmit={(e) => {
        e.preventDefault();
        if (!locked && ready) p.onSubmit({ kind: "cloze", values });
      }}
    >
      <fieldset className="min-w-0 text-lead leading-[2.4] text-ink" aria-labelledby={p.promptId}>
        {parts.map(({ id, text: part }) => {
          const m = /^\{\{([^}]+)\}\}$/.exec(part);
          if (!m?.[1]) {
            return (
              <Fragment key={id}>
                <Md text={part} />
              </Fragment>
            );
          }
          const k = m[1];
          const accept = ask.blanks[k]?.accept ?? [];
          const width = Math.max(4, ...accept.map((a) => a.length)) + 2;
          return (
            <input
              key={k}
              ref={(el) => {
                inputs.current[k] = el;
              }}
              data-autofocus={k === keys[0] || undefined}
              aria-label={`Blank ${keys.indexOf(k) + 1}`}
              className={cn(
                "mx-1 inline-block h-10 rounded-sm border-b-2 border-ink bg-surface-2 px-2 text-center text-lead text-ink",
                active === k && "bg-sea-soft",
                solution && "border-sea",
              )}
              style={{ width: `${width}ch` }}
              autoComplete="off"
              value={values[k] ?? ""}
              disabled={locked}
              onFocus={() => setActive(k)}
              onChange={(e) => set(k, e.target.value)}
            />
          );
        })}
      </fieldset>
      {tiles.length > 0 ? (
        <fieldset className="flex flex-wrap gap-2 min-w-0" aria-label="Tiles">
          {tiles.map((t) => (
            <button
              key={t}
              type="button"
              disabled={locked}
              onClick={() => fillTile(t)}
              className="rounded-sm border-[1.5px] border-ink bg-surface px-3 py-1 text-body shadow-key-rest active:translate-y-0.5 active:shadow-key-down"
            >
              {t}
            </button>
          ))}
        </fieldset>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" kbd="⏎" disabled={locked || !ready}>
          {p.submitLabel}
        </Button>
      </div>
      {solution ? <p className="text-small text-ink-2">Those are the words. Check them to carry on.</p> : null}
    </form>
  );
}
