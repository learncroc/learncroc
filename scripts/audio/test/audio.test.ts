/**
 * Tests for scripts/audio: file naming, phrase extraction, voices, the render pipeline (with a
 * synthetic voice, so Piper isn't needed) and the CLI's behaviour without Piper installed.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ASSET_PATH_RE } from "@learncroc/core";
import { audioAssetPath, fnv1a64, normalizePhrase, phraseKey } from "../hash";
import { extractPhrases, joinTiles, loadPackFiles } from "../phrases";
import {
  buildManifest,
  estimateBytes,
  MANIFEST_PATH,
  MAX_PACK_AUDIO_BYTES,
  planPack,
  prunePack,
  renderPack,
  writeManifest,
} from "../pipeline";
import { type Encoder, ffmpegOpusEncoder, hasBinary, type Synth } from "../tools";
import { resolveSpeaker, VOICES, voiceFor } from "../voices";

const root = resolve(import.meta.dir, "..", "..", "..");
const spanish = join(root, "packs", "spanish-tapas-bar");
const persuasion = join(root, "packs", "art-of-persuasion");

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "lm-audio-test-"));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A 16-bit mono PCM WAV with a short sine tone whose length depends on the text. */
function writeSineWav(file: string, text: string): void {
  const rate = 16000;
  const samples = Math.round(rate * (0.2 + text.length * 0.01));
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 8000), 44 + i * 2);
  writeFileSync(file, buf);
}

const fakeSynth = (): Synth & { calls: string[] } => {
  const calls: string[] = [];
  return {
    name: "sine",
    calls,
    async synthesize(text, _voice, outWav) {
      calls.push(text);
      writeSineWav(outWav, text);
    },
  };
};
const copyEncoder: Encoder = {
  name: "copy",
  async encode(inWav, outOgg) {
    copyFileSync(inWav, outOgg);
  },
};

/** A tiny pack exercising every phrase source. */
function miniPack(): string {
  const dir = tempDir();
  mkdirSync(join(dir, "nodes"), { recursive: true });
  mkdirSync(join(dir, "bosses"), { recursive: true });
  writeFileSync(join(dir, "pack.yaml"), "id: mini\ntargetLang: es-ES\n");
  writeFileSync(
    join(dir, "nodes", "a.yaml"),
    `id: a
screens:
  - blocks:
      - { type: audio, tts: { text: "Hola,   ¿qué tal?", lang: es-ES }, transcript: "Hola" }
      - { type: audio, tts: { text: "Ya tengo audio", lang: es-ES }, src: assets/audio/x.ogg, transcript: "x" }
      - { type: audio, tts: { text: "Hello there", lang: en }, transcript: "Hello there" }
    interaction:
      kind: widget
      widget:
        id: listen
        v: 1
        props: { tts: { text: "Hola, ¿qué tal?", lang: es-ES }, speeds: [1], transcript: "t", showTranscript: after }
        goal: { kind: type, accept: ["hola"] }
items:
  - kind: widget
    widget:
      id: tile-builder
      v: 1
      props:
        mode: sentence
        lang: es-ES
        speak: true
        tiles: [ { id: a, text: "¿Me" }, { id: b, text: "pones" }, { id: c, text: "una caña" }, { id: d, text: "?" } ]
      goal: { kind: sequence, accept: [[a, b, c, d]] }
  - kind: widget
    widget:
      id: tile-builder
      v: 1
      props: { mode: sentence, lang: es-ES, tiles: [ { id: a, text: "silencio" } ] }
      goal: { kind: sequence, accept: [[a]] }
`,
  );
  writeFileSync(
    join(dir, "bosses", "b.yaml"),
    `id: b
stages:
  - widget:
      id: dialogue
      v: 1
      props:
        setting: s
        character: { name: Lola, lang: es-ES }
        start: n1
        nodes:
          - { id: n1, line: "Buenas noches." }
          - { id: n2, line: "Con audio.", audio: assets/audio/y.ogg }
  - widget:
      id: dialogue
      v: 1
      props: { setting: s, character: { name: Dana }, start: v1, nodes: [ { id: v1, line: "English line" } ] }
`,
  );
  return dir;
}

