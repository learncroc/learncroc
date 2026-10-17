/**
 * Moss's chat state, shared by the map corner panel and the modal panes: the exchanges per card (one
 * conversation per card, "*" for the map), the AI threads, chips hidden for this session (an offline
 * chip with nothing written for that card), whether the corner panel is open, and a focus request
 * (⌘J inside a modal focuses the pane's input).
 */
import type { AskEvent, NodeId, PackId, WidgetRef } from "@learncroc/core";
import { create } from "zustand";

/** Where Moss is talking (00 §3.3): the server decides the mode, the client picks the chips. */
export type CrocContext = "map" | "hook" | "card" | "checkpoint" | "checkpoint-result" | "relight";

export interface CrocScope {
  packId: PackId;
  nodeId?: NodeId;
  screenId?: string;
  runId?: string;
  context: CrocContext;
}

export type ExchangeStatus = "sending" | "thinking" | "streaming" | "done" | "error";

export interface Exchange {
  id: string;
  question: string;
  mode?: "hint" | "full";
  /** "ai": live model text (Iris mark). "offline": the card's own notes. "local": answered from the map. */
  source?: "ai" | "offline" | "local";
  /** Small label under an offline or local reply. */
  note?: string;
  /** Checkpoint / Relight: the question's hint level after this reply. */
  hintLevel?: 0 | 1 | 2;
  summary?: Extract<AskEvent, { type: "sent" }>["payloadSummary"];
  text: string;
  status: ExchangeStatus;
  check?: { prompt: string; options: string[]; answer: number; picked?: number };
  widget?: { widget: WidgetRef; prompt: string };
  error?: { code: string; message: string };
  /** Free text without a key: show "Set up AI" and the card's prepared answers. */
  offlineFreeText?: boolean;
  costUsd?: number;
}

/** One conversation per card; the map has its own ("*"). */
export const scopeKey = (s: Pick<CrocScope, "packId" | "nodeId">) => `${s.packId}/${s.nodeId ?? "*"}`;

interface CrocStore {
  exchanges: Record<string, Exchange[]>;
  threads: Record<string, string>;
  /** `${scopeKey}#${chip label}`: offline chips with nothing written, hidden for the session. */
  hiddenChips: Record<string, true>;
  /** The map corner's chat panel. */
  panelOpen: boolean;
  /** Bumped by ⌘J inside a modal: the mounted pane focuses its input. */
  focusTick: number;
  setPanelOpen(open: boolean): void;
  requestFocus(): void;
  upsert(key: string, ex: Exchange): void;
  patch(key: string, id: string, p: Partial<Exchange>): void;
  setThread(key: string, threadId: string): void;
  hideChip(key: string, label: string): void;
}

export const useCroc = create<CrocStore>((set) => ({
  exchanges: {},
  threads: {},
  hiddenChips: {},
  panelOpen: false,
  focusTick: 0,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  requestFocus: () => set((s) => ({ focusTick: s.focusTick + 1 })),
  upsert: (key, ex) =>
    set((s) => {
      const list = s.exchanges[key] ?? [];
      const i = list.findIndex((e) => e.id === ex.id);
      const next = i >= 0 ? list.map((e, j) => (j === i ? ex : e)) : [...list, ex];
      return { exchanges: { ...s.exchanges, [key]: next } };
    }),
  patch: (key, id, p) =>
    set((s) => ({
      exchanges: {
        ...s.exchanges,
        [key]: (s.exchanges[key] ?? []).map((e) => (e.id === id ? { ...e, ...p } : e)),
      },
    })),
  setThread: (key, threadId) => set((s) => ({ threads: { ...s.threads, [key]: threadId } })),
  hideChip: (key, label) => set((s) => ({ hiddenChips: { ...s.hiddenChips, [`${key}#${label}`]: true } })),
}));

let seq = 0;
/** A fresh exchange id. */
export const exchangeId = (prefix = "x") => `${prefix}${++seq}`;
