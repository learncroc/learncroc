/**
 * The shared drag kit. Every drag in a built-in widget works three ways:
 *
 * 1. Pointer: press and drag an item onto a target (or tap an item, then tap a target).
 * 2. Keyboard: Tab to an item, Space or Enter to pick it up, arrow keys to move between targets
 *    (each announced), Space or Enter to drop, Escape to cancel.
 * 3. "Use buttons instead": a persisted toggle (`useButtonsMode`) that widgets honour by rendering
 *    explicit select-and-place buttons.
 *
 * `usePickPlace` covers discrete drops (cards into buckets, labels onto spots, tiles into a line).
 * `useDragPoint` covers continuous handles (bar heights, a point on a plane, a slider marker).
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// ── "Use buttons instead" (persisted, shared by every widget on the page) ───────────────────

const BUTTONS_KEY = "lm:use-buttons";
const listeners = new Set<() => void>();
let memoryButtons = false;

function readButtons(): boolean {
  try {
    return globalThis.localStorage?.getItem(BUTTONS_KEY) === "1";
  } catch {
    return memoryButtons;
  }
}

function writeButtons(on: boolean): void {
  memoryButtons = on;
  try {
    if (on) globalThis.localStorage?.setItem(BUTTONS_KEY, "1");
    else globalThis.localStorage?.removeItem(BUTTONS_KEY);
  } catch {
    // Storage can be unavailable (private mode); the in-memory value still applies.
  }
  for (const l of listeners) l();
}

function subscribeButtons(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === BUTTONS_KEY) l();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(l);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

/** The persisted "Use buttons instead" preference. */
export function useButtonsMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeButtons, readButtons, () => false);
  return [on, writeButtons];
}

// ── Keyboard helpers ──────────────────────────────────────────────────────────────────────

/** Arrow key → [dx, dy] in steps (Shift = 10×), or null for any other key. y grows downward. */
export function arrowDelta(e: { key: string; shiftKey: boolean }): [number, number] | null {
  const k = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case "ArrowLeft":
      return [-k, 0];
    case "ArrowRight":
      return [k, 0];
    case "ArrowUp":
      return [0, -k];
    case "ArrowDown":
      return [0, k];
    default:
      return null;
  }
}

const isActivate = (key: string) => key === " " || key === "Spacebar" || key === "Enter";

// ── Discrete pick and place ───────────────────────────────────────────────────────────────

export interface PickTarget {
  id: string;
  label: string;
}

export interface PickPlaceOptions {
  /** Ordered targets; arrow keys walk this list. */
  targets: readonly PickTarget[];
  /** Accessible name of an item ("kilometre"). */
  itemLabel: (itemId: string) => string;
  /** Where an item is now (a target id), or null when it is still in the tray. */
  locate: (itemId: string) => string | null;
  onPlace: (itemId: string, targetId: string) => void;
  announce: (text: string) => void;
  /** Root element: used to restore focus to an item after it moves in the DOM. */
  rootRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
  /** Verb for announcements: "placed in" (default), "moved to". */
  verb?: string;
}

export interface PickPlace {
  /** The item being carried (keyboard or pointer), or the tapped item awaiting a target. */
  held: string | null;
  /** The target under the carried item. */
  over: string | null;
  /** True while a pointer drag is in progress. */
  dragging: boolean;
  /** Pointer offset of the dragged item, for a translate() while dragging. */
  offset: { x: number; y: number };
  /** Spread on each item element (a <button>). */
  itemProps: (itemId: string) => {
    "data-pick-item": string;
    "aria-pressed": boolean;
    "aria-roledescription": string;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onClick: (e: { detail: number }) => void;
    style: { transform?: string; zIndex?: number; pointerEvents?: "none"; touchAction: "none" };
  };
  /** Spread on each drop target element. */
  targetProps: (targetId: string) => {
    "data-drop-target": string;
    "data-over": boolean | undefined;
    onClick: (e: { target: EventTarget | null }) => void;
  };
  /** Place an item directly (buttons mode). */
  place: (itemId: string, targetId: string) => void;
  cancel: () => void;
}