describe("hash", () => {
  test("fnv1a64 matches the published test vectors", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64("foobar")).toBe("85944171f73967e8");
  });

  test("asset paths are deterministic, valid and sensitive to text and voice", () => {
    const a = audioAssetPath("Hola, ¿qué tal?", "es-ES", "v1");
    expect(a).toMatch(ASSET_PATH_RE);
    expect(a).toMatch(/^assets\/audio\/es-es-[0-9a-f]{16}\.ogg$/);
    expect(audioAssetPath("Hola,  ¿qué tal? ", "es-ES", "v1")).toBe(a);
    expect(audioAssetPath("Hola, ¿qué tal?", "es-ES", "v2")).not.toBe(a);
    expect(audioAssetPath("hola, ¿qué tal?", "es-ES", "v1")).not.toBe(a);
  });

  test("normalisation composes accents and collapses spaces", () => {
    expect(normalizePhrase("  qué   tal ")).toBe("qué tal");
    expect(phraseKey(" ¿Qué  tal? ", "es-ES")).toBe("es-ES|¿Qué tal?");
  });
});

describe("phrases", () => {
  test("finds audio blocks, listen, dialogue and speaking tile-builder phrases, deduplicated", () => {
    const phrases = extractPhrases(loadPackFiles(miniPack()));
    const texts = phrases.map((p) => `${p.kind}:${p.lang}:${p.text}`);
    expect(texts).toEqual([
      "audio-block:es-ES:Hola, ¿qué tal?",
      "audio-block:en:Hello there",
      "tile-builder:es-ES:¿Me pones una caña?",
      "dialogue:es-ES:Buenas noches.",
    ]);
    expect(phrases[0]?.where).toHaveLength(2);
  });

  test("joinTiles attaches punctuation tiles to the previous word", () => {
    expect(joinTiles(["Hola", ",", "¿qué", "tal", "?"])).toBe("Hola, ¿qué tal?");
    expect(joinTiles(["Dos", "cañas,", "por", "favor."])).toBe("Dos cañas, por favor.");
  });

  test("the Spanish pack's phrases are all Castilian and cover every phrase kind", () => {
    const phrases = extractPhrases(loadPackFiles(spanish));
    expect(phrases.length).toBeGreaterThan(80);
    expect(new Set(phrases.map((p) => p.lang))).toEqual(new Set(["es-ES"]));
    expect(new Set(phrases.map((p) => p.kind))).toEqual(new Set(["audio-block", "listen", "dialogue", "tile-builder"]));
    const texts = phrases.map((p) => p.text);
    expect(texts).toContain("Hola. Hotel. Ahora.");
    expect(texts).toContain("Claro. Este bar tiene las mejores croquetas.");
  });

  test("the persuasion pack has nothing to render (no target language)", () => {
    const plan = planPack(persuasion);
    expect(plan.phrases).toHaveLength(0);
  });
});

describe("voices", () => {
  test("es-ES and es resolve to the Castilian voice; English has none", () => {
    expect(voiceFor("es-ES")).toBe(VOICES["es-ES"]);
    expect(voiceFor("es")).toBe(VOICES["es-ES"]);
    expect(voiceFor("en")).toBeUndefined();
  });

  test("speaker names resolve through speaker_id_map", () => {
    const voice = { ...(VOICES["es-ES"] as NonNullable<(typeof VOICES)["es-ES"]>) };
    expect(resolveSpeaker(voice, { speaker_id_map: { M: 0, F: 1 } })).toBe(1);
    expect(() => resolveSpeaker(voice, { speaker_id_map: { M: 0 } })).toThrow(/speaker "F"/);
    expect(resolveSpeaker({ ...voice, speaker: 3 }, {})).toBe(3);
    expect(resolveSpeaker({ ...voice, speaker: undefined }, {})).toBeUndefined();
  });
});

