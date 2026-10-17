/**
 * Explain: always typed first. With AI the server grades the sentence against key points
 * and a short Iris-marked reaction comes back. Offline the exemplar appears beside the learner's
 * sentence with matched keywords highlighted, and the learner rates themselves. Tiles (or "pick the
 * best of 3") appear only after "Give me words to start".
 */
import type { AnswerValue, KeyPoint, SelfRating } from "@learncroc/core";
import { Button, cn, IrisMark } from "@learncroc/ui";
import { CheckCircle, Circle } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { digitIndex, useKeys } from "../keys";
import { Md } from "../Markdown";
import { matchKeywords, segments, wordCount } from "../text";
import { seededOrder } from "./types";

export interface ExplainResult {
  correct: boolean;
  matched?: string[];
  feedback?: string;
  /** "ai" when the server graded with a model (Iris-marked). */
  source: "ai" | "offline";
}

export interface ExplainFieldProps {
  promptId: string;
  keyPoints: KeyPoint[];
  /** Shown beside the learner's sentence afterwards; without one, only the key points show. */
  exemplar?: string;
  tiles?: { text: string }[];
  options?: { text: string }[];
  aiConfigured: boolean;
  locked: boolean;
  draft?: string;
  onDraft?: (text: string) => void;
  onSubmit: (answer: Extract<AnswerValue, { kind: "explain" }>) => void;
  result?: ExplainResult;
  keysActive: boolean;
  seed: string;
  /** "Your sentence" placeholder. */
  placeholder?: string;
  /** Label for the typed commit in AI mode. */
  submitLabel?: string;
  packId?: string;
  /** "Give me words to start" without tiles or options: the caller swaps in a built-in question. */
  onStuck?: () => void;
  /** Focus the field on mount. */
  autoFocus?: boolean;
}

const RATINGS: { value: SelfRating; label: string }[] = [
  { value: "got-it", label: "Got it" },
  { value: "partly", label: "Partly" },
  { value: "missed", label: "Missed it" },
];

type Mode = "write" | "compare" | "tiles" | "options";

