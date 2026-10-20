/**
 * The Continue hero: the most recently opened map with anything left to do, drawn live
 * as a MiniMap, and the way back in: "You left off with:" plus the teaser of the last card you
 * closed (a question, not a progress bar). The primary button opens the next card in map order
 * directly, the checkpoint when the section is complete, or resumes an open run at its beat.
 */
import {
  type CompiledPack,
  type InstalledPackSummary,
  type PackProgress,
  type RunState,
  sections,
} from "@learncroc/core";
import { MiniMap } from "@learncroc/maps";
import { buttonClass, KbdHint } from "@learncroc/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../api/client";
import { qk } from "../../app/queries";
import { Inline } from "../../lib/inline";
import { gateCounts, PosterFrame, progressLine, stateCounts } from "./posterKit";

export interface ContinueTarget {
  href: string;
  label: string;
}

/** The last card the learner closed on this map (by doneAt), if any. */
export function lastClosed(pack: CompiledPack, progress: PackProgress): string | undefined {
  let best: { id: string; at: number } | undefined;
  for (const p of Object.values(progress.nodes)) {
    if (p.status === "started" || !pack.nodes[p.nodeId]) continue;
    const at = p.doneAt ?? p.litAt ?? 0;
    if (!best || at > best.at) best = { id: p.nodeId, at };
  }
  return best?.id;
}

/** What the hero's primary button does. */
export function continueTarget(
  summary: InstalledPackSummary,
  pack: CompiledPack | undefined,
  progress: PackProgress | undefined,
  run: RunState | undefined,
): ContinueTarget {
  const open = progress?.openRun;
  if (open?.target && pack) {
    const entry = pack.map.nodes[open.target];
    if (open.kind === "checkpoint" && entry) {
      return {
        href: `/p/${summary.id}?checkpoint=${encodeURIComponent(open.target)}`,
        label: `Resume: Checkpoint: ${entry.title}`,
      };
    }
    if (open.kind === "card" && entry) {
      const node = pack.nodes[open.target];
      const beats = node?.screens.length ?? 0;
      const beat = run?.cursor.phase === "screen" && run.cursor.screen !== undefined && beats ? " · In progress" : "";
      return {
        href: `/p/${summary.id}?card=${encodeURIComponent(open.target)}`,
        label: `Resume: ${entry.title}${beat}`,
      };
    }
  }
  const next = summary.next;
  if (next) {
    const kind = pack?.map.nodes[next.nodeId]?.kind;
    return kind === "checkpoint"
      ? { href: `/p/${summary.id}?checkpoint=${encodeURIComponent(next.nodeId)}`, label: `Checkpoint: ${next.title}` }
      : { href: `/p/${summary.id}?card=${encodeURIComponent(next.nodeId)}`, label: `Next card: ${next.title}` };
  }
  return { href: `/p/${summary.id}`, label: "Open the map" };
}

/** "Section 2 · The guessing loop · 1 of 3 cards done" for the section holding `nodeId`. */
export function sectionLine(pack: CompiledPack, progress: PackProgress | undefined, nodeId: string | undefined) {
  if (!nodeId) return null;
  const secs = sections(pack.map);
  const sec = secs.find((s) => s.checkpoint === nodeId || s.cards.includes(nodeId));
  if (!sec) return null;
  const title = pack.map.nodes[sec.checkpoint]?.title ?? "";
  const done = sec.cards.filter((c) => {
    const st = progress?.views[c]?.state;
    return st === "done" || st === "lit" || st === "fading";
  }).length;
  return `Section ${sec.index + 1}${title ? ` · ${title}` : ""} · ${done} of ${sec.cards.length} cards done`;
}

export interface ContinueHeroProps {
  summary: InstalledPackSummary;
  pack?: CompiledPack;
  progress?: PackProgress;
  /** "Start here" (the continue map is finished; this is the next unstarted map). */
  fresh?: boolean;
}

