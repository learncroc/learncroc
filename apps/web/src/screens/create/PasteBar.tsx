/**
 * The paste bar: one field for a link or the text itself, "Map it ⏎". Used
 * on the library (first run and returning, `N` focuses it) with the defaults (Standard size, "I know
 * nothing about this"); the full intake at /create/pocket offers the choices.
 *
 * Without AI the field stays usable; submitting shows an inline note with Set up AI, never a dialog
 * or an error page. In the static demo the bar is replaced by the line that says how to get the app.
 */
import type { CreateRequest } from "@learncroc/core";
import { Button, cn, Kbd } from "@learncroc/ui";
import { Check, Copy, LinkSimple } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { forwardRef, type ReactNode, useId, useImperativeHandle, useRef, useState } from "react";
import { api } from "../../api/client";
import { ApiClientError } from "../../api/errors";
import { INSTALL_COMMAND, isDemo } from "../../app/demo";
import { useAiStatus } from "../../app/queries";
import { isOffline } from "../../lib/env";
import { rememberJob } from "./jobs";

/** sessionStorage: the paste bar's value carried to the full intake ("More options"). */
export const INTAKE_PREFILL = "lm:intake-prefill";

/** Minimum words for pasted text (the server refuses shorter sources as too_short). */
export const MIN_TEXT_WORDS = 50;

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

export type PasteParse =
  | { kind: "empty" }
  | { kind: "url"; url: string }
  | { kind: "text"; text: string; title: string; words: number }
  | { kind: "short"; words: number };

