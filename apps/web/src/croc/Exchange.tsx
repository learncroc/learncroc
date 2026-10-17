/**
 * Pieces of Moss's conversation (moved from the old Ask drawer): one exchange (the question, the
 * reply with the Iris mark for live AI text or a "From this card's notes" label offline, an optional
 * "Show me" widget and a one-tap check), the card's prepared answers, and "What did I send?".
 */
import type { CompiledPack } from "@learncroc/core";
import { CROC_NAME } from "@learncroc/core";
import { Button, cn, IrisMark } from "@learncroc/ui";
import { WidgetHost } from "@learncroc/widgets";
import { Info } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useReducedMotion, useThemeMode } from "../ai/env";
import { Markdown } from "../ai/Markdown";
import { api, assetUrl } from "../api/client";
import { CROC_COPY } from "./copy";
import { type CrocScope, type Exchange, scopeKey, useCroc } from "./store";

export function Thinking() {
  const reduced = useReducedMotion();
  return (
    <p className="m-0 flex items-center gap-2 text-small text-ink-3" aria-live="polite">
      <span>{CROC_COPY.thinking}</span>
      <span aria-hidden className="inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("size-1.5 rounded-pill bg-croc", !reduced && "animate-pulse")}
            style={reduced ? undefined : { animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
    </p>
  );
}

export function CheckCard({ ex, onPick }: { ex: Exchange; onPick: (i: number) => void }) {
  const c = ex.check;
  if (!c) return null;
  const picked = c.picked;
  return (
    <fieldset className="m-0 mt-2 rounded-md border border-line bg-surface-2 p-3">
      <legend className="sr-only">Quick check</legend>
      <p className="m-0 mb-2 text-small font-[620] text-ink">{c.prompt}</p>
      <div className="flex flex-col gap-2">
        {c.options.map((o, i) => {
          const isAnswer = i === c.answer;
          const state = picked === undefined ? "rest" : isAnswer ? "right" : picked === i ? "miss" : "dim";
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: options are a fixed list
              key={i}
              type="button"
              disabled={picked !== undefined}
              onClick={() => onPick(i)}
              className={cn(
                "flex min-h-9 items-center gap-2 rounded-key border-[1.5px] px-2.5 text-left text-small transition-colors duration-quick",
                state === "rest" && "border-line-strong bg-surface hover:border-ink",
                state === "right" && "border-sea bg-sea-soft text-sea-text",
                state === "miss" && "border-line-strong bg-surface text-ink-2",
                state === "dim" && "border-line bg-surface text-ink-3",
              )}
            >
              <span className="tabular inline-flex size-5 shrink-0 items-center justify-center rounded-xs border border-line text-micro">
                {i + 1}
              </span>
              <span>{o}</span>
            </button>
          );
        })}
      </div>
      {picked !== undefined ? (
        <p className="m-0 mt-2 text-small text-ink-2" aria-live="polite">
          {picked === c.answer ? "Right." : `It's "${c.options[c.answer]}".`}
        </p>
      ) : null}
    </fieldset>
  );
}

/** The card's prepared answers (FAQ), shown with the no-key free-text reply. */
export function PreparedAnswers({ pack, nodeId }: { pack: CompiledPack | undefined; nodeId?: string }) {
  const node = nodeId ? pack?.nodes[nodeId] : undefined;
  const faq = node?.faq ?? [];
  if (faq.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-micro text-ink-3">Written for {node?.title}</p>
      {faq.map((f) => (
        <details key={f.q} className="rounded-sm border border-line bg-surface px-2.5 py-1.5">
          <summary className="cursor-pointer text-small font-[600] text-ink marker:text-ink-3">{f.q}</summary>
          <Markdown text={f.a} className="mt-1.5 text-small text-ink-2" />
        </details>
      ))}
    </div>
  );
}

export function ExchangeView({ ex, scope, pack }: { ex: Exchange; scope: CrocScope; pack?: CompiledPack }) {
  const reduced = useReducedMotion();
  const theme = useThemeMode();
  const patch = useCroc((s) => s.patch);
  const pending = ex.status === "sending" || (ex.status === "thinking" && !ex.text);
  return (
    <article className="flex flex-col gap-2" aria-label={`You asked: ${ex.question}`}>
      <p className="m-0 max-w-[90%] self-end rounded-md bg-surface-sunk px-2.5 py-1.5 text-small text-ink">
        {ex.question}
      </p>
      {pending ? <Thinking /> : null}
      {ex.text ? (
        ex.source === "ai" ? (
          <IrisMark className="voice-casual text-small leading-relaxed text-ink">
            <span className="sr-only">{CROC_NAME}: </span>
            <Markdown text={ex.text} className="inline" />
          </IrisMark>
        ) : (
          <div className="voice-casual text-small leading-relaxed text-ink">
            <span className="sr-only">{CROC_NAME}: </span>
            <Markdown text={ex.text} />
          </div>
        )
      ) : null}
      {ex.text && ex.source !== "ai" && ex.note ? <p className="m-0 text-micro text-ink-3">{ex.note}</p> : null}
      {ex.hintLevel === 1 ? <p className="m-0 text-micro text-ink-3">{CROC_COPY.firstHintFree}</p> : null}
      {ex.widget ? (
        <div className="rounded-md border border-line p-2">
          <p className="m-0 mb-2 text-micro text-ink-3">Show me · {ex.widget.prompt}</p>
          <WidgetHost
            widget={ex.widget.widget}
            mode="explore"
            reducedMotion={reduced}
            theme={theme}
            assetUrl={(p) => assetUrl(scope.packId, p)}
            alt={`A chart from ${CROC_NAME}`}
          />
        </div>
      ) : null}
      <CheckCard
        ex={ex}
        onPick={(i) => ex.check && patch(scopeKey(scope), ex.id, { check: { ...ex.check, picked: i } })}
      />
      {ex.offlineFreeText ? (
        <>
          <Link
            to="/settings/$section"
            params={{ section: "ai" }}
            className="self-start text-small font-[620] text-sea-text underline"
          >
            {CROC_COPY.setUpAi}
          </Link>
          <PreparedAnswers pack={pack} {...(scope.nodeId ? { nodeId: scope.nodeId } : {})} />
        </>
      ) : null}
      {ex.status === "error" && ex.error ? (
        <p className="m-0 flex items-start gap-2 text-small text-ink-2" role="status">
          <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
          <span>{ex.error.code === "cancelled" ? CROC_COPY.stopped : ex.error.message}</span>
        </p>
      ) : null}
    </article>
  );
}

/** The last AI request, exactly as sent (only the current card, the answers on it, its prerequisites). */
export function WhatDidISend({ onClose }: { onClose: () => void }) {
  const q = useQuery({
    queryKey: ["ai", "last-sent", "ask"],
    queryFn: () => api.getAiLastSent({ feature: "ask" }),
    staleTime: 0,
  });
  const payload = q.data?.payload as
    | { provider?: string; model?: string; system?: string[]; messages?: { role: string; content: string }[] }
    | undefined;
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-small font-[650]">What did I send?</h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Back
        </Button>
      </div>
      {q.isLoading ? <p className="m-0 text-small text-ink-3">Loading…</p> : null}
      {!q.isLoading && !payload ? <p className="m-0 text-small text-ink-3">Nothing sent yet.</p> : null}
      {payload ? (
        <>
          <p className="m-0 text-small text-ink-2">
            Sent to {payload.provider} ({payload.model}). Only this card, your answers on it and what it builds on. No
            browsing history, no other maps.
          </p>
          {(payload.system ?? []).map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the payload blocks are an immutable list
            <details key={`s${i}`} className="rounded-sm border border-line">
              <summary className="cursor-pointer px-2 py-1 text-micro text-ink-2">Instructions block {i + 1}</summary>
              <pre className="voice-mono m-0 max-h-64 overflow-auto whitespace-pre-wrap p-2 text-micro">{s}</pre>
            </details>
          ))}
          {(payload.messages ?? []).map((m, i) => (
            <details
              // biome-ignore lint/suspicious/noArrayIndexKey: the payload messages are an immutable list
              key={`m${i}`}
              open={i === (payload.messages?.length ?? 0) - 1}
              className="rounded-sm border border-line"
            >
              <summary className="cursor-pointer px-2 py-1 text-micro text-ink-2">
                {m.role === "user" ? "Your context and question" : "Earlier reply"}
              </summary>
              <pre className="voice-mono m-0 max-h-80 overflow-auto whitespace-pre-wrap p-2 text-micro">
                {m.content}
              </pre>
            </details>
          ))}
        </>
      ) : null}
    </div>
  );
}
