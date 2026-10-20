/**
 * /create/pocket: Map an article. A link or the text itself, a preview line, the size
 * in cards (Short · about 5 / Standard · about 8 / Thorough · about 12), what you know already,
 * the provider and cost with "first card in about 20 seconds", and exactly what will be sent.
 * With no AI the form stays visible and Map it becomes Set up AI; offline and the static demo say so
 * in one line. The example article maps below work without any of it.
 */
import type { CreateRequest, CreateSize, InstalledPackSummary } from "@learncroc/core";
import { Button, buttonClass, cn, Kbd, Segmented } from "@learncroc/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { isDemo } from "../../app/demo";
import { useAiStatus, usePackPosters, usePacks, useSettings } from "../../app/queries";
import { isOffline } from "../../lib/env";
import { isTypingTarget } from "../../lib/keys";
import { Poster } from "../library/ShelfPoster";
import { rememberJob } from "./jobs";
import { createErrorCopy, DemoPasteNote, INTAKE_PREFILL, MIN_TEXT_WORDS, parsePaste } from "./PasteBar";

export const SIZES: readonly { value: CreateSize; label: string }[] = [
  { value: "short", label: "Short · about 5 cards" },
  { value: "standard", label: "Standard · about 8" },
  { value: "thorough", label: "Thorough · about 12" },
];
const FAMILIARITY: readonly { value: CreateRequest["familiarity"]; label: string }[] = [
  { value: "none", label: "nothing about this" },
  { value: "some", label: "a bit" },
  { value: "lots", label: "a lot" },
];
const PROVIDER_NAME: Record<string, string> = {
  anthropic: "Claude (Anthropic)",
  "openai-compatible": "an OpenAI-compatible model",
  ollama: "Ollama on this computer",
};

/** sessionStorage hand-off: "text" opens the Text tab (failure copy "Paste the text"). */
export const INTAKE_HANDOFF = "lm:intake-mode";

