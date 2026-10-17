/**
 * Moss's chat body, shared by the map corner panel and the modal pane: the conversation for this
 * scope, quick chips for the moment and a short input.
 *
 * With an AI key the question goes to POST /ai/ask with the run id and the chip's intent; the server
 * decides the mode (hint before the guess and during a checkpoint, full otherwise). Without one, or
 * whenever the server can't use AI, chips answer from the card's own notes (core `offlineCrocReply`,
 * ≤ 75 words, ending "Try this: …", labelled "From this card's notes") and free text explains what
 * works offline with a "Set up AI" link. Map chips are answered on the client from pack data.
 */
import { type CompiledPack, CROC_NAME, type CrocIntent, offlineCrocReply } from "@learncroc/core";
import { Button, cn } from "@learncroc/ui";
import { ArrowUp, Eye, Stop as StopIcon } from "@phosphor-icons/react";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAiConfigured } from "../run/queries";
import { CROC_COPY } from "./copy";
import { ExchangeView, WhatDidISend } from "./Exchange";
import { type CrocScope, type Exchange, exchangeId, scopeKey, useCroc } from "./store";
import { useCrocStream } from "./useCrocStream";

export interface CrocChip {
  label: string;
  intent: CrocIntent;
  /** Answer on the client from pack data (map chips). */
  local?: () => string;
  /** A small line under the chip row ("This one won't count if you take it."). */
  note?: string;
  disabled?: boolean;
}

/** An answer built without AI. `empty`: nothing authored for this chip on this card (the chip hides). */
export interface OfflineAnswer {
  text: string;
  note?: string;
  hintLevel?: 0 | 1 | 2;
  empty?: boolean;
}

export interface CrocChatProps {
  scope: CrocScope;
  pack?: CompiledPack;
  chips: CrocChip[];
  /** "hint" before the guess and in checkpoint / Relight questions. */
  mode: "hint" | "full";
  placeholder: string;
  inputLabel?: string;
  /** A fixed line under the input ("Hints only during a checkpoint."). */
  fixedNote?: string;
  /** Build the offline reply for a chip (default: core `offlineCrocReply` over the card's notes). */
  offline?(chip: CrocChip): Promise<OfflineAnswer> | OfflineAnswer;
  /** After any reply lands (the pane refreshes the run so hint pips update). */
  onReply?(ex: Exchange): void;
  onThinking?(thinking: boolean): void;
  onListening?(listening: boolean): void;
  /** Focus the input when this changes (⌘J). */
  focusTick?: number;
  /** Ask a chip from outside (the E / X / D keys) when `tick` changes. */
  trigger?: { label: string; tick: number };
  /** Key hints shown on chips, by label. */
  chipKeys?: Record<string, string>;
  className?: string;
}

const NONE: Exchange[] = [];

/** The default offline reply: core's, from authored content; "generic" means nothing was written for it. */
export function defaultOffline(pack: CompiledPack | undefined, scope: CrocScope, mode: "hint" | "full") {
  return (chip: CrocChip): OfflineAnswer => {
    if (!pack) return { text: CROC_COPY.offlineEmpty, empty: true };
    const r = offlineCrocReply({
      pack,
      mode,
      intent: chip.intent,
      ...(scope.nodeId && pack.nodes[scope.nodeId] ? { nodeId: scope.nodeId } : {}),
      ...(scope.screenId ? { screenId: scope.screenId } : {}),
    });
    if (r.basis === "generic" && chip.intent !== "hint") return { text: CROC_COPY.offlineEmpty, empty: true };
    return { text: r.text, note: CROC_COPY.offlineLabel };
  };
}

