/**
 * Asset response headers (PLAN §17): an extension → MIME allowlist plus a sandboxing CSP, nosniff
 * and same-origin resource policy. HTML is never served from the app origin.
 */
export const ASSET_MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
};

export const ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export function assetMime(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return ASSET_MIME[ext];
}

export function assetHeaders(mime: string, size: number): Record<string, string> {
  return {
    "Content-Type": mime,
    "Content-Length": String(size),
    "Content-Security-Policy": ASSET_CSP,
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "private, max-age=300",
  };
}
