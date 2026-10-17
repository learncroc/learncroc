/**
 * Inline Markdown for AI and pack text: bold, italic, code, http(s) links. Raw HTML is escaped
 * (markdown-it with html off), links to anything but http(s) are dropped.
 */
import MarkdownIt from "markdown-it";
import { useMemo } from "react";

const md = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: true });
md.validateLink = (url: string) => /^https?:\/\//i.test(url.trim());
const defaultLink = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  t?.attrSet("target", "_blank");
  t?.attrSet("rel", "noopener noreferrer");
  return defaultLink ? defaultLink(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};

export function renderInline(text: string): string {
  return md.renderInline(text);
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => text.split(/\n+/).map((line) => renderInline(line)), [text]);
  return (
    <div className={className}>
      {html.map((h, i) => (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it with html disabled escapes every tag; links are limited to http(s)
        // biome-ignore lint/suspicious/noArrayIndexKey: lines of one immutable text
        <p key={i} className="m-0 [&+p]:mt-2" dangerouslySetInnerHTML={{ __html: h }} />
      ))}
    </div>
  );
}
