/**
 * The last checkpoint miss per gate, kept for this tab so a revisit card (`?card=x&from=<cp>`) can say
 * what was missed ("You missed: … This card has what you need.") and the result can be shown again.
 * UI memory only (sessionStorage): the server keeps the real revisit flags.
 */
import type { CheckpointOutcome, NodeId, PackId, RevisitTarget } from "@learncroc/core";

const KEY = "lm.revisit";

type Store = Record<string, RevisitTarget[]>;

function read(): Store {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(s: Store): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage off: the band falls back to a generic line */
  }
}

const k = (packId: PackId, cpId: NodeId) => `${packId}/${cpId}`;

/** Remember a finished checkpoint attempt (a pass clears the gate's entry). */
export function rememberCheckpoint(packId: PackId, outcome: CheckpointOutcome): void {
  const s = read();
  if (outcome.passed) delete s[k(packId, outcome.checkpointId)];
  else s[k(packId, outcome.checkpointId)] = outcome.revisit;
  write(s);
}

/** What the learner missed that points at this card, from the latest miss at `cpId`. */
export function revisitFor(packId: PackId, cpId: NodeId, nodeId: NodeId): RevisitTarget | undefined {
  return read()[k(packId, cpId)]?.find((r) => r.nodeId === nodeId);
}
