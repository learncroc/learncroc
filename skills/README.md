# learncroc skills for coding agents

These folders are [Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills): a `SKILL.md`
with front-matter (when to use it) and step-by-step instructions, plus reference files. They turn a
coding agent into a learncroc author that follows the same prompts, schemas and lint as
`learncroc build`. **The agent is the model**, so this path needs no learncroc AI key: every command
the skills run is deterministic, and `learncroc lint` is the gate.

| Skill | Use it to |
|---|---|
| `learncroc-pack-author` | Write a whole pack from sources or a topic: map, stops, practice, lint, playtest |
| `learncroc-node-writer` | Write or rewrite one stop to the node contract |
| `learncroc-minimap` | Turn one article into a small pocket-map folder |
| `learncroc-pack-reviewer` | Review a pack or a stop against the rubric and propose fixes |

## Install

Inside this repository, Claude Code finds them if `.claude/skills` points here:

```sh
mkdir -p .claude && ln -s ../skills .claude/skills
```

For a pack repo made from the template, copy the folders into that repo's `.claude/skills/` (or your
user-level `~/.claude/skills/`). Other agents can read the `SKILL.md` files as plain instructions;
`AGENTS.md` points at them.

## Commands the skills rely on (no key needed)

| Command | Does |
|---|---|
| `learncroc new <id> --title "…"` | Scaffold a pack that already passes lint |
| `learncroc lint <dir> [--json] [--fix] [--profile community]` | Every rule (PLAN §11.3); `--json` for agents |
| `bun run validate:pack <dir>` | Schema check only (fast) |
| `learncroc play <dir>` | Open the pack in the app with live reload |
| `learncroc build --prompt <id>` | Print a versioned prompt (`author-plan`, `author-node`, `author-practice`, `create-skeleton`, `create-node`, `create-figure`, `create-toy`, …) with the shared house style |

Inside this repo, `learncroc` is `bun packages/cli/src/index.ts`. The prompt files themselves live in
`packages/ai/prompts/`; improving a prompt improves `learncroc build`, the app and every agent at once.
