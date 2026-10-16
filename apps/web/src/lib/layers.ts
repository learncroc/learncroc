/**
 * The layer stack (03 §3.1): one at a time, top wins.
 *
 *   5 toast · 4 modal (card, checkpoint, finished, share, confirm) · 3 croc panel · 2 peek · 1 map · 0 rail
 *
 * A surface registers its layer while mounted with `useLayer(kind)`. Keys that belong to a surface
 * (digit keys in a card, arrows on the map) check `useIsTopLayer()` first, and Esc closes only the
 * top layer (`closeTopLayer()`). Opening a modal closes the peek and the croc panel.
 */
import { useEffect, useId, useRef, useSyncExternalStore } from "react";

export type LayerKind = "rail" | "map" | "peek" | "croc" | "modal" | "toast";

/** Stacking order, bottom to top. Toasts are non-modal and never count as the top layer for keys. */
export const LAYER_ORDER: readonly LayerKind[] = ["rail", "map", "peek", "croc", "modal", "toast"];

interface Entry {
  id: string;
  kind: LayerKind;
  /** Mount order, to break ties between two layers of the same kind (a confirm over a card). */
  seq: number;
  close?: () => void;
}

const entries = new Map<string, Entry>();
const subs = new Set<() => void>();
let seq = 0;
let version = 0;

function emit() {
  version++;
  for (const fn of [...subs]) fn();
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

const rank = (k: LayerKind) => LAYER_ORDER.indexOf(k);

/** The top interactive layer (toasts excluded), or undefined when only the base screen is up. */
function top(): Entry | undefined {
  let best: Entry | undefined;
  for (const e of entries.values()) {
    if (e.kind === "toast") continue;
    if (!best || rank(e.kind) > rank(best.kind) || (rank(e.kind) === rank(best.kind) && e.seq > best.seq)) best = e;
  }
  return best;
}

/** Register a layer while the calling component is mounted. Returns the layer's id. */
export function useLayer(kind: LayerKind, opts: { open?: boolean; onClose?: () => void } = {}): string {
  const id = useId();
  const open = opts.open ?? true;
  const closeRef = useRef(opts.onClose);
  closeRef.current = opts.onClose;
  useEffect(() => {
    if (!open) return;
    entries.set(id, { id, kind, seq: ++seq, close: () => closeRef.current?.() });
    // A modal closes the peek and the croc panel under it.
    if (kind === "modal") {
      for (const e of [...entries.values()]) if (e.kind === "peek" || e.kind === "croc") e.close?.();
    }
    emit();
    return () => {
      entries.delete(id);
      emit();
    };
  }, [id, kind, open]);
  return id;
}

/** Is the calling component's layer (or, with no id, any layer of `kind`) on top? Re-renders on change. */
export function useIsTopLayer(idOrKind?: string): boolean {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  const t = top();
  if (!idOrKind) return t === undefined || t.kind === "map" || t.kind === "rail";
  if ((LAYER_ORDER as readonly string[]).includes(idOrKind))
    return t === undefined ? idOrKind === "map" : t.kind === idOrKind;
  return t?.id === idOrKind;
}

/** Non-hook check for key handlers: is a layer of this kind (or this id) on top right now? */
export function isTopLayer(idOrKind: string): boolean {
  const t = top();
  if ((LAYER_ORDER as readonly string[]).includes(idOrKind))
    return t === undefined ? idOrKind === "map" : t.kind === idOrKind;
  return t?.id === idOrKind;
}

/** Close the top layer (Esc). Returns false when nothing closable is open. */
export function closeTopLayer(): boolean {
  const t = top();
  if (!t || t.kind === "map" || t.kind === "rail" || !t.close) return false;
  t.close();
  return true;
}

/** Any modal open (the map pauses its keys and its moments). */
export function isModalOpen(): boolean {
  for (const e of entries.values()) if (e.kind === "modal") return true;
  return false;
}
