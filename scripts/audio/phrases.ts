/**
 * Find every phrase in a pack that should have pre-rendered audio.
 *
 * Sources (anywhere in pack.yaml, nodes/, bosses/ and toy.yaml):
 * - audio blocks:              { type: audio, tts: { text, lang } }
 * - listen widgets:            props.tts { text, lang }
 * - dialogue widgets:          every node `line`, when the character has a `lang`
 * - tile-builder widgets:      every accepted sentence, when `speak: true` and a `lang` is set
 *
 * A phrase whose author already set a `src` (or dialogue `audio`) is skipped: it has audio.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { normalizePhrase, phraseKey } from "./hash";

export type PhraseKind = "audio-block" | "listen" | "dialogue" | "tile-builder";

export interface Phrase {
  /** Normalised text, exactly as it is sent to the voice. */
  text: string;
  lang: string;
  kind: PhraseKind;
  /** Every place the phrase occurs: "<file>#<json pointer>". */
  where: string[];
}

export interface PackFile {
  /** Pack-relative path, e.g. "nodes/ordering.yaml". */
  rel: string;
  value: unknown;
}

/** Load the YAML sources of a pack directory (pack.yaml, nodes/*, bosses/*, toy.yaml). */
export function loadPackFiles(dir: string): PackFile[] {
  const files: PackFile[] = [];
  const read = (rel: string) => files.push({ rel, value: parse(readFileSync(join(dir, rel), "utf8")) });
  if (existsSync(join(dir, "pack.yaml"))) read("pack.yaml");
  for (const sub of ["nodes", "bosses"]) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)
      .filter((n) => n.endsWith(".yaml"))
      .sort())
      read(`${sub}/${f}`);
  }
  if (existsSync(join(dir, "toy.yaml"))) read("toy.yaml");
  return files;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

function pointer(path: readonly (string | number)[]): string {
  return path.length ? `/${path.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}` : "";
}

/** Join tile texts the way a reader would say them (punctuation tiles attach to the previous word). */
export function joinTiles(texts: readonly string[]): string {
  let out = "";
  for (const t of texts) {
    const s = t.trim();
    if (!s) continue;
    out += out && !/^[.,;:!?)»]/.test(s) ? ` ${s}` : s;
  }
  return out;
}

/** Every phrase in the given files, de-duplicated by language and text, in first-seen order. */
export function extractPhrases(files: readonly PackFile[]): Phrase[] {
  const byKey = new Map<string, Phrase>();
  const add = (text: string, lang: string, kind: PhraseKind, where: string) => {
    const clean = normalizePhrase(text);
    if (!clean) return;
    const key = phraseKey(clean, lang);
    const existing = byKey.get(key);
    if (existing) existing.where.push(where);
    else byKey.set(key, { text: clean, lang, kind, where: [where] });
  };

  const visit = (value: unknown, rel: string, path: (string | number)[]) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        visit(v, rel, [...path, i]);
      });
      return;
    }
    if (!isObj(value)) return;
    const at = (sub: (string | number)[] = []) => `${rel}#${pointer([...path, ...sub])}`;

    // Audio block.
    if (value.type === "audio" && isObj(value.tts) && !value.src) {
      const text = str(value.tts.text);
      const lang = str(value.tts.lang);
      if (text && lang) add(text, lang, "audio-block", at(["tts"]));
    }

    // Widget references.
    if (typeof value.id === "string" && isObj(value.props) && "v" in value) {
      const props = value.props;
      if (value.id === "listen" && isObj(props.tts) && !props.src) {
        const text = str(props.tts.text);
        const lang = str(props.tts.lang);
        if (text && lang) add(text, lang, "listen", at(["props", "tts"]));
      }
      if (value.id === "dialogue" && isObj(props.character) && Array.isArray(props.nodes)) {
        const lang = str(props.character.lang);
        if (lang) {
          props.nodes.forEach((n, i) => {
            if (isObj(n) && !n.audio) {
              const line = str(n.line);
              if (line) add(line, lang, "dialogue", at(["props", "nodes", i, "line"]));
            }
          });
        }
      }
      if (value.id === "tile-builder" && props.speak === true && Array.isArray(props.tiles)) {
        const lang = str(props.lang);
        const goal = value.goal;
        if (lang && isObj(goal) && Array.isArray(goal.accept)) {
          const text = new Map<string, string>();
          for (const t of props.tiles) if (isObj(t) && typeof t.id === "string") text.set(t.id, String(t.text ?? ""));
          goal.accept.forEach((seq, i) => {
            if (!Array.isArray(seq)) return;
            const sentence = joinTiles(seq.map((id) => text.get(String(id)) ?? ""));
            add(sentence, lang, "tile-builder", at(["goal", "accept", i]));
          });
        }
      }
    }

    for (const [k, v] of Object.entries(value)) visit(v, rel, [...path, k]);
  };

  for (const f of files) visit(f.value, f.rel, []);
  return [...byKey.values()];
}
