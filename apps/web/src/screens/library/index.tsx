/**
 * /library: Home.
 *
 * First run (nothing opened, nothing closed, no article map of your own): "Learn anything by its
 * map.", the paste bar, the flagship's first hook as a live question, three subject posters (each
 * opens its map with the first card's hook up) and the article-map gallery.
 *
 * Returning: the paste bar (N), the Continue hero (live MiniMap, the last closed card's teaser, Next
 * card / Checkpoint / Resume), the Relight strip only when something is fading, Your maps, Subjects
 * not started yet, and Article maps (yours, then the gallery). Maps that fail to build are hidden;
 * in a developer build they sit in a collapsed "Needs repair" row with their error.
 */
import type { CompiledPack, InstalledPackSummary, PackProgress } from "@learncroc/core";
import { Button, buttonClass, Dialog, Kbd, toast } from "@learncroc/ui";
import { ArrowClockwise, ArrowRight, Cards as CardsIcon, Notebook, Storefront, Trash } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { errorText } from "../../app/errors";
import { useScreenKeys } from "../../app/keys";
import { qk, useHealth, usePackPosters, usePacks, useProgressAll, useSettings } from "../../app/queries";
import { SearchTrigger } from "../../app/Rail";
import { Page, ScreenHeader } from "../../app/ScreenHeader";
import { ServerProblem } from "../../app/ServerProblem";
import { useScreenShortcuts } from "../../app/store";
import { isDevBuild } from "../../lib/env";
import { PasteBar, type PasteBarHandle } from "../create/PasteBar";
import { ContinueHero, continueTarget } from "./ContinueHero";
import { EmptyShelf } from "./EmptyShelf";
import { FirstQuestion, pickFirstQuestion } from "./FirstQuestion";
import { type FadingStop, fadingStops } from "./posterKit";
import { RelightStrip } from "./RelightStrip";
import { Poster } from "./ShelfPoster";

export { homeTarget } from "../../app/HomeRedirect";

/** The three subjects on the first-run library, in order. */
export const FEATURED_SUBJECTS = ["how-llms-work", "spanish-tapas-bar", "special-relativity"] as const;

const PROFILE_RANK: Record<InstalledPackSummary["profile"], number> = {
  curated: 0,
  sampler: 1,
  community: 2,
  pocket: 3,
};

/** Broken maps last; most recent first (by last opened); never-opened: full maps before samplers, then alphabetical. */
export function shelfOrder(a: InstalledPackSummary, b: InstalledPackSummary): number {
  return (
    Number(a.status === "invalid") - Number(b.status === "invalid") ||
    (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) ||
    PROFILE_RANK[a.profile] - PROFILE_RANK[b.profile] ||
    a.title.localeCompare(b.title)
  );
}

/** Opened, or anything closed on it. */
export const isStarted = (p: InstalledPackSummary): boolean =>
  p.lastOpenedAt !== undefined || p.done + p.lit + p.fading > 0;

/**
 * The first-run variant shows until a card is started: no map opened (an article map you built is
 * opened by "Start card 1"), nothing done, and the first card close hasn't happened
 * (`firstRun.completed`). Tiers aren't used: under `--dev` every bundled map reports "local".
 */
export function isFirstRun(firstRunCompleted: boolean, packs: InstalledPackSummary[]): boolean {
  if (firstRunCompleted) return false;
  return !packs.some(isStarted);
}

/** Three subjects for the first run: the featured ones that load, then other full maps and samplers. */
export function firstRunSubjects(packs: InstalledPackSummary[]): InstalledPackSummary[] {
  const ok = packs.filter((p) => p.status === "ok" && p.kind === "pack");
  const featured = FEATURED_SUBJECTS.map((id) => ok.find((p) => p.id === id)).filter(
    (p): p is InstalledPackSummary => p !== undefined,
  );
  const rest = ok
    .filter((p) => !featured.includes(p))
    .sort((a, b) => PROFILE_RANK[a.profile] - PROFILE_RANK[b.profile] || a.title.localeCompare(b.title));
  return [...featured, ...rest].slice(0, 3);
}