export function CrocChat(p: CrocChatProps) {
  const { scope, pack, chips, mode } = p;
  const key = scopeKey(scope);
  const exchanges = useCroc((s) => s.exchanges[key] ?? NONE);
  const hidden = useCroc((s) => s.hiddenChips);
  const aiConfigured = useAiConfigured();
  const { send, stop } = useCrocStream(scope);
  const [text, setText] = useState("");
  const [showSent, setShowSent] = useState(false);
  const inputId = useId();
  const noteId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const offline = useMemo(() => p.offline ?? defaultOffline(pack, scope, mode), [p.offline, pack, scope, mode]);
  const onReply = useRef(p.onReply);
  onReply.current = p.onReply;
  const onThinking = useRef(p.onThinking);
  onThinking.current = p.onThinking;

  const busy = exchanges.some((x) => x.status === "sending" || x.status === "thinking" || x.status === "streaming");
  useEffect(() => onThinking.current?.(busy), [busy]);

  // ⌘J (or the corner opening) focuses the input.
  useEffect(() => {
    if (p.focusTick) input.current?.focus();
  }, [p.focusTick]);

  // Keep the newest reply in view.
  const lastText = exchanges.at(-1)?.text;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the conversation grows or streams.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [exchanges.length, lastText]);

  const answerOffline = async (id: string, question: string, chip?: CrocChip) => {
    const store = useCroc.getState();
    if (!chip) {
      const ex: Exchange = {
        id,
        question,
        text: CROC_COPY.offlineFree,
        status: "done",
        mode,
        source: "offline",
        offlineFreeText: true,
      };
      store.upsert(key, ex);
      onReply.current?.(ex);
      return;
    }
    store.upsert(key, { id, question, text: "", status: "thinking", mode, source: "offline" });
    try {
      const a = await offline(chip);
      if (a.empty) store.hideChip(key, chip.label);
      const ex: Exchange = {
        id,
        question,
        text: a.text,
        status: "done",
        mode,
        source: "offline",
        ...(a.note ? { note: a.note } : {}),
        ...(a.hintLevel !== undefined ? { hintLevel: a.hintLevel } : {}),
      };
      store.upsert(key, ex);
      onReply.current?.(ex);
    } catch {
      store.upsert(key, {
        id,
        question,
        text: "",
        status: "error",
        error: { code: "offline", message: CROC_COPY.unreachable },
      });
    }
  };

  const ask = async (question: string, chip?: CrocChip) => {
    setShowSent(false);
    if (chip?.local) {
      useCroc.getState().upsert(key, {
        id: exchangeId("l"),
        question,
        text: chip.local(),
        status: "done",
        mode: "full",
        source: "local",
        note: CROC_COPY.mapLabel,
      });
      return;
    }
    if (!aiConfigured) {
      await answerOffline(exchangeId("o"), question, chip);
      return;
    }
    const out = await send(question, chip?.intent ?? "ask");
    if (!out) return;
    if (!out.ok && out.offline) await answerOffline(out.id, question, chip);
    else {
      const ex = useCroc.getState().exchanges[key]?.find((e) => e.id === out.id);
      if (ex) onReply.current?.(ex);
    }
  };

  const askRef = useRef(ask);
  askRef.current = ask;
  const trigger = p.trigger;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once per trigger tick.
  useEffect(() => {
    if (!trigger || busy) return;
    const chip = chips.find((c) => c.label === trigger.label && !c.disabled);
    if (chip && !hidden[`${key}#${chip.label}`]) void askRef.current(chip.label, chip);
  }, [trigger?.tick]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setText("");
    void ask(q);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && text) {
      // Esc clears the draft first; a second Esc closes the layer.
      e.stopPropagation();
      setText("");
    }
  };

  const visibleChips = chips.filter((c) => !hidden[`${key}#${c.label}`]);
  const chipNote = visibleChips.find((c) => c.note)?.note;

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", p.className)} data-croc-chat data-mode={mode}>
      {showSent ? (
        <WhatDidISend onClose={() => setShowSent(false)} />
      ) : exchanges.length > 0 ? (
        <ol ref={list} className="m-0 flex min-h-0 flex-1 list-none flex-col gap-4 overflow-y-auto p-0 pr-1">
          {exchanges.map((x) => (
            <li key={x.id}>
              <ExchangeView ex={x} scope={scope} {...(pack ? { pack } : {})} />
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex-1" />
      )}
      {visibleChips.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5" data-croc-chips>
            {visibleChips.map((c) => (
              <button
                key={c.label}
                type="button"
                disabled={busy || c.disabled}
                onClick={() => void ask(c.label, c)}
                className="rounded-pill border border-line-strong bg-surface px-3 py-1 text-left text-small text-ink transition-colors duration-quick hover:border-croc hover:bg-croc-belly/40 disabled:cursor-default disabled:opacity-50 disabled:hover:border-line-strong disabled:hover:bg-surface"
              >
                {c.label}
                {p.chipKeys?.[c.label] ? (
                  <kbd className="ml-1.5 font-sans text-micro text-ink-3">{p.chipKeys[c.label]}</kbd>
                ) : null}
              </button>
            ))}
          </div>
          {chipNote ? <p className="m-0 text-micro text-ink-3">{chipNote}</p> : null}
        </div>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <label htmlFor={inputId} className="sr-only">
            {p.inputLabel ?? `Ask ${CROC_NAME}`}
          </label>
          <input
            id={inputId}
            ref={input}
            value={text}
            maxLength={500}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => p.onListening?.(true)}
            onBlur={() => p.onListening?.(false)}
            placeholder={p.placeholder}
            aria-describedby={p.fixedNote ? noteId : undefined}
            className="h-9 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-2.5 text-small text-ink placeholder:text-ink-3 focus:border-focus focus:outline-none"
          />
          {busy ? (
            <Button size="sm" variant="secondary" type="button" aria-label="Stop" onClick={stop}>
              <StopIcon size={14} aria-hidden />
            </Button>
          ) : (
            <Button size="sm" variant="secondary" type="submit" aria-label="Send" disabled={!text.trim()}>
              <ArrowUp size={14} aria-hidden />
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          {p.fixedNote ? (
            <p id={noteId} className="m-0 text-micro text-ink-3" data-croc-fixed-note>
              {p.fixedNote}
            </p>
          ) : (
            <span />
          )}
          {aiConfigured && exchanges.some((x) => x.source === "ai") ? (
            <button
              type="button"
              onClick={() => setShowSent((v) => !v)}
              aria-pressed={showSent}
              className="inline-flex items-center gap-1 text-micro text-ink-3 hover:text-ink-2"
            >
              <Eye size={12} aria-hidden /> What did I send?
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
