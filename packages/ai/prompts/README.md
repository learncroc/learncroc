# Prompts

Versioned Markdown prompt files with YAML front-matter:

```markdown
---
id: create-node          # = file name
version: 1               # bump on any change; recorded in provenance as create-node@1
tier: fast               # fast | smart | deep (provider-neutral)
effort: low              # low | medium | high (providers that support it)
maxTokens: 6000
schema: PocketNodeDraft  # the LLM-facing schema in src/schemas.ts, when the call is structured
description: One line on what the call does.
---
Body with {{placeholders}} filled by the caller.
```

| Id | Used by |
|---|---|
| `house-style` | First, cached system block of every generation call |
| `ask`, `ask-socratic` | Ask (full after answering; Socratic before) |
| `hint` | Hint rewrite for the learner's wrong answer |
| `grade` | Explain / Say it / Teach grading against key points |
| `quiz-variant`, `solve` | Quiz me variants and the blind solver that checks them |
| `cards` | Cards from my session |
| `teach-nib` | Nib's in-character reply |
| `create-skeleton`, `create-node`, `create-figure`, `create-toy` | Article → pocket map |
| `repair` | One targeted repair round after validation or lint |
| `author-plan`, `author-node`, `author-practice` | `learncroc build` and the authoring skills |

`learncroc build --prompt <id>` prints a prompt with the house style, for agents and humans. Changing
a prompt: bump `version`, run `bun test` in `packages/ai` and, for generation prompts,
`bun scripts/eval/local.ts` against a real provider.
