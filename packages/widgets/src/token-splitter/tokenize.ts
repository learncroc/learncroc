/**
 * cl100k_base tokenisation (gpt-tokenizer). The vocabulary is about 1 MB (450 KB gzipped), so it is
 * bound lazily: `@learncroc/widgets/spec` (server, CLI, static demo) installs it eagerly through
 * ./tokenizer-eager, and the browser loads it with the token-splitter widget (`loadTokenizer()`,
 * awaited by the widget loader before the view renders). The functions below are synchronous once
 * it is installed.
 */

export interface Encoder {
  encode: (text: string, opts?: { disallowedSpecial?: Set<string> }) => number[];
  decode: (ids: Iterable<number>) => string;
}

let encoder: Encoder | null = null;
let loading: Promise<Encoder> | null = null;

/** Install an encoder (used by ./tokenizer-eager and tests). */
export function installTokenizer(e: Encoder): void {
  encoder = e;
}

export function tokenizerReady(): boolean {
  return encoder !== null;
}

/** Load the cl100k_base encoder on demand (one download, cached). */
export function loadTokenizer(): Promise<Encoder> {
  if (encoder) return Promise.resolve(encoder);
  loading ??= import("gpt-tokenizer/encoding/cl100k_base").then((m) => {
    encoder = { encode: m.encode, decode: m.decode };
    return encoder;
  });
  return loading;
}

export class TokenizerNotLoadedError extends Error {
  constructor() {
    super("The cl100k_base tokenizer isn't loaded: import @learncroc/widgets/spec or await loadTokenizer() first.");
    this.name = "TokenizerNotLoadedError";
  }
}

function need(): Encoder {
  if (!encoder) throw new TokenizerNotLoadedError();
  return encoder;
}

/** Token ids for `text`. Special-token text such as "<|endoftext|>" is treated as plain text. */
export function tokenIds(text: string): number[] {
  if (text.length === 0) return [];
  return need().encode(text, { disallowedSpecial: new Set() });
}

export function tokenCount(text: string): number {
  return tokenIds(text).length;
}

export interface TokenPiece {
  /** Decoded text of this piece (a whole character sequence; never a broken UTF-8 fragment). */
  text: string;
  /** The token ids in this piece: usually one; several when one character spans tokens (emoji, CJK). */
  ids: number[];
  /** Index of the first token of the piece in the full token list. */
  index: number;
  /** Character offset of the piece in the original text. */
  start: number;
}

/**
 * Split text into displayable pieces. Tokens that decode to a partial character are merged with
 * their neighbours until the bytes form whole characters, so every chip shows real text.
 */
export function tokenPieces(text: string): TokenPiece[] {
  const { decode } = need();
  const ids = tokenIds(text);
  const out: TokenPiece[] = [];
  let group: number[] = [];
  let groupIndex = 0;
  let offset = 0;
  for (let i = 0; i < ids.length; i++) {
    if (group.length === 0) groupIndex = i;
    group.push(ids[i] as number);
    const s = decode(group);
    if (!s.includes("�") || i === ids.length - 1 || group.length >= 8) {
      out.push({ text: s, ids: group, index: groupIndex, start: offset });
      offset += s.length;
      group = [];
    }
  }
  return out;
}

/** Words as a person counts them: runs of non-space characters. */
export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}
