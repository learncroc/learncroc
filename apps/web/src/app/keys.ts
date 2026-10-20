/**
 * Global keys: `⌘K` command palette, `G` then a letter to go somewhere, `?` the
 * shortcut sheet, `⌘,` settings. Single-key shortcuts never fire inside text fields; `G` navigation
 * is off in focus mode (Relight) so a stray key never pulls a learner out of a session.
 *
 * Layers (lib/layers.ts): while a modal is the top layer (a card, a checkpoint, a confirm), the
 * screen's single keys and every G sequence stay quiet, so a digit picks an option in the card and
 * never navigates. Only the modal's own keys react.
 *
 * Screen shortcuts: listen on window (bubble phase) and skip events with `defaultPrevented`; the
 * global handler runs first (capture) and marks every key it consumes, including the second key of
 * a G sequence. `useScreenKeys` does this for you.
 */

import { isTypingTarget } from "@learncroc/ui";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { isModalOpen } from "../lib/layers";
import type { ShortcutGroup } from "./store";
import { useShell } from "./store";

/**
 * G-then-letter destinations. `M` (current map) is resolved at runtime. `D` is a hidden alias of
 * `F` (Flashcards), kept for muscle memory.
 */
export const GO_KEYS: Record<string, { label: string; href: string | null; alias?: boolean }> = {
  l: { label: "Library", href: "/library" },
  m: { label: "Current map", href: null },
  r: { label: "Relight", href: "/relight" },
  c: { label: "Create", href: "/create" },
  j: { label: "Logbook", href: "/logbook" },
  f: { label: "Flashcards", href: "/flashcards" },
  k: { label: "Marketplace", href: "/market" },
  s: { label: "Settings", href: "/settings/ai" },
  d: { label: "Flashcards", href: "/flashcards", alias: true },
};

/** True while something sits above the screen (a modal layer or any aria-modal dialog). */
export function screenCovered(): boolean {
  if (isModalOpen()) return true;
  if (typeof document === "undefined") return false;
  return document.querySelector('[aria-modal="true"]') !== null;
}

export const SEQUENCE_MS = 1200;

export function globalShortcutGroups(mod: string): ShortcutGroup[] {
  return [
    {
      title: "Anywhere",
      items: [
        { keys: [mod, "K"], label: "Command palette: maps, cards, flashcards, settings" },
        { keys: "?", label: "This sheet" },
        { keys: "Esc", label: "Close the top layer" },
        { keys: [mod, ","], label: "Settings" },
        { keys: [mod, "J"], label: "Ask Moss" },
      ],
    },
    {
      title: "Go to",
      items: Object.entries(GO_KEYS)
        .filter(([, v]) => !v.alias)
        .map(([k, v]) => ({ keys: ["G", k.toUpperCase()], label: v.label })),
    },
  ];
}

export interface GlobalKeyOptions {
  /** Focus mode (run-like screens): G navigation is off. */
  focus: boolean;
  /** href of the current map, if any (for G M). */
  currentMapHref: string | null;
}

export function useGlobalKeys({ focus, currentMapHref }: GlobalKeyOptions): void {
  const router = useRouter();
  const open = useShell((s) => s.open);
  const pendingG = useRef<number | null>(null);
  const opts = useRef({ focus, currentMapHref });
  opts.current = { focus, currentMapHref };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && key === "k") {
        e.preventDefault();
        const s = useShell.getState();
        if (s.layer === "palette") s.close();
        else open("palette");
        return;
      }
      if (mod && !e.altKey && e.key === ",") {
        e.preventDefault();
        router.history.push("/settings/ai");
        return;
      }
      if (mod || e.altKey || isTypingTarget(e.target) || useShell.getState().layer) return;
      if (e.key === "?" && !screenCovered()) {
        e.preventDefault();
        open("shortcuts");
        return;
      }
      if (opts.current.focus) return;
      // A card or checkpoint on top: its own keys only. G L, G M… do nothing until it closes.
      if (screenCovered()) {
        pendingG.current = null;
        return;
      }
      const now = e.timeStamp || performance.now();
      if (pendingG.current !== null && now - pendingG.current <= SEQUENCE_MS) {
        pendingG.current = null;
        const dest = GO_KEYS[key];
        if (!dest) return;
        // Consumed even with nowhere to go, so the screen's own single-key shortcut doesn't fire.
        e.preventDefault();
        const href = dest.href ?? opts.current.currentMapHref;
        if (href) router.history.push(href);
        return;
      }
      if (key === "g" && !e.shiftKey) pendingG.current = now;
      else pendingG.current = null;
    };
    // Capture phase: runs before screen handlers, which skip events marked defaultPrevented.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [router, open]);
}

/**
 * Single-key shortcuts for a screen: never inside text fields, never with modifiers, never while an
 * overlay or a modal layer is open, never when the global handler consumed the key (the L of "G L").
 */
export function useScreenKeys(handlers: Record<string, (e: KeyboardEvent) => void>, enabled = true): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (useShell.getState().layer) return;
      if (screenCovered()) return;
      const fn = ref.current[e.key] ?? ref.current[e.key.toLowerCase()];
      if (fn) fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
