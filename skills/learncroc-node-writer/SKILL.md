---
name: learncroc-node-writer
description: Write, rewrite or improve one learncroc stop (nodes/<id>.yaml) to the node contract - a guess-first hook, 2-5 do-then-reveal screens, an item bank, Say it and misconceptions - until `learncroc lint` passes. Use when the user says "write the X stop", "rewrite this node", "this stop is boring / too wordy / fails lint", or when the pack-author skill reaches a stop.
---

# learncroc node writer

One stop is a 3–5 minute lesson that teaches **one** idea to an adult by having them do it. Read
`../learncroc-pack-author/references/principles-checklist.md` and one complete example
(`templates/pack/nodes/per-hundred.yaml`) first.

## Steps

1. **Get the plan.** From `map.yaml` and the user: the stop's id, title, line, what it requires (the
   learner has already lit those) and which stops come after it (don't teach those yet). Write down the
   `bigIdea` in one sentence and 1–3 objectives with observable verbs.
2. **Print the contract:** `learncroc build --prompt author-node`. Follow its SHAPE section exactly.
3. **Misconceptions first.** Write 1–2 (community) or 2+ (curated) wrong beliefs a smart newcomer brings,
   each with an `upstream` (an ancestor stop id, or `in-node:<screenId>` when the fix is a screen of this
   stop) and a hint of ≤ 30 words that points without telling.
4. **Hook.** A guess-first question about the `bigIdea`, not a definition. Choice options should be the
   misconceptions in disguise (tag each wrong option). Add `confidence: true`. Reveal in ≤ 40 words.
   Add `lotsGuess` only if you really expect most guesses to land there.
5. **Screens.** The first resolves the hook, the middle ones teach (one `newIdea` each), the last is a
   near-transfer task (new situation, same idea, no hints). On each: ≤ 30 words of setup as a micro-story,
   then one interaction, then a reveal (≤ 50 words) that names what just happened on the canvas. Prefer
   non-choice actions (sorter, numeric, order, plot); at least one is required by lint (L018).
6. **Items.** `learncroc build --prompt author-practice` gives the rules: recall / apply / transfer,
   ≤ 40% choice, no True/False, a placement item (curated, sampler), parametric numbers via `params` when
   a number could vary.
7. **Say it.** One-sentence explain-it-back prompt, 2–3 key points with keywords, `minHits`, and a
   ≤ 30-word exemplar.
8. **Lint loop.** `learncroc lint <pack-dir> --json`; fix every error on this stop; repeat until clean.
   `learncroc lint --fix` handles mechanical issues (missing alt placeholders, theme colours).
9. **Blind-solve** every item from the key points alone. Disagree with the key → fix the item.
10. Keep `status: draft`.

## Common lint failures and fixes

| Rule | Usually means | Fix |
|---|---|---|
| L001 / L001b | Too many words | Cut setup into the reveal; make the canvas do the explaining |
| L003 | A screen without a real action | Turn the statement into a prediction or a sort |
| L004 | Missing visual or alt | Add a widget visual or a figure with `alt` |
| L005 | Hook gives the answer or is a definition | Ask about a consequence instead |
| L008 | Misconception id or upstream wrong | Upstream must be an ancestor stop or `in-node:sN…` |
| L009 / L010 | Widget props, goal or solution invalid | Check the widget's `spec.ts`; the solution must grade correct |
| L018 | Too much multiple choice | Swap choices for numeric, order, text or a sorter |
| L019 | Choice on a widget canvas doesn't act out | Give each option a `visualState` |
