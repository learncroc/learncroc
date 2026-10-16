/**
 * /market: the marketplace grid of posters (Handpicked, then Community), filtered by category and
 * search. /market/:pack: map detail with "Try the first card" (the player's CardEmbed: a try-run
 * that writes no progress), "11 cards · 4 checkpoints · about 45 minutes", install with SSE progress
 * and the poster drawing in, review badges and reviewer credits (03 §4.11).
 */
import type { PackCategory, RegistryView } from "@learncroc/core";
import { MapPoster } from "@learncroc/maps";
import { Button, buttonClass, cn, KbdHint, toast } from "@learncroc/ui";
import { ArrowClockwise, ArrowLeft, ArrowSquareOut, MagnifyingGlass, Play, WarningCircle } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { matches } from "../../app/CommandPalette";
import { errorText } from "../../app/errors";
import { useScreenKeys } from "../../app/keys";
import { qk, useRegistry } from "../../app/queries";
import { SearchTrigger } from "../../app/Rail";
import { Page, ScreenHeader } from "../../app/ScreenHeader";
import { useScreenShortcuts } from "../../app/store";
import { CardEmbed } from "../../slots";
import { POSTER_MAP_SLOT, PosterBadge, PosterFrame } from "../library/posterKit";
import { InstallButton } from "./InstallButton";
import { SketchPoster } from "./SketchPoster";
import { useInstall } from "./useInstall";

export type RegistryEntry = RegistryView["packs"][number];

export const CATEGORY_LABEL: Record<PackCategory, string> = {
  languages: "Languages",
  science: "Science",
  "tech-ai": "Tech & AI",
  thinking: "Thinking",
  arts: "Arts",
  practical: "Practical",
};

/** "about 2 h", "about 40 min" */
export function aboutTime(min: number): string {
  if (min < 55) return `about ${Math.max(5, Math.round(min / 5) * 5)} min`;
  const h = Math.round((min / 60) * 2) / 2;
  return `about ${h % 1 ? h.toFixed(1) : h} h`;
}

export function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb < 0.1 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const latestOf = (p: RegistryEntry) => p.versions.find((v) => v.version === p.latest) ?? p.versions[0];

/** Playable checkpoints in the registry sketch. */
const checkpointsOf = (p: RegistryEntry) =>
  p.sketch.nodes.filter((n) => n.kind === "checkpoint" && n.status === "playable").length;

/** "11 cards · 4 checkpoints · about 45 minutes" (03 §4.11). */
export function mapSizeLine(p: RegistryEntry): string {
  const latest = latestOf(p);
  const cards = latest?.playable ?? p.sketch.nodes.filter((n) => n.kind === "node" && n.status === "playable").length;
  const cps = checkpointsOf(p);
  const parts = [`${cards} ${cards === 1 ? "card" : "cards"}`];
  if (cps) parts.push(`${cps} ${cps === 1 ? "checkpoint" : "checkpoints"}`);
  if (latest) parts.push(aboutTime(latest.estMinutes).replace(/ min$/, " minutes").replace(/ h$/, " hours"));
  return parts.join(" · ");
}
const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

// ── Grid ─────────────────────────────────────────────────────────────────────────

