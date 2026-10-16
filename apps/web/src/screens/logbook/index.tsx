/**
 * /logbook: what you can do now, without guilt mechanics (03 §4.11). "What you can now explain"
 * (every lit card, by the question it answers), the finished-map badge shelf, "You can now" (line
 * outcomes), "Things I used to think", older field notes if you have any, and quiet activity dots
 * (no streak; gaps are just gaps).
 */
import type { CompiledPack, FieldNote, InstalledPackSummary, Logbook, PackId, PackProgress } from "@learncroc/core";
import { MapBadge } from "@learncroc/maps";
import { Button, buttonClass, cn, StopGlyph, toast } from "@learncroc/ui";
import { DownloadSimple } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { downloadFile, fileDate } from "../../app/download";
import { errorText } from "../../app/errors";
import { useScreenKeys } from "../../app/keys";
import { useLogbook, usePackPosters, usePacks } from "../../app/queries";
import { SearchTrigger } from "../../app/Rail";
import { Page, ScreenHeader } from "../../app/ScreenHeader";
import { useScreenShortcuts } from "../../app/store";
import { plainText } from "../../lib/inline";
import { PosterFrame } from "../library/posterKit";

const DAY = 86_400_000;
const noteDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Local "YYYY-MM-DD" for a time (matches the server's activity dates). */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The last `weeks` whole weeks up to `now`, Monday-first, as columns of 7 days. */
export function activityGrid(activity: Logbook["activity"], now: number, weeks = 12) {
  const counts = new Map(activity.map((a) => [a.date, a.count]));
  const today = new Date(now);
  const dow = (today.getDay() + 6) % 7; // Monday = 0
  const start = now - (dow + (weeks - 1) * 7) * DAY;
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const t = start + (w * 7 + d) * DAY;
      const date = dayKey(t);
      return { date, count: t > now ? -1 : (counts.get(date) ?? 0) };
    }),
  );
}

export interface ExplainRow {
  packId: PackId;
  packTitle: string;
  nodeId: string;
  title: string;
  /** The hook, as one question: the context line(s) and the prompt. */
  question: string;
  fading: boolean;
}

/** Lit (and fading) cards of a map in map order, each with the question it answers. */
export function explainRows(summary: InstalledPackSummary, pack: CompiledPack, progress: PackProgress): ExplainRow[] {
  const out: ExplainRow[] = [];
  for (const id of pack.map.topo) {
    const st = progress.views[id]?.state;
    const node = pack.nodes[id];
    if ((st !== "lit" && st !== "fading") || !node || pack.map.nodes[id]?.kind !== "node") continue;
    const context = (node.hook.blocks ?? [])
      .map((b) => ("text" in b && typeof b.text === "string" ? plainText(b.text) : ""))
      .filter(Boolean)
      .join(" ");
    const prompt = plainText(node.hook.interaction.prompt);
    out.push({
      packId: summary.id,
      packTitle: summary.title,
      nodeId: id,
      title: node.title,
      question: context ? `${context} ${prompt}` : prompt,
      fading: st === "fading",
    });
  }
  return out;
}

/** The whole logbook as Markdown (Export). */
export function logbookMarkdown(log: Logbook, titleOf: (id: PackId) => string, explain: ExplainRow[] = []): string {
  const out = ["# My Learncroc logbook", ""];
  if (explain.length) {
    out.push("## What I can now explain", "");
    for (const r of explain) out.push(`- ${r.question} (${r.title}, ${r.packTitle})`);
    out.push("");
  }
  if (log.badges.length) {
    out.push("## Finished maps", "");
    for (const b of log.badges)
      out.push(`- ${b.title} (${b.world}), ${b.cards} cards, finished ${dayKey(b.finishedAt)}`);
    out.push("");
  }
  if (log.canNow.length) {
    out.push("## You can now", "");
    for (const c of log.canNow) out.push(`- ${c.text} (${titleOf(c.packId)})`);
    out.push("");
  }
  if (log.fieldNotes.length) {
    out.push("## Field notes", "");
    for (const n of log.fieldNotes) {
      out.push(`### ${n.title} (${titleOf(n.packId)}, ${dayKey(n.litAt)})`, "");
      if (n.myWords) out.push(`> ${n.myWords}`, "");
      if (n.usedToThink) out.push(`I used to think: ${n.usedToThink}`, "");
    }
  }
  if (log.usedToThink.length) {
    out.push("## Things I used to think", "");
    for (const u of log.usedToThink) out.push(`- I used to think ${u.guess}. Now: ${u.now}`);
    out.push("");
  }
  return out.join("\n");
}

