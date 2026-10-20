/**
 * SVG safety check: a pack SVG is accepted only if sanitising it would change nothing.
 *
 * Implemented as a strict allowlist validator over a small XML tokenizer, so the verdict is exact
 * and deterministic: any construct a sanitiser would strip (scripts, event handlers, foreignObject,
 * external references, javascript: URLs, DOCTYPE/entities, unknown elements) rejects the file.
 */

const ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "title",
  "desc",
  "metadata",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "style",
  "image",
  "switch",
  "view",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
]);

const ATTR_NAME_RE = /^[a-zA-Z_][-a-zA-Z0-9_.]*(?::[a-zA-Z_][-a-zA-Z0-9_.]*)?$/;
const ALLOWED_NS_ATTRS = new Set([
  "xmlns",
  "xmlns:xlink",
  "xmlns:svg",
  "xml:space",
  "xml:lang",
  "xlink:href",
  "xlink:title",
]);
const DATA_IMAGE_RE = /^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/=\s]+$/;

export interface SvgVerdict {
  ok: boolean;
  problems: string[];
}

function cssProblems(css: string): string[] {
  const out: string[] = [];
  const lower = css.toLowerCase();
  if (lower.includes("@import")) out.push("CSS @import");
  if (lower.includes("expression(")) out.push("CSS expression()");
  if (lower.includes("javascript:")) out.push("javascript: URL in CSS");
  if (/-moz-binding|behavior\s*:/.test(lower)) out.push("CSS binding");
  // CSS escapes can spell @import or a URL scheme past the checks above; pack art never needs them.
  if (css.includes("\\")) out.push("CSS escape sequence");
  for (const m of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!(m[2] ?? "").startsWith("#")) out.push(`external url() in CSS: ${(m[2] ?? "").slice(0, 60)}`);
  }
  return out;
}

function decodeEntities(v: string): string {
  return v.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? Number.parseInt(k.slice(2), 16) : Number.parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

function attrProblems(el: string, name: string, rawValue: string): string[] {
  const value = decodeEntities(rawValue);
  const out: string[] = [];
  const lname = name.toLowerCase();
  if (!ATTR_NAME_RE.test(name)) return [`bad attribute name ${name}`];
  if (lname.startsWith("on")) return [`event handler ${name} on <${el}>`];
  if (name.includes(":") && !ALLOWED_NS_ATTRS.has(name)) return [`namespaced attribute ${name}`];
  const compact = Array.from(value)
    .filter((ch) => ch.charCodeAt(0) > 0x20)
    .join("")
    .toLowerCase();
  if (compact.includes("javascript:") || compact.includes("vbscript:")) out.push(`script URL in ${name}`);
  if (lname === "href" || lname === "xlink:href") {
    const ok = value.startsWith("#") || (el === "image" && DATA_IMAGE_RE.test(value));
    if (!ok) out.push(`external reference ${name}="${value.slice(0, 60)}" on <${el}>`);
  } else if (compact.startsWith("data:")) {
    out.push(`data: URL in ${name}`);
  }
  if (lname === "style") out.push(...cssProblems(value));
  else if (/url\(/i.test(value)) out.push(...cssProblems(value));
  return out;
}

/** Validate an SVG document. */
export function checkSvg(input: string | Uint8Array): SvgVerdict {
  let text: string;
  try {
    text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    return { ok: false, problems: ["not valid UTF-8"] };
  }
  const problems: string[] = [];
  const stack: string[] = [];
  let i = 0;
  let sawRoot = false;
  const s = text.replace(/^﻿/, "");
  while (i < s.length && problems.length < 20) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      if (s.slice(i).trim() && stack.length === 0) problems.push("text outside the root element");
      break;
    }
    const between = s.slice(i, lt);
    if (stack.length === 0 && between.trim()) problems.push("text outside the root element");
    if (stack[stack.length - 1] === "style") problems.push(...cssProblems(decodeEntities(between)));
    if (s.startsWith("<?", lt)) {
      const end = s.indexOf("?>", lt);
      if (end < 0) return { ok: false, problems: ["unterminated processing instruction"] };
      const pi = s.slice(lt + 2, end);
      if (!/^xml\s/.test(pi) || sawRoot) problems.push(`processing instruction <?${pi.slice(0, 20)}`);
      i = end + 2;
      continue;
    }
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      if (end < 0) return { ok: false, problems: ["unterminated comment"] };
      i = end + 3;
      continue;
    }
    if (s.startsWith("<!", lt)) {
      problems.push(s.startsWith("<![CDATA[", lt) ? "CDATA section" : "DOCTYPE or entity declaration");
      const end = s.indexOf(">", lt);
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (s.startsWith("</", lt)) {
      const end = s.indexOf(">", lt);
      if (end < 0) return { ok: false, problems: ["unterminated end tag"] };
      const name = s.slice(lt + 2, end).trim();
      if (stack.pop() !== name) problems.push(`mismatched </${name}>`);
      i = end + 1;
      continue;
    }
    // start tag: <name attrs... (/)>
    const m = /^<([A-Za-z_][-A-Za-z0-9_.:]*)/.exec(s.slice(lt, lt + 200));
    if (!m) return { ok: false, problems: [...problems, "malformed tag"] };
    const name = m[1] as string;
    let j = lt + m[0].length;
    const attrs: [string, string][] = [];
    let selfClose = false;
    for (;;) {
      while (j < s.length && /\s/.test(s[j] as string)) j++;
      if (s.startsWith("/>", j)) {
        selfClose = true;
        j += 2;
        break;
      }
      if (s[j] === ">") {
        j++;
        break;
      }
      const am = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(s.slice(j, j + 100_000));
      if (!am) return { ok: false, problems: [...problems, `malformed attribute in <${name}>`] };
      attrs.push([am[1] as string, am[3] ?? am[4] ?? ""]);
      j += am[0].length;
    }
    if (stack.length === 0) {
      if (sawRoot) problems.push("more than one root element");
      if (name !== "svg") problems.push(`root element is <${name}>, not <svg>`);
      sawRoot = true;
    }
    if (!ELEMENTS.has(name)) problems.push(`element <${name}> is not allowed`);
    const seen = new Set<string>();
    for (const [an, av] of attrs) {
      if (seen.has(an)) problems.push(`duplicate attribute ${an}`);
      seen.add(an);
      problems.push(...attrProblems(name, an, av));
    }
    if (!selfClose) stack.push(name);
    i = j;
  }
  if (stack.length) problems.push(`unclosed <${stack[stack.length - 1]}>`);
  if (!sawRoot) problems.push("no <svg> root element");
  return { ok: problems.length === 0, problems };
}
