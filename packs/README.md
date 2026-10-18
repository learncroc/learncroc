# Packs

One folder per pack (`packs/<id>/`), plus `packs/_pocket/<slug>/` for the article-map gallery.
Every folder here that has a `pack.yaml` is bundled and installed on first run; there is no list to
update. Layout and rules: `docs/PLAN.md` §11 and the generated reference in `docs/reference/`.

```
packs/<id>/
  pack.yaml        # manifest           (# yaml-language-server: $schema=../../schemas/pack.schema.json)
  map.yaml         # lines + DAG        (# yaml-language-server: $schema=../../schemas/map.schema.json)
  nodes/<id>.yaml  # playable stops     (# yaml-language-server: $schema=../../../schemas/node.schema.json)
  bosses/<id>.yaml # terminus           (# yaml-language-server: $schema=../../../schemas/boss.schema.json)
  toy.yaml         # optional map toy
  data/*.json      # optional { $data: "data/x.json#/ptr" } includes
  assets/          # svg, webp/png, ogg/mp3, interactive/*.html
  pack.lock.yaml   # AI provenance + human review sign-offs (humans write reviews)
  LICENSE          # CC-BY-SA-4.0 for first-party packs
  README.md
```

Check your work: `bun run validate:pack packs/<id>` (or `--all`).
