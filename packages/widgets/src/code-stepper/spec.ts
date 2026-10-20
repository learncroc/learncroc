/**
 * code-stepper: step through code with a precomputed trace. At marked steps, predict a variable value
 * or the output before it is shown. Name-tag or box view.
 */
import { graded } from "../shared/spec-helpers";
import { type WidgetSpec, z } from "../shared/zod";

export const CodeStepperProps = z.strictObject({
  lang: z.enum(["python", "javascript"]),
  /** ≤ 20 lines. */
  code: z.string(),
  trace: z.array(
    z.strictObject({
      line: z.number().int(),
      vars: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      output: z.string().optional(),
    }),
  ),
  predictAt: z.array(
    z.strictObject({ step: z.number().int(), ask: z.enum(["var", "output", "line"]), name: z.string().optional() }),
  ),
  view: z.enum(["name-tags", "boxes"]),
});

/** answers parallel to predictAt. */
export const CodeStepperGoal = z.strictObject({
  kind: z.literal("predictions"),
  answers: z.array(z.string()),
  minCorrect: z.number().int(),
});

export const CodeStepperAnswer = z.object({ predictions: z.array(z.string()) });

export type CodeStepperProps = z.infer<typeof CodeStepperProps>;
export type CodeStepperGoal = z.infer<typeof CodeStepperGoal>;
export type CodeStepperAnswer = z.infer<typeof CodeStepperAnswer>;
export type TraceValue = string | number | boolean | null;

export const MAX_LINES = 20;

/** How a value reads in the program's language: strings with quotes, True/None in Python. */
export function formatValue(v: TraceValue, lang: CodeStepperProps["lang"], quoteStrings = true): string {
  if (v === null) return lang === "python" ? "None" : "null";
  if (typeof v === "boolean") return lang === "python" ? (v ? "True" : "False") : String(v);
  if (typeof v === "number") return String(v);
  return quoteStrings ? (lang === "python" ? `'${v}'` : `"${v}"`) : v;
}

/** The value a prediction at `predictAt[i]` should match, read from the trace (as text). */
export function expectedAt(p: CodeStepperProps, i: number): string | undefined {
  const at = p.predictAt[i];
  const step = at ? p.trace[at.step] : undefined;
  if (!at || !step) return undefined;
  if (at.ask === "line") return String(step.line);
  if (at.ask === "output") return step.output;
  if (!at.name || !(at.name in step.vars)) return undefined;
  return formatValue(step.vars[at.name] as TraceValue, p.lang, false);
}

