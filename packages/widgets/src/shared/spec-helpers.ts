/**
 * Helpers shared by widget specs. No React imports: specs run in core lint, the server and the CLI.
 */
import type { GradeResult, WidgetSpec } from "@learncroc/core";

/** Placeholder grade for widgets whose real grader hasn't landed yet. Never grades correct. */
export function gradeNotImplemented(): GradeResult {
  return { correct: false, score: 0, feedback: "This widget's grader is not implemented yet." };
}

/** Placeholder semantic validation: accepts everything. */
export function validateNotImplemented(): string[] {
  return [];
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function graded(correct: boolean, score = correct ? 1 : 0, extra: Partial<GradeResult> = {}): GradeResult {
  return { correct, score: clamp01(score), ...extra };
}

/**
 * Build a spec whose grade() and validate() are placeholders. The zod props, goal and answer are
 * final; the widget's owner replaces grade, validate, toText and examples.
 */
export function stubSpec<P, G, A>(
  spec: Omit<WidgetSpec<P, G, A>, "version" | "validate" | "grade" | "toText" | "examples"> &
    Partial<Pick<WidgetSpec<P, G, A>, "toText" | "examples">>,
): WidgetSpec<P, G, A> {
  return {
    version: 1,
    validate: validateNotImplemented,
    grade: gradeNotImplemented,
    toText: (props) => spec.textAlternative(props),
    examples: [],
    ...spec,
  };
}
