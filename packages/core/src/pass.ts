/**
 * Credit rules.
 *
 * - Only checkpoint questions count. Hooks and beat actions never count.
 * - Checkpoint: a question is right when it is correct with hint level ≤ 1 and not assisted (one shot each);
 *   the pass rule (right ≥ size − 1) lives in checkpoint.ts.
 * - Relight: hint level 1 halves the score; hint level ≥ 2 or AI help scores 0.
 */
import { CHECKPOINT_RIGHT_MAX_HINT } from "./checkpoint";
import type { RunPhase, RunState } from "./schema/index";

/** Score after the hint and assist rules (relight and beat actions). */
export function creditedScore(score: number, hintLevel: number, assisted: boolean): number {
  if (assisted || hintLevel >= 2) return 0;
  if (hintLevel === 1) return score * 0.5;
  return score;
}

/** Checkpoint credit: 1 when the question counts as right for the gate, else 0. */
export function checkpointCredit(correct: boolean, hintLevel: number, assisted: boolean): 0 | 1 {
  return correct && hintLevel <= CHECKPOINT_RIGHT_MAX_HINT && !assisted ? 1 : 0;
}

/** Does an attempt in this phase count? Only checkpoint questions do. */
export function isCounted(run: Pick<RunState, "kind">, phase: RunPhase): boolean {
  return run.kind === "checkpoint" && phase === "checkpoint";
}
