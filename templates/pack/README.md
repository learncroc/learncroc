# __PACK_TITLE__

A learncroc pack. Three stops: what a percentage means, finding 10% (and building 5% and 25% from
it), and working out a price after a change.

## Work on it

```sh
learncroc play .          # open it in the app with live reload
learncroc lint .          # check it against the pack rules
learncroc build-pack .    # write dist/__PACK_ID__-0.1.0.lmpack
```

Edit `map.yaml` to change the stops and their order, and `nodes/<id>.yaml` for each stop. The
format is documented at https://learncroc.github.io/schema/v1/ and your editor autocompletes it
through the `# yaml-language-server` line at the top of every file.

Every pull request is linted by `.github/workflows/lint.yml`.
