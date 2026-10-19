# Anatomy of a stop (nodes/<id>.yaml)

The complete lint-clean examples are `templates/pack/nodes/*.yaml`; read one before writing. This is
the shape, with the rule behind each part.

```yaml
# yaml-language-server: $schema=../../../schemas/node.schema.json
id: per-hundred                 # = file name; stable forever
title: Per cent means per hundred   # ≤ 6 words, learner-facing
tagline: A percentage is a part of a hundred
estMinutes: 3
bigIdea: >                      # one idea; for authors, the tutor and lint (never shown as text)
  A percentage is a number of parts out of 100.
objectives: [Read a percentage as parts per hundred]
misconceptions:                 # ≥ 1 (community), ≥ 2 (curated/sampler)
  percent-is-count:
    label: Thinks a percentage is a count, not a share   # the belief, stated as a belief
    upstream: in-node:s1-grid   # an ancestor stop id, or in-node:<screenId>
    hint: "Count the shaded squares, then all of them."  # ≤ 30 words, never the answer
hook:                           # guess first, about the bigIdea; excluded from scoring
  blocks: [{ type: story, text: "A shop sign says 20% of the shelf is on sale. 50 tins." }]
  interaction:
    kind: choice                # choice | estimate | order | widget
    id: hook-q
    prompt: How many tins are on sale?
    confidence: true
    options:
      - { id: twenty, text: "20 tins", misconception: percent-is-count }
      - { id: ten, text: "10 tins" }
    answer: ten
  lotsGuess: twenty             # → "Lots of people guess 20 tins"
  reveal: "10 tins. 20% is a share: 20 of every 100."   # ≤ 40 words
screens:                        # 2–5; first resolve-hook, last transfer (or practice)
  - id: s1-grid
    role: resolve-hook          # resolve-hook | teach | practice | transfer
    newIdea: A percentage is a share of 100            # ≤ 1 per screen
    visual: { kind: figure, asset: assets/img/hundred-grid.svg, alt: "…" }
    blocks: [{ type: story, text: "The grid has 100 squares…" }]   # ≤ 30 words, BEFORE the action
    interaction: { kind: numeric, id: s1-q, prompt: "What percentage is shaded?", answer: 20 }
    reveal: { text: "20 squares of 100: 20%." }        # ≤ 50 words; names what the canvas did
items: [ … ]                    # the bank: check, relight and quiz; ≤ 40% choice; no True/False
sayIt:                          # always typed first; graded against key points (or self-checked)
  prompt: "A friend asks what 40% means. One sentence."
  keyPoints: [{ id: share, text: "a share of the whole", keywords: [share, out of 100] }]
  minHits: 1
  exemplar: "40% means 40 of every 100, a share of the whole."
sources: [{ id: own-notes, title: "Author's notes" }]
status: draft
```

Widget interactions also need `goal` (inside `widget`), a `solution` that grades correct, and a
built-in `fallback` (choice, numeric, text or order) for keyboard and screen-reader users. `explain`
interactions need an `offline` fallback. On a screen whose canvas is a widget, give every choice option
a `visualState` so the canvas acts out that answer (L019).
