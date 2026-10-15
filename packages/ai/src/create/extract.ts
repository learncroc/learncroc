/**
 * Readability on linkedom → paragraphs p1…pn (PLAN §15.5). The paragraph ids are what stops cite,
 * what the highlighter sweeps and what "See in article" scrolls to.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { Para } from "../inputs";
import { words } from "../text";

export interface Article {
  title: string;
  site?: string;
  byline?: string;
  paragraphs: Para[];
  headings: string[];
  words: number;
}

const MIN_PARA_WORDS = 8;

function clean(s: string): string {
  return s
    .replace(/\[\d+\]|\[citation needed\]|\[edit\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function finish(title: string, paras: Para[], extra: Partial<Article> = {}): Article {
  const headings = [...new Set(paras.map((p) => p.heading).filter((h): h is string => !!h))];
  return {
    title,
    ...extra,
    paragraphs: paras,
    headings,
    words: paras.reduce((n, p) => n + words(p.text), 0),
  };
}

export function extractFromHtml(html: string, url: string): Article {
  const { document } = parseHTML(html);
  const site = new URL(url).hostname.replace(/^www\./, "");
  const fallbackTitle = clean(document.querySelector("title")?.textContent ?? site);
  const parsed = new Readability(document as unknown as Document, { charThreshold: 300 }).parse();
  const contentHtml = parsed?.content ?? document.body?.innerHTML ?? "";
  const { document: content } = parseHTML(`<!doctype html><html><body>${contentHtml}</body></html>`);
  const paras: Para[] = [];
  let heading: string | undefined;
  for (const el of Array.from(content.querySelectorAll("h1, h2, h3, h4, p, li, blockquote"))) {
    const tag = el.tagName.toLowerCase();
    const text = clean(el.textContent ?? "");
    if (!text) continue;
    if (/^h[1-4]$/.test(tag)) {
      heading = text.slice(0, 120);
      continue;
    }
    // A list item inside a paragraph-like blockquote is already counted.
    if (tag === "li" && el.querySelector("p")) continue;
    if (words(text) < MIN_PARA_WORDS) continue;
    paras.push({ id: `p${paras.length + 1}`, text, ...(heading ? { heading } : {}) });
  }
  return finish(clean(parsed?.title ?? "") || fallbackTitle, paras, {
    site: parsed?.siteName?.trim() || site,
    ...(parsed?.byline ? { byline: clean(parsed.byline) } : {}),
  });
}

/** Pasted text (or a text/plain page): blank lines separate paragraphs; "#" lines are headings. */
export function extractFromText(text: string, title: string): Article {
  const paras: Para[] = [];
  let heading: string | undefined;
  for (const block of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t) continue;
    const h = /^#{1,4}\s+(.+)$/.exec(t);
    if (h && !t.includes("\n")) {
      heading = clean(h[1] as string);
      continue;
    }
    const body = clean(t);
    if (words(body) < MIN_PARA_WORDS && paras.length > 0) {
      const prev = paras[paras.length - 1];
      if (prev) prev.text = `${prev.text} ${body}`;
      continue;
    }
    paras.push({ id: `p${paras.length + 1}`, text: body, ...(heading ? { heading } : {}) });
  }
  return finish(title.trim() || "Pasted text", paras);
}

/** Limits from PLAN §15.5: under 300 words → paste instead; very long → ask for a section. */
export const MIN_ARTICLE_WORDS = 300;
export const MAX_ARTICLE_WORDS = 15_000;
