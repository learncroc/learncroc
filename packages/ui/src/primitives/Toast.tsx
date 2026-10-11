import { CheckCircle, Info, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "../cn";

export interface ToastProps {
  /** "ember" for system problems (failed download, bad key). "done" confirms an action. Never red. */
  tone?: "info" | "done" | "ember";
  message: string;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}

const ICON = { info: Info, done: CheckCircle, ember: WarningCircle } as const;

/** One toast: a short line, an optional action, a dismiss button. Errors say what happened and what to do. */
export function Toast({ tone = "info", message, action, onDismiss }: ToastProps) {
  const Icon = ICON[tone];
  return (
    <div
      role={tone === "ember" ? "alert" : "status"}
      className={cn(
        "lm-pop-in pointer-events-auto flex max-w-md items-center gap-3 rounded-md border bg-surface py-2.5 pr-2 pl-3.5 text-small shadow-2",
        tone === "ember" ? "border-ember text-ember-text" : "border-line text-ink",
      )}
    >
      <Icon size={18} weight={tone === "info" ? "regular" : "fill"} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {action ? (
        <button
          type="button"
          className="rounded-xs px-1.5 font-semibold text-ink underline decoration-1 underline-offset-2"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
      <button type="button" className="rounded-xs px-1.5 text-micro text-ink-2 hover:text-ink" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

// ── Toaster: a tiny global queue (no provider needed) ─────────────────────────────

export interface ToastItem extends Omit<ToastProps, "onDismiss"> {
  id: number;
  /** ms before it leaves on its own; 0 keeps it until dismissed. Default 5000 (ember: 0). */
  duration?: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Show a toast. Returns its id. */
export function toast(t: Omit<ToastItem, "id">): number {
  const id = nextId++;
  items = [...items.slice(-2), { duration: t.tone === "ember" ? 0 : 5000, ...t, id }];
  emit();
  return id;
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function TimedToast({ item }: { item: ToastItem }) {
  useEffect(() => {
    if (!item.duration) return;
    const timer = setTimeout(() => dismissToast(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item.id, item.duration]);
  const { id: _id, duration: _d, ...props } = item;
  return <Toast {...props} onDismiss={() => dismissToast(item.id)} />;
}

/** Mount once (the app shell does). Toasts stack bottom-centre, at most three. */
export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  );
  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4"
    >
      {list.map((t) => (
        <TimedToast key={t.id} item={t} />
      ))}
    </section>
  );
}
