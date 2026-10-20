/**
 * Canonical JSON and sha256 (Web Crypto: available in browsers, Bun and Node ≥ 19).
 */

/** JSON with object keys sorted recursively; `undefined` members are dropped (as JSON.stringify does). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as object).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = sortKeys(v);
  }
  return out;
}

/** Lowercase hex sha256 of a string (UTF-8) or bytes. */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** sha256 of the canonical pack.json without its `contentHash` field. */
export async function contentHashOf(pack: Record<string, unknown>): Promise<string> {
  const { contentHash: _omit, ...rest } = pack;
  return sha256Hex(canonicalJson(rest));
}