export function MarketScreen() {
  const registry = useRegistry();
  const [category, setCategory] = useState<PackCategory | "all">("all");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useScreenKeys({
    "/": (e) => {
      e.preventDefault();
      searchRef.current?.focus();
    },
  });
  useScreenShortcuts("market", {
    title: "Marketplace",
    items: [
      { keys: "/", label: "Search packs" },
      { keys: "⏎", label: "Open the focused map" },
    ],
  });

  const packs = registry.data?.packs ?? [];
  const categories = useMemo(() => [...new Set(packs.map((p) => p.category))], [packs]);
  const shown = packs.filter(
    (p) =>
      (category === "all" || p.category === category) &&
      (!query.trim() || matches(query, p.title, p.subtitle, p.tagline, p.publisher, ...p.tags)),
  );
  const handpicked = shown.filter((p) => p.tier === "official");
  const community = shown.filter((p) => p.tier === "community");

  return (
    <Page>
      <ScreenHeader
        title="Marketplace"
        lead="Find a world worth learning. Try the first card before you install; installed maps work offline."
        actions={<SearchTrigger />}
      />

      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="relative">
          <span className="sr-only">Search maps</span>
          <MagnifyingGlass size={16} aria-hidden className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={`Search ${packs.length || ""} packs`.replace("  ", " ")}
            className="h-10 w-72 rounded-sm border border-line-strong bg-surface pr-10 pl-9 text-body text-ink placeholder:text-ink-3"
            aria-keyshortcuts="/"
          />
          <kbd
            aria-hidden
            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-xs border border-line-strong px-1.5 text-micro text-ink-3"
          >
            /
          </kbd>
        </label>
        {categories.length > 1 ? (
          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="sr-only">Category</legend>
            {(["all", ...categories] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
                className={cn(
                  "h-8 rounded-sm border px-3 text-small transition-colors duration-quick",
                  category === c ? "border-ink bg-ink text-bg" : "border-line-strong text-ink-2 hover:text-ink",
                )}
              >
                {c === "all" ? "All" : CATEGORY_LABEL[c]}
              </button>
            ))}
          </fieldset>
        ) : null}
      </div>

      <RegistryNotes view={registry.data} onRetry={() => void registry.refetch()} />

      {registry.isError ? (
        <section role="alert" className="grid max-w-xl gap-3 rounded-md border border-line bg-surface p-6">
          <h2 className="text-heading">Couldn't load the Marketplace</h2>
          <p className="text-body text-ink-2">
            {errorText(registry.error)}. Installed packs work as usual; browsing needs the registry.
          </p>
          <div>
            <Button icon={<ArrowClockwise size={16} />} onClick={() => void registry.refetch()}>
              Try again
            </Button>
          </div>
        </section>
      ) : registry.data && packs.length === 0 ? (
        <section className="rounded-stage border border-dashed border-line-strong bg-surface-2 px-8 py-12">
          <h2 className="text-heading">No packs to show yet</h2>
          <p className="mt-2 max-w-[60ch] text-body text-ink-2">
            Your registries didn't list any packs. Check your connection, or the registry list in{" "}
            <Link to="/settings/$section" params={{ section: "data" }} className="underline underline-offset-2">
              Settings
            </Link>
            . You can also turn an article into a{" "}
            <Link to="/create/pocket" className="underline underline-offset-2">
              pocket map
            </Link>
            .
          </p>
        </section>
      ) : registry.data && shown.length === 0 ? (
        <p className="text-body text-ink-2">
          No maps match{query.trim() ? ` “${query.trim()}”` : ""}
          {category !== "all" ? ` in ${CATEGORY_LABEL[category]}` : ""}.
        </p>
      ) : null}

      {handpicked.length ? (
        <section aria-labelledby="handpicked" className="mb-14">
          <h2 id="handpicked" className="text-heading">
            Handpicked
          </h2>
          <p className="mt-1 mb-5 text-small text-ink-2">Written and reviewed by the Learncroc maintainers.</p>
          <div className="grid grid-cols-12 gap-6">
            {handpicked.map((p) => (
              <MarketTile key={`${p.registry}/${p.id}`} pack={p} size="large" />
            ))}
          </div>
        </section>
      ) : null}

      {community.length ? (
        <section aria-labelledby="community" className="mb-14">
          <h2 id="community" className="text-heading">
            Community
          </h2>
          <p className="mt-1 mb-5 text-small text-ink-2">
            Made by other learners. These pass <code className="voice-mono">learncroc lint</code>; maintainers haven't
            reviewed them.
          </p>
          <div className="grid grid-cols-12 gap-5">
            {community.map((p) => (
              <MarketTile key={`${p.registry}/${p.id}`} pack={p} size="small" />
            ))}
          </div>
        </section>
      ) : null}
    </Page>
  );
}

