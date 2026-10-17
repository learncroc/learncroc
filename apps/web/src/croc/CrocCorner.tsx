/**
 * Moss in the map's corner (slot, MapView's screen-space overlay): bottom-left, 64 px, a reaction
 * bubble from the bus and an "Ask Moss ⌘J" label. Minimisable to the avatar alone (persisted).
 *
 * Clicking Moss (or ⌘J) opens the chat panel: a non-modal popover (380 × 560, layer 3) with the map
 * chips answered locally from pack data and free text through the stream. Esc closes it and focus
 * returns to Moss. When a card or checkpoint modal opens, Moss hops into the modal (the pane there)
 * and the corner empties; reduced motion crossfades instead.
 */
import { CROC_NAME } from "@learncroc/core";
import { Croc, CrocBubble, cn, Kbd } from "@learncroc/ui";
import { CaretUp, Minus } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTypingTarget } from "../lib/keys";
import { isModalOpen, useIsTopLayer, useLayer } from "../lib/layers";
import { useReducedMotion } from "../run/prefs";
import { usePackQuery } from "../run/queries";
import type { CrocCornerProps } from "../slots";
import { CrocChat } from "./CrocChat";
import { CROC_COPY, contextLine, placeholderFor } from "./copy";
import { mapChips } from "./mapChips";
import { useCroc } from "./store";
import { useCrocReactions } from "./useCrocReactions";

const MIN_KEY = "lm:croc:minimised";

function readMinimised(): boolean {
  try {
    return localStorage.getItem(MIN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Re-render when any modal opens or closes (the layer stack). */
function useModalOpen(): boolean {
  useIsTopLayer();
  return isModalOpen();
}

export function CrocCorner({ packId, views, selected }: CrocCornerProps) {
  const pack = usePackQuery(packId).data;
  const open = useCroc((s) => s.panelOpen);
  const setOpen = useCroc((s) => s.setPanelOpen);
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [minimised, setMinimised] = useState(readMinimised);
  const [focusTick, setFocusTick] = useState(0);
  const reduced = useReducedMotion();
  const modalOpen = useModalOpen();
  const button = useRef<HTMLButtonElement>(null);
  const mood = useCrocReactions({ filter: (e) => e.packId === packId && !isModalOpen() });
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
  }, [setOpen]);
  useLayer("croc", { open, onClose: close });
  const peeked = selected && pack?.map.nodes[selected] ? selected : undefined;
  const chips = useMemo(() => mapChips(pack, views, peeked), [pack, views, peeked]);
  const scope = useMemo(
    () => ({ packId, ...(peeked ? { nodeId: peeked } : {}), context: "map" as const }),
    [packId, peeked],
  );
  const title = peeked ? pack?.map.nodes[peeked]?.title : undefined;

  // The panel never stays open under a modal, and closes with the map.
  useEffect(() => {
    if (modalOpen && open) setOpen(false);
  }, [modalOpen, open, setOpen]);
  useEffect(() => () => useCroc.getState().setPanelOpen(false), []);

  const toggle = useCallback(() => {
    const next = !useCroc.getState().panelOpen;
    setOpen(next);
    if (next) {
      setMinimised(false);
      setFocusTick((t) => t + 1);
    }
  }, [setOpen]);

  // ⌘J on the map opens the panel (inside a modal the pane takes it). Esc closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        if (isModalOpen()) return;
        e.preventDefault();
        if (useCroc.getState().panelOpen) close();
        else toggle();
        return;
      }
      if (e.key === "Escape" && useCroc.getState().panelOpen && !isModalOpen()) {
        if (isTypingTarget(e.target) && (e.target as HTMLInputElement).value) return;
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, toggle]);

  const setMin = (v: boolean) => {
    setMinimised(v);
    try {
      localStorage.setItem(MIN_KEY, v ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  const state = thinking ? "thinking" : listening ? "listening" : mood.state;
  const size = minimised ? 44 : 64;

  return (
    <div
      className={cn(
        "absolute bottom-5 left-5 flex flex-col items-start gap-2",
        reduced ? "transition-opacity duration-[120ms]" : "transition-[opacity,transform] duration-[360ms] ease-in-out",
        modalOpen && "pointer-events-none opacity-0",
        modalOpen && !reduced && "translate-x-[40px] -translate-y-[24px] scale-[0.625]",
      )}
      style={{ transformOrigin: "left bottom" }}
      aria-hidden={modalOpen || undefined}
      data-slot="croc-corner"
      data-minimised={minimised || undefined}
    >
      {open && !modalOpen ? (
        <section
          aria-label={`${CROC_NAME}: ${contextLine("map", title)}`}
          className="lm-slide-in-up flex h-[min(560px,calc(100dvh-220px))] w-[min(380px,calc(100vw-120px))] flex-col gap-3 rounded-md border border-line bg-surface p-4 shadow-3"
          data-croc-panel
        >
          <header className="flex items-start gap-3">
            <Croc state={state} size={40} lumen={mood.lumen} decorative />
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-body font-semibold text-ink">{contextLine("map", title)}</h2>
              <p className="m-0 text-small text-ink-2">{CROC_COPY.mapPanelIntro}</p>
            </div>
            <button
              type="button"
              onClick={close}
              className="flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-small text-ink-2 hover:bg-surface-2"
            >
              Close <Kbd keys="Esc" />
            </button>
          </header>
          <CrocChat
            scope={scope}
            {...(pack ? { pack } : {})}
            chips={chips}
            mode="full"
            placeholder={placeholderFor("map", title)}
            inputLabel={`Ask ${CROC_NAME} about this map`}
            onThinking={setThinking}
            onListening={setListening}
            focusTick={focusTick}
            className="min-h-0 flex-1"
          />
        </section>
      ) : mood.line && !minimised ? (
        <CrocBubble tail="bottom-left" onDone={mood.clearLine} className="ml-2">
          {mood.line}
        </CrocBubble>
      ) : null}
      <div className="group flex items-end gap-1">
        <button
          ref={button}
          type="button"
          aria-label={CROC_COPY.cornerLabel}
          aria-expanded={open}
          tabIndex={modalOpen ? -1 : 0}
          onClick={toggle}
          className={cn(
            "flex items-center gap-2 rounded-pill p-1 pr-1 transition-transform duration-quick hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            open && "bg-surface shadow-2",
          )}
        >
          <Croc state={state} size={size} lumen={mood.lumen} decorative />
          {minimised ? null : (
            <span className="mb-1 hidden items-center gap-1.5 rounded-pill border border-line bg-surface/95 px-2.5 py-1 text-small text-ink-2 shadow-1 sm:inline-flex">
              {CROC_COPY.askHotkey}
              <Kbd keys={["⌘", "J"]} kind="chord" />
            </span>
          )}
        </button>
        {open ? null : (
          <button
            type="button"
            onClick={() => setMin(!minimised)}
            aria-label={minimised ? CROC_COPY.restore : CROC_COPY.minimise}
            tabIndex={modalOpen ? -1 : 0}
            className="mb-1 rounded-pill p-1 text-ink-3 opacity-0 transition-opacity duration-quick group-hover:opacity-100 hover:bg-surface-2 hover:text-ink-2 focus-visible:opacity-100"
          >
            {minimised ? <CaretUp size={12} aria-hidden /> : <Minus size={12} aria-hidden />}
          </button>
        )}
      </div>
    </div>
  );
}
