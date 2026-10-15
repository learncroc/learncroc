/**
 * Generated SVG figures (PLAN §6.5, §15.5 step 3). A figure is kept only if it follows the
 * illustration contract AND DOMPurify (SVG profile) would leave it unchanged; otherwise it is
 * dropped and the screen keeps its widget visual. Scripts and event handlers never survive.
 */
import createDOMPurify from "dompurify";
import { Window } from "happy-dom";
import { words } from "../text";

export const FIGURE_MAX_BYTES = 64 * 1024;

const ALLOWED = new Set([
  "svg",
  "title",
  "desc",
  "g",
  "path",
  "line",
  "polyline",
  "polygon",
  "rect",
  "circle",
  "ellipse",
  "text",
  "tspan",
]);
const PAINT_OK = /^(none|currentColor|transparent|var\(--(ink|ink-2|lumen|sea|w-[1-5])\))$/;

const ATTRS = new Set([
  "xmlns",
  "viewbox",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "dx",
  "dy",
  "width",
  "height",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "fill-rule",
  "transform",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "role",
  "aria-label",
  "aria-hidden",
]);
const TRANSFORM_OK = /^(\s*(translate|rotate|scale)\(\s*-?[\d.]+(\s*[,\s]\s*-?[\d.]+){0,2}\s*\)\s*)+$/;

let purifier: ReturnType<typeof createDOMPurify> | undefined;
let parserWindow: Window | undefined;
let purifierSane: boolean | undefined;

function dom() {
  if (!purifier || !parserWindow) {
    parserWindow = new Window();
    purifier = createDOMPurify(parserWindow as unknown as Parameters<typeof createDOMPurify>[0]);
  }
  return { purify: purifier, window: parserWindow };
}

const PROBE_OK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>t</title><circle cx="5" cy="5" r="2" fill="none"/></svg>';
const PROBE_BAD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle onclick="x()" cx="5" cy="5" r="2"/></svg>';

/**
 * DOMPurify needs a faithful DOM. Some server-side DOM emulations drop the <svg> root and keep
 * event handlers, so the purifier is used only when it passes a self-test on this runtime; the
 * strict allowlist in checkFigure() is the guarantee either way.
 */
function purifierWorks(): boolean {
  if (purifierSane !== undefined) return purifierSane;
  try {
    const { purify } = dom();
    const ok = purify.sanitize(PROBE_OK, { USE_PROFILES: { svg: true } });
    const goodClean = purify.removed.length === 0 && ok.includes("<svg");
    const bad = purify.sanitize(PROBE_BAD, { USE_PROFILES: { svg: true } });
    purifierSane = goodClean && !bad.includes("onclick");
  } catch {
    purifierSane = false;
  }
  return purifierSane;
}

export type FigureCheck = { ok: true; svg: string } | { ok: false; reason: string };

/** Sanitize-and-compare: true when DOMPurify removed nothing (or the purifier is unavailable here). */
export function purifyUnchanged(svg: string): boolean {
  if (!purifierWorks()) return true;
  const { purify } = dom();
  purify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: false } });
  return purify.removed.length === 0;
}

const escapeXml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Models often put <title>/<desc> late, leave them out, or swap them. Move (or add) them right
 * after the opening <svg> tag so the accessibility rule holds without throwing a good figure away.
 */
export function normalizeFigure(raw: string, title: string, desc: string): string {
  let svg = raw.trim().replace(/^<\?xml[^>]*>\s*/, "");
  const grab = (tag: string) => {
    const m = svg.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    svg = svg
      .replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "gi"), "")
      .replace(new RegExp(`<${tag}\\s*/>`, "gi"), "");
    return m?.[1]?.trim() ?? "";
  };
  const t = grab("title") || escapeXml(title.trim() || "Figure");
  const d = grab("desc") || escapeXml(desc.trim() || title.trim() || "Figure");
  return svg.replace(/^<svg\b[^>]*>/i, (open) => `${open}<title>${t}</title><desc>${d}</desc>`);
}

export function checkFigure(raw: string): FigureCheck {
  const svg = raw.trim().replace(/^<\?xml[^>]*>\s*/, "");
  if (new TextEncoder().encode(svg).length > FIGURE_MAX_BYTES) return { ok: false, reason: "over 64 KB" };
  if (!/^<svg[\s>]/.test(svg)) return { ok: false, reason: "not an <svg> document" };
  if (
    /<script|<foreignObject|<style|<image|<use|<a[\s>]|<animate|<set[\s>]|javascript:|url\(|@import|xlink:href|\shref=/i.test(
      svg,
    )
  ) {
    return { ok: false, reason: "contains scripts, links, styles or external references" };
  }
  if (/\son[a-z]+\s*=/i.test(svg)) return { ok: false, reason: "contains an event handler" };
  if (!purifyUnchanged(svg)) return { ok: false, reason: "sanitising would change it" };

  const { window } = dom();
  const doc = new window.DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root?.tagName.toLowerCase() !== "svg") return { ok: false, reason: "not an <svg> document" };
  if ((root.getAttribute("viewBox") ?? "").trim().replace(/\s+/g, " ") !== "0 0 800 500") {
    return { ok: false, reason: 'viewBox must be "0 0 800 500"' };
  }
  const kids = Array.from(root.children).map((c) => c.tagName.toLowerCase());
  if (kids[0] !== "title" || kids[1] !== "desc") return { ok: false, reason: "needs <title> then <desc> first" };
  const all = Array.from(root.querySelectorAll("*"));
  let labels = 0;
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED.has(tag)) return { ok: false, reason: `<${tag}> is not allowed` };
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ATTRS.has(name)) return { ok: false, reason: `attribute ${name} is not allowed` };
      if (name === "transform" && !TRANSFORM_OK.test(attr.value ?? ""))
        return { ok: false, reason: "only simple transforms" };
      if ((name === "fill" || name === "stroke") && !PAINT_OK.test((attr.value ?? "").trim())) {
        return { ok: false, reason: `colour "${attr.value}" is not a theme variable` };
      }
    }
    if (tag === "text") {
      labels++;
      // Models sometimes write "14px"; accept a px suffix, nothing else.
      const sizeRaw = (el.getAttribute("font-size") ?? "16").trim();
      const size = /^\d+(\.\d+)?(px)?$/.test(sizeRaw) ? Number.parseFloat(sizeRaw) : Number.NaN;
      if (!(size >= 14)) return { ok: false, reason: "labels must be at least 14 px" };
      if (words(el.textContent ?? "") > 4) return { ok: false, reason: "labels are at most 4 words" };
    }
  }
  if (labels > 6) return { ok: false, reason: "at most 6 labels" };
  if (!doc.querySelector("title")?.textContent?.trim() || !doc.querySelector("desc")?.textContent?.trim()) {
    return { ok: false, reason: "<title> and <desc> must have text" };
  }
  return { ok: true, svg };
}