function RegistryNotes({ view, onRetry }: { view?: RegistryView; onRetry: () => void }) {
  if (!view || (!view.stale && view.errors.length === 0)) return null;
  return (
    <div
      role="status"
      className="mb-8 flex flex-wrap items-start gap-3 rounded-md border border-ember/60 bg-surface px-4 py-3 text-small"
    >
      <WarningCircle size={18} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-ember-text" />
      <div className="min-w-0 flex-1 text-ink-2">
        {view.errors.map((e) => (
          <p key={e.registry}>
            <span className="text-ember-text">Couldn't reach {e.registry}</span> ({e.message}).
          </p>
        ))}
        {view.stale ? (
          <p>
            Using the copy from {view.fetchedAt ? dateFmt.format(view.fetchedAt) : "an earlier visit"}. Installed packs
            work as usual.
          </p>
        ) : null}
      </div>
      <Button size="sm" variant="ghost" icon={<ArrowClockwise size={14} />} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function MarketTile({ pack, size }: { pack: RegistryEntry; size: "large" | "small" }) {
  const router = useRouter();
  const { state, start } = useInstall(pack.id, pack.registry);
  const latest = latestOf(pack);
  const installed = pack.installed !== undefined || state.phase === "done";
  const large = size === "large";

  useEffect(() => {
    if (state.phase === "error" && state.error) toast({ tone: "ember", message: `${pack.title}: ${state.error}` });
  }, [state.phase, state.error, pack.title]);

  return (
    <article
      aria-labelledby={`tile-${pack.id}`}
      className={cn(
        "group/poster relative",
        large ? "col-span-12 md:col-span-6 xl:col-span-4" : "col-span-6 md:col-span-4 xl:col-span-3",
      )}
    >
      <PosterFrame
        theme={pack.theme}
        className={cn(
          "flex h-full flex-col shadow-2 transition-transform duration-base ease-out group-hover/poster:-translate-y-0.5",
          "group-has-[[data-poster-link]:focus-visible]/poster:ring-[3px] group-has-[[data-poster-link]:focus-visible]/poster:ring-focus group-has-[[data-poster-link]:focus-visible]/poster:ring-offset-2 group-has-[[data-poster-link]:focus-visible]/poster:ring-offset-bg",
        )}
      >
        <div className={cn("px-5 pt-5", large ? "h-[188px]" : "h-[132px]")}>
          <SketchPoster sketch={pack.sketch} title={pack.title} drawing={state.phase === "done"} />
        </div>
        <div className={cn("flex flex-1 flex-col gap-2", large ? "px-6 pt-3 pb-6" : "px-5 pt-2 pb-5")}>
          <p className="voice-casual text-small text-w-ink-2">{pack.theme.world}</p>
          <h3 id={`tile-${pack.id}`} className={large ? "text-heading" : "text-body font-semibold"}>
            <Link
              to="/market/$pack"
              params={{ pack: pack.id }}
              data-poster-link
              className="rounded-xs outline-none after:absolute after:inset-0 after:rounded-stage after:content-['']"
            >
              {pack.title}
            </Link>
          </h3>
          {large && pack.tagline ? <p className="text-small text-w-ink-2">{pack.tagline}</p> : null}
          <p className="tabular text-small text-w-ink-2">
            {mapSizeLine(pack)}
            {large && latest ? ` · ${megabytes(latest.size)}` : ""}
            {!large ? ` by ${pack.publisher}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {pack.review === "draft" && pack.tier === "official" ? (
              <PosterBadge>AI-drafted, review pending</PosterBadge>
            ) : null}
            {pack.customInteractives ? <PosterBadge>Custom interactive</PosterBadge> : null}
            {pack.updateAvailable ? <PosterBadge>Update available</PosterBadge> : null}
          </div>
          {large ? (
            <div className="relative z-10 mt-auto flex flex-wrap items-center gap-2 pt-3">
              {installed ? (
                <>
                  <Link to="/p/$pack" params={{ pack: pack.id }} className={buttonClass({ variant: "primary" })}>
                    Open map
                  </Link>
                  <span className="text-small text-w-ink-2">Installed</span>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={buttonClass({ variant: "primary" })}
                    onClick={() => router.history.push(`/market/${pack.id}?try=1`)}
                  >
                    <Play size={16} weight="fill" aria-hidden />
                    Try the first card
                  </button>
                  <InstallButton state={state} onInstall={() => void start()} />
                </>
              )}
            </div>
          ) : installed ? (
            <p className="mt-auto pt-1 text-small text-w-ink-2">Installed</p>
          ) : null}
        </div>
      </PosterFrame>
    </article>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────────

export function MarketPackScreen() {
  const { pack: id = "" } = useParams({ strict: false });
  const router = useRouter();
  const registry = useRegistry();
  const pack = registry.data?.packs.find((p) => p.id === id);
  const tryParam = useRouterState({ select: (s) => (s.location.search as Record<string, unknown>).try });
  const [trying, setTrying] = useState(() => String(tryParam) === "1");
  const tryBundle = useQuery({
    queryKey: qk.tryBundle(id, pack?.registry),
    queryFn: () => api.getTryBundle({ id }, pack?.registry ? { registry: pack.registry } : {}),
    enabled: Boolean(pack),
    staleTime: Infinity,
    retry: false,
  });
  const { state, start } = useInstall(id, pack?.registry);
  const installed = pack?.installed !== undefined || state.phase === "done";

  useScreenKeys(
    {
      t: (e) => {
        if (!pack || installed) return;
        e.preventDefault();
        setTrying(true);
      },
      i: (e) => {
        if (!pack || installed) return;
        e.preventDefault();
        void start();
      },
      Enter: (e) => {
        if (state.phase !== "done" || (e.target as HTMLElement).closest("button,a")) return;
        e.preventDefault();
        router.history.push(`/p/${id}`);
      },
      Escape: (e) => {
        e.preventDefault();
        if (trying) setTrying(false);
        else router.history.push("/market");
      },
    },
    Boolean(pack),
  );
  useScreenShortcuts("market-pack", {
    title: "Map detail",
    items: [
      { keys: "T", label: "Try the first card" },
      { keys: "I", label: "Install" },
      { keys: "Esc", label: "Back to the Marketplace" },
    ],
  });

  if (registry.isError || (registry.data && !pack)) {
    return (
      <Page>
        <BackLink />
        <section className="mt-6 grid max-w-xl gap-3">
          <h1 className="t-title">Map detail</h1>
          <p className="text-lead text-ink-2">
            {registry.isError
              ? `Couldn't load the registry (${errorText(registry.error)}).`
              : `No registry lists a map called “${id}”. It may have been renamed or removed.`}
          </p>
        </section>
      </Page>
    );
  }
  if (!pack) {
    return (
      <Page>
        <BackLink />
        <h1 className="sr-only">Map detail</h1>
      </Page>
    );
  }

  const latest = latestOf(pack);
  const lines = tryBundle.data?.map;
  const reviewers = pack.reviewers ?? [];
  const stats: [string, string][] = [
    ...(latest && latest.nodes > latest.playable
      ? ([["Planned", `${latest.nodes - latest.playable - checkpointsOf(pack)} more cards coming`]] as [
          string,
          string,
        ][])
      : []),
    ...(latest ? ([["Download", megabytes(latest.size)]] as [string, string][]) : []),
    ["Language", new Intl.DisplayNames(undefined, { type: "language" }).of(pack.lang) ?? pack.lang],
    ...(latest ? ([["License", latest.license]] as [string, string][]) : []),
    [
      "Version",
      pack.installed && pack.installed !== pack.latest ? `${pack.latest} (you have ${pack.installed})` : pack.latest,
    ],
    ...(latest ? ([["Published", dateFmt.format(new Date(latest.published))]] as [string, string][]) : []),
    ["By", pack.publisher],
  ];

  return (
    <Page>
      <BackLink />
      <div className="mt-6 grid grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-7">
          {trying ? (
            <div className="overflow-hidden rounded-stage border border-line bg-surface shadow-2">
              <CardEmbed registry={pack.registry} packId={pack.id} onExit={() => setTrying(false)} />
            </div>
          ) : (
            <PosterFrame theme={pack.theme} className="shadow-2">
              <div className={cn("h-[420px] p-8", POSTER_MAP_SLOT)}>
                {tryBundle.data ? (
                  <div
                    className={cn("h-full", state.phase === "done" && "lm-wipe")}
                    data-drawing={state.phase === "done" || undefined}
                  >
                    <MapPoster
                      pack={tryBundle.data}
                      views={{}}
                      width={tryBundle.data.map.layout.width}
                      height={tryBundle.data.map.layout.height}
                      showTitle={false}
                    />
                  </div>
                ) : (
                  <SketchPoster sketch={pack.sketch} title={pack.title} drawing={state.phase === "done"} />
                )}
              </div>
              <p className="px-8 pb-6 voice-casual text-small text-w-ink-2">{pack.theme.world}</p>
            </PosterFrame>
          )}
          {lines && !trying ? (
            <section aria-labelledby="lines" className="mt-8">
              <h2 id="lines" className="text-heading">
                Lines and cards
              </h2>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                {lines.lines.map((line) => (
                  <div key={line.id}>
                    <h3 className="flex items-center gap-2 text-body font-semibold">
                      <span
                        aria-hidden
                        className="h-1.5 w-6 rounded-pill"
                        style={{ backgroundColor: pack.theme.lines[line.color - 1] }}
                      />
                      {line.title}
                    </h3>
                    <ol className="mt-2 grid gap-1 border-l-2 border-line pl-4 text-small text-ink-2">
                      {(lines.layout.lines[line.id] ?? []).map((nodeId) => {
                        const n = lines.nodes[nodeId];
                        return (
                          <li key={nodeId} className={n?.status === "planned" ? "text-ink-3 italic" : undefined}>
                            {n?.title ?? nodeId}
                            {n?.kind === "checkpoint" ? <span className="text-ink-3"> (checkpoint)</span> : null}
                            {n?.status === "planned" ? <span className="text-ink-3"> (planned)</span> : null}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="col-span-12 lg:col-span-5" aria-labelledby="pack-title">
          <p className="text-small text-ink-2">
            {pack.tier === "official" ? "Handpicked" : "Community"} · {CATEGORY_LABEL[pack.category]}
          </p>
          <h1 id="pack-title" className="t-display mt-2 text-ink">
            {pack.title}
          </h1>
          {pack.tagline || pack.subtitle ? (
            <p className="mt-3 text-lead text-ink-2">{pack.tagline ?? pack.subtitle}</p>
          ) : null}
          <p className="mt-3 tabular text-body text-ink">{mapSizeLine(pack)}</p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {installed ? (
              <>
                <Link
                  to="/p/$pack"
                  params={{ pack: pack.id }}
                  className={buttonClass({ variant: "primary", size: "lg" })}
                >
                  Open map
                  {state.phase === "done" ? <KbdHint keyLabel="⏎" inverted /> : null}
                </Link>
                {pack.updateAvailable && state.phase !== "done" ? (
                  <InstallButton
                    state={state}
                    onInstall={() => void start(pack.latest)}
                    label={`Update to ${pack.latest}`}
                    size="lg"
                  />
                ) : null}
                {state.phase === "done" ? (
                  <p role="status" className="text-small text-ink-2">
                    Installed. Works offline from now on.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  kbd="T"
                  icon={<Play size={16} weight="fill" />}
                  onClick={() => setTrying(true)}
                >
                  Try the first card
                </Button>
                <InstallButton state={state} onInstall={() => void start()} size="lg" kbd="I" />
              </>
            )}
          </div>
          {state.phase === "error" ? (
            <p role="alert" className="mt-3 flex items-start gap-2 text-small text-ember-text">
              <WarningCircle size={16} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
              {state.error}
            </p>
          ) : null}
          {!installed ? (
            <p className="mt-3 text-small text-ink-3">
              Trying the first card saves nothing. Install to keep your progress.
            </p>
          ) : null}

          {pack.outcomes.length ? (
            <section aria-labelledby="outcomes" className="mt-8">
              <h2 id="outcomes" className="text-body font-semibold">
                You'll be able to
              </h2>
              <ul className="mt-2 grid gap-2 text-body text-ink-2">
                {pack.outcomes.map((o) => (
                  <li key={o} className="flex gap-3">
                    <span aria-hidden className="mt-2.5 h-0.5 w-3 shrink-0 bg-ink-3" />
                    {o}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="review" className="mt-8 rounded-md border border-line bg-surface p-4">
            <h2 id="review" className="text-body font-semibold">
              {pack.review === "reviewed" ? "Reviewed by" : "AI-drafted, review pending"}
            </h2>
            {pack.review === "reviewed" && reviewers.length ? (
              <ul className="mt-2 grid gap-1 text-small">
                {reviewers.map((r) => (
                  <li key={r.name}>
                    {r.name} <span className="text-ink-2">({r.role})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-small text-ink-2">
                Written with AI help and checked by lint. A named human reviewer hasn't signed it off yet; you can help
                by reporting anything that looks wrong.
              </p>
            )}
            {pack.customInteractives ? (
              <p className="mt-3 text-small text-ink-2">
                Uses custom interactives. They run in a sandbox with no network access.
              </p>
            ) : null}
          </section>

          <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-small">
            {stats.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-2">{k}</dt>
                <dd className="tabular text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {pack.tags.length ? (
            <p className="mt-6 flex flex-wrap gap-1.5">
              {pack.tags.map((t) => (
                <span key={t} className="rounded-xs border border-line px-2 py-0.5 text-micro text-ink-2">
                  {t}
                </span>
              ))}
            </p>
          ) : null}
          {pack.tier === "community" ? (
            <p className="mt-6 inline-flex items-center gap-1.5 text-small text-ink-2">
              <ArrowSquareOut size={14} aria-hidden />
              From {pack.registry}
            </p>
          ) : null}
        </aside>
      </div>
    </Page>
  );
}

function BackLink() {
  return (
    <div className="pt-8">
      <Link to="/market" className="inline-flex items-center gap-1.5 rounded-xs text-small text-ink-2 hover:text-ink">
        <ArrowLeft size={14} aria-hidden />
        Marketplace
      </Link>
    </div>
  );
}
