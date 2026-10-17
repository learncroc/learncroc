/**
 * /p/:pack — the map, home of a pack. The themed map fills the screen with the Route panel on the
 * right; cards and checkpoints open as modals over it from the URL (C8):
 *
 * - `?card=` opens the card modal (pushed on open; Next replaces it; Back / Esc / scrim go back when
 *   pushed, else replace to the bare map). `?checkpoint=` opens the checkpoint. `?from`, `?guess` and
 *   `?again` pass through to the card. `?finished=1` opens the finished map. A checkpoint id in `?card`
 *   is rewritten to `?checkpoint` (and back). The legacy `?stop=` arrives as `?card` and opens the card
 *   when it can be played, else its peek.
 * - Later, Planned and Writing… cards and Locked or Open gates open a peek anchored to the glyph (C5).
 * - Moments (cardDone, gateOpen, revisit, the final dawn) come from run summaries, queue, never overlap,
 *   and any key skips them. After the first gate ever opens, the one-time sound offer shows.
 *
 * Keys: ⏎ (nothing focused) or N the suggested card, arrows follow the lines, L list, S share,
 * ] Route panel, ⌘J Moss, M whole map, F fit, +/− zoom, Esc closes the top layer only.
 */
import type { CompiledPack, NodeId, NodeView, PackProgress, RunSummary } from "@learncroc/core";
import { ListView, MapBadge, MapView, type MapViewProps, tokenPath, viewFor } from "@learncroc/maps";
import { Button, buttonClass, MenuItem, Modal, StopGlyph } from "@learncroc/ui";
import {
  ArrowCounterClockwise,
  Info,
  Lightning,
  ListBullets,
  MapTrifold,
  ShareNetwork,
  SidebarSimple,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouter, useRouterState, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { ApiClientError } from "../../api/errors";
import { errorText } from "../../app/errors";
import { useScreenKeys } from "../../app/keys";
import { qk, useSettings } from "../../app/queries";
import { ScreenMenu } from "../../app/ScreenMenu";
import { useScreenShortcuts } from "../../app/store";
import { suggestedEntry } from "../../croc/mapChips";
import { type CrocReaction, crocReactions } from "../../croc/reactions";
import { useLayer } from "../../lib/layers";
import { CardModal, CheckpointModal } from "../../run/index";
import { useReducedMotion } from "../../run/prefs";
import { useRunSounds } from "../../run/sound";
import { CrocCorner } from "../../slots";
import { FinishedModal } from "./FinishedModal";
import {
  buildingLine,
  countsLine,
  localDay,
  type MapCounts,
  type MapMoment,
  mapCounts,
  momentFromSummary,
  nextMomentKey,
  openTarget,
  relightMinutes,
  store,
} from "./mapLogic";
import { Peek } from "./Peek";
import { RoutePanel } from "./RoutePanel";
import { ShareDialog } from "./ShareDialog";
import { SlotBoundary } from "./SlotBoundary";
import { SoundOffer } from "./SoundOffer";
import type { MapSearch } from "./search";
import { jobKeyFor, useLiveBuild } from "./useLiveBuild";
import { useMapArrival } from "./useMapArrival";
import { useMapMoments } from "./useMapMoments";

const EMPTY_VIEWS: Record<NodeId, NodeView> = {};
const ROUTE_KEY = "lm:route-panel";
const SOUND_OFFER_KEY = "lm:sound-offer-shown";
const finishedKey = (packId: string) => `lm:finished-shown:${packId}`;
const callbackKey = (packId: string) => `lm:callback-seen:${packId}`;

type Pack = CompiledPack;

export function PackMapScreen() {
  const { pack: packId = "" } = useParams({ strict: false });
  const search = useSearch({ strict: false }) as MapSearch;
  const packQ = useQuery({ queryKey: qk.pack(packId), queryFn: () => api.getPack({ id: packId }), enabled: !!packId });
  const progressQ = useQuery({
    queryKey: qk.progress(packId),
    queryFn: () => api.getPackProgress({ packId }),
    enabled: !!packId,
  });
  const building = Boolean(
    packQ.data && (packQ.data.provisional || Object.values(packQ.data.map.nodes).some((n) => n.status === "building")),
  );
  useLiveBuild(packId, building);

  useEffect(() => {
    if (packId) api.markPackOpened({ id: packId }).catch(() => {});
  }, [packId]);

  if (packQ.isError) {
    const missing = packQ.error instanceof ApiClientError && packQ.error.status === 404;
    return (
      <main className="p-10">
        <h1 className="t-title">Map</h1>
        <p className="mt-3 text-body text-ink-2">
          {missing ? "This map isn't installed." : `This map didn't open. ${errorText(packQ.error)}`}
        </p>
        <div className="mt-6 flex gap-2">
          <Link to="/library" className={buttonClass({ variant: "secondary" })}>
            Back to the library
          </Link>
          {missing ? (
            <Link to="/market/$pack" params={{ pack: packId }} className={buttonClass({ variant: "primary" })}>
              Find it in the marketplace
            </Link>
          ) : null}
        </div>
      </main>
    );
  }
  if (!packQ.data) {
    return (
      <main aria-busy="true" className="p-10">
        <h1 className="t-title">Map</h1>
      </main>
    );
  }
  return (
    <PackMap
      key={packId}
      pack={packQ.data}
      views={progressQ.data?.views ?? EMPTY_VIEWS}
      progress={progressQ.data}
      search={search}
    />
  );
}

/** Where the open card should sit: the map window left of the centred modal (UX §1.7). */
function gutterRect(host: HTMLElement | null): NonNullable<MapViewProps["frame"]>["rect"] | undefined {
  if (!host) return undefined;
  const r = host.getBoundingClientRect();
  const vw = window.innerWidth;
  const w = Math.min(960, vw - 160);
  const modalLeft = (vw + 64 - w) / 2;
  return { left: r.left, top: r.top, width: Math.max(120, modalLeft - 16 - r.left), height: r.height };
}

function readRouteOpen(): boolean {
  const v = store.get(ROUTE_KEY);
  if (v === "open") return true;
  if (v === "closed") return false;
  return typeof window !== "undefined" && window.innerWidth >= 1280;
}

function PackMap({
  pack,
  views,
  progress,
  search,
}: {
  pack: Pack;
  views: Record<NodeId, NodeView>;
  progress: PackProgress | undefined;
  search: MapSearch;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const sounds = useRunSounds();
  const reduced = useReducedMotion();
  const settings = useSettings().data;
  const packId = pack.manifest.id;
  const counts = mapCounts(pack, views);
  const finished = Boolean(progress?.finished) || counts.allLit;
  const pushed = useRouterState({
    select: (s) => (s.location.state as { lmModal?: boolean } | undefined)?.lmModal === true,
  });
  const [list, setList] = useState(false);
  const [share, setShare] = useState(false);
  const [legend, setLegend] = useState(false);
  const [routeOpen, setRouteOpen] = useState(readRouteOpen);
  const [peek, setPeek] = useState<{ id: NodeId; anchor?: Element }>();
  const [selected, setSelected] = useState<NodeId>();
  const [frame, setFrame] = useState<MapViewProps["frame"]>();
  const [soundOffer, setSoundOffer] = useState(false);
  const [callbackSeen, setCallbackSeen] = useState(() => store.get(callbackKey(packId)));
  const mapHost = useRef<HTMLDivElement>(null);
  const pending = useRef<MapMoment[]>([]);
  const nextAfterGate = useRef<NodeId | undefined>(undefined);
  const finishAfterGate = useRef(false);
  const enqueueRef = useRef<(m: MapMoment) => void>(() => {});
  const modalOpen = Boolean(search.card || search.checkpoint || search.finished);
  const due = progress?.due.relight ?? 0;
  const suggested = useMemo(() => suggestedEntry(pack, views), [pack, views]);

  useMapArrival(pack, views, progress);

  // ── URL navigation.
  const go = useCallback(
    (s: MapSearch, how: "push" | "replace") => {
      void navigate({
        to: "/p/$pack",
        params: { pack: packId },
        // `stop` (the legacy alias) is not part of MapSearch; clear it explicitly or the router keeps it.
        search: { ...s, stop: undefined } as MapSearch,
        ...(how === "replace" ? { replace: true } : {}),
        state: ((prev: Record<string, unknown>) => ({
          ...prev,
          lmModal: how === "push" ? Object.keys(s).length > 0 : prev.lmModal === true,
        })) as never,
      });
    },
    [navigate, packId],
  );

  // A checkpoint id in ?card (or a card id in ?checkpoint) is rewritten with replace.
  useEffect(() => {
    const id = search.card ?? search.checkpoint;
    if (!id) return;
    const kind = pack.map.nodes[id]?.kind;
    if (search.card && kind === "checkpoint") go({ checkpoint: id }, "replace");
    else if (search.checkpoint && kind === "node") go({ card: id }, "replace");
  }, [search.card, search.checkpoint, pack.map.nodes, go]);

  // ?card (and the legacy ?stop) for an entry that can't be played yet: show its peek instead. Decided
  // once per URL after progress loads, so a card that changes state mid-session never bounces.
  const latest = useRef({ pack, views, go, search });
  latest.current = { pack, views, go, search };
  const loaded = progress !== undefined;
  useEffect(() => {
    const id = search.card ?? search.checkpoint;
    if (!id || !loaded) return;
    const { pack: p, views: v, go: nav } = latest.current;
    const node = p.map.nodes[id];
    const locked = viewFor(p.map, v, id).state === "locked";
    if (!node) nav({}, "replace");
    else if (node.kind === "node" ? openTarget(p, v, id) === "peek" : locked || node.status !== "playable") {
      nav({}, "replace");
      setPeek({ id });
    } else if (/[?&]stop=/.test(window.location.search)) {
      // The legacy ?stop= alias is read as ?card=; drop it from the address bar.
      nav(latest.current.search, "replace");
    }
  }, [search.card, search.checkpoint, loaded]);

  // Opening a modal pans the card into the map window beside it.
  useEffect(() => {
    const id = search.card ?? search.checkpoint;
    if (!id || !pack.map.layout.nodes[id]) return;
    const rect = gutterRect(mapHost.current);
    setFrame({ node: id, ...(rect ? { rect } : {}), key: nextMomentKey() });
  }, [search.card, search.checkpoint, pack.map.layout.nodes]);

  // The peek anchors to the glyph on the map (or the row it was opened from).
  const anchorFor = useCallback((id: NodeId): Element | undefined => {
    const el = mapHost.current?.querySelector(`[data-stop="${CSS.escape(id)}"]`);
    return el ?? undefined;
  }, []);

  const openEntry = useCallback(
    (id: NodeId, anchor?: Element) => {
      const target = openTarget(pack, views, id);
      if (target === "peek") {
        setPeek({ id, ...((anchor ?? anchorFor(id)) ? { anchor: anchor ?? anchorFor(id) } : {}) });
        return;
      }
      setSelected(id);
      setPeek(undefined);
      go(target === "card" ? { card: id } : { checkpoint: id }, "push");
    },
    [pack, views, anchorFor, go],
  );

  // ── moments. Moss speaks a beat after a moment ends, so the card's own line has had its moment.
  const say = useCallback((e: CrocReaction) => {
    setTimeout(() => crocReactions.emit(e), 700);
  }, []);
  const onMomentEnd = useCallback(
    (m: MapMoment, skipped: boolean) => {
      if (m.kind === "cardDone") {
        const s = m.summary;
        const next = s.next;
        if (next?.kind === "checkpoint") {
          const cp = pack.map.nodes[next.nodeId];
          const minutes = cp?.estMinutes ?? Math.max(2, Math.round((cp?.size ?? 4) * 0.75));
          say({ type: "section-complete", packId, checkpointId: next.nodeId, minutes });
        } else if (counts.done <= 1) {
          say({ type: "first-card-done", packId, nodeId: m.node });
        }
        return;
      }
      if (m.kind === "gateOpen") {
        const next = m.summary.next;
        nextAfterGate.current = next?.nodeId;
        if (!skipped && m.unlocked.length > 0) sounds.unlock();
        if (finishAfterGate.current) {
          finishAfterGate.current = false;
          if (!store.get(finishedKey(packId))) {
            setTimeout(() => enqueueRef.current({ kind: "dawn", key: nextMomentKey() }), 0);
            return;
          }
        }
        say({
          type: "gate-opened",
          packId,
          checkpointId: m.gate,
          ...(next ? { nextTitle: pack.map.nodes[next.nodeId]?.title ?? next.nodeId } : {}),
        });
        if (!settings?.sound.offered && !store.get(SOUND_OFFER_KEY)) {
          store.set(SOUND_OFFER_KEY, "1");
          setSoundOffer(true);
        }
        return;
      }
      if (m.kind === "dawn") {
        store.set(finishedKey(packId), "1");
        sounds.finish();
        crocReactions.emit({ type: "map-finished", packId });
        go({ finished: true }, "push");
      }
    },
    [pack.map.nodes, packId, counts.done, sounds, settings?.sound.offered, go, say],
  );
  const moments = useMapMoments({ modalOpen, canPlay: !list, onEnd: onMomentEnd });
  enqueueRef.current = moments.enqueue;
  const current = moments.current;

  const flushPending = useCallback(() => {
    for (const m of pending.current) moments.enqueue(m);
    pending.current = [];
  }, [moments]);

  const closeModal = useCallback(() => {
    flushPending();
    if (pushed) router.history.back();
    else go({}, "replace");
  }, [flushPending, pushed, router, go]);

  const navigateTo = useCallback(
    (to: { nodeId: NodeId; kind: "node" | "checkpoint"; from?: NodeId }) => {
      // Next card: the closed card's moment plays behind the scrim while the next one opens.
      const done = pending.current.find((m) => m.kind === "cardDone");
      if (done && done.kind === "cardDone") {
        moments.enqueue({ ...done, behind: true });
        pending.current = pending.current.filter((m) => m !== done);
      }
      // Following a revisit row: the learner is on the route already.
      if (to.from) pending.current = pending.current.filter((m) => m.kind !== "revisit");
      go(
        to.kind === "checkpoint"
          ? { checkpoint: to.nodeId }
          : { card: to.nodeId, ...(to.from ? { from: to.from } : {}) },
        "replace",
      );
    },
    [moments, go],
  );

  const onSummary = useCallback((s: RunSummary) => {
    const m = momentFromSummary(s);
    if (m) pending.current = [...pending.current.filter((x) => x.kind !== m.kind), m];
    if (s.mapFinished) finishAfterGate.current = true;
  }, []);

  const onOpenGate = useCallback(
    (s: RunSummary) => {
      if (!pending.current.some((m) => m.kind === "gateOpen")) {
        const m = momentFromSummary(s);
        if (m) pending.current.push(m);
      }
      if (s.mapFinished) finishAfterGate.current = true;
      closeModal();
    },
    [closeModal],
  );

  const showRoute = useCallback(
    (id: NodeId) => {
      setPeek(undefined);
      const from =
        suggestedEntry(pack, views) ?? pack.map.topo.find((x) => views[x]?.state === "lit") ?? pack.map.topo[0];
      if (!from || from === id) return;
      const path = tokenPath(pack.map, views, from, id);
      moments.enqueue({ kind: "revisit", from: path[0] ?? from, to: path.slice(1), key: nextMomentKey(), route: true });
      setFrame({ node: id, key: nextMomentKey() });
    },
    [pack, views, moments],
  );

  const openSuggested = useCallback(
    (e: KeyboardEvent) => {
      const id = nextAfterGate.current ?? suggested;
      nextAfterGate.current = undefined;
      if (!id) return;
      e.preventDefault();
      openEntry(id);
    },
    [suggested, openEntry],
  );

  const toggleRoute = useCallback(() => {
    setRouteOpen((o) => {
      store.set(ROUTE_KEY, o ? "closed" : "open");
      return !o;
    });
  }, []);

  useScreenKeys(
    {
      Enter: (e) => {
        if (peek) return;
        const t = e.target as HTMLElement | null;
        if (t && t !== document.body && t.closest("button, a, input, textarea, select, [role='treegrid']")) return;
        openSuggested(e);
      },
      n: (e) => {
        if (!peek) openSuggested(e);
      },
      l: () => setList((v) => !v),
      s: () => setShare(true),
      "]": toggleRoute,
    },
    !modalOpen,
  );
  useScreenShortcuts("pack-map", {
    title: "Map",
    items: [
      { keys: "⏎", label: "Open the suggested card (or the focused one)" },
      { keys: "N", label: "Open the next card" },
      { keys: ["←", "→"], label: "Follow the line" },
      { keys: ["↑", "↓"], label: "Neighbouring line" },
      { keys: "M", label: "Show the whole map" },
      { keys: "F", label: "Fit the map" },
      { keys: ["+", "−"], label: "Zoom" },
      { keys: "L", label: "List view" },
      { keys: "S", label: "Share" },
      { keys: "]", label: "Your route panel" },
      { keys: ["⌘", "J"], label: "Ask Moss" },
    ],
  });

  const today = progress ? localDay(progress.now) : undefined;
  const callback =
    progress?.callback && pack.map.nodes[progress.callback]?.status === "playable" && callbackSeen !== today
      ? progress.callback
      : undefined;
  const seeCallback = () => {
    if (!today) return;
    store.set(callbackKey(packId), today);
    setCallbackSeen(today);
  };
  const build = buildingLine(pack);
  const jobId = (() => {
    try {
      return sessionStorage.getItem(jobKeyFor(packId)) ?? undefined;
    } catch {
      return undefined;
    }
  })();

  const corner = (
    <SlotBoundary name="Moss">
      <CrocCorner packId={packId} views={views} {...(peek ? { selected: peek.id } : {})} />
    </SlotBoundary>
  );

  return (
    <main className="flex h-dvh min-h-0 flex-col" data-screen="pack-map">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {finished ? (
            <button
              type="button"
              onClick={() => go({ finished: true }, "push")}
              aria-label="See the badge"
              title="See the badge"
              className="shrink-0 rounded-pill focus-visible:outline-2 focus-visible:outline-focus"
            >
              <MapBadge
                pack={pack}
                cards={counts.playable}
                {...(progress?.finishedAt ? { finishedAt: progress.finishedAt } : {})}
                size={28}
              />
            </button>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-heading">{pack.manifest.title}</h1>
            <p className="text-small text-ink-3 tabular" data-counts>
              {pack.manifest.theme.world} · {countsLine(counts)}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {callback ? (
            <span className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface-2 py-0.5 pr-1 pl-0.5">
              <Link
                to="/p/$pack"
                params={{ pack: packId }}
                search={{ card: callback, again: true }}
                state={((prev: Record<string, unknown>) => ({ ...prev, lmModal: true })) as never}
                onClick={seeCallback}
                className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-small text-ink hover:bg-surface"
                data-callback
              >
                <ArrowCounterClockwise size={14} aria-hidden />
                Yesterday's question
              </Link>
              <button
                type="button"
                onClick={seeCallback}
                className="rounded-pill px-2 py-1 text-micro text-ink-3 hover:bg-surface hover:text-ink-2"
              >
                Not today
              </button>
            </span>
          ) : null}
          {counts.fading > 0 || due > 0 ? (
            <Link to="/relight" search={{ pack: packId }} className={buttonClass({ variant: "secondary" })}>
              <Lightning size={16} aria-hidden className="text-ember-text" />
              Relight this map · {relightMinutes(counts.fading, due)} min
            </Link>
          ) : null}
          <Button variant="secondary" onClick={() => setShare(true)} icon={<ShareNetwork size={16} />} kbd="S">
            Share
          </Button>
          <Button
            variant="ghost"
            onClick={() => setList((v) => !v)}
            aria-pressed={list}
            icon={list ? <MapTrifold size={16} /> : <ListBullets size={16} />}
            kbd="L"
          >
            {list ? "Map" : "List"}
          </Button>
          <ScreenMenu context={{ screen: "Map", packId, packVersion: pack.manifest.version }}>
            <MenuItem icon={<Info size={16} />} onSelect={() => setLegend(true)}>
              Legend
            </MenuItem>
          </ScreenMenu>
        </div>
      </header>
      {build ? (
        <div
          className="flex items-center gap-3 border-b border-line bg-iris-soft/60 px-6 py-1.5 text-small text-ink"
          role="status"
          data-building
        >
          <span className="inline-block size-2 animate-pulse rounded-pill bg-iris" aria-hidden />
          <span>{build}</span>
          {jobId ? (
            <Link
              to="/create/pocket/$job"
              params={{ job: jobId }}
              className="ml-auto text-small text-ink-2 underline hover:text-ink"
            >
              Building details
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div ref={mapHost} className="relative min-h-0 min-w-0 flex-1">
          {list ? (
            <div className="h-full overflow-auto bg-bg px-6 py-4">
              <ListView
                pack={pack}
                views={views}
                {...(selected ? { selectedId: selected } : {})}
                onSelect={setSelected}
                onOpen={(id) =>
                  openEntry(id, document.activeElement instanceof Element ? document.activeElement : undefined)
                }
              />
            </div>
          ) : (
            <MapView
              pack={pack}
              views={views}
              variant="full"
              {...(selected ? { selectedId: selected } : {})}
              onSelect={(id) => openEntry(id)}
              onOpen={(id) => openEntry(id)}
              {...(current?.kind === "cardDone"
                ? {
                    cardDone: { node: current.node, ...(current.next ? { next: current.next } : {}), key: current.key },
                  }
                : {})}
              {...(current?.kind === "gateOpen"
                ? { gateOpen: { gate: current.gate, lit: current.lit, unlocked: current.unlocked, key: current.key } }
                : {})}
              {...(current?.kind === "revisit"
                ? { revisit: { from: current.from, to: current.to, key: current.key } }
                : {})}
              {...(frame ? { frame } : {})}
              onMomentDone={moments.done}
              overlay={corner}
            />
          )}
          {list ? (
            <div className="pointer-events-none absolute inset-0 z-20 [&>*]:pointer-events-auto">{corner}</div>
          ) : null}
          {finished || current?.kind === "dawn" ? (
            <DawnWash
              play={current?.kind === "dawn"}
              reduced={reduced}
              {...(current?.kind === "dawn" ? { onDone: () => moments.done(current.key) } : {})}
            />
          ) : null}
          {soundOffer ? <SoundOffer onDone={() => setSoundOffer(false)} /> : null}
          {!routeOpen && !list ? (
            <button
              type="button"
              onClick={toggleRoute}
              className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-sm border border-line bg-surface/95 px-2.5 py-1.5 text-small text-ink-2 shadow-1 hover:text-ink"
              aria-label="Show your route"
            >
              <SidebarSimple size={14} aria-hidden className="-scale-x-100" />
              Your route <span className="text-micro text-ink-3">]</span>
            </button>
          ) : null}
        </div>
        {routeOpen && !list ? (
          <RoutePanel
            pack={pack}
            views={views}
            progress={progress}
            counts={counts}
            onOpen={openEntry}
            onCollapse={toggleRoute}
          />
        ) : null}
      </div>

      {peek ? (
        <Peek
          pack={pack}
          views={views}
          id={peek.id}
          {...(peek.anchor ? { anchor: peek.anchor } : {})}
          onClose={() => setPeek(undefined)}
          onShowRoute={showRoute}
          onPractise={(id) => {
            setPeek(undefined);
            go({ checkpoint: id }, "push");
          }}
        />
      ) : null}

      {search.card && progress && openTarget(pack, views, search.card) === "card" ? (
        <CardModal
          key={`${search.card}:${search.again ? "again" : ""}:${search.from ?? ""}`}
          packId={packId}
          nodeId={search.card}
          {...(search.from ? { from: search.from } : {})}
          {...(search.guess ? { guess: search.guess } : {})}
          {...(search.again ? { again: true } : {})}
          onClose={closeModal}
          onNavigate={navigateTo}
          onSummary={onSummary}
        />
      ) : null}
      {search.checkpoint && pack.map.nodes[search.checkpoint]?.kind === "checkpoint" ? (
        <CheckpointModal
          key={search.checkpoint}
          packId={packId}
          checkpointId={search.checkpoint}
          onClose={closeModal}
          onNavigate={navigateTo}
          onSummary={onSummary}
          onOpenGate={onOpenGate}
        />
      ) : null}
      {search.finished ? (
        <FinishedModal
          pack={pack}
          views={views}
          counts={counts}
          {...(progress?.finishedAt ? { finishedAt: progress.finishedAt } : {})}
          onClose={closeModal}
        />
      ) : null}
      <ShareDialog
        open={share}
        onClose={() => setShare(false)}
        pack={pack}
        views={views}
        counts={counts}
        finished={finished}
        {...(progress?.finishedAt ? { finishedAt: progress.finishedAt } : {})}
      />
      {legend ? <Legend counts={counts} onClose={() => setLegend(false)} /> : null}
    </main>
  );
}

/**
 * The dawn over a finished map: fades in over 1.2 s as the final moment (then the finished modal
 * opens), and stays, faint, on a finished map. Lumen is allowed here: the whole map is mastered.
 */
function DawnWash({ play, reduced, onDone }: { play: boolean; reduced: boolean; onDone?: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!play) return;
    const t = setTimeout(() => done.current?.(), reduced ? 400 : 2_100);
    return () => clearTimeout(t);
  }, [play, reduced]);
  return (
    <div
      aria-hidden
      data-dawn={play ? "playing" : "still"}
      className="pointer-events-none absolute inset-0 z-[5] mix-blend-soft-light"
      style={{
        background:
          "radial-gradient(120% 90% at 50% 105%, color-mix(in oklab, var(--lumen) 55%, transparent) 0%, color-mix(in oklab, var(--lumen-soft) 30%, transparent) 45%, transparent 75%)",
        opacity: play ? 1 : 0.55,
        animation: play && !reduced ? "lm-fade 1200ms var(--ease-out) both" : undefined,
      }}
    />
  );
}

/** The legend (from the ⋯ menu): every card and gate state, shape-coded. */
function Legend({ counts, onClose }: { counts: MapCounts; onClose(): void }) {
  useLayer("modal", { onClose });
  const cards = [
    { state: "locked", label: "Later" },
    { state: "ready", label: "Ready" },
    { state: "in-progress", label: "In progress" },
    { state: "done", label: "Done" },
    { state: "lit", label: "Lit" },
    { state: "fading", label: "Fading" },
    { state: "planned", label: "Planned" },
  ] as const;
  const gates = [
    { state: "locked", label: "Locked" },
    { state: "ready", label: "Ready" },
    { state: "lit", label: "Open" },
  ] as const;
  return (
    <Modal open onClose={onClose} title="Legend" size="peek" bodyClassName="flex flex-col gap-3 p-4">
      <div data-legend>
        <h3 className="m-0 mb-1.5 text-micro font-[700] tracking-[0.08em] text-ink-3 uppercase">Cards</h3>
        <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1.5 p-0">
          {cards.map((i) => (
            <li key={i.state} className="flex items-center gap-2 text-small text-ink">
              <StopGlyph state={i.state} kind="node" size={18} decorative />
              {i.label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="m-0 mb-1.5 text-micro font-[700] tracking-[0.08em] text-ink-3 uppercase">Checkpoints</h3>
        <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1.5 p-0">
          {gates.map((i) => (
            <li key={i.state} className="flex items-center gap-2 text-small text-ink">
              <StopGlyph state={i.state} kind="checkpoint" size={18} decorative />
              {i.label}
            </li>
          ))}
        </ul>
      </div>
      <p className="m-0 text-micro text-ink-3">
        Done cards light up when you pass their checkpoint.
        {counts.gates ? ` ${counts.open} of ${counts.gates} checkpoints open.` : ""}
      </p>
    </Modal>
  );
}