/** The map the Continue hero shows: the most recently opened one with anything left to do. */
export function continueMap(packs: InstalledPackSummary[]): { summary: InstalledPackSummary; fresh: boolean } | null {
  const opened = packs
    .filter((p) => p.status !== "invalid" && isStarted(p))
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
  const live = opened.find((p) => !p.finished);
  if (live && live === opened[0]) return { summary: live, fresh: false };
  // The most recent map is finished: offer the next unstarted one ("Start here").
  const unstarted = packs
    .filter((p) => p.status === "ok" && p.kind === "pack" && !isStarted(p))
    .sort((a, b) => PROFILE_RANK[a.profile] - PROFILE_RANK[b.profile] || a.title.localeCompare(b.title))[0];
  if (unstarted) return { summary: unstarted, fresh: true };
  return live ? { summary: live, fresh: false } : null;
}

function SectionHead({ id, children, aside }: { id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-4">
      <h2 id={id} className="shrink-0 text-heading text-ink">
        {children}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-line" />
      {aside}
    </div>
  );
}

function MarketLink() {
  return (
    <Link to="/market" className="inline-flex shrink-0 items-center gap-1.5 text-small text-ink-2 hover:text-ink">
      Marketplace <ArrowRight size={14} aria-hidden />
      <Kbd keys={["G", "K"]} compact />
    </Link>
  );
}

type PosterData = { id: string; pack?: CompiledPack; progress?: PackProgress };

