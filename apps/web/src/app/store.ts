/**
 * Shell UI state: which overlay is open (one layer at a time) and the current screen's shortcuts
 * for the shortcut sheet.
 */
import { useEffect } from "react";
import { create } from "zustand";

export type ShellLayer = "palette" | "shortcuts" | null;

export interface Shortcut {
  /** ["G", "L"], ["⌘", "K"], "R" */
  keys: string | string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

interface ShellState {
  layer: ShellLayer;
  open(layer: Exclude<ShellLayer, null>): void;
  close(): void;
  /** Shortcut groups registered by the mounted screen(s), by owner id. */
  screenShortcuts: Record<string, ShortcutGroup>;
  setShortcuts(id: string, group: ShortcutGroup | null): void;
}

export const useShell = create<ShellState>((set) => ({
  layer: null,
  open: (layer) => set({ layer }),
  close: () => set({ layer: null }),
  screenShortcuts: {},
  setShortcuts: (id, group) =>
    set((s) => {
      const next = { ...s.screenShortcuts };
      if (group) next[id] = group;
      else delete next[id];
      return { screenShortcuts: next };
    }),
}));

/**
 * Register this screen's shortcuts with the shortcut sheet (`?`) while it is mounted.
 * Pass a stable `id` (the screen name) and memoised items.
 */
export function useScreenShortcuts(id: string, group: ShortcutGroup): void {
  const setShortcuts = useShell((s) => s.setShortcuts);
  const key = JSON.stringify(group);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures the group's content
  useEffect(() => {
    setShortcuts(id, group);
    return () => setShortcuts(id, null);
  }, [id, key, setShortcuts]);
}