/** Discrete drag and drop with pointer, keyboard and tap-to-place paths. */
export function usePickPlace(opts: PickPlaceOptions): PickPlace {
  const [held, setHeld] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const pointer = useRef<{ id: string; x: number; y: number; pid: number; moved: boolean } | null>(null);
  const [pointerSeq, setPointerSeq] = useState(0);

  const focusItem = useCallback((itemId: string) => {
    const run = () => {
      const root = optsRef.current.rootRef.current;
      const el = root?.querySelector<HTMLElement>(`[data-pick-item="${CSS.escape(itemId)}"]`);
      el?.focus();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 0);
  }, []);

  const place = useCallback(
    (itemId: string, targetId: string) => {
      const o = optsRef.current;
      if (o.disabled) return;
      const label = o.targets.find((t) => t.id === targetId)?.label ?? targetId;
      o.onPlace(itemId, targetId);
      o.announce(`${o.itemLabel(itemId)} ${o.verb ?? "placed in"} ${label}.`);
      setHeld(null);
      setOver(null);
      focusItem(itemId);
    },
    [focusItem],
  );

  const cancel = useCallback(() => {
    const o = optsRef.current;
    if (held) o.announce(`${o.itemLabel(held)} put back.`);
    setHeld(null);
    setOver(null);
    setDragging(false);
    setOffset({ x: 0, y: 0 });
    pointer.current = null;
  }, [held]);

  const pickUp = useCallback((itemId: string) => {
    const o = optsRef.current;
    if (o.disabled || o.targets.length === 0) return;
    const at = o.locate(itemId);
    const start = at && o.targets.some((t) => t.id === at) ? at : (o.targets[0]?.id ?? null);
    setHeld(itemId);
    setOver(start);
    const where = o.targets.find((t) => t.id === start)?.label;
    o.announce(
      `Picked up ${o.itemLabel(itemId)}.${where ? ` Over ${where}.` : ""} Arrow keys choose a place, Space drops, Escape cancels.`,
    );
  }, []);

  const step = useCallback((dir: 1 | -1) => {
    const o = optsRef.current;
    setOver((cur) => {
      const i = o.targets.findIndex((t) => t.id === cur);
      const n = o.targets.length;
      const next = o.targets[((((i < 0 ? (dir === 1 ? -1 : 0) : i) + dir) % n) + n) % n];
      if (next) o.announce(`Over ${next.label}.`);
      return next?.id ?? cur;
    });
  }, []);

  // Pointer drag: window listeners while a pointer is down on an item.
  useEffect(() => {
    if (pointerSeq === 0 || !pointer.current) return;
    const onMove = (e: PointerEvent) => {
      const p = pointer.current;
      if (!p || e.pointerId !== p.pid) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.moved && Math.hypot(dx, dy) < 4) return;
      p.moved = true;
      setDragging(true);
      setOffset({ x: dx, y: dy });
      const hit = document.elementFromPoint?.(e.clientX, e.clientY);
      const target = hit?.closest<HTMLElement>("[data-drop-target]")?.dataset.dropTarget ?? null;
      setOver(target);
    };
    const onUp = (e: PointerEvent) => {
      const p = pointer.current;
      if (!p || e.pointerId !== p.pid) return;
      pointer.current = null;
      setDragging(false);
      setOffset({ x: 0, y: 0 });
      if (!p.moved) return; // a tap: keep the item selected for tap-to-place
      const hit = document.elementFromPoint?.(e.clientX, e.clientY);
      const target = hit?.closest<HTMLElement>("[data-drop-target]")?.dataset.dropTarget ?? null;
      if (target) place(p.id, target);
      else {
        setHeld(null);
        setOver(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [pointerSeq, place]);

  const itemProps: PickPlace["itemProps"] = (itemId) => {
    const isHeld = held === itemId;
    return {
      "data-pick-item": itemId,
      "aria-pressed": isHeld,
      "aria-roledescription": "draggable",
      onKeyDown: (e) => {
        if (optsRef.current.disabled) return;
        if (isActivate(e.key)) {
          e.preventDefault();
          if (isHeld && over) place(itemId, over);
          else pickUp(itemId);
          return;
        }
        if (e.key === "Escape" && isHeld) {
          e.preventDefault();
          e.stopPropagation();
          cancel();
          return;
        }
        if (!isHeld) return;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          step(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          step(-1);
        }
      },
      onPointerDown: (e) => {
        if (optsRef.current.disabled || e.button !== 0) return;
        pointer.current = { id: itemId, x: e.clientX, y: e.clientY, pid: e.pointerId, moved: false };
        setHeld(itemId);
        setOver(null);
        setPointerSeq((n) => n + 1);
      },
      onClick: (e) => {
        // Keyboard "clicks" (detail 0) are handled in onKeyDown.
        if (e.detail === 0 || optsRef.current.disabled) return;
        if (!pointer.current && held === itemId && !dragging) {
          const o = optsRef.current;
          o.announce(`${o.itemLabel(itemId)} selected. Choose a place for it.`);
        }
      },
      style: {
        touchAction: "none",
        ...(isHeld && dragging
          ? { transform: `translate(${offset.x}px, ${offset.y}px)`, zIndex: 40, pointerEvents: "none" as const }
          : {}),
      },
    };
  };

  const targetProps: PickPlace["targetProps"] = (targetId) => ({
    "data-drop-target": targetId,
    "data-over": held && over === targetId ? true : undefined,
    onClick: (e) => {
      // A tap on an item inside the target selects that item; it isn't a drop.
      if (e.target instanceof Element && e.target.closest("[data-pick-item]")) return;
      if (held && !dragging) place(held, targetId);
    },
  });

  return { held, over, dragging, offset, itemProps, targetProps, place, cancel };
}

// ── Continuous drag ───────────────────────────────────────────────────────────────────────

export interface DragPointOptions {
  /** The element whose box maps to 0..1 on both axes (usually the SVG plot area). */
  areaRef: RefObject<Element | null>;
  /** Called with the pointer position normalised to the area: x 0..1 left→right, y 0..1 top→bottom. */
  onMove: (nx: number, ny: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  disabled?: boolean;
  /** Inset of the active area inside the element's box, in the element's own pixels. */
  inset?: { left: number; right: number; top: number; bottom: number };
  /** Size of the element's coordinate space (e.g. the SVG viewBox), to convert the inset. */
  viewSize?: { width: number; height: number };
}

/** Pointer drag that reports normalised positions. Spread `handlers` on the handle or the area. */
export function useDragPoint(opts: DragPointOptions): {
  dragging: boolean;
  handlers: { onPointerDown: (e: ReactPointerEvent<Element>) => void };
} {
  const [dragging, setDragging] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const report = useCallback((clientX: number, clientY: number) => {
    const o = optsRef.current;
    const el = o.areaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    const sx = o.viewSize ? r.width / o.viewSize.width : 1;
    const sy = o.viewSize ? r.height / o.viewSize.height : 1;
    const inset = o.inset ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const left = r.left + inset.left * sx;
    const top = r.top + inset.top * sy;
    const w = r.width - (inset.left + inset.right) * sx;
    const h = r.height - (inset.top + inset.bottom) * sy;
    if (!(w > 0 && h > 0)) return;
    o.onMove(Math.max(0, Math.min(1, (clientX - left) / w)), Math.max(0, Math.min(1, (clientY - top) / h)));
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<Element>) => {
      const o = optsRef.current;
      if (o.disabled || e.button !== 0) return;
      e.preventDefault();
      const pid = e.pointerId;
      setDragging(true);
      o.onStart?.();
      report(e.clientX, e.clientY);
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId === pid) report(ev.clientX, ev.clientY);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setDragging(false);
        optsRef.current.onEnd?.();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [report],
  );

  return { dragging, handlers: { onPointerDown } };
}
