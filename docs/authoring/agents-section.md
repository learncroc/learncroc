<!-- Paste into your pack repo's AGENTS.md as the "Authoring packs with an agent" section. -->

## Authoring packs with an agent

If you are a coding agent asked to write or improve a learncroc pack, use the skills in `skills/`:

- `skills/learncroc-pack-author/SKILL.md`: a whole pack (map → stops → practice → lint → playtest).
- `skills/learncroc-node-writer/SKILL.md`: one stop.
- `skills/learncroc-minimap/SKILL.md`: a pocket map from one article.
- `skills/learncroc-pack-reviewer/SKILL.md`: review against the rubric and propose edits.

You need no learncroc AI key: you are the model. `learncroc build --prompt <id>` prints the same
versioned prompts the app uses (`author-plan`, `author-node`, `author-practice`, `create-*`), and
`learncroc lint <dir> --json` is the gate: you are done when it reports 0 errors. Write
`status: draft` everywhere and never write `reviews` in `pack.lock.yaml`.
