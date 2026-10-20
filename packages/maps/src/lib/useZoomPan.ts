/**
 * Zoom and pan for the map viewport. `k` is the learner's zoom relative to "fit" (1 = the whole map
 * fits), clamped to 0.5..2.5; the actual scale is fit × k. Wheel with Ctrl/⌘ (or a trackpad pinch)
 * zooms around the pointer, a plain wheel or a drag on the ground pans. Transform-only updates keep
 * zoom and hover at 60 fps.
 *
 * Auto camera: `frameBox` fits a layout box into a screen window, `revealIn` places a point in
 * a window (beside an open modal). After any manual pan, wheel or zoom, auto moves are suppressed for
 * 6 s unless forced (gate and finish moments always reframe). Every move is one tween of the transform.
 */
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type Ease, easeInOut, easeOut, tween } from "./tween";

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;
const PAD = 40;
/** Small maps (pocket maps) never blow up past this. */
const MAX_FIT = 1.3;
/** Auto camera stays out of the way this long after the learner moves the map. */
export const OVERRIDE_MS = 6000;

/** A window inside the viewport (px, relative to the viewport's top-left). */
export interface MapWindow {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AutoMove {
  /** Tween length; 0 jumps. Default 360. */
  ms?: number;
  /** Ignore the learner-override window (gate and finish moments). */
  force?: boolean;
  ease?: Ease;
}

export interface ViewState {
  /** Relative zoom (1 = fit). */
  k: number;
  /** Translate in screen px. */
  x: number;
  y: number;
}

export interface ZoomPan {
  ref: (el: HTMLDivElement | null) => void;
  view: ViewState;
  /** Fit scale for the current viewport size. */
  fit: number;
  /** Actual scale: fit × k. */
  scale: number;
  size: { w: number; h: number };
  zoomBy(factor: number, around?: { x: number; y: number }): void;
  fitView(animate?: boolean): void;
  /** Pan so a layout point is inside the visible area (minus `insetRight` px), easing if `animate`. */
  reveal(p: { x: number; y: number }, insetRight: number, animate: boolean): void;
  /** Fit a layout box into `win` (default the whole viewport), zoom clamped to `maxK`. Returns false when suppressed. */
  frameBox(
    box: { x: number; y: number; w: number; h: number },
    win?: MapWindow,
    move?: AutoMove & { maxK?: number },
  ): boolean;
  /** Put a layout point at the centre of `win` (y kept between 35% and 65%), nudging zoom up to at least `minK`. */
  revealIn(p: { x: number; y: number }, win?: MapWindow, move?: AutoMove & { minK?: number }): boolean;
  /** The learner moved the map in the last 6 s. */
  overridden(): boolean;
  onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void;
}

const clampK = (k: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));

