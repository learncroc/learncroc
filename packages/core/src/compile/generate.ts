/**
 * Boilerplate the compiler fills in so hand-written packs stay short:
 * - flashcards (up to 3 qa flashcards, recall items first) when `flashcards` is absent;
 * - audio `src` for every phrase `packs:audio` rendered (data/audio-manifest.json).
 */
import { formatNumber } from "../params";
import type { Flashcard, Item, PackNode } from "../schema/index";
import { plainText } from "./text";

export const GENERATED_FLASHCARDS = 3;

/** Every id in a card's shared namespace (hook, beat actions, items, flashcards). */
export function nodeIds(node: PackNode): Set<string> {
  const ids = new Set<string>([node.hook.interaction.id]);
  for (const s of node.screens) if (s.interaction) ids.add(s.interaction.id);
  for (const i of node.items) ids.add(i.id);
  for (const c of node.flashcards ?? []) ids.add(c.id);
  return ids;
}

/** The back of a generated flashcard for an item, or undefined when the item can't become one. */
function cardBack(item: Item): string | undefined {
  switch (item.kind) {
    case "choice": {
      if (Array.isArray(item.answer) || item.multi) return undefined;
      const opt = item.options.find((o) => o.id === item.answer);
      return opt ? plainText(opt.text) : undefined;
    }
    case "text":
      return item.accept[0];
    case "numeric":
      if (item.params) return undefined;
      return `${formatNumber(item.answer)}${item.unit ? ` ${item.unit}` : ""}`;
    default:
      return undefined;
  }
}

/** Up to 3 qa flashcards from the item bank: recall items first, then the rest, in bank order. */
export function generateFlashcards(node: PackNode, max = GENERATED_FLASHCARDS): Flashcard[] {
  const used = nodeIds(node);
  const ordered = [
    ...node.items.filter((i) => i.level === "recall"),
    ...node.items.filter((i) => i.level !== "recall"),
  ];
  const out: Flashcard[] = [];
  let n = 1;
  for (const item of ordered) {
    if (out.length >= max) break;
    const back = cardBack(item);
    if (back === undefined || !back.trim()) continue;
    while (used.has(`card-${n}`)) n++;
    const id = `card-${n}`;
    used.add(id);
    out.push({ id, kind: "qa", front: plainText(item.prompt), back });
  }
  return out;
}

/** data/audio-manifest.json written by `bun run packs:audio` (keyed by "<lang>|<normalised text>"). */
export interface AudioManifest {
  phrases: Record<string, { src: string }>;
}

export function normalizePhrase(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Look up a rendered phrase. */
export function audioSrcFor(manifest: AudioManifest | undefined, text: string, lang: string): string | undefined {
  if (!manifest) return undefined;
  const key = `${lang}|${normalizePhrase(text)}`;
  return Object.hasOwn(manifest.phrases, key) ? manifest.phrases[key]?.src : undefined;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Fill audio sources in place (on a structuredClone of the node): audio blocks and listen widgets
 * get `src`, dialogue lines get `audio`, when the phrase was rendered and no source is authored.
 * Returns the number of sources filled.
 */
export function fillAudio(value: unknown, manifest: AudioManifest | undefined): number {
  if (!manifest) return 0;
  let filled = 0;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (!isObj(v)) return;
    if (v.type === "audio" && isObj(v.tts) && v.src === undefined) {
      const src = audioSrcFor(manifest, String(v.tts.text ?? ""), String(v.tts.lang ?? ""));
      if (src) {
        v.src = src;
        filled++;
      }
    }
    if (typeof v.id === "string" && isObj(v.props)) {
      const props = v.props;
      if (v.id === "listen" && isObj(props.tts) && props.src === undefined) {
        const src = audioSrcFor(manifest, String(props.tts.text ?? ""), String(props.tts.lang ?? ""));
        if (src) {
          props.src = src;
          filled++;
        }
      }
      if (
        v.id === "dialogue" &&
        isObj(props.character) &&
        typeof props.character.lang === "string" &&
        Array.isArray(props.nodes)
      ) {
        for (const n of props.nodes) {
          if (!isObj(n) || n.audio !== undefined || typeof n.line !== "string") continue;
          const src = audioSrcFor(manifest, n.line, props.character.lang);
          if (src) {
            n.audio = src;
            filled++;
          }
        }
      }
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(value);
  return filled;
}
