/**
 * URL search params on /p/$pack: card, checkpoint, from, guess, again, finished. No peek param
 * (peeks are transient). `?stop=<id>` is the legacy alias, read once as `card`; PackMapScreen rewrites a
 * checkpoint id found in `card` to `checkpoint` (and the reverse) with replace.
 */

export interface MapSearch {
  /** Open this card's modal (play, or replay a done/lit/fading card). */
  card?: string;
  /** Open this checkpoint's modal. */
  checkpoint?: string;
  /** Revisit: the checkpoint the card's end button returns to. */
  from?: string;
  /** A pre-locked hook option id or "idk" (the first-run question): the card opens at beat 1. */
  guess?: string;
  /** "Guess again" / Yesterday's question: a fresh hook, no state change. */
  again?: true;
  /** Show the finished-map modal. */
  finished?: true;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const GUESS_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const id = (v: unknown): string | undefined => {
  const s = str(v);
  return s && ID_RE.test(s) ? s : undefined;
};
const flag = (v: unknown): boolean => v === true || v === "" || v === "1" || v === "true" || v === 1;

export function validateMapSearch(s: Record<string, unknown>): MapSearch {
  const card = id(s.card) ?? id(s.stop);
  const checkpoint = card ? undefined : id(s.checkpoint);
  const from = id(s.from);
  const guess = str(s.guess);
  return {
    ...(card ? { card } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(card && from ? { from } : {}),
    ...(card && guess && GUESS_RE.test(guess) ? { guess } : {}),
    ...(card && flag(s.again) ? { again: true as const } : {}),
    ...(!card && !checkpoint && flag(s.finished) ? { finished: true as const } : {}),
  };
}
