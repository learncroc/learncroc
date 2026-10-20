/**
 * "Your route": the scannable, accessible path through the map. 320 px, collapsible
 * with `]` (persisted), open by default at ≥ 1280 px. Progress beads (lit count), then the sections in
 * map order: the current section is expanded, earlier open sections fold to one line ("Open"), later
 * ones read "3 cards · Later" and expand on click. Card rows show the state word (and "Beat 2 of 3"
 * for the card in progress); a Locked gate row says what is missing. Rows that can play open the modal;
 * the rest open the peek.
 */
import type { CompiledPack, NodeId, NodeView, PackProgress, RunState } from "@learncroc/core";
import { cn, StopGlyph, stateLabel } from "@learncroc/ui";
import { CaretDown, CaretRight, SidebarSimple } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { runQueryKey } from "../../run/queries";
import { type MapCounts, type RouteRow, type RouteSection, routeSections } from "./mapLogic";

export interface RoutePanelProps {
  pack: Pick<CompiledPack, "manifest" | "map" | "nodes">;
  views: Record<NodeId, NodeView>;
  progress: PackProgress | undefined;
  counts: MapCounts;
  onOpen(id: NodeId, anchor?: Element): void;
  onCollapse(): void;
}

/** Where the open card's run is ("At the question", "Card 3 of 6"). */
function useOpenRunStep(
  pack: RoutePanelProps["pack"],
  views: Record<NodeId, NodeView>,
  progress: PackProgress | undefined,
): Record<NodeId, string> {
  const open = progress?.openRun?.kind === "card" ? progress.openRun : undefined;
  const q = useQuery<RunState>({
    queryKey: runQueryKey(open?.runId ?? ""),
    queryFn: async () => (await api.getRun({ runId: open?.runId ?? "" })).run,
    enabled: Boolean(open?.runId),
    staleTime: 10_000,
    retry: false,
  });
  return useMemo(() => {
    const run = q.data;
    const target = open?.target;
    // Only a card that is still In progress shows its step (a stale open run never overrides Done).
    if (!run || !target || run.finishedAt !== undefined || views[target]?.state !== "in-progress") return {};
    const beats = pack.nodes[target]?.screens.length ?? 0;
    const c = run.cursor;
    if (c.phase === "hook") return { [target]: "At the question" };
    if (c.phase === "screen" && beats > 0) return { [target]: "In progress" };
    if (c.phase === "close") return { [target]: "At the takeaway" };
    return {};
  }, [q.data, open?.target, pack.nodes, views]);
}

function Row({
  row,
  step,
  onOpen,
  primary,
}: {
  row: RouteRow;
  step?: string;
  onOpen(e: Element): void;
  primary?: boolean;
}) {
  const gate = row.kind === "checkpoint";
  const label = step ?? stateLabel(row.kind, row.state);
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      data-route-row={row.id}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors duration-quick",
        primary ? "bg-sea-soft hover:bg-sea-soft/70" : "hover:bg-surface-2",
        (row.state === "locked" || row.state === "planned") && "text-ink-2",
      )}
    >
      <StopGlyph state={row.state} kind={row.kind} size={gate ? 18 : 16} decorative />
      <span className={cn("min-w-0 flex-1 truncate text-small", gate ? "font-[620]" : "", primary && "text-sea-text")}>
        {gate ? "Checkpoint" : row.title}
      </span>
      {row.revisit ? (
        <span className="rounded-pill border border-sea px-1.5 text-micro text-sea-text">Revisit</span>
      ) : null}
      <span
        className={cn(
          "shrink-0 text-micro tabular",
          row.state === "ready" || row.state === "in-progress" ? "text-sea-text" : "text-ink-3",
        )}
      >
        {label}
      </span>
    </button>
  );
}

