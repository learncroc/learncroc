/**
 * Contrast check for the design tokens (PLAN §6.1): body text ≥ 7:1, meta text ≥ 4.5:1, non-text
 * UI ≥ 3:1, in the light and the dark theme. Pure: give it the text of tokens.css.
 * The CLI wrapper is scripts/tokens-check.ts (`bun run tokens:check`).
 */
import { contrast } from "./color";

export type ThemeName = "light" | "dark";
export type PairKind = "body" | "meta" | "ui";

export const MIN_RATIO: Record<PairKind, number> = { body: 7, meta: 4.5, ui: 3 };

export interface TokenPair {
  fg: string;
  bg: string;
  kind: PairKind;
  /** Where the pair is used. */
  use: string;
}

const SURFACES = ["bg", "surface", "surface-2"] as const;

/** Every foreground/background pair the UI actually draws. */
export const TOKEN_PAIRS: TokenPair[] = [
  ...[...SURFACES, "surface-sunk"].map((bg) => ({ fg: "ink", bg, kind: "body" as const, use: "body text" })),
  ...[...SURFACES, "surface-sunk"].map((bg) => ({ fg: "ink-2", bg, kind: "meta" as const, use: "secondary text" })),
  ...SURFACES.map((bg) => ({ fg: "ink-3", bg, kind: "meta" as const, use: "meta text, hints" })),
  { fg: "lumen-text", bg: "lumen-soft", kind: "meta", use: "Lit pill, Open gate pill" },
  { fg: "lumen-text", bg: "surface", kind: "meta", use: "durable mark, lumen text" },
  { fg: "ember-text", bg: "ember-soft", kind: "meta", use: "Fading pill" },
  ...SURFACES.map((bg) => ({ fg: "ember-text", bg, kind: "meta" as const, use: "system errors" })),
  { fg: "sea-text", bg: "sea-soft", kind: "meta", use: "Ready pill, selected answer" },
  ...SURFACES.map((bg) => ({ fg: "sea-text", bg, kind: "meta" as const, use: "links, ready text" })),
  { fg: "ink", bg: "iris-soft", kind: "body", use: "Building pill, AI chips" },
  { fg: "bg", bg: "ink", kind: "body", use: "primary button text" },
  ...SURFACES.map((bg) => ({ fg: "focus", bg, kind: "ui" as const, use: "focus ring" })),
  ...SURFACES.map((bg) => ({ fg: "sea", bg, kind: "ui" as const, use: "Ready glyph ring" })),
  // The Fading glyph's ring is drawn in --ember-text; the --ember half-disc fill sits inside that ring.
  ...SURFACES.map((bg) => ({ fg: "ember-text", bg, kind: "ui" as const, use: "Fading glyph ring" })),
  ...SURFACES.map((bg) => ({ fg: "lumen-text", bg, kind: "ui" as const, use: "Lit glyph outline and rays" })),
  ...SURFACES.map((bg) => ({ fg: "iris", bg, kind: "ui" as const, use: "AI text border, ◆" })),
  ...SURFACES.map((bg) => ({ fg: "ink-3", bg, kind: "ui" as const, use: "Later / Planned glyph, control borders" })),
  { fg: "sea", bg: "surface-sunk", kind: "ui", use: "switch on" },
  // Moss: the outline, mouth and nostrils on the body; the belly lines; the body against its halo.
  { fg: "croc-ink", bg: "croc", kind: "meta", use: "Moss outline and mouth on the body" },
  { fg: "croc-ink", bg: "croc-belly", kind: "meta", use: "Moss lines on the belly" },
  { fg: "croc-ink", bg: "croc-eye", kind: "body", use: "Moss pupils" },
  // The halo is --surface on every world ground, so the body only ever meets --surface at its edge.
  { fg: "croc", bg: "surface", kind: "ui", use: "Moss body against its surface halo" },
  // Checkpoint pips and the gate charge: Sea discs and dashed ink-3 rings on the modal surface.
  { fg: "ink-3", bg: "surface-sunk", kind: "ui", use: "missed pip ring on its sunk disc" },
];

/** Read the colour variables of one theme block out of tokens.css. */
export function readTheme(css: string, theme: ThemeName): Record<string, string> {
  const selector =
    theme === "light" ? /:root,\s*\[data-theme="light"\]\s*\{([^}]*)\}/ : /\[data-theme="dark"\]\s*\{([^}]*)\}/;
  const body = selector.exec(css)?.[1];
  if (!body) throw new Error(`tokens.css: no ${theme} theme block`);
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (name && value) out[name] = value;
  }
  return out;
}

export interface PairResult extends TokenPair {
  theme: ThemeName;
  ratio: number;
  min: number;
  ok: boolean;
}

export function checkTokens(css: string): PairResult[] {
  const results: PairResult[] = [];
  for (const theme of ["light", "dark"] as const) {
    const vars = readTheme(css, theme);
    for (const pair of TOKEN_PAIRS) {
      const fg = vars[pair.fg];
      const bg = vars[pair.bg];
      if (!fg || !bg) throw new Error(`tokens.css (${theme}): missing --${fg ? pair.bg : pair.fg}`);
      const ratio = contrast(fg, bg);
      const min = MIN_RATIO[pair.kind];
      results.push({ ...pair, theme, ratio, min, ok: ratio >= min });
    }
  }
  return results;
}
