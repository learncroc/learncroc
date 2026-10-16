import { buttonClass, KbdHint, StopGlyph, WhyThisWorks } from "@learncroc/ui";
import { Link } from "@tanstack/react-router";
import type { FadingStop } from "./posterKit";

export interface RelightStripProps {
  /** Fading cards across every map (authoritative count). */
  count: number;
  /** Distinct maps with fading cards. */
  packTitles: string[];
  /** The named cards we know about (weakest first). */
  stops: FadingStop[];
}

/** "About N minutes" for a relight of `count` cards (8 items ≈ 5 minutes, one item per card at least). */
export function relightMinutes(count: number): number {
  return Math.min(5, Math.max(1, Math.round((count * 5) / 8)));
}

/** The sentence: the size of the job, never a streak or guilt. "4 cards are fading · about 3 minutes" */
export function relightCopy(count: number, _packTitles: string[] = []): string {
  const minutes = relightMinutes(count);
  const time = minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
  return count === 1 ? `1 card is fading · ${time}` : `${count} cards are fading · ${time}`;
}

const SHOWN = 6;

/** The Relight strip (only when something is fading): embers you can turn back to gold. */
export function RelightStrip({ count, packTitles, stops }: RelightStripProps) {
  const shown = stops.slice(0, SHOWN);
  const more = count - shown.length;
  return (
    <section
      aria-labelledby="relight-strip-title"
      className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-md border border-line bg-surface py-4 pr-5 pl-4 shadow-1 dark:shadow-[var(--inset-dark)]"
    >
      <div aria-hidden className="relative flex h-14 shrink-0 items-center rounded-key bg-ember-soft px-3">
        {Array.from({ length: Math.min(count, 4) }, (_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: decorative cluster
            key={i}
            className="-ml-2 first:ml-0 rounded-pill bg-ember-soft"
            style={{ transform: `translateY(${i % 2 ? 4 : -4}px)` }}
          >
            <StopGlyph state="fading" size={26} decorative className="animate-flicker" />
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <h2 id="relight-strip-title" className="text-lead font-[560] text-ink">
          {relightCopy(count, packTitles)}
        </h2>
        {shown.length ? (
          <ul aria-label="Fading cards" className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-small text-ink-2">
            {shown.map((s) => (
              <li key={`${s.packId}/${s.nodeId}`} className="inline-flex items-center gap-1.5">
                <StopGlyph state="fading" size={14} decorative />
                <Link
                  to="/p/$pack"
                  params={{ pack: s.packId }}
                  search={{ card: s.nodeId }}
                  className="underline-offset-2 hover:text-ink hover:underline"
                  title={s.packTitle}
                >
                  {s.title}
                </Link>
              </li>
            ))}
            {more > 0 ? <li className="text-ink-3">and {more} more</li> : null}
          </ul>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <WhyThisWorks
          title="Relight"
          line="Reviews arrive just before you'd forget, and mixing cards makes each one stick better than drilling one at a time."
          evidence="strong"
          citation="Cepeda et al. (2006); Rohrer & Taylor (2007)"
        />
        <Link to="/relight" className={buttonClass({ variant: "primary", size: "lg" })} aria-keyshortcuts="R">
          Relight
          <KbdHint keyLabel="R" inverted />
        </Link>
      </div>
    </section>
  );
}
