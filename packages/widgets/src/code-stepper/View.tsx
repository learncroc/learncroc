/**
 * code-stepper view: the program with the current line marked, the variables (name tags or boxes) and the
 * console. Stepping onto a marked step first asks for a prediction; the step is revealed once the learner
 * locks one in (or says "Not sure").
 */
import { Button, cn } from "@learncroc/ui";
import { type FormEvent, type KeyboardEvent, type ReactNode, useId, useMemo, useState } from "react";
import { useAnswer } from "../light-clock/view-kit";
import { WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import {
  type CodeStepperAnswer,
  type CodeStepperGoal,
  type CodeStepperProps,
  codeStepperSpec,
  expectedAt,
  formatValue,
  samePrediction,
  type TraceValue,
} from "./spec";

type Props = WidgetViewProps<CodeStepperProps, CodeStepperGoal, CodeStepperAnswer>;

export default function CodeStepperView(p: Props) {
  const props = useMemo(() => withReveal(p.props, p.revealProps), [p.props, p.revealProps]);
  const readOnly = p.mode === "review";
  const [answer, setAnswer] = useAnswer(p.value, () => codeStepperSpec.initialAnswer(props), p.onChange);
  const lines = useMemo(() => props.code.replace(/\n+$/, "").split("\n"), [props.code]);
  const n = props.trace.length;

  // `step` = the last revealed trace step (−1 before the program starts).
  const [step, setStep] = useState(readOnly ? n - 1 : -1);
  const [draft, setDraft] = useState("");
  const promptIndex = (s: number) => props.predictAt.findIndex((a) => a.step === s);
  // "Not sure" stores an empty prediction; remember those so the prompt doesn't come back this session.
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(() => new Set());
  const predicted = (i: number) => (answer.predictions[i] ?? "") !== "" || skipped.has(i);
  const nextStep = step + 1;
  const gateIndex = nextStep < n ? promptIndex(nextStep) : -1;
  const gated = !readOnly && gateIndex >= 0 && !predicted(gateIndex);
  const [asking, setAsking] = useState(false);
  const formId = useId();
  const inputId = useId();
  const codeId = useId();

  const reveal = (s: number, prefix = "") => {
    setStep(s);
    const t = props.trace[s];
    if (!t) return;
    const out = t.output !== undefined ? ` Prints ${t.output}.` : "";
    p.announce(`${prefix}Step ${s + 1} of ${n}: line ${t.line}, ${lines[t.line - 1]?.trim() ?? ""}.${out}`);
  };

  const forward = () => {
    if (nextStep >= n) return;
    if (gated) {
      setAsking(true);
      p.announce(`Prediction first. ${questionText(props, gateIndex, lines)}`);
      return;
    }
    reveal(nextStep);
  };
  const back = () => {
    if (step < 0) return;
    setAsking(false);
    if (step === 0) {
      setStep(-1);
      p.announce("Back to the start.");
    } else reveal(step - 1);
  };

  const lockIn = (value: string) => {
    // Always parallel to predictAt; unanswered entries are "" (they never match).
    const filled = props.predictAt.map((_, i) => answer.predictions[i] ?? "");
    filled[gateIndex] = value;
    setAnswer({ predictions: filled });
    if (value === "") setSkipped((s) => new Set(s).add(gateIndex));
    setAsking(false);
    setDraft("");
    const want = expectedAt(props, gateIndex);
    const verdict =
      value === ""
        ? `It's ${want ?? "shown now"}.`
        : want !== undefined && samePrediction(value, want)
          ? "That matches."
          : `It's ${want}.`;
    reveal(nextStep, `${verdict} `);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim() === "") return;
    lockIn(draft.trim());
  };

  const onStepKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    if (e.key === "ArrowLeft") back();
    else if (!(asking && gated)) forward();
  };

  const cur = step >= 0 ? props.trace[step] : undefined;
  const prev = step > 0 ? props.trace[step - 1] : undefined;
  const upcoming = gated && asking ? props.trace[nextStep] : undefined;
  const hideUpcomingLine = upcoming && props.predictAt[gateIndex]?.ask === "line";
  const outputs = props.trace
    .slice(0, step + 1)
    .flatMap((t) => (t.output !== undefined ? [t.output] : []))
    .join("\n");

  // Results of predictions already made, shown as a small log.
  const made = props.predictAt
    .map((a, i) => ({ a, i, value: answer.predictions[i], want: expectedAt(props, i) }))
    .filter(
      (x) =>
        (readOnly || x.a.step <= step) && x.value !== undefined && (x.value !== "" || readOnly || skipped.has(x.i)),
    );

  return (
    <WidgetShell id="code-stepper" mode={p.mode} label={codeStepperSpec.title}>
      <div className="grid gap-3 @[40rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby={codeId} className="overflow-x-auto rounded-stage bg-surface-2 py-3">
          <h3 id={codeId} className="sr-only">
            Program, {props.lang === "python" ? "Python" : "JavaScript"}
          </h3>
          <ol className="voice-mono text-code">
            {lines.map((text, i) => {
              const ln = i + 1;
              const isCur = cur?.line === ln && !upcoming;
              const isNext = upcoming && !hideUpcomingLine && upcoming.line === ln;
              return (
                <li
                  key={`${ln}:${text}`}
                  aria-current={isCur ? "step" : undefined}
                  className={cn(
                    "flex list-none items-baseline gap-3 px-3 transition-colors duration-quick",
                    isCur && "bg-sea-soft",
                    isNext && "outline-2 -outline-offset-2 outline-dashed outline-sea",
                  )}
                >
                  <span aria-hidden="true" className="w-4 shrink-0 text-ink-3">
                    {isCur ? "▸" : isNext ? "›" : ""}
                  </span>
                  <span className="w-5 shrink-0 select-none text-right text-ink-3 tabular">{ln}</span>
                  <code className="whitespace-pre text-ink">{highlight(text, props.lang)}</code>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="flex flex-col gap-3">
          <section aria-label="Variables" className="rounded-md border border-line bg-surface p-3">
            <h3 className="mb-2 text-small text-ink-2">Variables</h3>
            <Variables vars={cur?.vars ?? {}} prev={prev?.vars} view={props.view} lang={props.lang} />
          </section>
          <section aria-label="Output" className="rounded-md bg-ink p-3">
            <h3 className="mb-1 text-small text-surface opacity-80">Output</h3>
            <pre className="voice-mono min-h-6 whitespace-pre-wrap text-code text-surface" data-output>
              {outputs}
            </pre>
          </section>
        </div>
      </div>

      {asking && gated ? (
        <form
          id={formId}
          onSubmit={submit}
          className="flex flex-col gap-2 rounded-md border-[1.5px] border-ink bg-surface p-3 shadow-2"
        >
          <label htmlFor={inputId} className="text-body text-ink">
            {questionText(props, gateIndex, lines)}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={inputId}
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              autoComplete="off"
              spellCheck={false}
              // biome-ignore lint/a11y/noAutofocus: the prediction prompt appears because the learner asked to step.
              autoFocus
              className="voice-mono h-11 w-48 rounded-sm border-[1.5px] border-line-strong bg-surface px-3 text-code text-ink"
            />
            <Button type="submit" variant="primary" disabled={draft.trim() === ""}>
              Lock it in
            </Button>
            <Button variant="ghost" onClick={() => lockIn("")}>
              Not sure, show me
            </Button>
          </div>
        </form>
      ) : null}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: ←/→ step while focus is on any of the stepper's buttons. */}
      <div className="flex flex-wrap items-center gap-2" onKeyDown={onStepKey}>
        <Button size="sm" onClick={back} disabled={step < 0} aria-keyshortcuts="ArrowLeft">
          ← Back
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={forward}
          disabled={nextStep >= n || (asking && gated)}
          aria-keyshortcuts="ArrowRight"
        >
          {gated && !readOnly ? "Step (predict first)" : "Step →"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setAsking(false);
            setStep(-1);
            p.announce("Back to the start.");
          }}
          disabled={step < 0}
        >
          Restart
        </Button>
        <span className="ml-auto text-small text-ink-2 tabular" aria-live="off">
          {step < 0 ? "Not started" : `Step ${step + 1} of ${n}`}
        </span>
      </div>

      {made.length ? (
        <ul aria-label="Your predictions" className="flex flex-col gap-1">
          {made.map(({ a, value, want }) => {
            const ok = want !== undefined && value !== undefined && value !== "" && samePrediction(value, want);
            return (
              <li
                key={`${a.step}-${a.ask}`}
                className="list-none text-small text-ink-2"
                data-prediction={ok ? "match" : "differs"}
              >
                Step {a.step + 1}: you said{" "}
                <span className="voice-mono text-ink">{value === "" ? "not sure" : value}</span>
                {ok ? (
                  <span className="text-sea-text">. That matches.</span>
                ) : (
                  <>
                    . It's <span className="voice-mono text-ink">{want}</span>.
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </WidgetShell>
  );
}

function questionText(p: CodeStepperProps, i: number, lines: string[]): string {
  const a = p.predictAt[i];
  const t = a ? p.trace[a.step] : undefined;
  if (!a || !t) return "Your prediction?";
  if (a.ask === "line") return "Which line runs next? (a line number)";
  const code = lines[t.line - 1]?.trim() ?? "";
  if (a.ask === "output") return `Line ${t.line} (${code}) runs next. What will it print?`;
  return `Line ${t.line} (${code}) runs next. What will ${a.name} be after it?`;
}

function Variables(props: {
  vars: Record<string, TraceValue>;
  prev?: Record<string, TraceValue>;
  view: CodeStepperProps["view"];
  lang: CodeStepperProps["lang"];
}) {
  const entries = Object.entries(props.vars);
  if (entries.length === 0) return <p className="text-small text-ink-3">None yet.</p>;
  return (
    <ul
      className={cn(
        props.view === "boxes" ? "grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2" : "flex flex-col gap-2",
      )}
    >
      {entries.map(([name, v]) => {
        const changed = props.prev !== undefined && (!(name in props.prev) || props.prev[name] !== v);
        const value = formatValue(v, props.lang);
        return props.view === "boxes" ? (
          <li key={name} className="flex list-none flex-col items-start gap-1" data-var={name}>
            <span className="voice-mono text-small text-ink-2">{name}</span>
            <span
              className={cn(
                "voice-mono flex min-h-10 w-full items-center rounded-sm border-[1.5px] border-ink px-2 text-code text-ink transition-colors duration-base",
                changed ? "bg-iris-soft" : "bg-surface-2",
              )}
            >
              {value}
              {changed ? <span className="sr-only"> (changed)</span> : null}
            </span>
          </li>
        ) : (
          <li key={name} className="flex list-none items-center gap-2" data-var={name}>
            <span className="voice-mono rounded-pill border-[1.5px] border-ink bg-surface px-2.5 py-0.5 text-small text-ink">
              {name}
            </span>
            <span aria-hidden="true" className="h-px w-6 bg-ink-3" />
            <span
              className={cn(
                "voice-mono rounded-xs px-2 py-0.5 text-code text-ink transition-colors duration-base",
                changed ? "bg-iris-soft" : "bg-surface-2",
              )}
            >
              {value}
              {changed ? <span className="sr-only"> (changed)</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Minimal syntax colouring (keywords, strings, numbers, comments) ─────────────────────────────

const KEYWORDS = {
  python: new Set(
    "and as break class continue def elif else for from if import in is lambda not or pass print range return while with True False None len".split(
      " ",
    ),
  ),
  javascript: new Set(
    "break case const continue else for function if in let new of return switch while true false null undefined console log".split(
      " ",
    ),
  ),
};

function highlight(line: string, lang: CodeStepperProps["lang"]): ReactNode[] {
  const comment = lang === "python" ? "#" : "//";
  const re = new RegExp(
    `(${comment === "#" ? "#" : "\\/\\/"}.*$)|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`[^\`]*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_]\\w*)`,
    "g",
  );
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of line.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(line.slice(last, at));
    const [tok, c, s, num, word] = m;
    if (c)
      out.push(
        <span key={k++} className="italic text-ink-3">
          {tok}
        </span>,
      );
    else if (s)
      out.push(
        <span key={k++} className="text-sea-text">
          {tok}
        </span>,
      );
    else if (num)
      out.push(
        <span key={k++} className="text-ember-text">
          {tok}
        </span>,
      );
    else if (word && KEYWORDS[lang].has(word))
      out.push(
        <span key={k++} className="font-semibold text-iris">
          {tok}
        </span>,
      );
    else out.push(tok);
    last = at + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
