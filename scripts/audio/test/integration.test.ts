/**
 * End to end with the core compiler and lint: before rendering, the Spanish pack's only lint errors
 * are L021 (audio not rendered yet; it plays through speechSynthesis meanwhile). After a render
 * (synthetic voice, so Piper isn't needed) the compiler fills every `src`/`audio` from the manifest
 * and the pack lints clean.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compilePack, diskFs, lintPack, type NodeFsPromises } from "@learncroc/core";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import { renderPack, writeManifest } from "../pipeline";
import { type Encoder, ffmpegOpusEncoder, hasBinary, type Synth } from "../tools";

const root = resolve(import.meta.dir, "..", "..", "..");
const work = mkdtempSync(join(tmpdir(), "lm-audio-e2e-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const fsOf = (dir: string) => diskFs(fsp as unknown as NodeFsPromises, dir);
const errorsOf = async (dir: string) =>
  (await lintPack(fsOf(dir), { widgets: widgetSpecRegistry })).report.issues.filter((i) => i.severity === "error");

/** Silent 16-bit mono WAV, 0.3 s. */
const silentSynth: Synth = {
  name: "silence",
  async synthesize(_text, _voice, outWav) {
    const samples = 4800;
    const buf = Buffer.alloc(44 + samples * 2);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + samples * 2, 4);
    buf.write("WAVEfmt ", 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(16000, 24);
    buf.writeUInt32LE(32000, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(samples * 2, 40);
    writeFileSync(outWav, buf);
  },
};
const encoder: Encoder = hasBinary("ffmpeg")
  ? ffmpegOpusEncoder("ffmpeg")
  : { name: "copy", encode: async (i, o) => copyFileSync(i, o) };

// Restored by the content-spanish-tapas-bar package once the pack is converted to cards.
describe.skip("spanish-tapas-bar with the core compiler and lint", () => {
  const dir = join(work, "spanish-tapas-bar");
  cpSync(join(root, "packs", "spanish-tapas-bar"), dir, { recursive: true });

  test("unrendered, the pack lints with no errors (missing audio falls back to the device voice)", async () => {
    expect(await errorsOf(dir)).toEqual([]);
  });

  test("after rendering, the compiler fills every source and the pack lints clean", async () => {
    const result = await renderPack(dir, { synth: silentSynth, encoder });
    expect(result.plan.problems).toEqual([]);
    expect(writeManifest(result.plan)).toBeDefined();

    expect(await errorsOf(dir)).toEqual([]);

    const compiled = await compilePack(fsOf(dir));
    const sounds = compiled.pack?.nodes.sounds;
    const s1 = sounds?.screens[0];
    expect(s1?.blocks[0]).toMatchObject({ type: "audio", src: expect.stringMatching(/^assets\/audio\/es-es-/) });
    const listen = s1?.interaction?.kind === "widget" ? (s1.interaction.widget.props as { src?: string }) : undefined;
    expect(listen?.src).toMatch(/^assets\/audio\/es-es-[0-9a-f]{16}\.ogg$/);
    expect(existsSync(join(dir, listen?.src as string))).toBe(true);

    const item = compiled.pack?.nodes.greetings?.items.find((i) => i.id === "st4-dinner");
    const dinner = (item?.kind === "widget" ? item.widget.props : { nodes: [] }) as {
      nodes: { line: string; audio?: string }[];
    };
    expect(dinner.nodes.every((n) => typeof n.audio === "string")).toBe(true);
  }, 60_000);
});

// Restored by the content-art-of-persuasion package once the pack is converted to cards.
describe.skip("art-of-persuasion with the core lint", () => {
  test("lints with zero errors", async () => {
    expect(await errorsOf(join(root, "packs", "art-of-persuasion"))).toEqual([]);
  });
});
