/**
 * SandboxFrame: mounts a sandbox-origin frame (URL from POST /api/frames) for a pack html
 * interactive or a generated toy, and speaks the bridge protocol with it.
 *
 * Security (PLAN §17): sandbox="allow-scripts" without allow-same-origin (the frame cannot read the
 * parent), allow="" and no referrer. A message is accepted only when event.source is this iframe's
 * window (and, for URL frames, the origin matches); it is then zod-validated and capped. The frame
 * only reports values; grading happens on the host from the last report.
 */
import type { FrameToHost } from "@learncroc/core";
import { cn } from "@learncroc/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampFrameHeight,
  FRAME_TOKEN_NAMES,
  type HostToFrameMessage,
  parseFrameMessage,
  READY_TIMEOUT_MS,
  SELFTEST_TIMEOUT_MS,
} from "./bridge";

export type FrameReportValue = Extract<FrameToHost, { type: "report" }>["value"];

export interface SandboxFrameProps {
  /** One-time URL returned by POST /api/frames. */
  url: string;
  title: string;
  height: number;
  mode: "explore" | "answer" | "review";
  theme: "light" | "dark";
  reducedMotion: boolean;
  /** The frame's last reported value (the host grades it, never the frame). */
  onReport?: (value: FrameReportValue) => void;
  onReady?: () => void;
  onAnnounce?: (text: string) => void;
  /** Called when the frame never becomes ready or fails its self-test. */
  onFail?: (reason: string) => void;
  /** Value to restore into the frame on init (from run scratch). */
  value?: unknown;
  /** Review mode: sent with init and in a `reveal` message. */
  solution?: unknown;
  /** Ask the frame to prove it reacts to input after `ready` (generated toys). */
  selfTest?: boolean;
  onSelfTest?: (ok: boolean) => void;
  /** Override the 2 s ready deadline (tests). */
  readyTimeoutMs?: number;
  /**
   * Inline document instead of `url`, for the widget gallery and tests only. It runs in the same
   * opaque-origin sandbox; production frames always come from the sandbox origin.
   */
  srcDoc?: string;
  /** Hide the "custom interactive" badge (e.g. when the caller draws its own). */
  hideBadge?: boolean;
  className?: string;
}

type Status = "loading" | "ready" | "failed";

/** Read the theme tokens the frame should use from the element's computed style. */
function readTokens(el: Element | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!el || typeof getComputedStyle !== "function") return out;
  const cs = getComputedStyle(el);
  for (const name of FRAME_TOKEN_NAMES) {
    const v = cs.getPropertyValue(name).trim();
    if (v) out[name] = v;
  }
  return out;
}

function originOf(url: string): string | null {
  try {
    return new URL(url, globalThis.location?.href).origin;
  } catch {
    return null;
  }
}

/**
 * The only origin a frame's messages may come from: "null" for an inline (srcdoc) sandboxed frame,
 * otherwise the sandbox origin of its URL. Null means the URL couldn't be parsed (nothing is accepted).
 */
export function expectedFrameOrigin(url: string, srcDoc?: string): string | null {
  return srcDoc !== undefined ? "null" : originOf(url);
}

