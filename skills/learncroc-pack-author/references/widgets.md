# The 15 built-in widgets (v0.1)

Use only these (plus figures and sandboxed `html` interactives in `assets/interactive/`). Full props,
goals and answers: `packages/widgets/src/<id>/spec.ts` (each has `llmDoc` and ≥ 2 examples) and
`docs/reference/`.

| Widget | Learner does | Good for |
|---|---|---|
| `sorter` | Drags 3–8 cards into 2–4 buckets, or ranks them | Classifying examples, ordering steps or sizes. The workhorse for any topic |
| `plot` | Moves sliders, drags a marker, draws a prediction on a function or data chart | Anything with a curve or a parameter; "hit this value" goals |
| `hotspot` | Taps parts of an SVG, or drags labels onto them | Anatomy of a diagram, "which part does X" |
| `ab-compare` | Flips or compares two panels, picks one | Contrasting cases (good vs bad example) |
| `probability-bars` | Drags bars to predict a distribution, then sees the real one | Next-token prediction, any "how likely" guess |
| `token-splitter` | Types text and sees tokens | Tokenisation |
| `attention-weights` | Sets weights that share a budget of 1 | Attention, any "spread a budget" idea |
| `embedding-plane` | Drags words onto a 2D meaning map | Similarity, clustering |
| `light-clock`, `train-scene`, `spacetime-diagram` | Physics manipulations | Relativity |
| `tile-builder` | Builds a sentence or code (Parsons) from tiles | Language production, code order |
| `dialogue` | Branching conversation with a character | Language, persuasion |
| `listen` | Plays a phrase, picks or types what was said | Language listening |
| `code-stepper` | Steps through code, predicts values | Programming |

Built-in interaction kinds (rendered by the player, no widget needed): `choice`, `numeric`,
`estimate`, `text`, `order`, `match`, `cloze`, `explain`.

Every widget used must be listed in `pack.yaml` → `widgets` with its major version (`sorter: 1`).
