---
name: learncroc-pack-author
description: Author or extend a learncroc learning pack (a skill map plus interactive stops) from sources, notes or a topic. Use when the user wants to create a pack, add stops to a pack, turn notes/articles/URLs into a pack, or fix a pack that fails `learncroc lint`. Produces pack.yaml, map.yaml and nodes/*.yaml that pass lint, all marked status draft.
---

# learncroc pack author

You are writing a learncroc pack: a prerequisite map (a DAG) whose stops are 3–5 minute interactive
lessons for adults. The bar: **learning is fun and it actually teaches**. Quizzes confirm learning;
they are never the lesson. Read `references/principles-checklist.md` before writing anything.

## Ground rules

- **Do, don't read.** Every screen ends in an action the learner performs (guess, sort, order, set a
  number, type, explain). ≤ 30 words of setup before the action, ≤ 50 in the reveal, ≤ 40 in the hook,
  ≤ 350 learner-facing words per stop. No "Continue" buttons.
- **Guess first.** Every stop opens with a hook about its core idea that a smart newcomer will
  probably get wrong. Write "Lots of people guess …", never "Most people".
- **One new idea per screen, with a visual.** Use only the 15 built-in widgets (`references/widgets.md`)
  or a figure. Widgets need `goal`, `solution` and a built-in `fallback`.
- **Ground claims** in the user's sources. No source → keep it qualitative or mark the number
  "illustrative". Never invent numbers, quotes or studies.
- **Voice:** dry, warm, adult. No exclamation marks, no emoji, no praise ("Great job"), no streaks or XP.
- **Status:** write `status: draft` everywhere. Never write `reviews` in `pack.lock.yaml`; only named
  humans sign off.
- **`learncroc lint` is the gate.** You are done only when it reports 0 errors.

## Workflow

1. **Understand the pack.** Read `pack.yaml` if it exists. If not, ask for the title, audience and size,
   then run `learncroc new <id> --title "…"` (ids are lowercase words joined by dashes).
2. **Read the sources** the user gave you (files, URLs you fetch, notes). Keep short chunk ids
   (`s1`, `s2`, …) so screens can cite them in `src`.
3. **Plan the map.** Print the planner prompt with `learncroc build --prompt author-plan` and follow it.
   Write `map.yaml` (rules in `references/map-design.md`). Run `learncroc lint <dir> --json` and fix
   map errors. **Stop and show the user the graph** (a short list "stop ← requires"), and list the
   edges you are unsure about as questions. Wait for approval: wrong edges are the costliest mistake.
4. **Write stops, roots first.** For each stop, use the learncroc-node-writer skill (or follow
   `learncroc build --prompt author-node` directly). Write `nodes/<id>.yaml`, then
   `learncroc lint <dir> --json` and fix every error before moving on.
5. **Practice.** `learncroc build --prompt author-practice` gives the item-bank rules. Each stop needs the
   profile's item count (community ≥ 3, sampler ≥ 6, curated ≥ 10), ≤ 40% choice, no True/False, at least
   one transfer item, a placement item for curated and sampler packs.
6. **Self-check like a blind solver.** For every item, cover the answer and solve it from the key points
   alone. If your answer differs from the key, fix the item.
7. **Review.** Run the learncroc-pack-reviewer skill on the three most important stops; apply its
   fixes; lint again.
8. **Playtest.** `learncroc play <dir>` and play two stops as a newcomer would. Could someone with only
   the prerequisites pass the last screen? If not, a teaching screen is missing.
9. **Report** to the user: stops written, lint status, anything that needs a human (unsourced numbers,
   custom interactives), and how to play the pack.

## Quality bar (check each stop before moving on)

- Would an adult be curious after the hook? Would lots of people guess wrong?
- Does each screen show the idea before testing it, and does the learner's hand do the idea?
- Does every wrong option map to a misconception, and every misconception point upstream (an ancestor
  stop or `in-node:<screenId>`)?
- Does each reveal name what the canvas just did instead of re-explaining?
- Any sentence that talks down to an adult? Delete it.

## References

- `references/principles-checklist.md`: PRINCIPLES.md as a pre-flight checklist.
- `references/node-anatomy.md`: an annotated stop, field by field.
- `references/map-design.md`: DAG and theme rules lint enforces.
- `references/widgets.md`: the 15 widgets and when to use each.
- Worked examples: `templates/pack/` (a lint-clean 3-stop pack) and `packages/core/fixtures/mini-pack/`.
- Field-by-field schema reference: `docs/reference/` (generated from the zod schemas).
