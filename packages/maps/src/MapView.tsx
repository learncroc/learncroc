/**
 * MapView: renderer + effects + StopLayer inside a zoom/pan viewport, plus a screen-space overlay (Moss).
 *
 * Owns the map-local state the contract leaves to it: zoom and pan (F fit, +/− zoom, wheel, drag), the
 * section veil (M held, or Shift+M latched, shows the whole map), hover, keyboard focus, the travelling
 * token, the camera (frames the current section on open, follows `frame`, stays out of the way for 6 s
 * after the learner moves the map) and the map moments:
 *
 * - `cardDone` (≤ 900 ms, never gold): a tick burst at the card, the track to the next card is laid,
 *   the token travels there and the next card pulses once.
 * - `gateOpen` (≈ 5 s, the headline): frame the section, light the covered cards one by one with Lumen
 *   flowing between them, swing the gate open, power its out-edges, roll the veil back, wake the newly
 *   Ready cards with a Sea ripple, then the token travels to the next card. While it plays the map shows
 *   the state before the pass and steps it forward; any key, click or wheel skips to the end.
 * - `revisit`: a Sea route from the gate back to the cards worth a second look (marches once, then stays
 *   until one of them or the gate is opened).
 * - `lightUp` (Relight returns): cards light in sequence.
 *
 * Each moment reports its key through `onMomentDone` and says what changed through the shared live
 * region. Reduced motion: camera jumps, a crossfade to the end state, short "+ brighter" / "Ready" labels.
 *
 * Variants: "full" (the map screen), "poster" (static, fitted, not interactive), "mini" (small, no labels,
 * still clickable). A renderer that throws falls back to metro; so does a graph with more than 60 nodes.
 */
import type { CompiledMap, NodeId, NodeState, NodeView, RendererId } from "@learncroc/core";
import { cn, useReducedMotion } from "@learncroc/ui";
import {
  Component,
  type ErrorInfo,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type EffectItem, EffectsLayer } from "./layers/EffectsLayer";
import { StopLayer } from "./layers/StopLayer";
import { MapViewportContext } from "./layers/viewport";
import { announceMap, describeChanges, listJoin } from "./lib/a11y";
import { worldStyle } from "./lib/color";
import { linePath, type Pt, pointAt, polylineLength } from "./lib/geometry";
import { gateCovers, isLitLike, mapGraph, nextGate, readingOrder, satisfies, tokenPath, viewFor } from "./lib/graph";
import { buildScene, ROUTE_STYLE, routeThrough } from "./lib/scene";
import { easeInOut, tween } from "./lib/tween";
import { type MapWindow, useZoomPan } from "./lib/useZoomPan";
import { TokenArt } from "./renderers/glyphs";
import { RENDERERS, resolveRenderer } from "./renderers/index";
import { TOKEN_OFFSET } from "./renderers/token";
import type { MapRendererProps, MapViewProps } from "./types";

type Override = Record<NodeId, NodeState>;

interface RunningMoment {
  key: number;
  kind: "cardDone" | "gateOpen" | "revisit";
  timers: ReturnType<typeof setTimeout>[];
  finished: boolean;
  /** Jump to the end state now (skip) or at the scheduled end. */
  finish(skipped: boolean): void;
}

const EMPTY_OVERRIDE: Override = {};

