/**
 * Deterministic file names for pre-rendered phrases.
 *
 * A phrase's file is named by a hash of (voice id, language, normalised text), so re-rendering a pack
 * only touches phrases whose text or voice changed, and two packs that share a phrase and a voice
 * produce byte-identical names. The hash is FNV-1a 64-bit: synchronous, dependency-free and identical
 * in Bun, Node and the browser, so the compiler or a widget can recompute a name without this script.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-8 bytes of `input`, as 16 lowercase hex digits. */
export function fnv1a64(input: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Unicode NFC, single spaces, trimmed. Case and punctuation are kept: they change how a voice reads. */
export function normalizePhrase(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Lookup key used by the audio manifest: "<lang>|<normalised text>". */
export function phraseKey(text: string, lang: string): string {
  return `${lang}|${normalizePhrase(text)}`;
}

/**
 * Pack-relative path of a rendered phrase, e.g. "assets/audio/es-es-3f1c0a9b8e7d6c5b.ogg".
 * Lowercase only, so it always matches the AssetPath pattern.
 */
export function audioAssetPath(text: string, lang: string, voiceId: string): string {
  const digest = fnv1a64(`${voiceId}\u0000${lang}\u0000${normalizePhrase(text)}`);
  const prefix = lang.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `assets/audio/${prefix}-${digest}.ogg`;
}
