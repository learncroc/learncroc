/**
 * Sends a question to POST /api/ai/ask (with the run id and the chip's intent) and folds the streamed
 * AskEvents into the exchange list. The server decides the mode (hint before a guess and during a
 * checkpoint, full otherwise) and reports the checkpoint hint level; the client only renders.
 *
 * When the server can't use AI (no key, the monthly cap, a 409 of any kind) the exchange is handed
 * back as "offline" so the chat answers from the card's notes instead: the learner never sees a 409.
 */
import type { CrocIntent } from "@learncroc/core";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../api/client";
import { ApiClientError } from "../api/errors";
import { CROC_COPY } from "./copy";
import { type CrocScope, type Exchange, exchangeId, scopeKey, useCroc } from "./store";

/** Errors that mean "answer from the notes instead". */
const OFFLINE_CODES = new Set(["ai_not_configured", "cap_reached", "conflict", "rate_limited"]);

export type StreamOutcome = { ok: true; id: string } | { ok: false; id: string; offline: boolean };

export function useCrocStream(scope: CrocScope | undefined) {
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(
    async (question: string, intent?: CrocIntent): Promise<StreamOutcome | undefined> => {
      if (!scope) return undefined;
      const q = question.trim().slice(0, 500);
      if (!q) return undefined;
      const key = scopeKey(scope);
      const id = exchangeId();
      const ex: Exchange = { id, question: q, text: "", status: "sending" };
      useCroc.getState().upsert(key, ex);
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      const patch = (p: Partial<Exchange>) => useCroc.getState().patch(key, id, p);
      try {
        const threadId = useCroc.getState().threads[key];
        const events = api.ask(
          {
            packId: scope.packId,
            ...(scope.nodeId ? { nodeId: scope.nodeId } : {}),
            ...(scope.screenId ? { screenId: scope.screenId } : {}),
            ...(scope.runId ? { runId: scope.runId } : {}),
            question: q,
            ...(threadId ? { threadId } : {}),
            ...(intent ? { intent } : {}),
          },
          { signal: ctl.signal },
        );
        let text = "";
        for await (const e of events) {
          switch (e.type) {
            case "sent":
              patch({
                mode: e.mode,
                source: e.source,
                summary: e.payloadSummary,
                status: "thinking",
                ...(e.hintLevel !== undefined ? { hintLevel: e.hintLevel } : {}),
                ...(e.source === "offline" ? { note: CROC_COPY.offlineLabel } : {}),
              });
              break;
            case "thinking":
              patch({ status: "thinking" });
              break;
            case "delta":
              text += e.text;
              patch({ text, status: "streaming" });
              break;
            case "widget":
              patch({ widget: { widget: e.widget, prompt: e.prompt } });
              break;
            case "check":
              patch({ check: { prompt: e.prompt, options: e.options, answer: e.answer } });
              break;
            case "done":
              useCroc.getState().setThread(key, e.threadId);
              patch({ status: "done", ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}) });
              break;
            case "error":
              if (OFFLINE_CODES.has(e.code)) return { ok: false, id, offline: true };
              patch({ status: "error", error: { code: e.code, message: e.message } });
              return { ok: false, id, offline: false };
          }
        }
        return { ok: true, id };
      } catch (err) {
        if (ctl.signal.aborted) {
          patch({ status: "error", error: { code: "cancelled", message: CROC_COPY.stopped } });
          return { ok: false, id, offline: false };
        }
        if (err instanceof ApiClientError) {
          if (err.status === 409 || OFFLINE_CODES.has(err.code)) return { ok: false, id, offline: true };
          patch({ status: "error", error: { code: err.code, message: err.body.message } });
          return { ok: false, id, offline: false };
        }
        patch({ status: "error", error: { code: "provider_error", message: CROC_COPY.unreachable } });
        return { ok: false, id, offline: false };
      }
    },
    [scope],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  return { send, stop };
}
