# Local and self-hosted models

learncroc treats local models as first-class: every AI feature works with Ollama or any
OpenAI-compatible server (LM Studio, vLLM, llama.cpp), with no feature caps and no cost meter. Nothing
leaves your machine.

## Ollama in two minutes

1. Install Ollama and pull a model: `ollama pull qwen3:14b` (about 9 GB; see the table for smaller ones).
2. Start learncroc. Settings → AI shows "Running on this computer" under Ollama when it is detected on
   `http://127.0.0.1:11434`.
3. Pick **Ollama**, choose models for the three tiers (the list comes from `ollama list`), press **Test**.

learncroc sets the context window explicitly (16k tokens for runtime features, 32k for article maps
and `learncroc build`), asks for JSON with Ollama's `format` (a JSON Schema), strips `<think>` blocks
from reasoning models, and validates every structured reply with zod, with one repair round.

## Recommended models

Tiers are provider-neutral: **fast** (grading, hints, cards, quiz variants, pocket-map stops),
**smart** (Ask, planning pocket maps), **deep** (optional, for authoring packs).

| Tier | First choice | Also good | Notes |
|---|---|---|---|
| fast | `qwen3:8b` | `llama3.1:8b`, `gemma3:12b` | Short structured outputs; 8B is enough |
| smart | `qwen3:14b` | `gemma3:27b`, `mistral-small3.2` | Socratic questions and the map planner need this size |
| deep | `qwen3:32b` | `llama3.3:70b` | Only for `learncroc build`; optional |

Settings pre-fills the first installed match for each tier. A single 14B model for all three tiers is a
reasonable setup on a 16 GB machine.

## OpenAI-compatible servers

Pick **OpenAI-compatible** and enter the server URL (`http://127.0.0.1:1234/v1` for LM Studio,
`https://openrouter.ai/api/v1`, …) and a key if the server needs one. learncroc uses
`response_format: json_schema` when the server supports it and falls back to JSON mode plus validation
when it doesn't. Changing the URL removes the stored key, so a key is never sent to a server it wasn't
meant for. Environment variables work too: `OPENAI_API_KEY` and `LEARNCROC_AI_BASE_URL`.

Cloud OpenAI-compatible providers count toward the monthly cap at the `openai-compatible.$default` row
of `packages/ai/prices.json` (an estimate; edit it by PR for your provider).

## The local-model eval

Before each release we run a small fixed suite on one ~14B open model and publish the results here:

```sh
bun run eval:local -- --provider ollama --model qwen3:14b --out eval-results.json
# or, while the root script isn't wired: bun scripts/eval/local.ts --provider ollama --model qwen3:14b
```

It checks: (1) a pocket map on 2 articles (does it finish, how many stops are playable, time to the
first playable stop, how many generated figures pass the illustration contract); (2) explain grading on
20 labelled answers (agreement with the human label); (3) hint leaks on 20 cases (how many rewritten
hints survive the answer-leak guard). `--fake` runs the suite against the deterministic fake provider
to check the harness itself.

### Results

| Model | Maps built | Stops ready | First playable stop | Figures kept | Grading agreement | Hints usable |
|---|---|---|---|---|---|---|
| (published at release) | | | | | | |
