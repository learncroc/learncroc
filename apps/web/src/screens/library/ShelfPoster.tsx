import type { CompiledPack, InstalledPackSummary, PackProgress } from "@learncroc/core";
import { MapBadge, MapPoster } from "@learncroc/maps";
import { cn, StatePill } from "@learncroc/ui";
import { Link } from "@tanstack/react-router";
import {
  gateCounts,
  LitMeter,
  POSTER_MAP_SLOT,
  PosterBadge,
  PosterFrame,
  progressLine,
  stateCounts,
} from "./posterKit";

export type PosterSize = "regular" | "subject" | "pocket";

export interface PosterProps {
  summary: InstalledPackSummary;
  pack?: CompiledPack;
  progress?: PackProgress;
  /**
   * regular: Your maps (opens the map). subject: a map not started yet (opens it with its first card's
   * hook up, `?card=<suggestedStart>`). pocket: a small article-map poster.
   */
  size: PosterSize;
  /** Grid classes override (the first-run row is three across). */
  className?: string;
}

/** Where the "next" card leads: the map with that card (or checkpoint) open. */
export function nextStopHref(summary: InstalledPackSummary, pack?: CompiledPack): string | null {
  const next = summary.next;
  if (!next) return null;
  const kind = pack?.map.nodes[next.nodeId]?.kind;
  return `/p/${summary.id}?${kind === "checkpoint" ? "checkpoint" : "card"}=${encodeURIComponent(next.nodeId)}`;
}

/** The card a fresh map opens on: its suggested start, else the summary's next card. */
export function startCardOf(summary: InstalledPackSummary, pack?: CompiledPack): string | undefined {
  const s = pack?.manifest.entry.suggestedStart;
  if (s && pack?.map.nodes[s]?.kind === "node") return s;
  if (summary.next && pack?.map.nodes[summary.next.nodeId]?.kind !== "checkpoint") return summary.next.nodeId;
  return undefined;
}

/** About how long a map takes: the sum of its cards' minutes, rounded to 5. */
export function mapMinutes(pack?: CompiledPack): number | undefined {
  if (!pack) return undefined;
  const sum = Object.values(pack.nodes).reduce((n, node) => n + node.estMinutes, 0);
  return sum > 0 ? Math.max(5, Math.round(sum / 5) * 5) : undefined;
}

/**
 * One map on the shelf: the pack's real map on its own ground, then a plate with the world name,
 * the title and "6 of 11 cards lit · 2 of 4 checkpoints open". A finished map carries its badge in
 * the corner. The whole poster is one link.
 */
export function Poster({ summary, pack, progress, size, className }: PosterProps) {
  const invalid = summary.status === "invalid";
  const building = summary.status === "building";
  const counts = stateCounts(summary, progress?.views);
  const gates = gateCounts(pack, progress?.views, summary.checkpoints);
  const started = counts.lit + counts.done > 0 || summary.lastOpenedAt !== undefined;
  const subject = size === "subject";
  const startCard = subject ? startCardOf(summary, pack) : undefined;
  const site =
    pack?.manifest.origin?.kind === "url" ? (pack.manifest.origin.site ?? pack.manifest.origin.title) : undefined;
  const minutes = mapMinutes(pack);

  const status = invalid
    ? "This map didn't build."
    : building
      ? "Still being written. The first cards are playable."
      : subject || !started
        ? [
            `${summary.playable} ${summary.playable === 1 ? "card" : "cards"}`,
            gates.total ? `${gates.total} ${gates.total === 1 ? "checkpoint" : "checkpoints"}` : null,
            minutes ? `about ${minutes} minutes` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : progressLine(counts.lit, counts.playable, gates);

  return (
    <article
      data-poster={summary.id}
      aria-labelledby={`poster-${summary.id}`}
      className={cn(
        "group/poster relative",
        className ??
          (size === "pocket" ? "col-span-6 md:col-span-4 xl:col-span-3" : "col-span-12 sm:col-span-6 lg:col-span-4"),
      )}
    >
      <PosterFrame
        theme={summary.theme}
        muted={invalid}
        className={cn(
          "flex h-full flex-col justify-between shadow-2 ring-0",
          "ring-focus transition-[box-shadow,transform] duration-base ease-out",
          "group-has-[[data-poster-link]:focus-visible]/poster:ring-[3px] group-has-[[data-poster-link]:focus-visible]/poster:ring-offset-2 group-has-[[data-poster-link]:focus-visible]/poster:ring-offset-bg",
          !invalid && "group-hover/poster:-translate-y-0.5 group-hover/poster:shadow-3",
          size === "pocket" && "rounded-md",
        )}
      >
        <div
          className={cn(
            "grid place-items-center",
            POSTER_MAP_SLOT,
            size === "pocket" ? "h-[132px] px-4 pt-4" : "h-[240px] px-6 pt-6",
            invalid && "opacity-40",
          )}
        >
          {pack ? (
            <MapPoster
              pack={pack}
              views={progress?.views ?? {}}
              width={pack.map.layout.width}
              height={pack.map.layout.height}
              showTitle={false}
            />
          ) : (
            <span className="text-small text-w-ink-2">{summary.theme.world}</span>
          )}
        </div>
        {summary.finished && pack ? (
          <div className="pointer-events-none absolute top-3 right-3 drop-shadow-md">
            <MapBadge
              pack={pack}
              cards={summary.playable}
              size={size === "pocket" ? 44 : 64}
              {...(summary.finishedAt ? { finishedAt: summary.finishedAt } : {})}
            />
          </div>
        ) : null}
        <div
          className={cn(
            "flex flex-none flex-col",
            size === "pocket" ? "gap-1.5 px-4 pt-2 pb-4" : "gap-2 px-6 pt-3 pb-6",
          )}
        >
          <p className="voice-casual text-small text-w-ink-2">{summary.theme.world}</p>
          <h3
            id={`poster-${summary.id}`}
            className={cn("text-w-ink", size === "pocket" ? "text-body font-semibold" : "text-heading")}
            style={{ fontVariationSettings: '"CASL" 0.5' }}
          >
            <Link
              to="/p/$pack"
              params={{ pack: summary.id }}
              {...(startCard ? { search: { card: startCard } } : {})}
              data-poster-link
              disabled={invalid}
              className="rounded-xs outline-none after:absolute after:inset-0 after:rounded-stage after:content-['']"
            >
              {summary.title}
            </Link>
          </h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {building ? <StatePill state="building" /> : null}
            <p className="tabular text-small text-w-ink-2">
              {summary.finished ? "Finished · " : ""}
              {status}
            </p>
          </div>
          {!invalid && !building && !subject && started && counts.playable > 0 ? (
            <LitMeter lit={counts.lit} fading={counts.fading} done={counts.done} total={counts.playable} />
          ) : null}
          {size !== "pocket" && (summary.review === "draft" || summary.customInteractives) ? (
            <div className="flex flex-wrap gap-2">
              {summary.review === "draft" && summary.kind === "pack" ? (
                <PosterBadge title="Written with AI help; a named human reviewer hasn't signed it off yet.">
                  AI-drafted, review pending
                </PosterBadge>
              ) : null}
              {summary.customInteractives ? <PosterBadge>Custom interactive</PosterBadge> : null}
            </div>
          ) : null}
          {size === "pocket" && summary.review === "draft" && summary.tier === "local" ? (
            <p className="truncate text-micro text-w-ink-2">AI-drafted{site ? ` from ${site}` : ""}</p>
          ) : null}
        </div>
      </PosterFrame>
    </article>
  );
}
