# learncroc

Learn anything by playing its map. Open source, local-first, AI optional.

**Status: v0.1 under construction.** The build plan is `docs/PLAN.md`; the data contracts are the zod
schemas in `packages/core/src/schema` (designed in `docs/CONTRACTS.md`).

## Develop

```sh
bun install        # Bun ≥ 1.2
bun dev            # web app on http://localhost:5173, server on http://127.0.0.1:4747
bun run check      # typecheck + biome + unit tests (all workspaces)
bun run e2e        # Playwright (Chromium)
```

Contributor and agent guide: `AGENTS.md`. Licence: MIT (code); packs carry their own licence (CC BY-SA 4.0 for first-party packs).
