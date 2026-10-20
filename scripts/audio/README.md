# scripts/audio

Pre-renders target-language phrases in packs to Ogg Opus with an open [Piper](https://github.com/OHF-Voice/piper1-gpl)
voice, so Spanish audio plays on machines with no system speech voices. Maintainer machines only:
Piper and its voice models are never a runtime dependency. Until a phrase is rendered, the widgets
play it through the browser's `speechSynthesis` and always offer the transcript.

```sh
bun scripts/audio/render.ts packs/spanish-tapas-bar --plan   # phrases, file names, size budget; needs no tools
bun scripts/audio/render.ts packs/spanish-tapas-bar          # render what's missing, write the manifest
bun scripts/audio/render.ts --all --prune                    # every pack; delete files no phrase uses
```

## Setup (once)

1. Install Piper and put `piper` on `PATH` (or set `PIPER_BIN`).
2. Install ffmpeg with libopus (or set `FFMPEG_BIN`).
3. Download the voice model and its config into `~/.local/share/piper-voices/` (or set `PIPER_VOICES`).
   The render command prints the exact URLs if they're missing. Spanish uses `es_ES-sharvard-medium`,
   female speaker (`voices.ts`). Check the voice's model card for its licence before publishing.

## What gets rendered

Every phrase the app can actually play from a file:

| Source | Field the compiler fills |
|---|---|
| audio blocks `{ type: audio, tts: { text, lang } }` | `src` |
| `listen` widgets, `props.tts` | `props.src` |
| `dialogue` widgets with `character.lang`, every node `line` | node `audio` |
| `tile-builder` widgets with `speak: true` and `lang`, every accepted sentence | (none yet: looked up by text) |

Phrases whose author already set `src`/`audio` are skipped. Languages with no voice in `voices.ts`
(English, for example) stay on `speechSynthesis`.

## Outputs

- `packs/<id>/assets/audio/<lang>-<hash>.ogg`: mono Opus at 32 kb/s. The name is FNV-1a 64 of
  `voice id + lang + normalised text` (`hash.ts`), so re-rendering only touches phrases whose text or
  voice changed.
- `packs/<id>/data/audio-manifest.json`: `{ schema: 1, generator, voices, phrases }`, where `phrases`
  maps `"<lang>|<text>"` to `{ src, bytes }` for every rendered file. The compiler reads it to fill the
  fields above; it's written only when at least one file exists.

## Budget

At most 2 MB per file and 10 MB of audio per pack. `--plan` estimates sizes before
rendering; after rendering the real sizes are checked and the command exits 1 if either limit is
exceeded. The Spanish pack is about 95 phrases, roughly 1 MB.

## Tests

`bun test ./scripts/audio` covers hashing, phrase extraction, voices, the full pipeline with a
synthetic voice (and real Opus encoding when ffmpeg is present), the CLI without Piper, and the
content rules of the Spanish and persuasion packs (`test/pack-rules.ts`).
