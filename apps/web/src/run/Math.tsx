/**
 * KaTeX maths, lazy-loaded so it stays out of the learner-route chunk. Until it loads (or if it fails)
 * the TeX source is shown as text, which is also what screen readers get via the MathML output.
 */
import { useEffect, useState } from "react";

type Katex = typeof import("katex").default;
let loading: Promise<Katex> | null = null;

function loadKatex(): Promise<Katex> {
  if (!loading) {
    loading = import("katex").then((m) => m.default);
    // The stylesheet is a separate lazy chunk; failure only affects layout, never content.
    import("katex/dist/katex.min.css").catch(() => undefined);
  }
  return loading;
}

export interface MathTexProps {
  tex: string;
  display?: boolean;
  className?: string;
}

export function MathTex({ tex, display = false, className }: MathTexProps) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadKatex()
      .then((katex) => {
        if (!live) return;
        // trust: false and no macros from content: KaTeX output is inert markup.
        setHtml(
          katex.renderToString(tex, {
            displayMode: display,
            throwOnError: false,
            trust: false,
            output: "htmlAndMathml",
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tex, display]);
  const Tag = display ? "div" : "span";
  if (html === null) {
    return (
      <Tag className={className} data-math="pending">
        <code className="voice-mono text-code">{tex}</code>
      </Tag>
    );
  }
  // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX renders authored TeX with trust disabled.
  return <Tag className={className} data-math="ready" dangerouslySetInnerHTML={{ __html: html }} />;
}