/** Canonical form of a typed prediction: trimmed, unquoted, booleans/null case-folded, numbers numeric. */
export function canonical(s: string): string {
  let t = s.trim().replace(/\r\n/g, "\n");
  t = t
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n");
  const q = t.match(/^(['"`])([\s\S]*)\1$/);
  if (q) t = q[2] as string;
  const lower = t.toLowerCase();
  if (lower === "true" || lower === "false") return lower;
  if (lower === "none" || lower === "null" || lower === "undefined") return "null";
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return String(Number(t));
  return t.replace(/[ \t]+/g, " ");
}

export function samePrediction(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

function validate(p: CodeStepperProps, goal?: CodeStepperGoal): string[] {
  const errors: string[] = [];
  const lines = p.code.replace(/\n+$/, "").split("\n");
  if (p.code.trim() === "") errors.push("code is empty");
  if (lines.length > MAX_LINES) errors.push(`code has ${lines.length} lines; the limit is ${MAX_LINES}`);
  if (p.trace.length === 0) errors.push("trace needs at least one step");
  p.trace.forEach((s, i) => {
    if (s.line < 1 || s.line > lines.length)
      errors.push(`trace step ${i} points at line ${s.line}, outside 1–${lines.length}`);
  });
  const steps = p.predictAt.map((a) => a.step);
  if (new Set(steps).size !== steps.length) errors.push("predictAt steps must be distinct");
  p.predictAt.forEach((a, i) => {
    const s = p.trace[a.step];
    if (!s) {
      errors.push(`predictAt ${i} asks about step ${a.step}, but the trace has ${p.trace.length} steps`);
      return;
    }
    if (a.ask === "var") {
      if (!a.name) errors.push(`predictAt ${i} asks for a variable but has no name`);
      else if (!(a.name in s.vars))
        errors.push(`predictAt ${i}: variable "${a.name}" isn't in the trace at step ${a.step}`);
    }
    if (a.ask === "output" && s.output === undefined) errors.push(`predictAt ${i}: step ${a.step} prints nothing`);
  });
  if (!goal) return errors;
  if (goal.answers.length !== p.predictAt.length) errors.push("goal answers must be parallel to predictAt");
  if (goal.minCorrect < 1 || goal.minCorrect > p.predictAt.length) {
    errors.push(`minCorrect must be between 1 and ${p.predictAt.length}`);
  }
  goal.answers.forEach((ans, i) => {
    const want = expectedAt(p, i);
    if (want !== undefined && !samePrediction(ans, want)) {
      errors.push(`goal answer ${i + 1} is "${ans}" but the trace says "${want}"`);
    }
  });
  return errors;
}

function grade({ goal, answer }: { props: CodeStepperProps; goal: CodeStepperGoal; answer: CodeStepperAnswer }) {
  const total = goal.answers.length;
  const right = goal.answers.filter((a, i) => samePrediction(answer.predictions[i] ?? "", a)).length;
  const ok = right >= goal.minCorrect;
  return graded(ok, total === 0 ? 0 : right / total, {
    solution: { predictions: goal.answers } satisfies CodeStepperAnswer,
  });
}

export const codeStepperSpec: WidgetSpec<CodeStepperProps, CodeStepperGoal, CodeStepperAnswer> = {
  id: "code-stepper",
  version: 1,
  title: "Code stepper",
  family: "code",
  description:
    "Step through a short program (≤ 20 lines) with a precomputed trace; at marked steps the learner predicts a variable, the output or the next line before it is revealed. Variables show as name tags or boxes.",
  llmDoc: {
    useWhen: "How a program runs line by line: assignment, loops, conditionals, output.",
    notFor: "Programs longer than 20 lines or anything that needs real execution (the trace is authored).",
    learnerDoes:
      "Steps forward and back with buttons or ←/→; at each marked step types a prediction (or 'Not sure') before the step is shown, then compares.",
    reports:
      "{ predictions: [string…] } parallel to predictAt; matching ignores surrounding quotes, case of True/False/None, and 6 vs 6.0.",
  },
  props: CodeStepperProps,
  goal: CodeStepperGoal,
  answer: CodeStepperAnswer,
  validate,
  grade,
  initialAnswer: () => ({ predictions: [] }),
  textAlternative: (p) =>
    `A ${p.lang === "python" ? "Python" : "JavaScript"} program of ${p.code.replace(/\n+$/, "").split("\n").length} lines with a ${p.trace.length}-step trace; ${p.predictAt.length} steps ask for a prediction first.`,
  toText: (p, a) => {
    const code = p.code
      .replace(/\n+$/, "")
      .split("\n")
      .map((l, i) => `${String(i + 1).padStart(2)}  ${l}`)
      .join("\n");
    const preds = a?.predictions.length ? `\nPredictions: ${a.predictions.map((x) => x || "(none)").join(", ")}` : "";
    return `${code}${preds}`;
  },
  examples: [
    {
      note: "A loop that adds up: predict total and the printed result",
      props: {
        lang: "python",
        code: "total = 0\nfor n in range(1, 4):\n    total = total + n\nprint(total)",
        trace: [
          { line: 1, vars: { total: 0 } },
          { line: 2, vars: { total: 0, n: 1 } },
          { line: 3, vars: { total: 1, n: 1 } },
          { line: 2, vars: { total: 1, n: 2 } },
          { line: 3, vars: { total: 3, n: 2 } },
          { line: 2, vars: { total: 3, n: 3 } },
          { line: 3, vars: { total: 6, n: 3 } },
          { line: 4, vars: { total: 6, n: 3 }, output: "6" },
        ],
        predictAt: [
          { step: 4, ask: "var", name: "total" },
          { step: 7, ask: "output" },
        ],
        view: "boxes",
      },
      goal: { kind: "predictions", answers: ["3", "6"], minCorrect: 2 },
      correctAnswer: { predictions: ["3", "6"] },
      wrongAnswer: { predictions: ["2", "6"] },
    },
    {
      note: "Name tags: reassignment moves the tag, not the value",
      props: {
        lang: "javascript",
        code: 'let a = "tea";\nlet b = a;\na = "coffee";\nconsole.log(b);',
        trace: [
          { line: 1, vars: { a: "tea" } },
          { line: 2, vars: { a: "tea", b: "tea" } },
          { line: 3, vars: { a: "coffee", b: "tea" } },
          { line: 4, vars: { a: "coffee", b: "tea" }, output: "tea" },
        ],
        predictAt: [
          { step: 2, ask: "var", name: "b" },
          { step: 3, ask: "output" },
        ],
        view: "name-tags",
      },
      goal: { kind: "predictions", answers: ["tea", "tea"], minCorrect: 1 },
      correctAnswer: { predictions: ['"tea"', "coffee"] },
      wrongAnswer: { predictions: ["coffee", "coffee"] },
    },
    {
      note: "Which line runs next after a false condition?",
      props: {
        lang: "python",
        code: 'age = 15\nif age >= 18:\n    print("adult")\nprint("done")',
        trace: [
          { line: 1, vars: { age: 15 } },
          { line: 2, vars: { age: 15 } },
          { line: 4, vars: { age: 15 }, output: "done" },
        ],
        predictAt: [{ step: 2, ask: "line" }],
        view: "boxes",
      },
      goal: { kind: "predictions", answers: ["4"], minCorrect: 1 },
      correctAnswer: { predictions: ["4"] },
      wrongAnswer: { predictions: ["3"] },
    },
  ],
};
