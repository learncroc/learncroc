# Map design rules (map.yaml)

```yaml
# yaml-language-server: $schema=../../schemas/map.schema.json
lines:
  - { id: basics, title: "The basics", color: 1, outcome: "Explain what a percentage measures" }
nodes:
  per-hundred: { requires: [], line: basics }
  ten-percent: { requires: [per-hundred], line: basics }
  price-change: { requires: [ten-percent], line: basics }
```

- **1 to 5 lines.** Each line is a theme with an `outcome` ("Explain …", "Predict …", "Sort …") shown in
  the Logbook as "You can now …". Every stop has one home line.
- **Edges are prerequisites.** B requires A only if B cannot be understood without A. When unsure,
  leave the edge out and ask the user.
- **Acyclic**, every `requires` exists, in-degree ≤ 4.
- **At least 2 roots**, or at least 2 stops ready once the first root is lit (learners choose their path).
- **Planned stops** (`status: planned`, with `title` and `teaser`) are never prerequisites of playable
  stops. Samplers place them only beyond the terminus.
- **Bosses** (`kind: boss`) need `bosses/<id>.yaml`: one performance task in 4–6 stages, each stage one
  widget testing a different covered stop, `pass` usually stages − 1, and a `teach` stop with a teach
  script. Community packs don't need a boss.
- **Ids are stable forever** (progress is keyed by them). Rename with `renamedFrom`.
- **Theme** (`pack.yaml` → `theme`): pick a renderer (`metro`, `circuit`, `atlas`, `sketchbook`) and five
  line colours that pass contrast (≥ 3:1 against the ground) and stay away from Lumen gold, Ember and
  Sea. `learncroc lint --fix` suggests passing colours.
