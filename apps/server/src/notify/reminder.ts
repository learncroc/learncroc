/**
 * The opt-in daily reminder (PLAN D38): off by default; when enabled, one local OS notification at
 * the learner's chosen time, with no counts. macOS: osascript; Linux: notify-send; Windows: a
 * PowerShell toast. Failures are silent (a missing notifier must never break the server).
 */
import type { Settings } from "@learncroc/core";

export const REMINDER_TITLE = "learncroc";
export const REMINDER_BODY = "A five-minute Relight is ready when you are.";

export type Notifier = (title: string, body: string) => Promise<void>;

/** The platform command for a notification (exported for tests). */
export function notifyCommand(platform: NodeJS.Platform, title: string, body: string): string[] | null {
  const q = (s: string) => s.replace(/["\\]/g, "");
  if (platform === "darwin") return ["osascript", "-e", `display notification "${q(body)}" with title "${q(title)}"`];
  if (platform === "linux") return ["notify-send", "--app-name=learncroc", title, body];
  if (platform === "win32") {
    const ps = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
      "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
      `$x = $t.GetElementsByTagName('text'); $x.Item(0).AppendChild($t.CreateTextNode('${q(title).replace(/'/g, "")}')) > $null; $x.Item(1).AppendChild($t.CreateTextNode('${q(body).replace(/'/g, "")}')) > $null`,
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('learncroc').Show([Windows.UI.Notifications.ToastNotification]::new($t))",
    ].join("; ");
    return ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps];
  }
  return null;
}

export const osNotifier: Notifier = async (title, body) => {
  const cmd = notifyCommand(process.platform, title, body);
  if (!cmd) return;
  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
  } catch {
    /* no notifier installed */
  }
};

const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const localMinutes = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/** Whether a reminder should fire now (exported for tests). */
export function reminderDue(reminder: Settings["learning"]["reminder"], now: number, lastSentDate?: string): boolean {
  if (!reminder.enabled) return false;
  const m = /^(\d{2}):(\d{2})$/.exec(reminder.time);
  if (!m) return false;
  const at = Number(m[1]) * 60 + Number(m[2]);
  const mins = localMinutes(now);
  return mins >= at && mins < at + 30 && lastSentDate !== localDate(now);
}

/** Check once a minute; returns a stop function. */
export function startReminderLoop(opts: {
  settings: () => Settings;
  now: () => number;
  notifier?: Notifier;
  lastSent: () => Promise<string | undefined>;
  markSent: (date: string) => Promise<void>;
  intervalMs?: number;
}): () => void {
  const notify = opts.notifier ?? osNotifier;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = opts.now();
      if (reminderDue(opts.settings().learning.reminder, now, await opts.lastSent())) {
        await opts.markSent(localDate(now));
        await notify(REMINDER_TITLE, REMINDER_BODY);
      }
    } catch {
      /* never let the reminder break the server */
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, opts.intervalMs ?? 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