export function ContinueHero({ summary, pack, progress, fresh }: ContinueHeroProps) {
  const openRunId = progress?.openRun?.kind === "card" ? progress.openRun.runId : undefined;
  const run = useQuery({
    queryKey: qk.run(openRunId ?? ""),
    queryFn: () => api.getRun({ runId: openRunId ?? "" }),
    enabled: !!openRunId,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const target = fresh
    ? (() => {
        const s = pack?.manifest.entry.suggestedStart;
        return s
          ? { href: `/p/${summary.id}?card=${encodeURIComponent(s)}`, label: "Start here" }
          : { href: `/p/${summary.id}`, label: "Start here" };
      })()
    : continueTarget(summary, pack, progress, run.data?.run);
  const closed = pack && progress && !fresh ? lastClosed(pack, progress) : undefined;
  const teaser = closed ? pack?.nodes[closed]?.close.teaser : undefined;
  const nextId = progress?.openRun?.target ?? summary.next?.nodeId;
  const section = pack ? sectionLine(pack, progress, nextId) : null;
  const counts = stateCounts(summary, progress?.views);
  const gates = gateCounts(pack, progress?.views, summary.checkpoints);
  // Nothing closed yet: the question the next card asks (its hook prompt) is the way back in.
  const hookId = fresh ? pack?.manifest.entry.suggestedStart : nextId;
  const hookEntry = hookId ? pack?.map.nodes[hookId] : undefined;
  const hook = hookEntry?.kind === "node" ? hookEntry.teaser : undefined;

  return (
    <section aria-labelledby="continue-title" className="mb-12">
      <h2 className="sr-only" id="continue-title">
        Continue: {summary.title}
      </h2>
      <PosterFrame theme={summary.theme} className="grid shadow-2 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="relative min-h-[240px] p-6 [&_svg]:h-full [&_svg]:w-full">
          <p className="absolute top-5 left-6 text-micro tracking-[0.08em] text-w-ink-2 uppercase">Continue</p>
          {pack ? (
            <Link
              to="/p/$pack"
              params={{ pack: summary.id }}
              aria-label={`Open the map: ${summary.title}`}
              className="block h-full min-h-[220px] rounded-md pt-6"
            >
              <MiniMap
                pack={pack}
                views={progress?.views ?? {}}
                {...(nextId ? { focusId: nextId, tokenAt: nextId } : {})}
                width={pack.map.layout.width}
                height={pack.map.layout.height}
              />
            </Link>
          ) : null}
        </div>
        <div className="flex flex-col justify-center gap-4 p-8 md:pl-2">
          <div>
            <p className="voice-casual text-small text-w-ink-2">
              {summary.title} · {summary.theme.world}
            </p>
            {section ? <p className="mt-1 text-small text-w-ink-2">{section}</p> : null}
          </div>
          {teaser ? (
            <div className="grid gap-1.5">
              <p className="text-small text-w-ink-2">You left off with:</p>
              <p className="voice-guide max-w-[48ch] text-lead text-w-ink">
                <Inline text={teaser} />
              </p>
            </div>
          ) : hook ? (
            <p className="voice-guide max-w-[48ch] text-lead text-w-ink">{hook}</p>
          ) : (
            <p className="t-heading text-w-ink">{summary.title}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-1">
            <Link to={target.href} className={buttonClass({ variant: "primary", size: "lg" })} aria-keyshortcuts="C">
              {target.label}
              <KbdHint keyLabel="⏎" inverted />
            </Link>
            <Link
              to="/p/$pack"
              params={{ pack: summary.id }}
              className="text-small text-w-ink underline decoration-1 underline-offset-2"
            >
              Open the map
            </Link>
          </div>
          {!fresh && counts.lit + counts.done > 0 ? (
            <p className="tabular text-micro text-w-ink-2">{progressLine(counts.lit, counts.playable, gates)}</p>
          ) : null}
        </div>
      </PosterFrame>
    </section>
  );
}
