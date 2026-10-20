/**
 * Inline Markdown for pack text: **bold**, *italic* / _italic_, `code`,
 * ==highlight== (the close's highlighter sweep), [links](https://…) or [card](stop:<nodeId>), and $maths$. Rendered to React elements, never to
 * HTML strings, so pack text can't inject markup.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { MathTex } from "./Math";

type Token =
  | { t: "text"; v: string }
  | { t: "strong"; v: Token[] }
  | { t: "em"; v: Token[] }
  | { t: "mark"; v: Token[] }
  | { t: "code"; v: string }
  | { t: "math"; v: string }
  | { t: "link"; href: string; v: Token[] };

const SAFE_HREF = /^(https?:\/\/[^\s]+|stop:[a-z0-9][a-z0-9-]{0,63})$/;

/** Parse inline Markdown into tokens. Unknown syntax stays literal text. */
export function parseInline(src: string): Token[] {
  const out: Token[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    if (ch === "\\" && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "$") {
      const end = src.indexOf("$", i + 1);
      if (end > i + 1 && src[i + 1] !== " ") {
        flush();
        out.push({ t: "math", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith("==")) {
      const end = src.indexOf("==", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "mark", v: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (rest.startsWith("**")) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "strong", v: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] !== " ") {
      const end = src.indexOf(ch, i + 1);
      const prev = src[i - 1];
      const boundary = ch === "*" || prev === undefined || !/[\p{L}\p{N}]/u.test(prev);
      if (end > i + 1 && boundary) {
        flush();
        out.push({ t: "em", v: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
      if (m?.[1] && m[2] && SAFE_HREF.test(m[2])) {
        flush();
        out.push({ t: "link", href: m[2], v: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/** Strip inline Markdown to plain text (aria labels, pinned chips). */
export function plainText(src: string): string {
  const walk = (ts: Token[]): string =>
    ts.map((t) => (t.t === "text" || t.t === "code" || t.t === "math" ? t.v : walk(t.v))).join("");
  return walk(parseInline(src));
}

/** Drop the close highlighter's `==…==` markers, keeping the words (teasers, logbook lines, Moss replies). */
export function stripMarks(src: string): string {
  return src.replace(/==([^=\n]+?)==/g, "$1");
}

interface RenderOpts {
  /** Delay before the highlighter sweeps (the close reveals its sentences one by one). */
  markDelayMs?: number;
}

function render(tokens: Token[], packId: string | undefined, keyPrefix: string, opts: RenderOpts = {}): ReactNode[] {
  return tokens.map((tok, i) => {
    const key = `${keyPrefix}${i}`;
    switch (tok.t) {
      case "text":
        return tok.v;
      case "strong":
        return (
          <strong key={key} className="font-bold">
            {render(tok.v, packId, `${key}.`, opts)}
          </strong>
        );
      case "em":
        return <em key={key}>{render(tok.v, packId, `${key}.`, opts)}</em>;
      case "mark":
        return (
          <mark
            key={key}
            className="lm-sweep-mark rounded-xs"
            style={opts.markDelayMs ? { animationDelay: `${opts.markDelayMs}ms` } : undefined}
          >
            {render(tok.v, packId, `${key}.`, opts)}
          </mark>
        );
      case "code":
        return (
          <code key={key} className="voice-mono rounded-xs bg-surface-sunk px-1 text-[0.92em]">
            {tok.v}
          </code>
        );
      case "math":
        return <MathTex key={key} tex={tok.v} />;
      case "link": {
        const children = render(tok.v, packId, `${key}.`, opts);
        if (tok.href.startsWith("stop:") && packId) {
          return (
            <Link
              key={key}
              to="/p/$pack"
              params={{ pack: packId }}
              search={{ card: tok.href.slice(5) }}
              className="underline decoration-sea underline-offset-2"
            >
              {children}
            </Link>
          );
        }
        if (tok.href.startsWith("stop:")) return <span key={key}>{children}</span>;
        return (
          <a
            key={key}
            href={tok.href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            {children}
          </a>
        );
      }
    }
    return null;
  });
}

export interface MdProps {
  text: string;
  /** Resolves stop: links to the pack map. */
  packId?: string;
  className?: string;
  as?: "span" | "p" | "div";
  /** Delay the `==mark==` sweep (ms). */
  markDelayMs?: number;
}

/**
 * Inline Markdown as React. `==x==` renders as `<mark class="lm-sweep-mark">` (the close's highlighter);
 * use `stripMarks` where a plain line is wanted instead.
 */
export function Md({ text, packId, className, as: Tag = "span", markDelayMs }: MdProps) {
  return (
    <Tag className={className}>
      {render(parseInline(text), packId, "", markDelayMs !== undefined ? { markDelayMs } : {})}
    </Tag>
  );
}

/** Split Markdown into sentences without cutting through a `**…**`, `*…*`, `==…==` or `` `…` `` span. */
export function sentences(src: string): string[] {
  const out: string[] = [];
  let buf = "";
  let open: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const two = src.slice(i, i + 2);
    const ch = src[i] ?? "";
    if (two === "**" || two === "==") {
      open = open === two ? null : open === null ? two : open;
      buf += two;
      i++;
      continue;
    }
    if (ch === "`" || ch === "$") open = open === ch ? null : open === null ? ch : open;
    buf += ch;
    if (open === null && /[.?!]/.test(ch) && /\s/.test(src[i + 1] ?? "") && buf.trim().length > 1) {
      out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
