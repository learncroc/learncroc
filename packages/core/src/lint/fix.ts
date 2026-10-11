/**
 * `learncroc lint --fix`: mechanical fixes applied to the YAML documents (comments and layout
 * are preserved). Fixes:
 * - L004: empty or missing `alt` on visuals → a placeholder marked TODO (lint keeps warning on it);
 * - L001: a beat over the beat cap with several blocks → the last story/callout moves into
 *   `alts.simpler` (the croc's "explain it differently") when that slot is free;
 * - generated boilerplate made editable: `flashcards` written into the card.
 * Theme colours are only suggested (in the L014 message example), never changed silently.
 */
import { isMap, type Document as YamlDocument } from "yaml";
import type { PackFs } from "../compile/fs";
import { generateFlashcards } from "../compile/generate";
import { loadPackSources } from "../compile/load";
import { screenWords } from "../compile/text";
import type { LintProfile, PackNode } from "../schema/index";
import { CARD_CAPS } from "./card-shape";

export const ALT_PLACEHOLDER = "TODO: describe this picture for screen readers";

export interface FixResult {
  /** Changed files only: pack-relative path → new YAML text. */
  files: Record<string, string>;
  fixed: { rule: string; file: string; path: string; what: string }[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const VISUAL_KINDS = new Set(["figure", "widget", "html", "generated-html"]);

/** Paths of visual-like objects (and html interactions) without usable alt text. */
function missingAlts(
  value: unknown,
  path: (string | number)[] = [],
  out: (string | number)[][] = [],
): (string | number)[][] {
  if (Array.isArray(value))
    value.forEach((v, i) => {
      missingAlts(v, [...path, i], out);
    });
  else if (isObj(value)) {
    const key = path[path.length - 1];
    const visual =
      typeof value.kind === "string" && VISUAL_KINDS.has(value.kind) && (key === "visual" || value.kind === "html");
    if (visual && (typeof value.alt !== "string" || !value.alt.trim())) out.push(path);
    for (const [k, v] of Object.entries(value)) missingAlts(v, [...path, k], out);
  }
  return out;
}

function fixNode(
  doc: YamlDocument,
  file: string,
  node: PackNode | undefined,
  lang: string,
  fixed: FixResult["fixed"],
): boolean {
  let changed = false;
  const raw = doc.toJS({ maxAliasCount: 100 }) as unknown;
  for (const path of missingAlts(raw)) {
    doc.setIn([...path, "alt"], ALT_PLACEHOLDER);
    fixed.push({ rule: "L004", file, path: `/${[...path, "alt"].join("/")}`, what: "added a TODO alt placeholder" });
    changed = true;
  }
  if (!node) return changed;

  node.screens.forEach((s, i) => {
    if (screenWords(s, lang).total <= CARD_CAPS.beat || s.blocks.length < 2 || s.alts?.simpler) return;
    const last = s.blocks[s.blocks.length - 1];
    if (!last || (last.type !== "story" && last.type !== "callout")) return;
    doc.deleteIn(["screens", i, "blocks", s.blocks.length - 1]);
    doc.setIn(["screens", i, "alts", "simpler"], last.text.trim());
    fixed.push({
      rule: "L001",
      file,
      path: `/screens/${i}/blocks`,
      what: "moved the last block into alts.simpler",
    });
    changed = true;
  });

  if (!node.flashcards) {
    const cards = generateFlashcards(node);
    if (cards.length) {
      doc.setIn(["flashcards"], doc.createNode(cards));
      fixed.push({ rule: "L002", file, path: "/flashcards", what: `wrote ${cards.length} generated flashcards` });
      changed = true;
    }
  }
  return changed;
}

/** Apply the mechanical fixes; returns the changed files (the caller writes them). */
export async function lintFix(fs: PackFs, _opts: { profile?: LintProfile } = {}): Promise<FixResult> {
  const sources = await loadPackSources(fs);
  const lang = sources.manifest?.value?.lang ?? "en";
  const result: FixResult = { files: {}, fixed: [] };
  for (const [, f] of Object.entries(sources.nodes)) {
    if (f.doc.errors.length || !isMap(f.doc.contents)) continue;
    if (fixNode(f.doc, f.path, f.value, lang, result.fixed)) result.files[f.path] = f.doc.toString();
  }
  return result;
}
