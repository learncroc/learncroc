/**
 * GET /relight/calendar.ics: one daily recurring "Relight (5 min)" event at the learner's chosen
 * local time. No counts, no streaks. Floating local time, so it follows the calendar's zone.
 */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isReminderTime(s: string): boolean {
  return TIME_RE.test(s);
}

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

function stamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export function relightCalendar(opts: { time: string; now: number; url?: string }): string {
  const m = TIME_RE.exec(opts.time);
  if (!m) throw new Error("time must be HH:MM");
  const d = new Date(opts.now);
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const start = `${date}T${m[1]}${m[2]}00`;
  const endMin = Number(m[1]) * 60 + Number(m[2]) + 5;
  const end = `${date}T${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}${String(endMin % 60).padStart(2, "0")}00`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//learncroc//relight//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:relight-daily@learncroc.local",
    `DTSTAMP:${stamp(opts.now)}`,
    `DTSTART:${start}`,
    `DTEND:${endMin >= 24 * 60 ? start : end}`,
    "RRULE:FREQ=DAILY",
    "SUMMARY:Relight (5 min)",
    "DESCRIPTION:Bring back the stops that are starting to fade.",
    ...(opts.url ? [`URL:${opts.url}`] : []),
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
