/**
 * Generated HTML toys. Static checks run on the server without executing
 * anything (the same pre-scan as lint L020); the behaviour check (posts `ready` within 2 s, the
 * bridge's self-test sees the DOM react) runs in a hidden sandbox frame in the learner's browser,
 * on the sandbox origin, and reports back. A toy that fails either is dropped.
 */
import { scanFrameHtml } from "@learncroc/widgets/sandbox/bridge";
import { parseHTML } from "linkedom";
import { words } from "../text";

export const TOY_MAX_BYTES = 64 * 1024;

const BANNED: [RegExp, string][] = [
  [/\bfetch\s*\(/, "fetch"],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/WebSocket/, "WebSocket"],
  [/EventSource/, "EventSource"],
  [/\bimport\s*\(/, "import()"],
  [/sendBeacon/, "sendBeacon"],
  [/\beval\s*\(/, "eval"],
  [/\bFunction\s*\(/, "Function()"],
  [/\bnew\s+Worker\b|SharedWorker|serviceWorker/, "workers"],
  [/localStorage|sessionStorage|indexedDB|document\.cookie/, "storage"],
  [/window\.(top|parent|opener)|\bparent\.|\btop\.location/, "parent window access"],
  [/\bsetTimeout\s*\(\s*["'`]|\bsetInterval\s*\(\s*["'`]/, "string timers"],
  [/<link\b|<iframe\b|<object\b|<embed\b|<base\b|<meta[^>]+http-equiv/i, "embedded resources"],
  [/(src|href|action|formaction|poster|data)\s*=\s*["']?\s*(https?:|\/\/|javascript:)/i, "external URLs"],
  [/url\(\s*["']?\s*(https?:|\/\/)/i, "external URLs in CSS"],
  [/@import/i, "CSS imports"],
];

export type ToyCheck = { ok: true } | { ok: false; reason: string };

export function checkToyStatic(html: string): ToyCheck {
  if (new TextEncoder().encode(html).length > TOY_MAX_BYTES) return { ok: false, reason: "over 64 KB" };
  for (const [re, what] of BANNED) if (re.test(html)) return { ok: false, reason: `uses ${what}` };
  // The same pre-scan the sandbox host and lint run (network, parent access, storage, lm.ready()).
  const scan = scanFrameHtml(html);
  if (scan[0]) return { ok: false, reason: scan[0].message };
  // SVG/XHTML namespace URIs (in markup or createElementNS calls) name a namespace; nothing is fetched.
  if (/https?:\/\//i.test(html.replace(/https?:\/\/www\.w3\.org\/[\w./-]*/g, ""))) {
    return { ok: false, reason: "contains an external URL" };
  }
  const { document } = parseHTML(html);
  const first = document.querySelector("input, button, select, textarea");
  if (!first) return { ok: false, reason: "has no control to play with" };
  const tag = first.tagName.toLowerCase();
  if (!(tag === "button" || (tag === "input" && /^(range|number|checkbox)$/i.test(first.getAttribute("type") ?? "")))) {
    return { ok: false, reason: "the first control must be a slider or a button" };
  }
  if (tag === "input") {
    const id = first.getAttribute("id");
    const labelled =
      (id && document.querySelector(`label[for="${id}"]`)) ||
      first.closest("label") ||
      first.getAttribute("aria-label");
    if (!labelled) return { ok: false, reason: "the control has no label" };
  }
  if (!document.querySelector("script")) return { ok: false, reason: "nothing reacts (no script)" };
  const text = (document.body?.textContent ?? "").replace(/\s+/g, " ");
  const scriptText = Array.from(document.querySelectorAll("script, style"))
    .map((s) => s.textContent ?? "")
    .join(" ");
  if (words(text) - words(scriptText) > 80) return { ok: false, reason: "too much text" };
  return { ok: true };
}

/** Result the browser posts after running the toy in a hidden sandbox frame. */
export interface ToyValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Waits for the browser's verdict on a toy. The pipeline asks; whoever is watching the job (the
 * surveying view) runs the hidden frame and answers. No answer in time → the toy is dropped.
 */
export class ToyValidator {
  private readonly pending = new Map<string, (v: ToyValidation) => void>();

  /** Called by the pipeline. */
  wait(key: string, timeoutMs: number, signal?: AbortSignal): Promise<ToyValidation> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        resolve({ ok: false, reason: "no browser checked it in time" });
      }, timeoutMs);
      const done = (v: ToyValidation) => {
        clearTimeout(timer);
        this.pending.delete(key);
        resolve(v);
      };
      signal?.addEventListener("abort", () => done({ ok: false, reason: "cancelled" }), { once: true });
      this.pending.set(key, done);
    });
  }

  /** Called by POST /jobs/:id/toy-check. Returns false when nothing is waiting. */
  report(key: string, v: ToyValidation): boolean {
    const fn = this.pending.get(key);
    if (!fn) return false;
    fn(v);
    return true;
  }

  isWaiting(key: string): boolean {
    return this.pending.has(key);
  }
}
