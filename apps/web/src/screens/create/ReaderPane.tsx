/**
 * The article in reader mode while the map is built. As the planner finds each idea, a highlighter
 * sweeps the paragraphs it came from in that card's ink colour, and the pane scrolls to follow.
 */
import { POCKET_INKS } from "@learncroc/ai/layout";
import { cn } from "@learncroc/ui";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "../../ai/env";
import type { ArticleParas } from "./jobs";
import type { SurveyState } from "./survey";

export function ReaderPane({
  article,
  state,
  lineIndex,
}: {
  article: ArticleParas | null;
  state: SurveyState;
  lineIndex: Record<string, number>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const last = state.lastHighlight;

  useEffect(() => {
    if (!last || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-para="${last.para}"]`);
    if (!el) return;
    const top = el.offsetTop - box.current.clientHeight / 3;
    box.current.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
  }, [last, reduced]);

  const title = article?.title ?? state.meta?.title ?? "Reading the article";
  let heading: string | undefined;
  return (
    <div ref={box} className="h-full overflow-y-auto px-8 py-6">
      <p className="m-0 text-micro text-ink-3">{article?.site ?? state.meta?.site ?? "Article"}</p>
      <h2 className="m-0 mt-1 mb-5 t-title text-ink">{title}</h2>
      {!article ? (
        <div className="flex flex-col gap-3" aria-hidden>
          {(state.meta?.headings.length ? state.meta.headings : ["", "", ""]).slice(0, 8).map((h, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder lines
            <div key={i} className="flex flex-col gap-2">
              {h ? <p className="m-0 text-small font-[650] text-ink-2">{h}</p> : null}
              <div className="h-2.5 w-11/12 rounded-pill bg-surface-sunk" />
              <div className="h-2.5 w-10/12 rounded-pill bg-surface-sunk" />
              <div className="h-2.5 w-8/12 rounded-pill bg-surface-sunk" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex max-w-[62ch] flex-col gap-4">
          {article.paragraphs.map((p) => {
            const showHeading = p.heading && p.heading !== heading;
            heading = p.heading;
            const node = state.highlights[p.id];
            const color = node !== undefined ? POCKET_INKS[(lineIndex[node] ?? 0) % 5] : undefined;
            return (
              <div key={p.id}>
                {showHeading ? <h3 className="m-0 mb-2 text-body font-[700] text-ink">{p.heading}</h3> : null}
                <p data-para={p.id} className="m-0 text-body text-ink-2">
                  <span
                    className={cn(
                      "box-decoration-clone rounded-xs px-0.5 transition-[background-size,color] ease-out",
                      !reduced && "duration-[1100ms]",
                      color && "text-ink",
                    )}
                    style={{
                      backgroundImage: color
                        ? `linear-gradient(${color}38, ${color}38)`
                        : "linear-gradient(transparent, transparent)",
                      backgroundRepeat: "no-repeat",
                      backgroundSize: color ? "100% 100%" : "0% 100%",
                    }}
                  >
                    {p.text}
                  </span>
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