function takeSession(key: string): string | null {
  try {
    const v = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return v;
  } catch {
    return null;
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const wordsOf = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export function Intake() {
  const navigate = useNavigate();
  const status = useAiStatus();
  const settings = useSettings();
  const packs = usePacks();
  const [prefill] = useState(() => takeSession(INTAKE_PREFILL));
  const [mode, setMode] = useState<"url" | "text">(() => {
    const m = takeSession(INTAKE_HANDOFF);
    if (m === "text") return "text";
    return prefill && parsePaste(prefill).kind !== "url" ? "text" : "url";
  });
  const [url, setUrl] = useState(() => (prefill && parsePaste(prefill).kind === "url" ? prefill.trim() : ""));
  const [text, setText] = useState(() => (prefill && parsePaste(prefill).kind !== "url" ? prefill : ""));
  const [title, setTitle] = useState("");
  const [size, setSize] = useState<CreateSize>("standard");
  const [familiarity, setFamiliarity] = useState<CreateRequest["familiarity"]>("none");
  const ids = { url: useId(), text: useId(), title: useId(), sent: useId() };
  const first = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mode` swaps which field the ref points at
  useEffect(() => {
    first.current?.focus();
  }, [mode]);

  const configured = status.data?.configured ?? false;
  const offline = isOffline();
  const request: CreateRequest | null = useMemo(() => {
    if (mode === "url") {
      const p = parsePaste(url);
      return p.kind === "url" ? { source: { kind: "url", url: p.url }, size, familiarity } : null;
    }
    if (wordsOf(text) < MIN_TEXT_WORDS) return null;
    const p = parsePaste(text);
    const fallbackTitle = p.kind === "text" ? p.title : "Pasted text";
    return { source: { kind: "text", text, title: title.trim() || fallbackTitle }, size, familiarity };
  }, [mode, url, text, title, size, familiarity]);
  const debounced = useDebounced(request, 400);
  const estimate = useQuery({
    queryKey: ["ai", "estimate", debounced],
    queryFn: () => api.estimateCreate(debounced as CreateRequest),
    enabled: !!debounced && configured,
    retry: false,
  });
  const create = useMutation({
    mutationFn: (req: CreateRequest) => api.createPocketMap(req),
    onSuccess: ({ jobId, packId }) => {
      rememberJob(jobId, packId);
      void navigate({ to: "/create/pocket/$job", params: { job: jobId } });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = ({ "1": "short", "2": "standard", "3": "thorough" } as const)[e.key as "1" | "2" | "3"];
      if (s) setSize(s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const overCap = estimate.data?.overCap ?? false;
  const submitError = create.error ? createErrorCopy(create.error) : undefined;
  const blockedOffline = offline && mode === "url";
  const submit = () => {
    if (request && configured && !overCap && !blockedOffline) create.mutate(request);
  };

  const gallery = (packs.data ?? []).filter((p: InstalledPackSummary) => p.kind === "pocket" && p.status === "ok");
  const galleryPosters = usePackPosters(gallery.slice(0, 4).map((p) => p.id));
  const provider = status.data?.provider ?? settings.data?.ai.provider ?? "none";
  const words = mode === "text" ? wordsOf(text) : 0;
  const host = (() => {
    if (mode !== "url" || !request || request.source.kind !== "url") return null;
    try {
      return new URL(request.source.url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-8 py-12" aria-labelledby="intake-title">
      <header>
        <Link to="/create" className="text-small text-ink-2 hover:text-ink">
          Create
        </Link>
        <h1 id="intake-title" className="m-0 mt-2 t-title text-ink">
          Map an article
        </h1>
        <p className="m-0 mt-2 t-lead text-ink-2">
          Paste a link or the text itself. Learncroc writes a short map of cards, with checkpoints.
        </p>
      </header>

      {isDemo() ? (
        <DemoPasteNote />
      ) : (
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div role="tablist" aria-label="Source" className="flex gap-1 self-start rounded-sm bg-surface-sunk p-1">
            {(["url", "text"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-xs px-3 py-1.5 text-small",
                  mode === m ? "bg-surface text-ink shadow-1" : "text-ink-2 hover:text-ink",
                )}
              >
                {m === "url" ? "Link" : "Text"}
              </button>
            ))}
          </div>

          {mode === "url" ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={ids.url} className="sr-only">
                Article link
              </label>
              <input
                id={ids.url}
                type="url"
                inputMode="url"
                ref={first}
                value={url}
                placeholder="https://en.wikipedia.org/wiki/Monty_Hall_problem"
                onChange={(e) => setUrl(e.target.value)}
                className="voice-mono h-14 rounded-key border-[1.5px] border-line-strong bg-surface px-4 text-body text-ink focus:border-focus focus:outline-none"
              />
              <p className="m-0 text-small text-ink-2" aria-live="polite">
                {host
                  ? `${host} · Learncroc reads the page when you press Map it.`
                  : "Public pages only. Links to this computer or your network are refused."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label htmlFor={ids.title} className="text-small font-[620] text-ink">
                Title
              </label>
              <input
                id={ids.title}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-10 rounded-sm border border-line-strong bg-surface px-3 text-body"
                placeholder="What is it about?"
              />
              <label htmlFor={ids.text} className="mt-2 text-small font-[620] text-ink">
                Text
              </label>
              <textarea
                id={ids.text}
                ref={first}
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="rounded-sm border border-line-strong bg-surface p-3 text-body"
                placeholder="Paste the article. Blank lines separate paragraphs; lines starting with # are headings."
              />
              <p className="m-0 text-small text-ink-2" aria-live="polite">
                {words
                  ? `About ${words.toLocaleString("en")} words${words < MIN_TEXT_WORDS ? `. A map needs at least ${MIN_TEXT_WORDS}.` : "."}`
                  : "The text is used to build the map and then discarded."}
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[7rem_1fr] sm:items-center">
            <p className="m-0 text-small font-[620] text-ink">How big?</p>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented label="How big?" value={size} onChange={setSize} options={SIZES} />
              <span className="text-micro text-ink-3">
                <Kbd keys="1" /> <Kbd keys="2" /> <Kbd keys="3" />
              </span>
            </div>
            <p className="m-0 text-small font-[620] text-ink">I know</p>
            <div className="justify-self-start">
              <Segmented label="I know" value={familiarity} onChange={setFamiliarity} options={FAMILIARITY} />
            </div>
          </div>

          <div className="grid gap-3 border-t border-line pt-6">
            <div className="flex flex-wrap items-center gap-4">
              <p className="m-0 flex-1 text-small text-ink-2" aria-live="polite">
                {!configured
                  ? "Article maps need an AI key or a local model. Ollama runs free on your computer."
                  : blockedOffline
                    ? "You're offline. Article maps need to fetch the page; pasting the text works with a local model."
                    : [
                        `Uses ${estimate.data?.model ?? PROVIDER_NAME[provider] ?? "your AI setup"}`,
                        estimate.data
                          ? estimate.data.usd > 0
                            ? `about $${estimate.data.usd.toFixed(2)}`
                            : "no cost"
                          : request
                            ? "estimating…"
                            : null,
                        "first card in about 20 seconds",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
              </p>
              {configured ? (
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={!request || overCap || create.isPending || blockedOffline}
                  kbd="⏎"
                >
                  {create.isPending ? "Starting…" : "Map it"}
                </Button>
              ) : (
                <Link
                  to="/settings/$section"
                  params={{ section: "ai" }}
                  className={buttonClass({ variant: "primary", size: "lg" })}
                >
                  Set up AI
                </Link>
              )}
            </div>
            {configured ? (
              <details className="text-small text-ink-2">
                <summary className="cursor-pointer self-start text-ink underline decoration-1 underline-offset-2">
                  What will be sent?
                </summary>
                <div id={ids.sent} className="mt-3 grid gap-2 rounded-sm border border-line bg-surface-2 p-4">
                  <p className="m-0">
                    To {PROVIDER_NAME[provider] ?? "your AI provider"}:{" "}
                    {mode === "url"
                      ? "the readable text of that page (Learncroc fetches it on this computer first)"
                      : "the text you pasted and its title"}
                    , the size you picked and how much you know already.
                  </p>
                  <p className="m-0">
                    Never sent: your progress, your other maps or your flashcards.
                    {provider === "ollama" ? " With Ollama nothing leaves this computer." : ""}
                  </p>
                </div>
              </details>
            ) : null}
            {overCap ? (
              <p className="m-0 text-small text-ember-text" role="alert">
                This would go over this month's AI budget. Raise it in{" "}
                <Link to="/settings/$section" params={{ section: "ai" }} className="underline">
                  Settings
                </Link>
                , or try a shorter map.
              </p>
            ) : null}
            {submitError ? (
              <p className="m-0 text-small text-ember-text" role="alert">
                {submitError}
              </p>
            ) : null}
          </div>
        </form>
      )}

      {gallery.length ? (
        <section aria-labelledby="examples" className="border-t border-line pt-8">
          <h2 id="examples" className="m-0 mb-4 text-heading text-ink">
            Example article maps <span className="text-small font-normal text-ink-2">(work without AI)</span>
          </h2>
          <div className="grid grid-cols-12 gap-5">
            {galleryPosters.map((d) => {
              const s = gallery.find((p) => p.id === d.id);
              return s ? (
                <Poster
                  key={d.id}
                  summary={s}
                  size="pocket"
                  className="col-span-6 md:col-span-3"
                  {...(d.pack ? { pack: d.pack } : {})}
                  {...(d.progress ? { progress: d.progress } : {})}
                />
              ) : null;
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}