describe("pipeline", () => {
  test("the Spanish pack's estimated audio fits the 10 MB budget", () => {
    const plan = planPack(spanish);
    expect(plan.problems).toEqual([]);
    expect(plan.totalBytes).toBeLessThan(MAX_PACK_AUDIO_BYTES);
    expect(plan.unvoiced).toHaveLength(0);
    for (const p of plan.phrases) expect(p.src).toMatch(ASSET_PATH_RE);
  });

  test("estimates grow with text length", () => {
    expect(estimateBytes("Hola")).toBeLessThan(estimateBytes("Hola, ¿qué tal? Muy bien, gracias."));
  });

  test("renders missing phrases, writes the manifest, skips on rerun and prunes orphans", async () => {
    const dir = miniPack();
    const synth = fakeSynth();
    const first = await renderPack(dir, { synth, encoder: copyEncoder });
    expect(first.rendered).toHaveLength(3);
    expect(synth.calls).toEqual(["Hola, ¿qué tal?", "¿Me pones una caña?", "Buenas noches."]);
    for (const src of first.rendered) expect(existsSync(join(dir, src))).toBe(true);
    expect(first.plan.phrases.every((p) => p.exists && !p.estimated)).toBe(true);

    const file = writeManifest(first.plan);
    expect(file).toBe(join(dir, MANIFEST_PATH));
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_PATH), "utf8"));
    expect(manifest.schema).toBe(1);
    expect(manifest.voices["es-ES"].model).toBe("es_ES-sharvard-medium");
    expect(Object.keys(manifest.phrases).sort()).toEqual(
      ["es-ES|Buenas noches.", "es-ES|Hola, ¿qué tal?", "es-ES|¿Me pones una caña?"].sort(),
    );
    expect(manifest.phrases["es-ES|Buenas noches."].src).toBe(
      audioAssetPath("Buenas noches.", "es-ES", manifest.voices["es-ES"].id),
    );

    const again = await renderPack(dir, { synth, encoder: copyEncoder });
    expect(again.rendered).toHaveLength(0);
    expect(again.skipped).toHaveLength(3);

    writeFileSync(join(dir, "assets", "audio", "es-es-0000000000000000.ogg"), "old");
    expect(prunePack(again.plan)).toEqual(["assets/audio/es-es-0000000000000000.ogg"]);
    expect(existsSync(join(dir, first.rendered[0] as string))).toBe(true);
  });

  test("a manifest is only written when something is rendered", () => {
    const dir = miniPack();
    const plan = planPack(dir);
    expect(Object.keys(buildManifest(plan).phrases)).toHaveLength(0);
    expect(writeManifest(plan)).toBeUndefined();
    expect(existsSync(join(dir, MANIFEST_PATH))).toBe(false);
  });

  test("files over the per-file limit are reported", async () => {
    const dir = miniPack();
    const huge: Encoder = {
      name: "huge",
      async encode(_in, out) {
        writeFileSync(out, Buffer.alloc(2 * 1024 * 1024 + 1));
      },
    };
    const result = await renderPack(dir, { synth: fakeSynth(), encoder: huge });
    expect(result.plan.problems.some((p) => p.includes("2 MB per-file limit"))).toBe(true);
  });

  test.skipIf(!hasBinary("ffmpeg"))("encodes real Ogg Opus with ffmpeg", async () => {
    const dir = miniPack();
    const result = await renderPack(dir, { synth: fakeSynth(), encoder: ffmpegOpusEncoder("ffmpeg") });
    for (const src of result.rendered) {
      const bytes = readFileSync(join(dir, src));
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("OggS");
      expect(bytes.includes(Buffer.from("OpusHead"))).toBe(true);
      expect(bytes.length).toBeLessThan(64 * 1024);
    }
  });
});

describe("cli", () => {
  const cli = join(root, "scripts", "audio", "render.ts");
  const run = (args: string[], env: Record<string, string> = {}) =>
    Bun.spawnSync(["bun", cli, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });

  test("--plan lists the Spanish pack within budget without any tools", () => {
    const r = run([spanish, "--plan"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toMatch(/spanish-tapas-bar: \d+ phrase\(s\), 0 rendered/);
    expect(r.stdout.toString()).toMatch(/of 10 MB/);
  });

  test("without Piper it renders nothing, explains how to install it, and exits 2", () => {
    const dir = miniPack();
    const r = run([dir], { PIPER_BIN: "/nonexistent/piper", PIPER_VOICES: join(dir, "no-voices") });
    expect(r.exitCode).toBe(2);
    const err = r.stderr.toString();
    expect(err).toMatch(/Piper not found/);
    expect(err).toMatch(/es_ES-sharvard-medium\.onnx/);
    expect(err).toMatch(/speechSynthesis/);
    expect(existsSync(join(dir, "assets", "audio"))).toBe(false);
  });

  test("rejects a directory without pack.yaml", () => {
    const r = run([tempDir()]);
    expect(r.exitCode).toBe(2);
  });
});

describe("speechSynthesis fallback", () => {
  test("every Spanish listen widget carries tts, and every Spanish dialogue and speaking tile-builder sets lang", () => {
    const files = loadPackFiles(spanish);
    let listens = 0;
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) {
        for (const x of v) walk(x);
        return;
      }
      if (!v || typeof v !== "object") return;
      const o = v as Record<string, unknown>;
      const props = o.props as Record<string, unknown> | undefined;
      if (o.id === "listen" && props) {
        listens++;
        expect((props.tts as { lang?: string } | undefined)?.lang).toBe("es-ES");
      }
      if (o.id === "dialogue" && props) expect((props.character as { lang?: string }).lang).toBe("es-ES");
      if (o.id === "tile-builder" && props?.speak) expect(props.lang).toBe("es-ES");
      for (const x of Object.values(o)) walk(x);
    };
    for (const f of files) walk(f.value);
    expect(listens).toBeGreaterThan(20);
  });
});