export function LogbookScreen() {
  const [packId, setPackId] = useState<PackId | "">("");
  const packs = usePacks();
  const log = useLogbook(packId || undefined);
  const byId = useMemo(() => new Map((packs.data ?? []).map((p) => [p.id, p])), [packs.data]);
  const titleOf = (id: PackId) => byId.get(id)?.title ?? id;
  const data = log.data;
  // Maps with anything lit (for "What you can now explain") or a badge (the shelf draws its medallion).
  const relevant = (packs.data ?? []).filter(
    (p) =>
      p.status !== "invalid" &&
      (!packId || p.id === packId) &&
      (p.lit + p.fading > 0 || data?.badges.some((b) => b.packId === p.id)),
  );
  const posters = usePackPosters(relevant.map((p) => p.id));
  const explain = posters.flatMap((d, i) => {
    const s = relevant[i];
    return s && d.pack && d.progress ? explainRows(s, d.pack, d.progress) : [];
  });
  const packOf = (id: PackId) => posters.find((d) => d.id === id)?.pack;
  const badges = (data?.badges ?? []).filter((b) => !packId || b.packId === packId);
  const empty =
    data &&
    !explain.length &&
    !badges.length &&
    !data.canNow.length &&
    !data.fieldNotes.length &&
    !data.usedToThink.length;

  const exportMd = () => {
    if (!data) return;
    try {
      downloadFile(
        `learncroc-logbook-${fileDate(data.now)}.md`,
        logbookMarkdown(data, titleOf, explain),
        "text/markdown;charset=utf-8",
      );
    } catch (err) {
      toast({ tone: "ember", message: `Couldn't export: ${errorText(err)}` });
    }
  };
  useScreenKeys({
    e: (e) => {
      e.preventDefault();
      exportMd();
    },
  });
  useScreenShortcuts("logbook", { title: "Logbook", items: [{ keys: "E", label: "Export as Markdown" }] });

  return (
    <Page>
      <ScreenHeader
        title="Logbook"
        lead="What you can explain now, and the maps you've finished."
        actions={
          <>
            <label className="flex items-center gap-2 text-small text-ink-2">
              <span className="sr-only">Map</span>
              <select
                value={packId}
                onChange={(e) => setPackId(e.currentTarget.value)}
                className="h-10 w-48 rounded-sm border border-line-strong bg-surface px-2 text-small text-ink"
              >
                <option value="">All maps</option>
                {(packs.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              icon={<DownloadSimple size={16} />}
              kbd="E"
              onClick={exportMd}
              disabled={!data || Boolean(empty)}
            >
              Export as Markdown
            </Button>
            <SearchTrigger />
          </>
        }
      />

      {log.isError ? (
        <p role="alert" className="text-body text-ember-text">
          Couldn't load the logbook ({errorText(log.error)}).{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => void log.refetch()}>
            Try again
          </button>
        </p>
      ) : empty ? (
        <section className="grid max-w-xl gap-4 rounded-stage border border-dashed border-line-strong bg-surface-2 px-8 py-12">
          <h2 className="text-heading">Pass your first checkpoint and it shows up here</h2>
          <p className="text-body text-ink-2">
            Cards light when you pass the checkpoint after them. Each lit card is a question you can now answer, and
            every map you finish leaves its badge on a shelf here.
          </p>
          <div>
            <Link to="/" className={buttonClass({ variant: "primary" })}>
              Continue
            </Link>
          </div>
          {data ? (
            <div className="mt-6">
              <ActivityDots log={data} />
            </div>
          ) : null}
        </section>
      ) : data ? (
        <div className="grid grid-cols-12 gap-x-10 gap-y-12">
          <div className="col-span-12 grid content-start gap-12 lg:col-span-7">
            <CanExplain rows={explain} />
            {data.fieldNotes.length ? (
              <section aria-labelledby="field-notes">
                <h2 id="field-notes" className="text-heading">
                  Field notes
                </h2>
                <p className="mt-1 mb-5 text-small text-ink-2">Notes from an earlier version of the app.</p>
                <ul className="grid gap-5 sm:grid-cols-2">
                  {data.fieldNotes.map((n) => (
                    <li key={n.id}>
                      <FieldNoteCard note={n} pack={byId.get(n.packId)} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          <div className="col-span-12 grid content-start gap-12 lg:col-span-5">
            <BadgeShelf badges={badges} packOf={packOf} />
            <CanNow log={data} titleOf={titleOf} />
            <UsedToThink log={data} titleOf={titleOf} />
            <ActivityDots log={data} />
          </div>
        </div>
      ) : null}
    </Page>
  );
}

/** "What you can now explain": every lit card, by the question it answers (a link replays the card). */
function CanExplain({ rows }: { rows: ExplainRow[] }) {
  return (
    <section aria-labelledby="can-explain">
      <h2 id="can-explain" className="text-heading">
        What you can now explain
      </h2>
      {rows.length ? (
        <ul className="mt-4 grid gap-3">
          {rows.map((r) => (
            <li
              key={`${r.packId}/${r.nodeId}`}
              className="flex gap-3 rounded-md border border-line bg-surface p-4 shadow-1 dark:shadow-[var(--inset-dark)]"
            >
              <StopGlyph state={r.fading ? "fading" : "lit"} size={20} decorative className="mt-1 shrink-0" />
              <div className="min-w-0">
                <p className="voice-guide text-body text-ink">{r.question}</p>
                <p className="mt-1 text-small text-ink-2">
                  <Link
                    to="/p/$pack"
                    params={{ pack: r.packId }}
                    search={{ card: r.nodeId }}
                    className="font-semibold text-ink hover:underline"
                  >
                    {r.title}
                  </Link>{" "}
                  · {r.packTitle}
                  {r.fading ? " · Fading" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-body text-ink-2">
          Cards light when you pass the checkpoint after them. Each one shows up here as the question you can answer.
        </p>
      )}
    </section>
  );
}

const badgeDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The finished-map shelf: one medallion per finished map (derived, never revoked). */
function BadgeShelf({
  badges,
  packOf,
}: {
  badges: Logbook["badges"];
  packOf: (id: PackId) => CompiledPack | undefined;
}) {
  return (
    <section aria-labelledby="badges">
      <h2 id="badges" className="text-heading">
        Finished maps
      </h2>
      {badges.length ? (
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {badges.map((b) => {
            const pack = packOf(b.packId);
            return (
              <li key={b.packId}>
                <Link
                  to="/p/$pack"
                  params={{ pack: b.packId }}
                  search={{ finished: true }}
                  className="grid justify-items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-4 text-center hover:border-line-strong"
                >
                  {pack ? (
                    <MapBadge pack={pack} cards={b.cards} finishedAt={b.finishedAt} size={84} />
                  ) : (
                    <StopGlyph state="lit" size={40} decorative />
                  )}
                  <span className="text-small font-semibold text-ink">{b.title}</span>
                  <span className="text-micro text-ink-3">
                    {b.cards} cards · {badgeDate.format(b.finishedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-body text-ink-2">
          Light every card on a map and open its last checkpoint, and its badge lands here.
        </p>
      )}
    </section>
  );
}

function CanNow({ log, titleOf }: { log: Logbook; titleOf: (id: PackId) => string }) {
  return (
    <section aria-labelledby="can-now">
      <h2 id="can-now" className="text-heading">
        You can now
      </h2>
      {log.canNow.length ? (
        <ul className="mt-4 grid gap-4">
          {log.canNow.map((c) => (
            <li key={`${c.packId}/${c.lineId}`} className="flex gap-3">
              <StopGlyph state="lit" size={20} decorative className="mt-0.5" />
              <div>
                <p className="text-lead text-ink">{c.text}</p>
                <p className="text-small text-ink-2">{titleOf(c.packId)}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-body text-ink-2">Light a whole line and what it taught you shows up here.</p>
      )}
    </section>
  );
}

function UsedToThink({ log, titleOf }: { log: Logbook; titleOf: (id: PackId) => string }) {
  if (!log.usedToThink.length) return null;
  return (
    <section aria-labelledby="used-to-think">
      <h2 id="used-to-think" className="text-heading">
        Things I used to think
      </h2>
      <ul className="mt-4 grid gap-3">
        {log.usedToThink.map((u) => (
          <li
            key={`${u.packId}/${u.nodeId}`}
            className="rounded-md border border-line bg-surface p-4 shadow-1 dark:shadow-[var(--inset-dark)]"
          >
            <p className="voice-guide text-ink-2 line-through decoration-ink-3 decoration-1">{u.guess}</p>
            <p className="voice-guide mt-1 text-ink">{u.now}</p>
            <p className="mt-2 text-micro text-ink-3">{titleOf(u.packId)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Two punched notches where a ticket tears off. */
const TICKET_MASK = {
  WebkitMask:
    "radial-gradient(circle 9px at calc(100% - 56px) 0, #0000 97%, #000) top / 100% 51% no-repeat, radial-gradient(circle 9px at calc(100% - 56px) 100%, #0000 97%, #000) bottom / 100% 51% no-repeat",
  mask: "radial-gradient(circle 9px at calc(100% - 56px) 0, #0000 97%, #000) top / 100% 51% no-repeat, radial-gradient(circle 9px at calc(100% - 56px) 100%, #0000 97%, #000) bottom / 100% 51% no-repeat",
} as const;

const STYLE_LABEL = { "spec-sheet": "Spec sheet", ticket: "Ticket", postcard: "Postcard", card: "Field note" } as const;

/** A field note on its world's paper: spec sheet (LLMs), stamped ticket (relativity), postcard (Spanish) or a plain card. */
function FieldNoteCard({ note, pack }: { note: FieldNote; pack?: InstalledPackSummary }) {
  const style = pack?.theme.fieldNoteStyle ?? "card";
  const theme = pack?.theme ?? {
    ground: "#1D1C3D",
    mode: "dark" as const,
    lines: ["#7FB2FF", "#C792F2", "#F07DA6", "#9AD07A", "#E6E1D3"] as [string, string, string, string, string],
    texture: "none" as const,
  };
  return (
    <div className="h-full" style={style === "ticket" ? TICKET_MASK : undefined}>
      <PosterFrame theme={theme} className="h-full rounded-md">
        <article
          aria-label={`Field note: ${note.title}`}
          data-style={style}
          // A ticket keeps its text left of the tear line; the stub on the right holds the glyph.
          className={cn("relative flex h-full flex-col gap-3 p-5", style === "ticket" && "pr-[76px]")}
        >
          <header className="flex items-start justify-between gap-3">
            <div>
              <p className="text-micro text-w-ink-2">{STYLE_LABEL[style]}</p>
              <h3 className="text-body font-semibold text-w-ink">
                <Link
                  to="/p/$pack"
                  params={{ pack: note.packId }}
                  search={{ card: note.nodeId }}
                  className="hover:underline"
                >
                  {note.title}
                </Link>
              </h3>
            </div>
            {style === "postcard" ? (
              <span
                aria-hidden
                className="grid size-11 shrink-0 place-items-center rounded-xs border-2 border-dashed border-w-ink-2"
              >
                <StopGlyph state="lit" size={22} decorative />
              </span>
            ) : (
              <StopGlyph
                state="lit"
                durable={note.durable}
                size={22}
                title={note.durable ? "Lit, durable" : "Lit"}
                className={style === "ticket" ? "absolute top-5 right-[17px]" : undefined}
              />
            )}
          </header>
          <blockquote
            className={cn(
              "voice-guide text-w-ink",
              style === "spec-sheet" && "border-l-2 border-w-1 pl-3",
              style === "postcard" && "border-t border-w-grid pt-3",
            )}
          >
            {note.myWords}
          </blockquote>
          {note.usedToThink ? <p className="text-small text-w-ink-2">I used to think: {note.usedToThink}</p> : null}
          <footer className="mt-auto flex items-center justify-between pt-1 text-micro text-w-ink-2">
            <span>{pack?.title ?? note.packId}</span>
            <time className="tabular" dateTime={dayKey(note.litAt)}>
              {noteDate.format(note.litAt)}
            </time>
          </footer>
          {style === "ticket" ? (
            <span aria-hidden className="absolute inset-y-4 right-14 border-l-2 border-dashed border-w-grid" />
          ) : null}
        </article>
      </PosterFrame>
    </div>
  );
}

function ActivityDots({ log }: { log: Logbook }) {
  const grid = activityGrid(log.activity, log.now);
  const max = Math.max(1, ...log.activity.map((a) => a.count));
  const active = log.activity.filter((a) => a.count > 0).length;
  return (
    <section aria-labelledby="activity">
      <h2 id="activity" className="text-heading">
        Lately
      </h2>
      <p className="mt-1 mb-4 text-small text-ink-2">
        {active
          ? `You played on ${active} ${active === 1 ? "day" : "days"} in the last 12 weeks.`
          : "Nothing played in the last 12 weeks yet."}
      </p>
      <div
        role="img"
        aria-label={`Activity in the last 12 weeks: ${active} active days`}
        className="inline-grid grid-flow-col gap-1.5"
      >
        {grid.map((week) => (
          <div key={week[0]?.date} className="grid gap-1.5">
            {week.map((d) => (
              <span
                key={d.date}
                title={d.count > 0 ? `${d.date}: ${d.count}` : d.date}
                className="grid size-3.5 place-items-center"
              >
                {d.count < 0 ? null : d.count === 0 ? (
                  <span className="size-1 rounded-pill bg-line-strong" />
                ) : (
                  <span
                    className="rounded-pill bg-ink-2"
                    style={{ width: 6 + (d.count / max) * 8, height: 6 + (d.count / max) * 8 }}
                  />
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