export function ExplainField(p: ExplainFieldProps) {
  const [text, setText] = useState(p.draft ?? "");
  const [mode, setMode] = useState<Mode>("write");
  const [built, setBuilt] = useState<number[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const exemplarId = useId();
  const words = wordCount(text);
  const match = useMemo(() => matchKeywords(text, p.keyPoints), [text, p.keyPoints]);
  const tileOrder = useMemo(() => seededOrder(p.tiles?.length ?? 0, `${p.seed}:tiles`), [p.tiles, p.seed]);
  const showExemplar = mode === "compare" || (p.result !== undefined && mode === "write");

  useEffect(() => {
    if (p.result && !p.result.correct && p.result.source === "ai") ref.current?.focus();
  }, [p.result]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, on mount
  useEffect(() => {
    if (p.autoFocus) ref.current?.focus();
  }, []);

  const submitTyped = () => {
    if (p.locked || words === 0) return;
    if (p.aiConfigured) p.onSubmit({ kind: "explain", text });
    else setMode("compare");
  };
  const rate = (r: SelfRating) => {
    if (p.locked) return;
    p.onSubmit({ kind: "explain", text, selfRating: r });
  };

  useKeys(
    (e) => {
      if (p.locked || mode !== "compare") return false;
      const d = digitIndex(e);
      const r = d !== undefined ? RATINGS[d] : undefined;
      if (r) {
        rate(r.value);
        return true;
      }
      return false;
    },
    { enabled: p.keysActive && mode === "compare" },
  );

  const exemplarCard = (
    <aside
      id={exemplarId}
      className="rounded-md border border-line bg-surface-2 p-3"
      aria-label={p.exemplar ? "One way to say it" : "What a good answer says"}
    >
      <p className="text-micro text-ink-3">{p.exemplar ? "One way to say it" : "What a good answer says"}</p>
      {p.exemplar ? (
        <p className="voice-casual text-body text-ink">
          <Md text={p.exemplar} packId={p.packId} />
        </p>
      ) : null}
      <ul className="mt-2 flex flex-col gap-1">
        {p.keyPoints.map((kp) => {
          const hit = (p.result?.matched ?? match.matched).includes(kp.id);
          return (
            <li key={kp.id} className="flex items-start gap-2 text-small text-ink-2">
              {hit ? (
                <CheckCircle
                  size={16}
                  weight="fill"
                  className="mt-0.5 shrink-0 text-sea"
                  aria-label="In your sentence"
                />
              ) : (
                <Circle size={16} className="mt-0.5 shrink-0 text-ink-3" aria-label="Not spotted" />
              )}
              <span>{kp.text}</span>
            </li>
          );
        })}
      </ul>
    </aside>
  );

  if (mode === "tiles" && p.tiles) {
    const tiles = p.tiles;
    return (
      <div className="flex flex-col gap-3" data-input="explain-tiles">
        <p
          className="min-h-14 rounded-key border-[1.5px] border-dashed border-line-strong bg-surface px-3 py-3 text-lead text-ink"
          aria-live="polite"
        >
          {built.length === 0 ? <span className="text-ink-3">Build it from the tiles below.</span> : null}
          {built.map((ti, i) => (
            <button
              key={ti}
              type="button"
              className="mr-1 mb-1 rounded-sm bg-sea-soft px-2 text-sea-text"
              aria-label={`Remove "${tiles[ti]?.text ?? ""}"`}
              disabled={p.locked}
              onClick={() => setBuilt(built.filter((_, j) => j !== i))}
            >
              {tiles[ti]?.text}
            </button>
          ))}
        </p>
        <fieldset className="flex flex-wrap gap-2 min-w-0" aria-label="Tiles">
          {tileOrder.map((ti) =>
            built.includes(ti) ? null : (
              <button
                key={ti}
                type="button"
                disabled={p.locked}
                onClick={() => setBuilt([...built, ti])}
                className="rounded-sm border-[1.5px] border-ink bg-surface px-3 py-1 text-body shadow-key-rest active:translate-y-0.5 active:shadow-key-down"
              >
                {tiles[ti]?.text}
              </button>
            ),
          )}
        </fieldset>
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            kbd="⏎"
            disabled={p.locked || built.length === 0}
            onClick={() => p.onSubmit({ kind: "explain", tiles: built.map((ti) => tiles[ti]?.text ?? "") })}
          >
            Use this sentence
          </Button>
          <Button variant="ghost" onClick={() => setMode("write")} disabled={p.locked}>
            Back to typing
          </Button>
        </div>
        {p.result ? exemplarCard : null}
      </div>
    );
  }

  if (mode === "options" && p.options) {
    const options = p.options;
    return (
      <fieldset className="flex min-w-0 flex-col gap-2" data-input="explain-options" aria-labelledby={p.promptId}>
        <p className="text-small text-ink-2">Which says it best?</p>
        {options.map((o, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: authored order
            key={i}
            type="button"
            disabled={p.locked}
            onClick={() => p.onSubmit({ kind: "explain", choice: String(i) })}
            className="flex min-h-14 items-center gap-3 rounded-key border-[1.5px] border-ink bg-surface px-4 text-left text-body shadow-key-rest active:translate-y-0.5 active:shadow-key-down"
          >
            <span
              aria-hidden
              className="grid size-6 place-items-center rounded-xs border border-line-strong text-micro tabular"
            >
              {i + 1}
            </span>
            <Md text={o.text} />
          </button>
        ))}
        <Button variant="ghost" onClick={() => setMode("write")} disabled={p.locked} className="self-start">
          Back to typing
        </Button>
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-input="explain">
      <div className={cn("grid gap-3", showExemplar ? "lg:grid-cols-2" : "")}>
        <div className="flex flex-col gap-2">
          {mode === "compare" ? (
            <p className="voice-casual min-h-14 rounded-key border-[1.5px] border-ink bg-surface px-4 py-3 text-lead text-ink">
              <span className="sr-only">Your sentence: </span>
              {segments(text, match.ranges).map((s, i) =>
                s.hit ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional segments
                  <mark key={i} className="rounded-xs bg-sea-soft px-0.5 text-ink">
                    {s.text}
                  </mark>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional segments
                  <span key={i}>{s.text}</span>
                ),
              )}
            </p>
          ) : (
            <textarea
              ref={ref}
              data-autofocus
              rows={2}
              className="voice-casual min-h-14 w-full resize-y rounded-key border-[1.5px] border-ink bg-surface px-4 py-3 text-lead text-ink shadow-key-rest placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-70"
              aria-labelledby={p.promptId}
              aria-describedby={showExemplar ? exemplarId : undefined}
              placeholder={p.placeholder ?? "One sentence, in your own words"}
              value={text}
              disabled={p.locked}
              onChange={(e) => {
                setText(e.target.value);
                p.onDraft?.(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitTyped();
                }
              }}
            />
          )}
          {p.result?.source === "ai" && p.result.feedback ? (
            <IrisMark as="p" className="text-body text-ink">
              <Md text={p.result.feedback} packId={p.packId} />
            </IrisMark>
          ) : null}
        </div>
        {showExemplar ? exemplarCard : null}
      </div>

      {mode === "compare" ? (
        <div className="flex flex-col gap-2" data-self-rating>
          <p className="text-small text-ink-2" id={`${p.promptId}-rate`}>
            Highlighted words match the key points. How close was yours?
          </p>
          <fieldset className="flex flex-wrap gap-2 min-w-0" aria-labelledby={`${p.promptId}-rate`}>
            {RATINGS.map((r, i) => (
              <Button key={r.value} kbd={String(i + 1)} disabled={p.locked} onClick={() => rate(r.value)}>
                {r.label}
              </Button>
            ))}
            <Button variant="ghost" disabled={p.locked} onClick={() => setMode("write")}>
              Edit my sentence
            </Button>
          </fieldset>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" kbd="⏎" disabled={p.locked || words === 0} onClick={submitTyped}>
            {p.aiConfigured ? (p.submitLabel ?? "Check") : "Compare"}
          </Button>
          {(p.tiles?.length || p.options?.length || p.onStuck) && !p.locked ? (
            <Button
              variant="ghost"
              onClick={() => {
                if (p.tiles?.length) setMode("tiles");
                else if (p.options?.length) setMode("options");
                else p.onStuck?.();
              }}
            >
              Give me words to start
            </Button>
          ) : null}
          <span className="ml-auto text-small text-ink-3 tabular" aria-live="off">
            {words} {words === 1 ? "word" : "words"}
          </span>
        </div>
      )}
    </div>
  );
}