export function useZoomPan(layoutW: number, layoutH: number, interactive: boolean): ZoomPan {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<ViewState>({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const cancelRef = useRef<() => void>(() => {});
  const fitted = useRef(false);
  const manualAt = useRef(Number.NEGATIVE_INFINITY);
  const markManual = useCallback(() => {
    manualAt.current = typeof performance !== "undefined" ? performance.now() : Date.now();
  }, []);
  const overridden = useCallback(
    () => (typeof performance !== "undefined" ? performance.now() : Date.now()) - manualAt.current < OVERRIDE_MS,
    [],
  );

  const fit =
    size.w > 0 && size.h > 0 ? Math.min((size.w - PAD * 2) / layoutW, (size.h - PAD * 2) / layoutH, MAX_FIT) : 1;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const centred = useCallback(
    (k: number): ViewState => {
      const s = fitRef.current * k;
      return { k, x: (sizeRef.current.w - layoutW * s) / 2, y: (sizeRef.current.h - layoutH * s) / 2 };
    },
    [layoutW, layoutH],
  );

  /** Keep at least a margin of the map on screen. */
  const clampPan = useCallback(
    (v: ViewState): ViewState => {
      const s = fitRef.current * v.k;
      const { w, h } = sizeRef.current;
      const mw = layoutW * s;
      const mh = layoutH * s;
      const keep = 120;
      const x = Math.min(w - Math.min(keep, mw), Math.max(Math.min(keep, mw) - mw, v.x));
      const y = Math.min(h - Math.min(keep, mh), Math.max(Math.min(keep, mh) - mh, v.y));
      return { k: v.k, x, y };
    },
    [layoutW, layoutH],
  );

  const animateTo = useCallback((target: ViewState, ms: number, ease: Ease = easeOut) => {
    cancelRef.current();
    const from = viewRef.current;
    if (ms <= 0) {
      setView(target);
      return;
    }
    cancelRef.current = tween({
      duration: ms,
      ease,
      onUpdate: (t) =>
        setView({
          k: from.k + (target.k - from.k) * t,
          x: from.x + (target.x - from.x) * t,
          y: from.y + (target.y - from.y) * t,
        }),
    });
  }, []);

  // Observe the viewport size; fit on first measure and keep the view centre on resize.
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const prevSize = useRef(size);
  useLayoutEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    if (!fitted.current) {
      fitted.current = true;
      setView(centred(1));
    } else if (prevSize.current.w > 0) {
      // Keep the same layout point at the centre.
      const old = prevSize.current;
      const v = viewRef.current;
      const oldFit = Math.min((old.w - PAD * 2) / layoutW, (old.h - PAD * 2) / layoutH, MAX_FIT);
      const s0 = oldFit * v.k;
      const cx = (old.w / 2 - v.x) / s0;
      const cy = (old.h / 2 - v.y) / s0;
      const s1 = fitRef.current * v.k;
      setView(clampPan({ k: v.k, x: size.w / 2 - cx * s1, y: size.h / 2 - cy * s1 }));
    }
    prevSize.current = size;
  }, [size, centred, clampPan, layoutW, layoutH]);

  const zoomBy = useCallback(
    (factor: number, around?: { x: number; y: number }) => {
      markManual();
      cancelRef.current();
      const v = viewRef.current;
      const k = clampK(v.k * factor);
      const p = around ?? { x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 };
      const s0 = fitRef.current * v.k;
      const s1 = fitRef.current * k;
      const lx = (p.x - v.x) / s0;
      const ly = (p.y - v.y) / s0;
      setView(clampPan({ k, x: p.x - lx * s1, y: p.y - ly * s1 }));
    },
    [clampPan, markManual],
  );

  const fitView = useCallback(
    (animate = true) => {
      const target = centred(1);
      if (animate) animateTo(target, 360);
      else setView(target);
    },
    [centred, animateTo],
  );

  const reveal = useCallback(
    (p: { x: number; y: number }, insetRight: number, animate: boolean) => {
      const v = viewRef.current;
      const s = fitRef.current * v.k;
      const { w, h } = sizeRef.current;
      if (w === 0) return;
      const margin = 96;
      const sx = v.x + p.x * s;
      const sy = v.y + p.y * s;
      const right = Math.max(margin * 2, w - insetRight);
      let dx = 0;
      let dy = 0;
      if (sx < margin) dx = margin - sx;
      else if (sx > right - margin) dx = right - margin - sx;
      if (sy < margin) dy = margin - sy;
      else if (sy > h - margin) dy = h - margin - sy;
      if (dx === 0 && dy === 0) return;
      const target = clampPan({ k: v.k, x: v.x + dx, y: v.y + dy });
      if (animate) animateTo(target, 360);
      else setView(target);
    },
    [clampPan, animateTo],
  );

  const frameBox = useCallback(
    (
      box: { x: number; y: number; w: number; h: number },
      win?: MapWindow,
      move: AutoMove & { maxK?: number } = {},
    ): boolean => {
      const { w, h } = sizeRef.current;
      if (w === 0 || (!move.force && overridden())) return false;
      const wnd = win ?? { left: 0, top: 0, width: w, height: h };
      const pad = 72;
      const fitS = fitRef.current;
      const sx = Math.max(40, wnd.width - pad * 2) / Math.max(1, box.w);
      const sy = Math.max(40, wnd.height - pad * 2) / Math.max(1, box.h);
      // The cap is relative to the fit, but a wide map fits small: always allow zooming in to
      // true size (1 layout unit = 1 px), where labels read at their designed size.
      const cap = Math.max(move.maxK ?? 1.6, Math.min(MAX_ZOOM, 1 / fitS));
      const k = clampK(Math.min(cap, Math.min(sx, sy) / fitS));
      const s = fitS * k;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const target = clampPan({ k, x: wnd.left + wnd.width / 2 - cx * s, y: wnd.top + wnd.height / 2 - cy * s });
      animateTo(target, move.ms ?? 360, move.ease ?? easeInOut);
      return true;
    },
    [clampPan, animateTo, overridden],
  );

  const revealIn = useCallback(
    (p: { x: number; y: number }, win?: MapWindow, move: AutoMove & { minK?: number } = {}): boolean => {
      const { w, h } = sizeRef.current;
      if (w === 0 || (!move.force && overridden())) return false;
      const wnd = win ?? { left: 0, top: 0, width: w, height: h };
      const v = viewRef.current;
      const k = clampK(Math.max(v.k, move.minK ?? v.k));
      const s = fitRef.current * k;
      const sy0 = v.y + p.y * (fitRef.current * v.k);
      const ty = Math.min(wnd.top + wnd.height * 0.65, Math.max(wnd.top + wnd.height * 0.35, sy0));
      const target = clampPan({ k, x: wnd.left + wnd.width / 2 - p.x * s, y: ty - p.y * s });
      animateTo(target, move.ms ?? 360, move.ease ?? easeInOut);
      return true;
    },
    [clampPan, animateTo, overridden],
  );

  // Wheel: needs a non-passive listener to prevent page zoom/scroll.
  useEffect(() => {
    if (!el || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      markManual();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomBy(Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        cancelRef.current();
        const v = viewRef.current;
        setView(clampPan({ k: v.k, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [el, interactive, zoomBy, clampPan, markManual]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!interactive || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, a, input, [data-callout]")) return;
      cancelRef.current();
      const start = { x: e.clientX, y: e.clientY, v: viewRef.current };
      const node = e.currentTarget;
      node.setPointerCapture?.(e.pointerId);
      let moved = false;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        if (!moved) markManual();
        moved = true;
        setView(clampPan({ k: start.v.k, x: start.v.x + dx, y: start.v.y + dy }));
      };
      const up = (ev: PointerEvent) => {
        node.releasePointerCapture?.(ev.pointerId);
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        node.removeEventListener("pointercancel", up);
      };
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", up);
      node.addEventListener("pointercancel", up);
    },
    [interactive, clampPan, markManual],
  );

  useEffect(() => () => cancelRef.current(), []);

  return {
    ref: setEl,
    view,
    fit,
    scale: fit * view.k,
    size,
    zoomBy,
    fitView,
    reveal,
    frameBox,
    revealIn,
    overridden,
    onPointerDown,
  };
}