export function LibraryScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const packsQ = usePacks();
  const progressQ = useProgressAll();
  const settingsQ = useSettings();
  const paste = useRef<PasteBarHandle>(null);
  const [removing, setRemoving] = useState<InstalledPackSummary | null>(null);
  const health = useHealth();
  // "Needs repair" shows in developer builds and when the server runs with --dev.
  const dev = isDevBuild() || health.data?.dev === true;

  const all = useMemo(() => [...(packsQ.data ?? [])].sort(shelfOrder), [packsQ.data]);
  const valid = all.filter((p) => p.status !== "invalid");
  const invalid = all.filter((p) => p.status === "invalid");
  const posters = usePackPosters(valid.map((p) => p.id));
  const byId = new Map<string, PosterData>(posters.map((p) => [p.id, p]));

  // Unknown until settings (and, before the first card close, the maps) have loaded.
  const completed = settingsQ.data?.firstRun.completed;
  const firstRun = completed === false && packsQ.data !== undefined && isFirstRun(false, valid);
  const deciding = !packsQ.isError && (completed === undefined || (completed === false && !packsQ.data));
  const hero = firstRun ? null : continueMap(valid);
  const heroData = hero ? byId.get(hero.summary.id) : undefined;
  const heroTarget = hero
    ? hero.fresh
      ? { href: `/p/${hero.summary.id}`, label: "Start here" }
      : continueTarget(hero.summary, heroData?.pack, heroData?.progress, undefined)
    : undefined;

  const fadingByPack = Object.entries(progressQ.data?.packs ?? {}).filter(([, p]) => p.fading > 0);
  const fadingCount = progressQ.data
    ? fadingByPack.reduce((n, [, p]) => n + p.fading, 0)
    : valid.reduce((n, p) => n + p.fading, 0);
  const titleOf = (id: string) => all.find((p) => p.id === id)?.title ?? id;
  const fadingPackTitles = fadingByPack.map(([id]) => titleOf(id));
  const stops: FadingStop[] = posters
    .flatMap((p) => (p.pack && p.progress ? fadingStops(p.pack, p.progress) : []))
    .sort((a, b) => a.retrievability - b.retrievability);

  useScreenKeys({
    n: (e) => {
      e.preventDefault();
      paste.current?.focus();
    },
    c: (e) => {
      if (!heroTarget) return;
      e.preventDefault();
      router.history.push(heroTarget.href);
    },
    Enter: (e) => {
      if (!heroTarget || e.target !== document.body) return;
      e.preventDefault();
      router.history.push(heroTarget.href);
    },
    r: (e) => {
      if (fadingCount === 0) return;
      e.preventDefault();
      router.history.push("/relight");
    },
  });
  useScreenShortcuts("library", {
    title: "Library",
    items: [
      { keys: "N", label: "Paste a link or some text" },
      ...(heroTarget ? [{ keys: "C", label: heroTarget.label }] : []),
      ...(fadingCount ? [{ keys: "R", label: "Relight" }] : []),
      ...(firstRun
        ? [
            { keys: ["1", "4"], label: "Guess on the first question" },
            { keys: "0", label: "No idea yet" },
          ]
        : []),
      { keys: ["←", "→"], label: "Move between posters" },
      { keys: "⌫", label: "Remove the focused map (asks first)" },
    ],
  });

  const onShelfKey = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (!target.matches("[data-poster-link]")) return;
    const links = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-poster-link]")];
    const i = links.indexOf(target);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      links[Math.min(links.length - 1, i + 1)]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      links[Math.max(0, i - 1)]?.focus();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      const id = target.closest<HTMLElement>("[data-poster]")?.dataset.poster;
      const pack = all.find((p) => p.id === id);
      if (pack) {
        e.preventDefault();
        setRemoving(pack);
      }
    }
  };

  const remove = async (pack: InstalledPackSummary) => {
    setRemoving(null);
    try {
      await api.removePack({ id: pack.id });
      toast({ tone: "done", message: `Removed ${pack.title}. Your progress is kept if you install it again.` });
    } catch (err) {
      toast({ tone: "ember", message: `Couldn't remove ${pack.title}: ${errorText(err)}` });
    }
    await qc.invalidateQueries({ queryKey: qk.packs });
    await qc.invalidateQueries({ queryKey: qk.progressAll });
  };

  const repair = async (pack: InstalledPackSummary) => {
    toast({ message: `Repairing ${pack.title}: downloading a fresh copy.` });
    try {
      for await (const ev of api.installPack({ id: pack.id })) {
        if (ev.type === "error") throw new Error(ev.message);
        if (ev.type === "done") toast({ tone: "done", message: `Repaired ${pack.title}.` });
      }
    } catch (err) {
      toast({
        tone: "ember",
        message: `Couldn't repair ${pack.title}: ${errorText(err)} Try Remove, then install it again.`,
      });
    }
    await qc.invalidateQueries({ queryKey: qk.packs });
  };

  const poster = (p: InstalledPackSummary, size: "regular" | "subject" | "pocket", className?: string) => {
    const d = byId.get(p.id);
    return (
      <Poster
        key={p.id}
        summary={p}
        size={size}
        {...(d?.pack ? { pack: d.pack } : {})}
        {...(d?.progress ? { progress: d.progress } : {})}
        {...(className ? { className } : {})}
      />
    );
  };

  const removeDialog = (
    <Dialog
      open={removing !== null}
      onClose={() => setRemoving(null)}
      role="alertdialog"
      title={removing ? `Remove ${removing.title}?` : "Remove this map?"}
      description="The map's files are deleted. Your progress and flashcards stay, so reinstalling picks up where you left off."
      actions={
        <>
          <Button variant="ghost" onClick={() => setRemoving(null)}>
            Keep it
          </Button>
          <Button variant="primary" onClick={() => removing && void remove(removing)}>
            Remove
          </Button>
        </>
      }
    />
  );

  const repairRow =
    dev && invalid.length ? (
      <NeedsRepair packs={invalid} onRepair={(p) => void repair(p)} onRemove={setRemoving} />
    ) : null;

  // Article maps: the ones you opened first, then the rest of the gallery. (Tiers can't tell a built map
  // from a bundled one under --dev, so opening order does.)
  const pockets = valid.filter((p) => p.kind === "pocket");
  const mine = pockets.filter(isStarted);
  const gallery = pockets.filter((p) => !isStarted(p));

  // ── first run ────────────────────────────────────────────────────────────────────────
  if (deciding) return <Page aria-busy="true" />;
  if (firstRun) {
    const loading = false;
    const subjects = firstRunSubjects(valid);
    const pick = loading ? null : pickFirstQuestion(valid.map((s) => ({ summary: s, pack: byId.get(s.id)?.pack })));
    const waitingForPacks = !loading && valid.some((p) => !byId.get(p.id)?.pack);
    return (
      <Page>
        <header className="pt-14 pb-8">
          <h1 className="t-hero text-ink">Learn anything by its map.</h1>
          <p className="mt-3 t-lead text-ink-2">Paste a link. Get a map. Learn it by playing.</p>
        </header>
        <PasteBar ref={paste} size="hero" className="mb-14 max-w-4xl" />
        {packsQ.isError ? (
          <ServerProblem error={packsQ.error} onRetry={() => void packsQ.refetch()} />
        ) : loading ? null : valid.length === 0 ? (
          <EmptyShelf />
        ) : (
          <>
            {pick ? (
              <section aria-labelledby="first-q-head" className="mb-14">
                <SectionHead id="first-q-head">Or start with one question</SectionHead>
                <FirstQuestion pick={pick} />
              </section>
            ) : waitingForPacks ? (
              <div className="mb-14 min-h-[320px]" />
            ) : null}
            {subjects.length ? (
              <section aria-labelledby="subjects-head" className="mb-14">
                <SectionHead id="subjects-head" aside={<MarketLink />}>
                  Or pick a subject
                </SectionHead>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move focus between the poster links inside */}
                <div className="grid grid-cols-12 gap-6" onKeyDown={onShelfKey}>
                  {subjects.map((p) => poster(p, "subject", "col-span-12 sm:col-span-6 lg:col-span-4"))}
                </div>
              </section>
            ) : null}
            {pockets.length ? (
              <section aria-labelledby="gallery-head" className="mb-14">
                <SectionHead id="gallery-head">Article maps, ready to play</SectionHead>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move focus between the poster links inside */}
                <div className="grid grid-cols-12 gap-5" onKeyDown={onShelfKey}>
                  {pockets.map((p) => poster(p, "pocket"))}
                </div>
              </section>
            ) : null}
          </>
        )}
        {repairRow}
        {removeDialog}
      </Page>
    );
  }

  // ── returning ───────────────────────────────────────────────────────────────────────
  const header = <ScreenHeader title="Library" actions={<SearchTrigger />} />;

  if (packsQ.isError) {
    return (
      <Page>
        {header}
        <ServerProblem error={packsQ.error} onRetry={() => void packsQ.refetch()} />
      </Page>
    );
  }

  const yours = valid.filter((p) => p.kind === "pack" && isStarted(p));
  const subjects = valid.filter(
    (p) => p.kind === "pack" && !isStarted(p) && (p.profile === "curated" || p.profile === "sampler"),
  );
  const others = valid.filter(
    (p) => p.kind === "pack" && !isStarted(p) && p.profile !== "curated" && p.profile !== "sampler",
  );

  return (
    <Page>
      {header}
      <PasteBar ref={paste} focusKey="N" className="mb-10 max-w-4xl" />

      {packsQ.data && all.length === 0 ? <EmptyShelf /> : null}

      {hero ? (
        <ContinueHero
          summary={hero.summary}
          fresh={hero.fresh}
          {...(heroData?.pack ? { pack: heroData.pack } : {})}
          {...(heroData?.progress ? { progress: heroData.progress } : {})}
        />
      ) : null}

      {fadingCount > 0 ? (
        <div className="mb-12">
          <RelightStrip count={fadingCount} packTitles={fadingPackTitles} stops={stops} />
        </div>
      ) : null}

      {yours.length ? (
        <section aria-labelledby="your-maps" className="mb-14">
          <SectionHead id="your-maps">Your maps</SectionHead>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move focus between the poster links inside */}
          <div className="grid grid-cols-12 gap-6" onKeyDown={onShelfKey}>
            {yours.map((p) => poster(p, "regular"))}
          </div>
        </section>
      ) : null}

      {subjects.length || others.length ? (
        <section aria-labelledby="subjects" className="mb-14">
          <SectionHead id="subjects" aside={<MarketLink />}>
            Subjects
          </SectionHead>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move focus between the poster links inside */}
          <div className="grid grid-cols-12 gap-6" onKeyDown={onShelfKey}>
            {[...subjects, ...others].map((p) => poster(p, "subject"))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="article-maps" className="mb-14">
        <SectionHead
          id="article-maps"
          aside={<p className="shrink-0 text-small text-ink-2">Small maps from one article, 3 to 12 cards.</p>}
        >
          Article maps
        </SectionHead>
        {mine.length || gallery.length ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move focus between the poster links inside
          <div className="grid grid-cols-12 gap-5" onKeyDown={onShelfKey}>
            {mine.map((p) => poster(p, "pocket"))}
            {gallery.map((p) => poster(p, "pocket"))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-line-strong px-5 py-6 text-body text-ink-2">
            Paste a link above and Learncroc turns it into a short map you can play.
          </p>
        )}
      </section>

      {repairRow}

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-6 text-small text-ink-2">
        <Link to="/flashcards" className="inline-flex items-center gap-2 hover:text-ink">
          <CardsIcon size={16} aria-hidden />
          Flashcards
          <Kbd keys={["G", "F"]} compact />
        </Link>
        <Link to="/logbook" className="inline-flex items-center gap-2 hover:text-ink">
          <Notebook size={16} aria-hidden />
          Logbook
        </Link>
        <Link to="/market" className="inline-flex items-center gap-2 hover:text-ink">
          <Storefront size={16} aria-hidden />
          Find more maps in the Marketplace
        </Link>
      </footer>

      {removeDialog}
    </Page>
  );
}

