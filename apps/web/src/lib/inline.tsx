/**
 * A tiny inline Markdown renderer for short authored strings shown outside the player (the
 * first-run question, teasers on the library): **bold**, *em*, `code` and ==mark==. Everything is
 * rendered as text nodes, never as HTML.
 */
import { Fragment, type ReactNode } from "react";

const TOKEN = /(\*\*[^*]+\*\*|==[^=]+==|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

export function Inline({ text }: { text: string }) {
  const parts = text.split(TOKEN).filter((p) => p !== "");
  return (
    <>
      {parts.map((p, i) => {
        let node: ReactNode = p;
        if (p.startsWith("**") && p.endsWith("**")) node = <strong className="font-semibold">{p.slice(2, -2)}</strong>;
        else if (p.startsWith("==") && p.endsWith("==")) node = <mark className="lm-sweep-mark">{p.slice(2, -2)}</mark>;
        else if (p.startsWith("`") && p.endsWith("`"))
          node = <code className="voice-mono text-code">{p.slice(1, -1)}</code>;
        else if ((p.startsWith("*") && p.endsWith("*")) || (p.startsWith("_") && p.endsWith("_")))
          node = <em>{p.slice(1, -1)}</em>;
        // biome-ignore lint/suspicious/noArrayIndexKey: a static split of one string
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

/** The plain words of a short Markdown string (for aria labels and search). */
export function plainText(md: string): string {
  return md
    .replace(/\*\*|==|`/g, "")
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, "$1$2")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}
