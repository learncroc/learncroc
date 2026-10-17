/**
 * Run keyboard shortcuts. Single keys never fire inside text fields (PLAN §7); modal layers register
 * with a higher priority so only the top layer reacts.
 */
import { useEffect, useRef } from "react";

const NON_TEXT_INPUTS = new Set(["radio", "checkbox", "range", "button", "submit", "reset", "color", "file", "image"]);

/** Text entry fields swallow single keys; radios, checkboxes and sliders don't. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type);
  return false;
}

/** Enter and Space on a focused control belong to that control, not to screen shortcuts. */
function isActivationTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest("button, a[href], summary, [role='button'], [role='menuitem']") !== null
  );
}

export type KeyHandler = (e: KeyboardEvent) => boolean | undefined;

interface Layer {
  priority: number;
  handler: KeyHandler;
  /** Also fire when focus is in a text field. */
  inFields: boolean;
}

const layers = new Set<Layer>();
/** Layers that must see a key before the app's global shortcuts (e.g. ⇧? over the shortcut sheet). */
const firstLayers = new Set<Layer>();
let installed = false;

function dispatch(set: Set<Layer>, e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  const sorted = [...set].sort((a, b) => b.priority - a.priority);
  const top = sorted[0]?.priority;
  const activation = (e.key === "Enter" || e.key === " ") && isActivationTarget(e.target);
  for (const layer of sorted) {
    if (layer.priority !== top) break;
    if (!layer.inFields && (isTypingTarget(e.target) || activation)) continue;
    if (layer.handler(e) === true) {
      e.preventDefault();
      return;
    }
  }
}

function onKeyDown(e: KeyboardEvent) {
  dispatch(layers, e);
}

/**
 * The app's global shortcuts listen on window in the capture phase and mark what they consume. This
 * capture listener is added when the module loads, before any component effect runs, so it fires
 * first: a run screen that claims a key gets it before the shortcut sheet.
 */
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => dispatch(firstLayers, e), { capture: true });
}

/**
 * Register a key handler while `enabled`. Return true from the handler to consume the key.
 * Priority: 0 = screen, 10 = overlay (dialogs). `first`: see the key before the app's
 * global shortcuts (use sparingly, for keys a run screen owns).
 */
export function useKeys(
  handler: KeyHandler,
  opts: { enabled?: boolean; priority?: number; inFields?: boolean; first?: boolean } = {},
) {
  const ref = useRef(handler);
  ref.current = handler;
  const { enabled = true, priority = 0, inFields = false, first = false } = opts;
  useEffect(() => {
    if (!enabled) return;
    if (!installed && typeof window !== "undefined") {
      window.addEventListener("keydown", onKeyDown);
      installed = true;
    }
    const layer: Layer = { priority, inFields, handler: (e) => ref.current(e) };
    const set = first ? firstLayers : layers;
    set.add(layer);
    return () => {
      set.delete(layer);
    };
  }, [enabled, priority, inFields, first]);
}

/** "1"…"9" → 0-based index, else undefined. Ignores modified keys. */
export function digitIndex(e: KeyboardEvent): number | undefined {
  if (e.metaKey || e.ctrlKey || e.altKey) return undefined;
  if (!/^[1-9]$/.test(e.key)) return undefined;
  return Number(e.key) - 1;
}
