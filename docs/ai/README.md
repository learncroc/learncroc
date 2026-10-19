# How the AI layer works

AI in learncroc is optional and bounded: the whole core loop works with no key, and every AI feature
has an offline path. This page is the map of `packages/ai`, the AI routes and the AI surfaces in the
app, for contributors.

## Providers

| Provider | Adapter | Notes |
|---|---|---|
| Anthropic | `@anthropic-ai/sdk` (`providers/anthropic.ts`) | `claude-haiku-5-5` / `claude-sonnet-5-5` / `claude-opus-5-5` for fast / smart / deep. Adaptive thinking (never disabled, no thinking budget), effort set per call, structured outputs through zod, the server-side refusal fallback on Sonnet and Opus generation calls, prompt caching on stable system blocks (1 hour for the tutor's pack block), `stop_reason` checked before reading content |
| OpenAI-compatible | `fetch` (`providers/openai-compatible.ts`) | `json_schema` structured output when supported, else JSON mode + validation + one repair |
| Ollama | `fetch` (`providers/ollama.ts`) | `format: <JSON Schema>`, explicit `num_ctx`, `<think>` stripped. See `local-models.md` |
| Fake | `providers/fake.ts` | `LEARNCROC_FAKE_AI=1`. Deterministic answers built from each call's `<input>` block, streamed with small delays. Every AI feature is demoable and testable offline with it |

Keys are read only by the server (environment first, then `~/.learncroc/config.json`, mode 0600) and
never logged: errors pass through a redactor.

## Prompts

`packages/ai/prompts/*.md`: versioned Markdown with front-matter (`id`, `version`, `tier`, `effort`,
`maxTokens`, `schema`). The house style is the first, cached system block of every generation call.
`learncroc build --prompt <id>` prints any of them; the skills in `skills/` use the same files. Every
call also carries a machine-readable `<input>` block; article text and learner text are wrapped in
`<article>`, `<source>` and `<learner>` tags and treated as data.

## Guards (host code, after every reply)

- **Socratic gate** (`gate.ts`): decided on the server from the stored run, never by the client. Before
  the learner has answered the current interaction (hook, screen, check item, boss stage, Say it), Ask
  may only ask one question back or hint at the allowed level (0–2, from wrong attempts and the hint
  ladder). After the answer it explains fully. Settings → Ask can turn the gate off; full answers on an
  unanswered interaction then mark it assisted, so it never counts toward lighting a stop.
- **Bounded context** (`context.ts`): the current screen, the stop's objectives, key points and
  misconceptions, the learner's last 3 answers on this stop and prerequisite states. Answer keys of
  unanswered interactions are never sent, so the model can't leak what it never saw.
- **Answer leak** (`guards.ts`): Socratic replies are generated whole and checked for the answer, its
  normalised forms, numbers (including parametric instances) and the correct option's text or letter.
  A leak regenerates once, then falls back to an authored hint.
- **Word caps**: 75 words for Ask (full replies stream sentence by sentence and stop at the cap), 40 for
  Socratic replies, hints and Nib, 30 for grading feedback.
- **Action ending**: a reply that doesn't end in a question or an action gets "Your move: …".
- **Nib**: replies may not introduce numbers or new terms beyond the teach script and the learner's text;
  otherwise the authored line is used.
- **Voice**: exclamation marks and emoji are removed from generated text.

## Spend and rate limits

`usage.ts` prices every call with `packages/ai/prices.json` (cache reads included), stores the month's
spend per feature in `~/.learncroc/ai/usage.json`, and enforces the monthly cap (default $5, cloud
providers only): at 100 % every feature takes its offline path. Learner-initiated calls are limited to
30 per minute; a pocket map counts once. "What did I send?" (`GET /api/ai/last-sent`) returns the exact
last payload per feature.

## Article → pocket map (`create/`)

1. **Fetch** (`fetch.ts`): http(s) only, DNS resolved and checked against private, loopback and link-local
   ranges, 10 s timeout, ≤ 5 redirects each re-checked, ≤ 5 MB.
2. **Extract** (`extract.ts`): Readability on linkedom → paragraphs `p1…pn` with headings. Under 300
   words → "Paste the text instead?".
3. **Plan** (`skeleton.ts`): the skeleton is streamed as structured output and parsed incrementally;
   each stop is emitted the moment its JSON object closes (`plan-node`, `highlight`), edges that would
   make a cycle are dropped.
4. **Stops** (`node.ts`): one fast-tier call per stop, ≤ 4 in parallel, started as stops arrive. The
   draft is converted to the contract `PackNode` (host-assigned ids, widget props validated by the
   widget's own spec, word caps measured), with one repair round. The first stop is playable as soon as
   it is ready; the pack is installed through the server's pack store and rewritten as stops land.
5. **Figures** (`figure.ts`): one generated SVG per visual screen, kept only if it follows the
   illustration contract and a strict element/attribute allowlist (and DOMPurify leaves it unchanged
   where a faithful DOM is available).
6. **Toy** (`toy.ts`): one generated HTML toy per map, statically scanned (no network, no parent access,
   calls `lm.ready()`), then run in a hidden frame on the sandbox origin **in the learner's browser**: it
   must post `ready` within 2 s and pass the bridge's self-test, or it is dropped. Generated code never
   runs on the server.
7. **Write**: `provisional: false`, `status: draft`, "AI-drafted from …".

The surveying view (`apps/web/src/screens/create/`) follows the job's SSE stream: the article
highlights where each idea comes from, idea cards fly to the map, and the map draws itself in ink.

## Routes

`/api/ai/*` (status, test, models, usage, last-sent, ask, cards, estimate), `/api/create`,
`/api/jobs/:id/events` (replayed on reconnect), `DELETE /api/jobs/:id`, plus two companions for the
surveying view: `GET /api/jobs/:id/article` (paragraphs, only while the job runs) and
`POST /api/jobs/:id/toy-check` (the browser's verdict on the toy). With no key, the feature routes
answer `409 ai_not_configured` with the offline fallback the UI should take.