function Section({
  section,
  expanded,
  onToggle,
  steps,
  onOpen,
}: {
  section: RouteSection;
  expanded: boolean;
  onToggle(): void;
  steps: Record<NodeId, string>;
  onOpen(id: NodeId, anchor: Element): void;
}) {
  const cards = section.rows.filter((r) => r.kind === "node");
  const summary =
    section.status === "open"
      ? "Open"
      : section.status === "later"
        ? `${cards.length} card${cards.length === 1 ? "" : "s"} · Later`
        : undefined;
  return (
    <li className="flex flex-col" data-route-section={section.index} data-status={section.status}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2"
      >
        {expanded ? (
          <CaretDown size={12} aria-hidden className="text-ink-3" />
        ) : (
          <CaretRight size={12} aria-hidden className="text-ink-3" />
        )}
        <span className="min-w-0 flex-1 truncate text-small font-[650] text-ink">
          <span className="tabular text-ink-3">{section.index} · </span>
          {section.title}
        </span>
        {summary ? (
          <span className={cn("shrink-0 text-micro", section.status === "open" ? "text-lumen-text" : "text-ink-3")}>
            {summary}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pl-3">
          {section.rows.map((r) => (
            <li key={r.id}>
              <Row
                row={r}
                {...(steps[r.id] ? { step: steps[r.id] } : {})}
                primary={r.kind === "checkpoint" && (r.state === "ready" || r.state === "in-progress")}
                onOpen={(el) => onOpen(r.id, el)}
              />
              {r.kind === "checkpoint" && section.missing ? (
                <p className="m-0 pr-2 pb-1 pl-9 text-micro text-ink-3">{section.missing}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function RoutePanel({ pack, views, progress, counts, onOpen, onCollapse }: RoutePanelProps) {
  const sections = useMemo(() => routeSections(pack, views), [pack, views]);
  const steps = useOpenRunStep(pack, views, progress);
  const currentIndex = sections.find((s) => s.status === "current")?.index;
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  // The current section moves on when a gate opens: follow it unless the learner chose otherwise.
  useEffect(() => {
    if (currentIndex !== undefined) setExpanded((e) => ({ ...e, [currentIndex]: e[currentIndex] ?? true }));
  }, [currentIndex]);
  const lit = counts.lit + counts.fading;
  const cards = useMemo(
    () =>
      pack.map.topo.filter((id) => pack.map.nodes[id]?.kind === "node" && pack.map.nodes[id]?.status === "playable"),
    [pack.map],
  );

  return (
    <aside
      aria-label="Your route"
      className="flex h-full w-[320px] shrink-0 flex-col border-l border-line bg-surface"
      data-route-panel
    >
      <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="m-0 text-micro font-[700] tracking-[0.08em] text-ink-3 uppercase">Your route</h2>
        <button
          type="button"
          onClick={onCollapse}
          className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-small text-ink-2 hover:bg-surface-2"
          aria-label="Hide the route panel"
        >
          <SidebarSimple size={14} aria-hidden className="-scale-x-100" />
          <span aria-hidden className="text-micro text-ink-3">
            ]
          </span>
        </button>
      </header>
      <div className="flex items-center gap-3 px-4 pb-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-[3px]" aria-hidden>
          {cards.map((id) => {
            const s = views[id]?.state;
            return (
              <span
                key={id}
                className={cn(
                  "h-2 min-w-1.5 flex-1 rounded-[2px]",
                  s === "lit" ? "bg-lumen" : s === "fading" ? "bg-ember" : s === "done" ? "bg-ink-3" : "bg-line",
                )}
              />
            );
          })}
        </div>
        <span className="shrink-0 text-micro text-ink-2 tabular">
          {lit}/{counts.playable} lit
        </span>
      </div>
      <nav aria-label="Sections" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {sections.map((s) => (
            <Section
              key={s.index}
              section={s}
              expanded={expanded[s.index] ?? s.status === "current"}
              onToggle={() => setExpanded((e) => ({ ...e, [s.index]: !(e[s.index] ?? s.status === "current") }))}
              steps={steps}
              onOpen={(id, el) => onOpen(id, el)}
            />
          ))}
        </ol>
        {counts.planned > 0 ? (
          <p className="m-0 mt-3 px-2 text-micro text-ink-3">
            Planned: {counts.planned} more card{counts.planned === 1 ? "" : "s"}
          </p>
        ) : null}
      </nav>
    </aside>
  );
}