/** Developer builds only: maps that didn't build, collapsed, each with its error and a way out. */
function NeedsRepair({
  packs,
  onRepair,
  onRemove,
}: {
  packs: InstalledPackSummary[];
  onRepair: (p: InstalledPackSummary) => void;
  onRemove: (p: InstalledPackSummary) => void;
}) {
  return (
    <details className="group mb-14 rounded-md border border-dashed border-line-strong bg-surface-2 px-5 py-4">
      <summary className="cursor-pointer text-body text-ink-2 group-open:mb-4">
        Needs repair <span className="tabular text-ink-3">({packs.length})</span>
        <span className="ml-2 text-small text-ink-3">Shown in developer builds only.</span>
      </summary>
      <ul className="grid gap-4">
        {packs.map((p) => (
          <li key={p.id} data-poster={p.id} className="grid gap-2 rounded-sm border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-body font-semibold text-ink">
                {p.title} <span className="voice-mono text-small font-normal text-ink-3">{p.id}</span>
              </p>
              <div className="flex gap-2">
                {p.kind === "pocket" ? (
                  <Link to="/create/pocket" className={buttonClass({ size: "sm" })}>
                    Rebuild
                  </Link>
                ) : (
                  <Button size="sm" icon={<ArrowClockwise size={16} />} onClick={() => onRepair(p)}>
                    Repair
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={<Trash size={16} />} onClick={() => onRemove(p)}>
                  Remove
                </Button>
              </div>
            </div>
            {p.kind === "pocket" ? (
              <p className="text-small text-ink-2">This map was made for an older version. Rebuild it from its link.</p>
            ) : null}
            {p.statusMessage ? (
              <pre className="voice-mono max-h-40 overflow-auto rounded-xs bg-surface-sunk p-3 text-micro break-words whitespace-pre-wrap text-ink-2">
                {p.statusMessage}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
