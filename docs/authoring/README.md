# Authoring packs with AI

Three ways to write a pack, from no AI at all to fully drafted:

1. **By hand:** `learncroc new <id>`, edit the YAML, `learncroc lint`. See `docs/make-a-pack.md`.
2. **With your coding agent** (no learncroc key): the skills in `skills/` turn Claude Code (or any agent
   that reads plain instructions) into an author that follows the same prompts and gates as the CLI. Your agent
   is the model; `learncroc lint` is the gate.
3. **With `learncroc build`** (needs a key or a local model): drafts the map and the stops for you.

## `learncroc build`

```sh
learncroc new kitchen-chemistry --title "Kitchen chemistry"
mkdir packs/kitchen-chemistry/sources && cp my-notes.md packs/kitchen-chemistry/sources/
learncroc build packs/kitchen-chemistry --nodes 6
```

1. **Plan** (`author-plan`, smart tier, high effort): writes `map.yaml` and **stops** so you can check
   the edges (wrong prerequisites are the costliest mistake). In a terminal it asks before going on; in
   scripts, re-run with `--yes`.
2. **Stops** (`author-node`, smart tier): a hook, 3 screens, Say it and misconceptions per stop, 3 in
   parallel.
3. **Practice** (`author-practice`, fast tier): 6 items and the cards per stop.
4. **Repair**: problems the host finds (word caps, invalid widget props, a choice with two right
   answers…) go back to the model for up to 2 rounds.
5. **Write**: `nodes/<id>.yaml` with `status: draft` and the schema header, `pack.lock.yaml` provenance
   per file (prompt version, provider, model, time), `pack.yaml` widgets kept in sync.
6. **Lint**: the full rule set. Exit code 1 if anything is left to fix.

Options: `--nodes N` (3–16), `--topic "…"` (when the manifest doesn't say enough), `--only a,b` (rewrite
some stops; the map must exist), `--yes`. `learncroc build --prompt <id>` prints any prompt.

Sources are the `.md` and `.txt` files in `sources/`; stops cite them by id (`s1`, `s2`, …). With no
sources, claims stay qualitative and numbers are labelled illustrative.

**Nothing generated is "reviewed".** Agents and the CLI only write `draft`. A named human reviewer signs
off in `pack.lock.yaml` → `reviews`, and only then may a file say `status: reviewed` (lint L017).

## Costs

A 6-stop pack with sources is roughly 150–250k tokens; with Anthropic's default models that is about
$1–2 (the spend meter counts `build` separately). Local models cost nothing.