/** What the learner pasted: a link, enough text for a map, or too little. */
export function parsePaste(raw: string): PasteParse {
  const v = raw.trim();
  if (!v) return { kind: "empty" };
  if (URL_RE.test(v)) return { kind: "url", url: v };
  if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v) && !/\s/.test(v)) return { kind: "url", url: `https://${v}` };
  const words = v.split(/\s+/).filter(Boolean).length;
  if (words < MIN_TEXT_WORDS) return { kind: "short", words };
  const firstLine = (v.split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "").trim();
  const title = firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77).trimEnd()}…`;
  return { kind: "text", text: v, title: title || "Pasted text", words };
}

/** The create request for a parsed paste (defaults: Standard size, no familiarity). */
export function pasteRequest(
  p: PasteParse,
  opts: { size?: CreateRequest["size"]; familiarity?: CreateRequest["familiarity"] } = {},
): CreateRequest | null {
  const size = opts.size ?? "standard";
  const familiarity = opts.familiarity ?? "none";
  if (p.kind === "url") return { source: { kind: "url", url: p.url }, size, familiarity };
  if (p.kind === "text") return { source: { kind: "text", text: p.text, title: p.title }, size, familiarity };
  return null;
}

/** The server's refusal, in the app's own copy. */
export function createErrorCopy(err: unknown): string {
  if (err instanceof ApiClientError) {
    const code = err.body.error;
    if (code === "ai_not_configured") return "Article maps need an AI key or a local model.";
    if (code === "cap_reached")
      return "This would go over this month's AI budget. Raise it in Settings, or try a shorter map.";
    if (code === "rate_limited") return "The AI provider asked us to slow down. Try again in a minute.";
    return err.body.message;
  }
  return "Couldn't reach the Learncroc server to start the map. Try again.";
}

export interface PasteBarHandle {
  focus(): void;
}

export interface PasteBarProps {
  /** Extra classes on the outer wrapper. */
  className?: string;
  /** Large hero variant (first run) vs the compact bar on top of the returning library. */
  size?: "hero" | "bar";
  /** Show the `N` hint next to the button (the library binds N to focus the bar). */
  focusKey?: string;
}

/** The static demo's stand-in for the bar. */
export function DemoPasteNote({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard refused: the command is on screen */
    }
  };
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-key border border-dashed border-line-strong bg-surface-2 px-5 py-4",
        className,
      )}
    >
      <LinkSimple size={20} aria-hidden className="text-ink-3" />
      <p className="min-w-0 flex-1 text-body text-ink-2">
        Article maps need the full app. Run <code className="voice-mono text-code text-ink">{INSTALL_COMMAND}</code> on
        your computer.
      </p>
      {typeof navigator !== "undefined" && navigator.clipboard ? (
        <Button
          size="sm"
          variant="secondary"
          icon={copied ? <Check size={16} /> : <Copy size={16} />}
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      ) : null}
    </div>
  );
}

export const PasteBar = forwardRef<PasteBarHandle, PasteBarProps>(function PasteBar(
  { className, size = "bar", focusKey },
  ref,
) {
  const navigate = useNavigate();
  const ai = useAiStatus();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState<ReactNode>(null);
  const id = useId();
  const noteId = useId();
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const create = useMutation({
    mutationFn: (req: CreateRequest) => api.createPocketMap(req),
    onSuccess: ({ jobId, packId }) => {
      rememberJob(jobId, packId);
      void navigate({ to: "/create/pocket/$job", params: { job: jobId } });
    },
    onError: (err) => setNote(createErrorCopy(err)),
  });

  if (isDemo()) return <DemoPasteNote {...(className ? { className } : {})} />;

  const configured = ai.data?.configured ?? false;
  const capReached = ai.data?.capReached ?? false;
  const hero = size === "hero";

  const setupLink = (
    <Link
      to="/settings/$section"
      params={{ section: "ai" }}
      className="font-semibold text-ink underline underline-offset-2"
    >
      Set up AI
    </Link>
  );

  const submit = () => {
    const parsed = parsePaste(value);
    if (parsed.kind === "empty") {
      inputRef.current?.focus();
      return;
    }
    if (parsed.kind === "short") {
      setNote(
        `That's ${parsed.words} ${parsed.words === 1 ? "word" : "words"}. Paste a link, or at least a few paragraphs (${MIN_TEXT_WORDS} words or more).`,
      );
      return;
    }
    if (!configured) {
      setNote(
        <>
          Article maps need an AI key or a local model (Ollama works, free and offline). {setupLink}, or start with a
          ready-made map below.
        </>,
      );
      return;
    }
    if (capReached) {
      setNote(
        <>
          This month's AI budget is used up. Change the cap in{" "}
          <Link to="/settings/$section" params={{ section: "ai" }} className="font-semibold text-ink underline">
            Settings
          </Link>
          .
        </>,
      );
      return;
    }
    if (parsed.kind === "url" && isOffline()) {
      setNote(
        "You're offline. Article maps need the internet to read the page. Pasting the text works with a local model.",
      );
      return;
    }
    const req = pasteRequest(parsed);
    if (req) {
      setNote(null);
      create.mutate(req);
    }
  };

  return (
    <div className={cn("grid gap-2", className)}>
      <form
        className="flex flex-wrap items-stretch gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={id} className="sr-only">
          Paste a link or some text you want to understand
        </label>
        <div
          className={cn(
            "flex min-w-0 flex-1 items-start gap-3 rounded-key border-[1.5px] border-line-strong bg-surface px-4 shadow-1 transition-colors duration-quick focus-within:border-focus",
            hero ? "min-h-16 py-[18px]" : "min-h-14 py-[14px]",
          )}
        >
          <LinkSimple size={20} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
          <textarea
            id={id}
            ref={inputRef}
            rows={1}
            value={value}
            aria-describedby={note ? noteId : undefined}
            aria-keyshortcuts={focusKey}
            placeholder="Paste a link or some text you want to understand"
            onChange={(e) => {
              setValue(e.currentTarget.value);
              if (note) setNote(null);
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.currentTarget.blur();
              }
            }}
            className={cn(
              "max-h-[200px] min-w-0 flex-1 resize-none bg-transparent text-ink outline-none placeholder:text-ink-3",
              hero ? "text-lead" : "text-body",
            )}
          />
          {focusKey && !value ? <Kbd keys={focusKey} compact /> : null}
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          kbd="⏎"
          disabled={create.isPending}
          className={hero ? "min-h-16 px-6" : "min-h-14"}
        >
          {create.isPending ? "Starting…" : "Map it"}
        </Button>
      </form>
      <p id={noteId} aria-live="polite" className="text-small text-ink-2">
        {note ??
          (ai.data && !configured ? (
            <span className="text-ink-3">
              Needs an AI key or a local model. Everything below works without one. {setupLink}
            </span>
          ) : ai.data && configured ? (
            <span className="text-ink-3">
              Learncroc writes a short map of cards, with checkpoints. Want a different size?{" "}
              <Link
                to="/create/pocket"
                onClick={() => {
                  try {
                    if (value.trim()) sessionStorage.setItem(INTAKE_PREFILL, value);
                  } catch {
                    /* private mode */
                  }
                }}
                className="underline underline-offset-2 hover:text-ink"
              >
                More options
              </Link>
            </span>
          ) : null)}
      </p>
    </div>
  );
});
