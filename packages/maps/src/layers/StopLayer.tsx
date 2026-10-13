/**
 * StopLayer: real <button>s over the renderer's SVG for every card and gate (a11y, keyboard, focus,
 * labels and the hover peek).
 *
 * Lives in layout coordinates inside MapView's zoom/pan transform. Buttons are in reading order (line by
 * line) with a roving tabindex: Tab enters the map once (on the suggested card), arrow keys follow the
 * graph (→ dependent, ← prerequisite, ↑/↓ neighbouring line; a quarter turn on bottom-to-top maps),
 * Enter or a click opens, Space asks for the pinned peek, Home/End jump.
 *
 * Labels share the placement used by posters. Section fog only mutes: cards behind the next gate keep a
 * readable title in secondary ink; two or more gates away the title shows from 0.8× zoom, or on hover
 * or focus. Gates are labelled "Checkpoint" with "4 questions · Power check" under it. Hovering for
 * 300 ms shows a small peek: the hook for open cards, never for Later ones.
 */
import type { NodeId, RendererId } from "@learncroc/core";
import { cn, stateLabel } from "@learncroc/ui";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeStop, gateHint, listJoin } from "../lib/a11y";
import {
  finalGate,
  fogLevels,
  gateSize,
  mapGraph,
  type NavKey,
  navigate,
  readingOrder,
  unmetAncestors,
  viewFor,
} from "../lib/graph";
import { GATE_SUB_FONT, glyphSize, LABEL, placeLabels } from "../lib/labels";
import type { MapRendererProps, ScreenRect } from "../types";

export interface StopLayerProps extends MapRendererProps {
  selectedId?: NodeId;
  onSelect(nodeId: NodeId): void;
  onOpen(nodeId: NodeId): void;
  /** Space on an entry, or a click on one with nothing to open: pin its peek beside this screen rect. */
  onPeek?(nodeId: NodeId, rect: ScreenRect): void;
  onHover?(nodeId: NodeId | undefined): void;
  /** Keyboard focus moved to an entry (arrow keys or Tab). */
  onFocusStop?(nodeId: NodeId | undefined): void;
  /** The renderer actually drawn (after fallback); default theme.renderer. */
  renderer?: RendererId;
  /** Hide visible labels (mini maps). */
  hideLabels?: boolean;
  /** Imperative focus requests: focus this entry when the key changes. */
  focusRequest?: { id: NodeId; key: string };
}

