/** One import site for zod and the core types widget specs need. */

import { z } from "zod";

export type { WidgetSpec } from "@learncroc/core";
export { AssetPath, LineColor, Markdown, Normalize, SelfRating } from "@learncroc/core";
export { z };

/** Portrait glyph of an in-world character (dialogue). Core no longer has guides, so the widget owns the list. */
export const GuideGlyph = z.enum([
  "tok",
  "mira",
  "lola",
  "bit",
  "iso",
  "prior",
  "yuki",
  "duke",
  "ping",
  "mags",
  "ochre",
  "heuristica",
  "generic",
]);
export type GuideGlyph = z.infer<typeof GuideGlyph>;
