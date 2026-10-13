/**
 * ListView (L): the map as an accessible treegrid, one group per section ("Section 1 · Text in"), one
 * row per card and a row for the section's checkpoint, with columns for state, needs and time (03 §3.4,
 * §6). The screen-reader primary view, and handy for planners. Maps without checkpoints group by line.
 *
 * Keyboard (treegrid pattern, row focus): ↑/↓ move between visible rows, → expands a section or moves
 * to its first card, ← collapses a section or returns to it, Home/End jump, Enter opens.
 */
import type { NodeId } from "@learncroc/core";
import { cn, STATE_LABEL, StopGlyph, stateLabel } from "@learncroc/ui";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { describeStop, gateHint, gateName, listJoin } from "./lib/a11y";
import { finalGate, gateSize, isLitLike, mapGraph, sectionIndex, sectionsOf, viewFor } from "./lib/graph";
import type { ListViewProps } from "./types";

type Row = { kind: "line"; id: string; lineIndex: number } | { kind: "stop"; id: NodeId; line: string };

interface Group {
  id: string;
  title: string;
  stops: NodeId[];
}

export function ListView({ pack, views, selectedId, onSelect, onOpen }: ListViewProps) {
  const map = pack.map;
  const g = mapGraph(map);
  const groups = useMemo((): Group[] => {
    const secs = sectionsOf(map);
    if (secs.length === 0) {
      return map.lines.map((line) => {
        const along = map.layout.lines[line.id] ?? [];
        const rest = map.topo.filter((id) => map.nodes[id]?.line === line.id && !along.includes(id));
        return { id: line.id, title: line.title, stops: [...along, ...rest].filter((id) => map.nodes[id]) };
      });
    }
    const idx = sectionIndex(map);
    const out: Group[] = secs.map((sec, i) => ({
      id: `section-${i + 1}`,
      title: `Section ${i + 1} · ${map.nodes[sec.checkpoint]?.title ?? "Checkpoint"}`,
      stops: [],
    }));
    const beyond: Group = { id: "beyond", title: "Further on", stops: [] };
    const gates = new Set(secs.map((sec) => sec.checkpoint));
    for (const id of map.topo) {
      if (!map.nodes[id] || gates.has(id)) continue;
      const i = idx.get(id) ?? secs.length;
      (out[i] ?? beyond).stops.push(id);
    }
    secs.forEach((sec, i) => {
      out[i]?.stops.push(sec.checkpoint);
    });
    return beyond.stops.length ? [...out, beyond] : out;
  }, [map]);
  const last = finalGate(map);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows: Row[] = [];
  groups.forEach((gr, lineIndex) => {
    rows.push({ kind: "line", id: gr.id, lineIndex });
    if (!collapsed.has(gr.id)) for (const id of gr.stops) rows.push({ kind: "stop", id, line: gr.id });
  });
  const rowKey = (r: Row) => `${r.kind}:${r.id}`;
  const [active, setActive] = useState<string>(selectedId ? `stop:${selectedId}` : rows[0] ? rowKey(rows[0]) : "");
  const activeKey = rows.some((r) => rowKey(r) === active) ? active : rows[0] ? rowKey(rows[0]) : "";
  const refs = useRef(new Map<string, HTMLTableRowElement>());

  const focusRow = (key: string) => {
    setActive(key);
    refs.current.get(key)?.focus();
  };
  const toggle = (lineId: string, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const isOpen = !next.has(lineId);
      if (open ?? !isOpen) next.delete(lineId);
      else next.add(lineId);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, r: Row, i: number) => {
    const key = e.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      e.preventDefault();
      const next = rows[i + (key === "ArrowDown" ? 1 : -1)];
      if (next) focusRow(rowKey(next));
    } else if (key === "Home" || key === "End") {
      e.preventDefault();
      const next = key === "Home" ? rows[0] : rows[rows.length - 1];
      if (next) focusRow(rowKey(next));
    } else if (key === "ArrowRight") {
      e.preventDefault();
      if (r.kind === "line") {
        if (collapsed.has(r.id)) toggle(r.id, true);
        else {
          const child = rows[i + 1];
          if (child?.kind === "stop") focusRow(rowKey(child));
        }
      }
    } else if (key === "ArrowLeft") {
      e.preventDefault();
      if (r.kind === "line") toggle(r.id, false);
      else focusRow(`line:${r.line}`);
    } else if (key === "Enter" || key === " ") {
      e.preventDefault();
      if (r.kind === "line") toggle(r.id);
      else if (key === "Enter") onOpen(r.id);
      else onSelect(r.id);
    }
  };

  const title = (id: NodeId) => map.nodes[id]?.title ?? id;
  const th = "px-3 py-2 text-left text-micro text-ink-3 font-semibold";
  const cell = "px-3 py-2";

  return (
    // The WAI-ARIA treegrid pattern on a native table: rows and cells get their roles from the table.
    <table
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a treegrid is a table with tree semantics (APG pattern).
      role="treegrid"
      aria-label={`${pack.manifest.title}: cards by section`}
      aria-readonly="true"
      className="w-full border-collapse text-small text-ink"
      data-view="list"
    >
      <thead>
        <tr>
          <th scope="col" className={th}>
            Card
          </th>
          <th scope="col" className={th}>
            State
          </th>
          <th scope="col" className={th}>
            Needs
          </th>
          <th scope="col" className={cn(th, "text-right")}>
            Time
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const key = rowKey(r);
          if (r.kind === "line") {
            const gr = groups[r.lineIndex];
            if (!gr) return null;
            const open = !collapsed.has(r.id);
            const cards = gr.stops.filter((id) => map.nodes[id]?.kind !== "checkpoint");
            const lit = cards.filter((id) => isLitLike(viewFor(map, views, id).state)).length;
            const playable = cards.filter((id) => map.nodes[id]?.status === "playable").length;
            return (
              <tr
                key={key}
                ref={(el) => {
                  if (el) refs.current.set(key, el);
                  else refs.current.delete(key);
                }}
                aria-level={1}
                aria-expanded={open}
                aria-posinset={r.lineIndex + 1}
                aria-setsize={groups.length}
                tabIndex={key === activeKey ? 0 : -1}
                onKeyDown={(e) => onKeyDown(e, r, i)}
                onFocus={() => setActive(key)}
                onClick={() => toggle(r.id)}
                className="cursor-pointer border-t border-line bg-surface-2 outline-none focus-visible:ring-[3px] focus-visible:ring-focus focus-visible:ring-inset"
              >
                <td colSpan={4} className={cell}>
                  <span aria-hidden className="mr-2 inline-block w-3 text-ink-3">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="font-semibold">{gr.title}</span>
                  <span className="ml-2 text-ink-3 tabular">{playable ? `${lit} of ${playable} lit` : "Planned"}</span>
                </td>
              </tr>
            );
          }
          const node = map.nodes[r.id];
          if (!node) return null;
          const view = viewFor(map, views, r.id);
          const gate = node.kind === "checkpoint";
          const needs = (g.prereqs.get(r.id) ?? []).map((n) =>
            map.nodes[n]?.kind === "checkpoint" ? gateName(map, n) : title(n),
          );
          const siblings = groups.find((gr) => gr.id === r.line)?.stops ?? [];
          const size = gate ? gateSize(map, r.id) : 0;
          return (
            <tr
              key={key}
              ref={(el) => {
                if (el) refs.current.set(key, el);
                else refs.current.delete(key);
              }}
              aria-level={2}
              aria-posinset={siblings.indexOf(r.id) + 1}
              aria-setsize={siblings.length}
              aria-selected={r.id === selectedId}
              aria-label={describeStop(map, views, r.id)}
              tabIndex={key === activeKey ? 0 : -1}
              data-stop={r.id}
              data-state={view.state}
              onKeyDown={(e) => onKeyDown(e, r, i)}
              onFocus={() => setActive(key)}
              onClick={() => {
                setActive(key);
                onSelect(r.id);
              }}
              onDoubleClick={() => onOpen(r.id)}
              className={cn(
                "cursor-pointer border-t border-line outline-none hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-focus focus-visible:ring-inset",
                r.id === selectedId && "bg-sea-soft",
              )}
            >
              <td className={cn(cell, "pl-8")}>
                <span className="inline-flex items-center gap-2">
                  <StopGlyph
                    state={view.state}
                    kind={node.kind}
                    final={gate && r.id === last}
                    durable={view.durable}
                    size={18}
                    decorative
                  />
                  <span className={cn(view.state === "planned" && "italic", gate && "font-semibold")}>
                    {gate ? gateName(map, r.id) : node.title}
                  </span>
                  {view.revisit && !gate ? (
                    <span className="rounded-pill border border-sea px-1.5 text-micro text-sea-text">Revisit</span>
                  ) : null}
                  {view.suggested ? (
                    <span className="rounded-pill border border-sea bg-sea-soft px-1.5 text-micro text-sea-text">
                      Suggested
                    </span>
                  ) : null}
                </span>
              </td>
              <td className={cn(cell, "text-ink-2")}>
                {stateLabel(node.kind, view.state)}
                {view.durable ? ` · ${STATE_LABEL.durable}` : ""}
              </td>
              <td className={cn(cell, "text-ink-2")}>
                {gate
                  ? view.state === "locked"
                    ? gateHint(map, views, r.id)
                    : `Pass with ${size - 1} of ${size}`
                  : needs.length
                    ? listJoin(needs)
                    : "Nothing"}
              </td>
              <td className={cn(cell, "text-right text-ink-2 tabular")}>
                {gate
                  ? node.status === "playable"
                    ? `${size} questions`
                    : ""
                  : node.estMinutes && node.status === "playable"
                    ? `${Math.round(node.estMinutes)} min`
                    : ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