const NAV_KEYS = new Set<string>(["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]);
const HIT = 44;
const DWELL_MS = 300;

/** Entries that open nothing (they peek): Later, Planned and Writing… cards, Locked gates. */
export function peeksOnly(state: string): boolean {
  return state === "locked" || state === "planned" || state === "building";
}

function rectOf(el: Element | undefined | null): ScreenRect {
  const r = el?.getBoundingClientRect();
  return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: 0, top: 0, width: 0, height: 0 };
}

/** The hook prompt shortened to about 30 words. */
function shortHook(text: string): string {
  const words = text.trim().split(/\s+/);
  return words.length <= 30 ? text.trim() : `${words.slice(0, 30).join(" ")}…`;
}

export function StopLayer(props: StopLayerProps) {
  const {
    pack,
    views,
    theme,
    fog,
    zoom,
    selectedId,
    onSelect,
    onOpen,
    onPeek,
    onHover,
    onFocusStop,
    hideLabels,
    focusRequest,
  } = props;
  const map = pack.map;
  const renderer = props.renderer ?? theme.renderer;
  const order = useMemo(() => readingOrder(map), [map]);
  const labels = placeLabels(map, renderer);
  const fogMap = useMemo(() => (fog ? fogLevels(map, views) : undefined), [fog, map, views]);
  const last = finalGate(map);
  const refs = useRef(new Map<NodeId, HTMLButtonElement>());
  const [peek, setPeek] = useState<NodeId | undefined>();
  const [reveal, setReveal] = useState<NodeId | undefined>();
  const dwell = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const firstOpen = useMemo(() => {
    const sugg = order.find((id) => views[id]?.suggested);
    return sugg ?? order.find((id) => viewFor(map, views, id).state === "ready") ?? order[0];
  }, [order, map, views]);
  const [active, setActive] = useState<NodeId | undefined>(selectedId ?? firstOpen);
  useEffect(() => {
    if (selectedId) setActive(selectedId);
  }, [selectedId]);
  useEffect(() => {
    if (!active || !map.nodes[active]) setActive(firstOpen);
  }, [active, firstOpen, map]);
  useEffect(() => {
    if (!focusRequest) return;
    setActive(focusRequest.id);
    refs.current.get(focusRequest.id)?.focus({ preventScroll: true });
  }, [focusRequest]);
  useEffect(() => () => clearTimeout(dwell.current), []);

  const focusStop = useCallback((id: NodeId) => {
    setActive(id);
    refs.current.get(id)?.focus({ preventScroll: true });
  }, []);

  // After a click the entry's own modal or pinned peek takes over: no hover peek until the pointer leaves.
  const quiet = useRef<NodeId | undefined>(undefined);
  const hoverIn = (id: NodeId) => {
    setReveal(id);
    onHover?.(id);
    clearTimeout(dwell.current);
    if (quiet.current !== id) dwell.current = setTimeout(() => setPeek(id), DWELL_MS);
  };
  const hoverOut = (id: NodeId) => {
    if (quiet.current === id) quiet.current = undefined;
    clearTimeout(dwell.current);
    setPeek((cur) => (cur === id ? undefined : cur));
    setReveal((cur) => (cur === id ? undefined : cur));
    onHover?.(undefined);
  };

  const activate = (id: NodeId) => {
    setActive(id);
    clearTimeout(dwell.current);
    quiet.current = id;
    setPeek(undefined);
    onSelect(id);
    const state = viewFor(map, views, id).state;
    if (peeksOnly(state)) onPeek?.(id, rectOf(refs.current.get(id)));
    onOpen(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, id: NodeId) => {
    if (NAV_KEYS.has(e.key)) {
      e.preventDefault();
      const next = navigate(map, id, e.key as NavKey);
      if (next) focusStop(next);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      activate(id);
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      clearTimeout(dwell.current);
      quiet.current = id;
      setPeek(undefined);
      onPeek?.(id, rectOf(refs.current.get(id)));
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const target = e.key === "Home" ? order[0] : order[order.length - 1];
      if (target) focusStop(target);
    }
  };

  const instructionsId = `${pack.manifest.id}-map-help`;
  const g = mapGraph(map);
  const title = (id: NodeId) => map.nodes[id]?.title ?? id;
  const detail = zoom >= 0.8;
  const cards = order.filter((id) => map.nodes[id]?.kind !== "checkpoint").length;
  const gates = order.length - cards;

  return (
    <section
      aria-label={`${theme.world}: ${cards} cards${gates ? `, ${gates} checkpoint${gates === 1 ? "" : "s"}` : ""}`}
      aria-describedby={instructionsId}
      className="absolute top-0 left-0"
      style={{ width: map.layout.width, height: map.layout.height }}
      data-layer="stops-a11y"
    >
      <p id={instructionsId} className="sr-only">
        Use arrow keys to follow the lines. Enter opens a card or a checkpoint. Space shows what it needs. Press L for a
        list view, M to show the whole map.
      </p>
      {order.map((id) => {
        const p = map.layout.nodes[id];
        const node = map.nodes[id];
        if (!p || !node) return null;
        const view = viewFor(map, views, id);
        const gate = node.kind === "checkpoint";
        const size = glyphSize(renderer, gate ? (id === last ? "final" : "gate") : "card", map.layout.direction);
        const w = Math.max(HIT, size.w + 12);
        const h = Math.max(HIT, size.h + 12);
        const level = fogMap?.get(id) ?? 0;
        const label = labels.get(id);
        const near = reveal === id || active === id;
        const showLabel =
          !hideLabels &&
          label &&
          (level < 2 || detail || near) &&
          (detail || gate || view.state === "ready" || view.state === "in-progress" || near);
        const muted = level > 0 || view.state === "locked" || view.state === "planned";
        const showPeek = peek === id && !hideLabels;
        return (
          <div key={id} className="contents">
            <button
              ref={(el) => {
                if (el) refs.current.set(id, el);
                else refs.current.delete(id);
              }}
              type="button"
              data-stop={id}
              data-kind={node.kind}
              data-state={view.state}
              data-fog={level}
              tabIndex={id === active ? 0 : -1}
              aria-label={describeStop(map, views, id)}
              aria-current={id === selectedId ? "true" : undefined}
              className={cn(
                "absolute cursor-pointer rounded-pill bg-transparent outline-none",
                "focus-visible:ring-[3px] focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--w-ground)]",
              )}
              style={{ left: p.x - w / 2, top: p.y - h / 2, width: w, height: h }}
              onClick={() => activate(id)}
              onKeyDown={(e) => onKeyDown(e, id)}
              onFocus={() => {
                setActive(id);
                setReveal(id);
                onFocusStop?.(id);
                // Arrow keys and Tab show the focused entry's peek too (after the same dwell).
                clearTimeout(dwell.current);
                if (quiet.current !== id) dwell.current = setTimeout(() => setPeek(id), DWELL_MS);
              }}
              onBlur={() => {
                setReveal((cur) => (cur === id ? undefined : cur));
                setPeek((cur) => (cur === id ? undefined : cur));
                onFocusStop?.(undefined);
              }}
              onMouseEnter={() => hoverIn(id)}
              onMouseLeave={() => hoverOut(id)}
            />
            {view.suggested && !hideLabels ? (
              <span
                aria-hidden
                className="pointer-events-none absolute rounded-pill border border-sea bg-sea-soft px-1.5 text-sea-text"
                style={{
                  left: p.x,
                  top: p.y - size.h / 2 - 22,
                  transform: "translateX(-50%)",
                  fontSize: 11,
                  lineHeight: "16px",
                  fontWeight: 600,
                }}
                data-badge="suggested"
              >
                Suggested
              </span>
            ) : null}
            {showLabel && label ? (
              <span
                aria-hidden
                data-label={id}
                className={cn(
                  "absolute cursor-pointer select-none text-center transition-[color,opacity] duration-500 [text-shadow:0_0_2px_var(--w-ground),0_0_5px_var(--w-ground),0_0_8px_var(--w-ground)]",
                  muted && !near ? "text-w-ink-2" : "text-w-ink",
                )}
                style={{
                  left: label.box.x,
                  top: label.box.y,
                  width: label.box.w,
                  fontSize: LABEL.font,
                  lineHeight: `${LABEL.lineHeight}px`,
                  fontWeight: gate ? 650 : view.state === "lit" ? 600 : 500,
                  fontStyle: view.state === "planned" ? "italic" : undefined,
                  textAlign: label.side === "right" ? "left" : label.side === "left" ? "right" : "center",
                  opacity: level === 2 && !near ? 0.8 : 1,
                }}
                onClick={() => activate(id)}
                onMouseEnter={() => hoverIn(id)}
                onMouseLeave={() => hoverOut(id)}
              >
                {label.lines.map((l, i) =>
                  label.gate && i > 0 ? (
                    <span
                      key={l}
                      className="block whitespace-nowrap text-w-ink-2"
                      style={{ fontSize: GATE_SUB_FONT, fontWeight: 500 }}
                    >
                      {l}
                    </span>
                  ) : (
                    <span key={l} className="block whitespace-nowrap">
                      {l}
                    </span>
                  ),
                )}
              </span>
            ) : null}
            {showPeek ? (
              <div
                aria-hidden
                data-peek={id}
                className="lm-pop-in pointer-events-none absolute z-10 w-60 rounded-md border border-line bg-surface p-3 text-left text-ink shadow-3"
                style={{ left: p.x - 120, top: p.y - size.h / 2 - 14, transform: "translateY(-100%)" }}
              >
                <p className="flex items-center justify-between gap-2">
                  <span className="text-small font-semibold">{gate ? "Checkpoint" : node.title}</span>
                  <span className="text-micro text-ink-3">{stateLabel(node.kind, view.state)}</span>
                </p>
                {peekBody(id)}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );

  function peekBody(id: NodeId) {
    const node = map.nodes[id];
    if (!node) return null;
    const view = viewFor(map, views, id);
    const s = view.state;
    const line = (text: string, casual = false) => (
      <p className={cn("mt-1 text-small", casual ? "voice-casual text-ink" : "text-ink-2")}>{text}</p>
    );
    if (node.kind === "checkpoint") {
      const n = gateSize(map, id);
      return (
        <>
          {line(`${node.title} · ${n} questions · pass with ${n - 1}`)}
          {s === "locked" ? line(gateHint(map, views, id).replace(" to open it.", " to open.")) : null}
          {s === "lit" || s === "done" || s === "fading" ? line("Open · passed") : null}
        </>
      );
    }
    if (node.status === "planned") return line(node.teaser || "Coming later.");
    if (s === "building") return line("Being written. Usually under a minute.");
    if (s === "ready" || s === "in-progress")
      return (
        <>
          {node.teaser ? line(shortHook(node.teaser), true) : null}
          {node.estMinutes ? (
            <p className="mt-1 text-micro text-ink-3 tabular">~{Math.round(node.estMinutes)} min</p>
          ) : null}
        </>
      );
    if (s === "done") return line("Done · lights at the next checkpoint");
    if (s === "lit") return line("Lit");
    if (s === "fading") return line("Fading · a Relight brings it back");
    // Later: never the hook (so it isn't spent before the card opens).
    const gateAhead = unmetAncestors(map, views, id).find((a) => map.nodes[a]?.kind === "checkpoint");
    if (gateAhead) return line(`Opens after Checkpoint: ${title(gateAhead)}`);
    const missing = view.missing.length ? view.missing : (g.prereqs.get(id) ?? []);
    return line(`Opens after ${listJoin(missing.map(title))}`);
  }
}
