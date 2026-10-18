# scripts/precompute

Maintainer-only tools for the numbers in the **How LLMs work** pack. Learners never run anything
here: the outputs are committed JSON under `packs/how-llms-work/data/` and are inlined into the pack
at compile time with `{ $data: "data/<file>.json#/<pointer>" }`.

## precompute.py: real numbers from GPT-2

```sh
~/.local/bin/uv run --python 3.12 scripts/precompute/precompute.py            # every file
~/.local/bin/uv run --python 3.12 scripts/precompute/precompute.py --only traces
~/.local/bin/uv run --python 3.12 scripts/precompute/precompute.py --check    # fail if committed numbers drift
```

`uv` reads the inline script metadata (PEP 723) and installs `torch`, `transformers` and `numpy` into
a throwaway environment. The first run downloads GPT-2 small (about 550 MB) into the Hugging Face
cache. Everything runs on the CPU in under a minute. Without `uv`:
`pip install torch transformers numpy && python scripts/precompute/precompute.py`.

| File | What | Used by |
|---|---|---|
| `next-token.json` | "I poured milk into my" bars (`coldOpen`, a checkpoint item), "The cat sat on the" ranking, a 4-step greedy loop (`loopStart` is run 1, `loop.steps` the runs after it, as the widget reads them) | `next-token`, `sampling` |
| `sampling.json` | "My favourite colour is" at four temperatures with seeded samples; "The capital of Australia is the city of" bars and samples | `sampling`, `pretraining`, `hallucination` |
| `hallucination.json` | greedy (temperature 0) continuations that are false; Everest bars; a citation-style loop | `hallucination` |
| `pretraining.json` | "Water is made of hydrogen and" bars; a base-model Q&A continuation; parameter count | `pretraining` |
| `embeddings.json` | 25 input-embedding rows drawn as a t-SNE map, nearest neighbours and king − man + woman in all 768 dimensions, "bank" in two contexts | `embeddings` |
| `traces.json` | six sentences, each with tokens, attention, logit-lens guesses, top-5 scores and one sampled token | `transformer` |

Every file has a `meta` block: model (`gpt2`), hub revision, parameter count, script version
(`scripts/precompute@1`), seed, library versions and a timestamp. Bump `SCRIPT_VERSION` when the
method changes (not when only the timestamp would), and update `pack.lock.yaml` provenance.

Method notes worth knowing before you change anything:

- Probabilities are GPT-2's softmax over its whole vocabulary of 50,257 tokens, rounded to 4
  decimals. Lists show a few tokens; the rest is "everything else" in the widget.
- Greedy decoding stands in for "temperature 0". Samples use a fixed seed per temperature.
- The embedding map is t-SNE over cosine distance between the 25 rows. The widget measures
  neighbours and analogies on the flat map, so the script picks the seed (0–9) that keeps each word's
  nearest neighbour and the analogy result from the full space, and records the agreement.
- Trace attention is the last layer, heads averaged, from the last token. GPT-2 parks much of its
  attention on the first token (an attention sink), so the trace reports the strongest link among the
  others and records the first token's share.
- Logit-lens guesses apply the final layer norm and output head to the residual stream partway up.
  They are rough; the pack only shows the top word.

Some beats and closes quote these numbers ("floor 7.6%", "Sydney 21.6%"). `check.test.ts` holds those
quotes against the data, so a regenerate that moves a number fails the test until the text is
updated too.

## check.ts: content checks

```sh
bun scripts/precompute/check.ts [pack-dir…] [--verbose]   # default: how-llms-work and packs/_pocket/*
bun test scripts/precompute                                # the same checks, plus the quoted-number test
```

The subset of `learncroc lint` that content authors trip on (the card shape and word caps, the close
naming every wrong guess, teasers that ask, reading order, a callback item opening each section,
enough fresh checkpoint items, misconception routing, answer keys, parametric items, visuals, the
illustration contract for SVGs, number provenance), so the packs can be held to the bar on their own.
The tests check the flagship plus every pocket map that already passes `validate:pack` and log the rest.
`bun run validate:pack` remains the schema and widget-props check.