export function MapView(props: MapViewProps) {
  const { pack, views, selectedId, onSelect, onOpen, onPeek, variant, lightUp, cardDone, gateOpen, revisit } = props;
  const { overlay, onMomentDone, frame } = props;
  const map = pack.map;
  const theme = pack.manifest.theme;
  const reducedMotion = useReducedMotion();
  const [failed, setFailed] = useState<RendererId | undefined>();
  const requested = resolveRenderer(theme.renderer, map);
  const renderer: RendererId = failed === requested ? "metro" : requested;
  const scene = buildScene(map, ROUTE_STYLE[renderer], pack.manifest.id);
  const interactive = variant === "full";
  const zp = useZoomPan(map.layout.width, map.layout.height, interactive);
  const zpRef = useRef(zp);
  zpRef.current = zp;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const zpSetEl = zp.ref;
  const setHost = useCallback(
    (el: HTMLDivElement | null) => {
      hostRef.current = el;
      zpSetEl(el);
    },
    [zpSetEl],
  );
  // The veil: M held shows the whole map; Shift+M (or the button) latches it.
  const [held, setHeld] = useState(false);
  const [latched, setLatched] = useState(false);
  const veil = !(held || latched);
  const [hoverId, setHoverId] = useState<NodeId | undefined>();
  const [focusId, setFocusId] = useState<NodeId | undefined>();
  const [layoutHost, setLayoutHost] = useState<HTMLDivElement | null>(null);
  const [screenHost, setScreenHost] = useState<HTMLDivElement | null>(null);

  // ── the views the map draws: the learner's, with a moment's "before" states laid over them.
  const [override, setOverride] = useState<Override>(EMPTY_OVERRIDE);
  const shown = useMemo(() => applyOverride(map, views, override), [map, views, override]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const viewsRef = useRef(views);
  viewsRef.current = views;

  // ── token: parked at the last card touched; travels along the drawn track.
  const initialToken = useMemo(() => pickTokenStop(map, views, selectedId), [map, views, selectedId]);
  const [tokenAt, setTokenAt] = useState<NodeId | undefined>(initialToken);
  const [travel, setTravel] = useState<{ points: Pt[]; t: number } | undefined>();
  const tokenRef = useRef(tokenAt);
  tokenRef.current = tokenAt;
  const travelCancel = useRef<() => void>(() => {});
  useEffect(() => {
    if (!tokenRef.current && initialToken) setTokenAt(initialToken);
  }, [initialToken]);

  const travelTo = useCallback(
    (from: NodeId | undefined, to: NodeId, maxMs: number) => {
      travelCancel.current();
      if (!from || from === to || reducedMotion || variant !== "full") {
        setTokenAt(to);
        return;
      }
      const points = routeThrough(scene, tokenPath(map, viewsRef.current, from, to));
      const duration = Math.max(300, Math.min(maxMs, 260 + polylineLength(points) * 0.9));
      setTokenAt(undefined);
      travelCancel.current = tween({
        duration,
        ease: easeInOut,
        onUpdate: (t) => setTravel({ points, t }),
        onComplete: () => {
          setTravel(undefined);
          setTokenAt(to);
        },
      });
    },
    [scene, map, reducedMotion, variant],
  );
  useEffect(
    () => () => {
      travelCancel.current();
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: travel only when the selection changes (views change on every refetch).
  useEffect(() => {
    if (!selectedId || !map.nodes[selectedId]) return;
    const state = viewFor(map, views, selectedId).state;
    if (state === "locked" || state === "planned" || state === "building") return;
    travelTo(tokenRef.current, selectedId, 900);
  }, [selectedId]);

  // ── effects: one-shot items, the revisit route and the route to a Later card.
  const [items, setItems] = useState<EffectItem[]>([]);
  const [revisitRoute, setRevisitRoute] = useState<{ paths: string[]; rings: NodeId[]; gate: NodeId; key: string }>();
  const [route, setRoute] = useState<{ d: string; key: string }>();
  const addItems = useCallback((next: EffectItem[]) => setItems((prev) => [...prev, ...next]), []);
  const dropItems = useCallback((prefix: string, after = 0) => {
    const drop = () => setItems((prev) => prev.filter((i) => !i.id.startsWith(prefix)));
    if (after > 0) setTimeout(drop, after);
    else drop();
  }, []);

  // ── camera helpers (layout boxes → frames).
  const boxOf = useCallback(
    (ids: NodeId[]) => {
      let x0 = Number.POSITIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (const id of ids) {
        const p = map.layout.nodes[id];
        if (!p) continue;
        x0 = Math.min(x0, p.x - 60);
        y0 = Math.min(y0, p.y - 60);
        x1 = Math.max(x1, p.x + 60);
        y1 = Math.max(y1, p.y + 70);
      }
      return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
    },
    [map],
  );
  const frameIds = useCallback(
    (ids: NodeId[], move: { ms?: number; force?: boolean; maxK?: number } = {}) => {
      if (!interactive) return;
      const box = boxOf(ids);
      if (box) zpRef.current.frameBox(box, undefined, { maxK: 1.4, ...move, ...(reducedMotion ? { ms: 0 } : {}) });
    },
    [interactive, boxOf, reducedMotion],
  );

  // ── moments.
  const momentDone = useRef(onMomentDone);
  momentDone.current = onMomentDone;
  const running = useRef<RunningMoment | null>(null);
  const lastChange = useRef<{ text: string; at: number }>({ text: "", at: Number.NEGATIVE_INFINITY });
  const sayMoment = useCallback((text: string) => {
    const now = Date.now();
    // The view change already said it (the response landed while the modal was open): don't repeat.
    if (text && !(lastChange.current.text === text && now - lastChange.current.at < 30_000)) announceMap(text);
  }, []);

  const begin = useCallback((key: number, kind: RunningMoment["kind"], end: (skipped: boolean) => void) => {
    running.current?.finish(true);
    const m: RunningMoment = {
      key,
      kind,
      timers: [],
      finished: false,
      finish(skipped) {
        if (m.finished) return;
        m.finished = true;
        for (const t of m.timers) clearTimeout(t);
        end(skipped);
        if (running.current === m) running.current = null;
        momentDone.current?.(key);
      },
    };
    running.current = m;
    return {
      at: (ms: number, fn: () => void) => {
        m.timers.push(
          setTimeout(() => {
            if (!m.finished) fn();
          }, ms),
        );
      },
      finish: m.finish,
    };
  }, []);
  useEffect(
    () => () => {
      running.current?.finish(true);
    },
    [],
  );

  const order = useMemo(() => new Map(map.topo.map((id, i) => [id, i] as const)), [map.topo]);
  const byTopo = useCallback(
    (ids: NodeId[]) =>
      [...new Set(ids)].filter((id) => map.nodes[id]).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    [map.nodes, order],
  );
  const title = useCallback((id: NodeId) => map.nodes[id]?.title ?? id, [map.nodes]);

  // cardDone: tick, laid track, token travel, next card pulse. Never Lumen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: plays only when the key changes.
  useEffect(() => {
    if (!cardDone) return;
    const { node, next, key } = cardDone;
    const prefix = `cd${key}:`;
    const text = `${title(node)} done.${next ? ` ${title(next)} is next.` : ""}`;
    const mo = begin(key, "cardDone", (skipped) => {
      travelCancel.current();
      setTravel(undefined);
      setTokenAt(next ?? node);
      dropItems(prefix, skipped ? 0 : 900);
      sayMoment(text);
    });
    if (reducedMotion || variant !== "full") {
      mo.at(120, () => mo.finish(false));
      return;
    }
    const color = theme.lines[(scene.byId.get(next ?? node)?.color ?? 0) as 0 | 1 | 2 | 3 | 4];
    addItems([
      { id: `${prefix}tick`, kind: "tick", node, delay: 0 },
      ...(next
        ? ([
            { id: `${prefix}lay`, kind: "lay", from: node, to: next, delay: 0, color, duration: 650 },
            { id: `${prefix}pulse`, kind: "pulse", node: next, delay: 220 },
          ] satisfies EffectItem[])
        : []),
    ]);
    if (next) {
      const p = map.layout.nodes[next];
      mo.at(100, () => {
        if (p && !zpRef.current.overridden()) zpRef.current.reveal(p, 0, true);
        travelTo(node, next, 600);
      });
    }
    mo.at(900, () => mo.finish(false));
  }, [cardDone?.key]);

  // gateOpen: the headline. See the file comment for the beats.
  // biome-ignore lint/correctness/useExhaustiveDependencies: plays only when the key changes.
  useEffect(() => {
    if (!gateOpen) return;
    const { gate, key } = gateOpen;
    const prefix = `go${key}:`;
    const covers = byTopo((gateOpen.lit.length ? gateOpen.lit : gateCovers(map, gate)).filter((id) => id !== gate));
    const unlocked = byTopo(gateOpen.unlocked.filter((id) => id !== gate));
    const suggested =
      unlocked[0] ??
      map.topo.find((id) => viewsRef.current[id]?.suggested) ??
      map.topo.find((id) => viewsRef.current[id]?.state === "ready");
    const sentence = [
      "Checkpoint passed.",
      covers.length ? `${listJoin(covers.map(title))} ${covers.length === 1 ? "is" : "are"} lit.` : "",
      unlocked.length ? `${listJoin(unlocked.map(title))} ${unlocked.length === 1 ? "is" : "are"} ready.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const frameAll = [...covers, gate, ...unlocked];
    const mo = begin(key, "gateOpen", (skipped) => {
      setOverride(EMPTY_OVERRIDE);
      travelCancel.current();
      setTravel(undefined);
      if (suggested) setTokenAt(suggested);
      if (skipped) dropItems(prefix);
      else dropItems(prefix, 1600);
      sayMoment(sentence);
    });
    if (reducedMotion || variant !== "full") {
      frameIds(frameAll, { ms: 0, force: true });
      addItems([
        ...covers.map(
          (id): EffectItem => ({
            id: `${prefix}b:${id}`,
            kind: "label",
            node: id,
            delay: 0,
            text: "+ brighter",
            tone: "lumen",
          }),
        ),
        { id: `${prefix}b:${gate}`, kind: "label", node: gate, delay: 0, text: "+ brighter", tone: "lumen" },
        ...unlocked.map(
          (id): EffectItem => ({
            id: `${prefix}r:${id}`,
            kind: "label",
            node: id,
            delay: 0,
            text: "Ready",
            tone: "sea",
          }),
        ),
      ]);
      mo.at(220, () => mo.finish(false));
      return;
    }
    // Show the moment before the pass, then step it forward.
    const before: Override = {};
    for (const id of covers) before[id] = "done";
    before[gate] = "ready";
    for (const id of unlocked) before[id] = "locked";
    setOverride(before);
    const lift = (id: NodeId) =>
      setOverride((prev) => {
        if (!(id in prev)) return prev;
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    mo.at(220, () => frameIds(frameAll, { ms: 700, force: true }));
    const n = covers.length;
    const step = n > 1 ? Math.min(320, 1500 / (n - 1)) : 0;
    const when = new Map<NodeId, number>();
    const fx: EffectItem[] = [];
    covers.forEach((id, i) => {
      const t = 920 + i * step;
      when.set(id, t);
      mo.at(t, () => lift(id));
      fx.push({ id: `${prefix}burst:${id}`, kind: "burst", node: id, delay: t });
    });
    const coverSet = new Set(covers);
    for (const e of scene.edges) {
      if (coverSet.has(e.from) && coverSet.has(e.to))
        fx.push({ id: `${prefix}flow:${e.key}`, kind: "flow", from: e.from, to: e.to, delay: when.get(e.from) ?? 920 });
    }
    const tGate = 920 + Math.max(0, n - 1) * step + 400;
    mo.at(tGate, () => lift(gate));
    fx.push({ id: `${prefix}gate`, kind: "burst", node: gate, delay: tGate, size: 1.8 });
    for (const e of scene.edges) {
      if (e.from === gate)
        fx.push({ id: `${prefix}out:${e.key}`, kind: "flow", from: e.from, to: e.to, delay: tGate + 300 });
      if (e.to === gate && coverSet.has(e.from))
        fx.push({
          id: `${prefix}in:${e.key}`,
          kind: "flow",
          from: e.from,
          to: e.to,
          delay: tGate - 300,
          duration: 600,
        });
    }
    unlocked.forEach((id, j) => {
      const t = tGate + 700 + j * 120;
      mo.at(t, () => lift(id));
      fx.push({ id: `${prefix}ripple:${id}`, kind: "ripple", node: id, delay: t });
    });
    addItems(fx);
    const tToken = tGate + 1200;
    if (suggested) mo.at(tToken, () => travelTo(gate, suggested, 900));
    mo.at(tToken + 1100, () => mo.finish(false));
  }, [gateOpen?.key]);

  // revisit: the Sea route from the gate back to each card; it stays until one of them is opened.
  // biome-ignore lint/correctness/useExhaustiveDependencies: plays only when the key changes.
  useEffect(() => {
    if (!revisit) return;
    const { from, key } = revisit;
    const to = byTopo(revisit.to);
    const paths = to
      .map((id) => linePath(routeThrough(scene, tokenPath(map, viewsRef.current, from, id))))
      .filter(Boolean);
    setRevisitRoute({ paths, rings: to, gate: from, key: `rv${key}` });
    const text = to.length
      ? `Worth a second look: ${listJoin(to.map(title))}. The route from the checkpoint is marked.`
      : "";
    const mo = begin(key, "revisit", () => sayMoment(text));
    frameIds([from, ...to], { ms: 360 });
    mo.at(reducedMotion ? 120 : 800, () => mo.finish(false));
  }, [revisit?.key]);

  // Skip: any key, click or wheel jumps an orchestrated moment to its end (Esc only skips).
  useEffect(() => {
    if (!interactive) return;
    const skip = (e: Event) => {
      const m = running.current;
      if (m?.kind !== "gateOpen") return;
      m.finish(true);
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", skip, true);
    document.addEventListener("pointerdown", skip, true);
    document.addEventListener("wheel", skip, true);
    return () => {
      document.removeEventListener("keydown", skip, true);
      document.removeEventListener("pointerdown", skip, true);
      document.removeEventListener("wheel", skip, true);
    };
  }, [interactive]);

  // ── opening entries: clear the revisit route when its cards are opened, route to Later cards,
  // pulse the unfinished covers of a Locked gate.
  const handleOpen = useCallback(
    (id: NodeId) => {
      setRevisitRoute((r) => (r && (r.rings.includes(id) || r.gate === id) ? undefined : r));
      onOpen(id);
    },
    [onOpen],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the selection only.
  useEffect(() => {
    if (!interactive || !selectedId || !map.nodes[selectedId]) {
      setRoute(undefined);
      return;
    }
    const node = map.nodes[selectedId];
    const state = viewFor(map, views, selectedId).state;
    if (state !== "locked") {
      setRoute(undefined);
      return;
    }
    if (node?.kind === "checkpoint") {
      setRoute(undefined);
      const open = gateCovers(map, selectedId).filter(
        (c) => viewFor(map, views, c).state !== "done" && !isLitLike(viewFor(map, views, c).state),
      );
      const k = Date.now();
      addItems(open.map((c): EffectItem => ({ id: `lg${k}:${c}`, kind: "pulse", node: c, delay: 0 })));
      dropItems(`lg${k}:`, 900);
      return;
    }
    const start = tokenRef.current ?? map.topo.find((id) => isOpenState(viewFor(map, views, id).state));
    if (!start) return;
    const pts = routeThrough(scene, tokenPath(map, views, start, selectedId));
    setRoute(pts.length > 1 ? { d: linePath(pts), key: `${start}>${selectedId}` } : undefined);
  }, [selectedId]);

  // ── keep the selected card in view (only nudges near the edges).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reveal only on selection change.
  useEffect(() => {
    if (!interactive || !selectedId) return;
    const p = map.layout.nodes[selectedId];
    if (p && !zpRef.current.overridden()) zpRef.current.reveal(p, 0, !reducedMotion);
  }, [selectedId, interactive]);

  // ── global map keys (full variant only): F fit, +/− zoom, M (hold) / Shift+M (latch) whole map.
  useEffect(() => {
    if (!interactive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      // Never while a modal (card, checkpoint, share sheet, palette) is open.
      if (document.querySelector('[aria-modal="true"]')) return;
      const z = zpRef.current;
      if (e.key === "f" || e.key === "F") z.fitView(!reducedMotion);
      else if (e.key === "+" || e.key === "=") z.zoomBy(1.25);
      else if (e.key === "-" || e.key === "_") z.zoomBy(0.8);
      else if (e.key === "M" || (e.key === "m" && e.shiftKey)) setLatched((v) => !v);
      else if (e.key === "m") {
        if (!e.repeat) setHeld(true);
      } else return;
      e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "m" || e.key === "M") setHeld(false);
    };
    const onBlur = () => setHeld(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [interactive, reducedMotion]);

  // ── opening the map: the current section framed (returning), or the first-visit arrival.
  const loaded = Object.keys(views).length > 0 || Object.keys(map.nodes).length === 0;
  const opened = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the viewport and the views are known.
  useEffect(() => {
    if (!interactive || opened.current || zp.size.w === 0 || !loaded) return;
    opened.current = true;
    const section = currentSection(map, views);
    const arrive = isFresh(map, views) && claimArrival(pack.manifest.id);
    if (!arrive) {
      if (section.length) frameIds(section, { ms: 0, force: true });
      return;
    }
    playArrival(layerRef.current, reducedMotion);
    // Then ease to the current section (not torn down by a resize mid-arrival).
    if (section.length) setTimeout(() => frameIds(section, { ms: 900, force: false }), reducedMotion ? 240 : 1600);
  }, [zp.size.w, loaded]);

  // ── camera target (a card beside the open modal).
  // biome-ignore lint/correctness/useExhaustiveDependencies: applies only when the key changes.
  useEffect(() => {
    if (!interactive || !frame) return;
    const p = map.layout.nodes[frame.node];
    if (!p) return;
    const host = hostRef.current?.getBoundingClientRect();
    const win: MapWindow | undefined =
      frame.rect && host
        ? {
            left: frame.rect.left - host.left,
            top: frame.rect.top - host.top,
            width: frame.rect.width,
            height: frame.rect.height,
          }
        : undefined;
    zpRef.current.revealIn(p, win, { minK: 1, ms: reducedMotion ? 0 : 360 });
  }, [frame?.key]);

  // ── polite announcements of state changes (one shared live region with Moss).
  const prevViews = useRef<Record<NodeId, NodeView>>(views);
  useEffect(() => {
    const before = prevViews.current;
    prevViews.current = views;
    if (!interactive || Object.keys(before).length === 0) return;
    const text = describeChanges(map, before, views);
    if (!text) return;
    lastChange.current = { text, at: Date.now() };
    if (running.current) return; // the moment says it at its end
    announceMap(text);
  }, [map, views, interactive]);

  const rendererProps: MapRendererProps = {
    pack,
    views: shown,
    theme,
    ...(focusId ? { focusId } : {}),
    ...((hoverId ?? focusId) ? { hoverId: (hoverId ?? focusId) as NodeId } : {}),
    ...(tokenAt && variant !== "poster" ? { tokenAt } : {}),
    fog: variant === "full" ? veil : false,
    zoom: interactive ? quantizeZoom(zp.view.k) : 1,
    reducedMotion: reducedMotion || variant === "poster",
  };
  // Memoised: zoom and pan are a CSS transform on the container, so the SVG only redraws when its own
  // props change (hover, focus, views, veil, a zoom bucket), keeping zoom and hover at 60 fps.
  const Renderer = useMemo(() => memo(RENDERERS[renderer]), [renderer]);
  const onRendererError = useCallback(() => setFailed(requested), [requested]);
  const s = zp.scale;
  const transform = `translate(${zp.view.x}px, ${zp.view.y}px) scale(${s})`;
  const ctx = useMemo(
    () => ({
      scene,
      layoutHost,
      screenHost,
      reveal: (p: { x: number; y: number }, insetRight: number) => {
        if (interactive) zpRef.current.reveal(p, insetRight, !reducedMotion);
      },
    }),
    [scene, layoutHost, screenHost, interactive, reducedMotion],
  );

  return (
    <MapViewportContext.Provider value={ctx}>
      <div
        ref={setHost}
        data-map={pack.manifest.id}
        data-variant={variant}
        data-renderer={renderer}
        data-theme={theme.mode}
        data-veil={veil ? "on" : "off"}
        className={cn(
          "relative isolate h-full w-full overflow-hidden select-none",
          interactive && "cursor-grab active:cursor-grabbing",
          variant === "full" ? "min-h-80" : "",
        )}
        style={{ ...worldStyle(theme), background: theme.ground, touchAction: interactive ? "none" : undefined }}
        onPointerDown={zp.onPointerDown}
      >
        <div
          ref={layerRef}
          className="absolute top-0 left-0 origin-top-left will-change-transform"
          style={{ transform, width: map.layout.width, height: map.layout.height }}
          data-layer="map"
        >
          <svg
            width={map.layout.width}
            height={map.layout.height}
            viewBox={`0 0 ${map.layout.width} ${map.layout.height}`}
            className="absolute top-0 left-0 overflow-visible"
            aria-hidden
            focusable="false"
          >
            <RendererBoundary key={renderer} onError={renderer === "metro" ? undefined : onRendererError}>
              <Renderer {...rendererProps} />
            </RendererBoundary>
            <EffectsLayer
              scene={scene}
              reducedMotion={reducedMotion}
              {...(lightUp ? { lightUp } : {})}
              items={items}
              {...(revisitRoute ? { revisit: revisitRoute } : {})}
              {...(route ? { route } : {})}
            />
            {travel ? <TravellingToken points={travel.points} t={travel.t} props={rendererProps} /> : null}
          </svg>
          {variant === "poster" ? null : (
            <MemoStopLayer
              {...rendererProps}
              renderer={renderer}
              hideLabels={variant === "mini"}
              {...(selectedId ? { selectedId } : {})}
              onSelect={onSelect}
              onOpen={handleOpen}
              {...(onPeek ? { onPeek } : {})}
              onHover={setHoverId}
              onFocusStop={setFocusId}
            />
          )}
          {/* Overlays in layout space draw above the labels; clicks pass through. */}
          <div
            ref={setLayoutHost}
            className="pointer-events-none absolute top-0 left-0"
            style={{ width: map.layout.width, height: map.layout.height }}
          />
        </div>
        <div
          ref={setScreenHost}
          className="pointer-events-none absolute top-4 right-4 bottom-16 z-10 flex flex-col items-end [&>*]:pointer-events-auto"
          data-layer="screen-host"
        />
        {overlay ? (
          <div className="pointer-events-none absolute inset-0 z-20 [&>*]:pointer-events-auto" data-layer="overlay">
            {overlay}
          </div>
        ) : null}
        {interactive ? (
          <ZoomControls
            zoom={zp.view.k}
            onZoomIn={() => zp.zoomBy(1.25)}
            onZoomOut={() => zp.zoomBy(0.8)}
            onFit={() => zp.fitView(!reducedMotion)}
            whole={!veil}
            onWhole={() => setLatched((v) => !v)}
          />
        ) : null}
      </div>
    </MapViewportContext.Provider>
  );
}

const MemoStopLayer = memo(StopLayer);

const isOpenState = (s: NodeState) => s === "ready" || s === "in-progress";

/** Views with a moment's overrides laid over them (the same object when there are none). */
function applyOverride(
  map: CompiledMap,
  views: Record<NodeId, NodeView>,
  override: Override,
): Record<NodeId, NodeView> {
  const keys = Object.keys(override);
  if (keys.length === 0) return views;
  const out: Record<NodeId, NodeView> = { ...views };
  for (const id of keys) {
    const state = override[id];
    if (!state) continue;
    const base = viewFor(map, views, id);
    out[id] = {
      ...base,
      state,
      brightness: state === "lit" ? 1 : 0,
      suggested: false,
      missing: state === "locked" ? (base.missing.length ? base.missing : (map.nodes[id]?.requires ?? [])) : [],
    };
  }
  return out;
}

/** The current section's frame: its cards, its gate and the first card past it. Empty: fit the map. */
function currentSection(map: CompiledMap, views: Record<NodeId, NodeView>): NodeId[] {
  const gate = nextGate(map, views);
  if (!gate) return [];
  const covers = gateCovers(map, gate);
  const past = (mapGraph(map).dependents.get(gate) ?? []).slice(0, 1);
  return [...covers, gate, ...past];
}

/** Nothing started on this map yet. */
function isFresh(map: CompiledMap, views: Record<NodeId, NodeView>): boolean {
  return (
    Object.keys(map.nodes).every((id) => {
      const s = views[id]?.state;
      return !s || s === "ready" || s === "locked" || s === "planned" || s === "building";
    }) && !Object.values(views).some((v) => satisfies(v.state))
  );
}

/** The arrival plays once per map per browser session. */
function claimArrival(packId: string): boolean {
  try {
    const key = `lm:arrival:${packId}`;
    if (typeof sessionStorage === "undefined" || sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

/**
 * First visit (02 §1.9): the map wipes in left to right, then cards pop in reading order (gates last).
 * Reduced motion: one 220 ms fade.
 */
function playArrival(layer: HTMLElement | null, reduced: boolean): void {
  if (!layer || typeof layer.animate !== "function") return;
  if (reduced) {
    layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "linear" });
    return;
  }
  const svg = layer.querySelector("svg");
  svg?.animate([{ clipPath: "inset(-50% 100% -50% -50%)" }, { clipPath: "inset(-50% -50% -50% -50%)" }], {
    duration: 900,
    easing: "cubic-bezier(.65,0,.35,1)",
  });
  const stops = Array.from(layer.querySelectorAll<SVGGElement>('[data-layer="stops"] > g'));
  stops.sort((a, b) => Number(a.dataset.kind === "checkpoint") - Number(b.dataset.kind === "checkpoint"));
  stops.forEach((g, i) => {
    // The inner group carries the glyph's CSS transform (hover scale), so the pop scales that one.
    const inner = g.firstElementChild as SVGGElement | null;
    (inner ?? g).animate(
      [
        { opacity: 0, transform: "scale(0.6)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 220, delay: 700 + i * 40, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
    );
  });
  const labels = layer.querySelector('[data-layer="stops-a11y"]');
  labels?.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 300,
    delay: 700 + stops.length * 40,
    fill: "backwards",
  });
}

/** Renderers see zoom in 0.25 steps (semantic zoom needs buckets, not every wheel tick). */
export function quantizeZoom(k: number): number {
  const q = Math.round(k * 4) / 4;
  // Keep the semantic-zoom threshold exact: below 0.8× stays below, 0.8× and up stays up.
  return k >= 0.8 ? Math.max(0.8, q) : Math.min(0.75, q);
}

function TravellingToken({ points, t, props }: { points: Pt[]; t: number; props: MapRendererProps }) {
  const p = pointAt(points, t);
  return (
    <g data-layer="token-travel" transform={`translate(${p.x + TOKEN_OFFSET.x} ${p.y + TOKEN_OFFSET.y}) scale(0.85)`}>
      <TokenArt kind={props.theme.token} ink="var(--w-ink)" accent="var(--w-1)" ground="var(--w-ground)" />
    </g>
  );
}

function ZoomControls(p: {
  zoom: number;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  whole: boolean;
  onWhole(): void;
}) {
  const btn =
    "grid h-8 min-w-8 place-items-center rounded-sm border border-line bg-surface px-2 text-small text-ink shadow-1 hover:bg-surface-2 disabled:opacity-50";
  return (
    <div className="absolute right-4 bottom-4 z-10 flex items-center gap-1" data-layer="zoom-controls">
      <button
        type="button"
        className={btn}
        onClick={p.onZoomOut}
        disabled={p.zoom <= 0.5}
        aria-label="Zoom out"
        title="Zoom out (−)"
      >
        −
      </button>
      <button
        type="button"
        className={btn}
        onClick={p.onZoomIn}
        disabled={p.zoom >= 2.5}
        aria-label="Zoom in"
        title="Zoom in (+)"
      >
        +
      </button>
      <button type="button" className={btn} onClick={p.onFit} title="Fit the map (F)">
        Fit
      </button>
      <button
        type="button"
        className={btn}
        onClick={p.onWhole}
        aria-pressed={p.whole}
        title="Show the whole map (hold M, Shift+M keeps it)"
      >
        Whole map
      </button>
    </div>
  );
}

/** Where the token starts: the selection, a run in progress, the suggested card, then any open card. */
function pickTokenStop(
  map: CompiledMap,
  views: Record<NodeId, NodeView>,
  selectedId: NodeId | undefined,
): NodeId | undefined {
  const order = readingOrder(map);
  if (selectedId && map.nodes[selectedId] && isLitLike(viewFor(map, views, selectedId).state)) return selectedId;
  return (
    order.find((id) => views[id]?.state === "in-progress") ??
    order.find((id) => views[id]?.suggested) ??
    order.find((id) => viewFor(map, views, id).state === "ready") ??
    order[0]
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** If a themed renderer throws, report it so MapView redraws with metro (the learner never sees a broken map). */
class RendererBoundary extends Component<
  { onError?: (() => void) | undefined; children: ReactNode },
  { error: boolean }
> {
  override state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    if (typeof console !== "undefined")
      console.warn("Map renderer failed; falling back to metro.", error, info.componentStack);
    this.props.onError?.();
  }
  override render() {
    return this.state.error ? null : this.props.children;
  }
}
