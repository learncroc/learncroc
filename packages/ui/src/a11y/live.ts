/**
 * One shared, rate-limited polite live region for the whole app. Moss's bubbles, the
 * map's change descriptions (`describeChanges`) and moment summaries all speak through `announce()`, so a
 * screen reader never hears two announcements for one event (a gate opening used to say it twice).
 *
 * Rules:
 * - one `<div role="status" aria-live="polite">` per document, created lazily on first use;
 * - messages are spoken at least `MIN_GAP_MS` apart, in order;
 * - a queued message with the same `key` is replaced by the newer one (the latest state wins);
 * - the same text within `LIVE_REPEAT_MS` of being spoken is dropped;
 * - `assertive` is not offered: nothing in a learning loop is urgent.
 */

export interface AnnounceOptions {
  /** Messages about the same thing share a key (e.g. "gate:cp-1", "croc"); the newest queued one wins. */
  key?: string;
  /** Skip the repeat filter (rare: a learner asked for the same thing twice on purpose). */
  force?: boolean;
}

/** Minimum time between two spoken messages. */
export const LIVE_MIN_GAP_MS = 900;
/** Drop a message whose text or key was spoken this recently. */
export const LIVE_REPEAT_MS = 2500;
/** Longest message kept (screen readers cut long status lines anyway). */
const MAX_CHARS = 300;

interface Pending {
  text: string;
  key?: string;
}

let region: HTMLElement | null = null;
let queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let lastAt = Number.NEGATIVE_INFINITY;
const recent = new Map<string, number>();

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function ensureRegion(): HTMLElement | null {
  if (typeof document === "undefined" || !document.body) return null;
  if (region?.isConnected) return region;
  const existing = document.querySelector<HTMLElement>("[data-lm-live]");
  if (existing) {
    region = existing;
    return region;
  }
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "true");
  el.dataset.lmLive = "";
  // Visually hidden (the sr-only recipe), so it works without Tailwind.
  Object.assign(el.style, {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: "0",
  });
  document.body.appendChild(el);
  region = el;
  return region;
}

function speak(p: Pending): void {
  const el = ensureRegion();
  if (!el) return;
  const t = now();
  lastAt = t;
  for (const [id, at] of recent) if (t - at >= LIVE_REPEAT_MS) recent.delete(id);
  recent.set(`t:${p.text}`, t);
  // Clear first so identical text is re-read, then set on the next frame.
  el.textContent = "";
  setTimeout(() => {
    if (region === el) el.textContent = p.text;
  }, 30);
}

function pump(): void {
  timer = null;
  const next = queue.shift();
  if (!next) return;
  speak(next);
  if (queue.length) timer = setTimeout(pump, LIVE_MIN_GAP_MS);
}

function schedule(): void {
  if (timer) return;
  const wait = Math.max(0, lastAt + LIVE_MIN_GAP_MS - now());
  if (wait === 0) pump();
  else timer = setTimeout(pump, wait);
}

function isRecent(id: string): boolean {
  const at = recent.get(id);
  return at !== undefined && now() - at < LIVE_REPEAT_MS;
}

/**
 * Say `text` politely through the shared live region. Safe to call from effects, during SSR and in
 * tests (it no-ops without a document). Empty text is ignored.
 */
export function announce(text: string, opts: AnnounceOptions = {}): void {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!clean) return;
  // The same words a moment ago: drop. The same key with new words goes through (the state moved on).
  if (!opts.force && isRecent(`t:${clean}`)) return;
  const item: Pending = opts.key !== undefined ? { text: clean, key: opts.key } : { text: clean };
  if (opts.key !== undefined) {
    const at = queue.findIndex((q) => q.key === opts.key);
    if (at >= 0) {
      queue[at] = item;
      return;
    }
  }
  if (queue.some((q) => q.text === clean)) return;
  queue.push(item);
  schedule();
}

/** Drop everything queued (a screen change). The region itself stays for the next message. */
export function clearAnnouncements(): void {
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
  if (region) region.textContent = "";
}

/** Tests only: forget the region, the queue and the repeat memory. */
export function resetLiveRegion(): void {
  clearAnnouncements();
  region?.remove();
  region = null;
  lastAt = Number.NEGATIVE_INFINITY;
  recent.clear();
}