export function SandboxFrame(p: SandboxFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(() => clampFrameHeight(p.height));
  const [status, setStatus] = useState<Status>("loading");
  const [live, setLive] = useState("");
  const latest = useRef(p);
  latest.current = p;
  const readyRef = useRef(false);
  const failedRef = useRef(false);
  const selfTestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A srcdoc frame has an opaque origin ("null"); a URL frame must come from the sandbox origin.
  const expectedOrigin = expectedFrameOrigin(p.url, p.srcDoc);
  const targetOrigin = p.srcDoc !== undefined || !expectedOrigin ? "*" : expectedOrigin;

  const send = useCallback(
    (msg: HostToFrameMessage) => {
      ref.current?.contentWindow?.postMessage(msg, targetOrigin);
    },
    [targetOrigin],
  );

  const fail = useCallback((reason: string) => {
    if (failedRef.current) return;
    failedRef.current = true;
    setStatus("failed");
    latest.current.onFail?.(reason);
  }, []);

  const sendInit = useCallback(() => {
    const cur = latest.current;
    send({
      type: "init",
      mode: cur.mode,
      theme: cur.theme,
      reducedMotion: cur.reducedMotion,
      tokens: readTokens(ref.current?.parentElement ?? null),
      value: cur.value,
      solution: cur.mode === "review" ? cur.solution : undefined,
    });
  }, [send]);

  // Reset on a new document.
  // biome-ignore lint/correctness/useExhaustiveDependencies: url/srcDoc identify the document.
  useEffect(() => {
    readyRef.current = false;
    failedRef.current = false;
    setStatus("loading");
    setHeight(clampFrameHeight(latest.current.height));
  }, [p.url, p.srcDoc]);

  // The message listener: source check, origin check, zod validation, caps.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const win = ref.current?.contentWindow;
      if (!win || e.source !== win) return;
      if (!expectedOrigin || e.origin !== expectedOrigin) return;
      const msg = parseFrameMessage(e.data);
      if (!msg || failedRef.current) return;
      const cur = latest.current;
      switch (msg.type) {
        case "ready":
          if (readyRef.current) return;
          readyRef.current = true;
          setStatus("ready");
          sendInit();
          cur.onReady?.();
          if (cur.selfTest) {
            send({ type: "selftest" });
            selfTestTimer.current = setTimeout(() => {
              cur.onSelfTest?.(false);
              fail("selftest-timeout");
            }, SELFTEST_TIMEOUT_MS);
          }
          return;
        case "report":
          if (!readyRef.current) return;
          cur.onReport?.(msg.value);
          return;
        case "resize":
          setHeight(clampFrameHeight(msg.height));
          return;
        case "announce":
          setLive(msg.text);
          cur.onAnnounce?.(msg.text);
          return;
        case "selftest":
          if (!cur.selfTest || !selfTestTimer.current) return;
          clearTimeout(selfTestTimer.current);
          selfTestTimer.current = null;
          cur.onSelfTest?.(msg.ok);
          if (!msg.ok) fail("selftest-failed");
          return;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [expectedOrigin, send, sendInit, fail]);

  // Ready deadline.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart the deadline per document.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!readyRef.current) fail("not-ready");
    }, latest.current.readyTimeoutMs ?? READY_TIMEOUT_MS);
    return () => {
      clearTimeout(t);
      if (selfTestTimer.current) clearTimeout(selfTestTimer.current);
    };
  }, [p.url, p.srcDoc, fail]);

  // Mode, theme and motion changes re-init the frame; entering review also reveals.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the inputs init carries.
  useEffect(() => {
    if (!readyRef.current) return;
    sendInit();
    if (p.mode === "review") send({ type: "reveal", solution: p.solution });
  }, [p.mode, p.theme, p.reducedMotion, sendInit, send]);

  return (
    <div
      className={cn("lm-sandbox relative flex w-full flex-col gap-2", p.className)}
      data-sandbox-frame
      data-status={status}
    >
      {p.hideBadge ? null : (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-xs border border-dashed border-line-strong px-1.5 py-0.5 text-micro text-ink-3">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1" y="1" width="8" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          custom interactive
        </span>
      )}
      {status === "failed" ? (
        <div
          className="flex min-h-30 flex-col justify-center gap-2 rounded-md border border-dashed border-line-strong bg-surface-2 p-4"
          data-sandbox-failed
        >
          <p className="text-body text-ink-2">{p.title}</p>
          <p className="text-small text-ember-text" role="status">
            This interactive didn't load. The question still works.
          </p>
        </div>
      ) : (
        <iframe
          ref={ref}
          src={p.srcDoc !== undefined ? undefined : p.url}
          srcDoc={p.srcDoc}
          title={p.title}
          height={height}
          sandbox="allow-scripts"
          allow=""
          referrerPolicy="no-referrer"
          loading="eager"
          className={cn(
            "block w-full rounded-md border-0 bg-transparent",
            !p.reducedMotion && "transition-[height] duration-base ease-out",
          )}
          style={{ height }}
        />
      )}
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-sandbox-live>
        {live}
      </div>
    </div>
  );
}
