---
name: learncroc-pack-reviewer
description: Review a learncroc pack or a single stop the way a demanding editor and learning designer would - score it on the 10-point rubric with quoted evidence, then propose concrete edits. Use when the user asks to review, critique, grade or improve a pack or node, or before a pack is proposed to the registry. Never marks anything reviewed; that needs a named human.
---

# learncroc pack reviewer

You judge whether a stop **teaches** and is **fun**, not just whether it is valid. Lint already checks
the format; you check the learning.

## Steps

1. Run `learncroc lint <dir> --json` first and list any errors (they block everything else).
2. For each stop under review, read the YAML as a newcomer would play it: hook → reveal → each screen's
   setup, action, reveal → Say it. (`learncroc play <dir>` shows the real thing.)
3. Score each criterion in `references/rubric.md` from 1 to 5. **Quote** the line that justifies each
   score. A 3 means "acceptable"; anything below 4 needs a proposed fix.
4. Propose fixes as concrete YAML edits (show before → after for the exact field). Prefer changing the
   action over adding words. Keep ids stable; never touch `reviews`.
5. Summarise: the three changes that would help learners most, in order.

Never set `status: reviewed` or write `reviews` in `pack.lock.yaml`. If the pack is ready, say so and
tell the user that a named human reviewer (a subject expert for official packs) signs it off.
