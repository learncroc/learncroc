/**
 * /dev/maps: the map gallery. A live map for any world (gallery, 30-card stress maps, installed packs)
 * with a journey you can step through: close a card (cardDone), pass the next checkpoint (gateOpen),
 * miss one (revisit), relight. Below: every card state and every gate state per renderer, the list view,
 * the section strip and mini map, a badge per renderer, the finished share posters (with an offline PNG
 * export) and every world as a poster.
 */
import type { CompiledPack, NodeId, NodeView, RendererId } from "@learncroc/core";
import {
  exportMapPosterPng,
  gateCovers,
  ListView,
  labelCollisions,
  MapBadge,
  MapPoster,
  MapView,
  MiniMap,
  nextGate,
  resolveBackdrop,
  resolveRenderer,
  sectionsOf,
  viewFor,
} from "@learncroc/maps";
import {
  galleryPacks,
  type SimulatedProgress,
  scenarioViews,
  simulateViews,
  stateSheet,
  stressPack,
} from "@learncroc/maps/gallery";
import { Button, cn, Segmented, Switch, stateLabel } from "@learncroc/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { qk } from "../../app/queries";

type AnyPack = Pick<CompiledPack, "manifest" | "map">;
type Journey = "fresh" | "journey" | "all-lit" | "real";

const RENDERERS: RendererId[] = ["metro", "circuit", "atlas", "sketchbook", "trail"];
const SCENARIOS: { value: Journey; label: string }[] = [
  { value: "fresh", label: "First visit" },
  { value: "journey", label: "Mid-journey" },
  { value: "all-lit", label: "Finished" },
];
const INSTALLED_SCENARIOS: { value: Journey; label: string }[] = [
  { value: "real", label: "Your progress" },
  ...SCENARIOS,
];

type Moment =
  | { kind: "cardDone"; node: NodeId; next?: NodeId; key: number }
  | { kind: "gateOpen"; gate: NodeId; lit: NodeId[]; unlocked: NodeId[]; key: number }
  | { kind: "revisit"; from: NodeId; to: NodeId[]; key: number };

/** The simulated progress behind a set of views (so the journey can be stepped forward). */
function progressOf(views: Record<NodeId, NodeView>): SimulatedProgress {
  const of = (s: NodeView["state"]) =>
    Object.values(views)
      .filter((v) => v.state === s)
      .map((v) => v.id);
  return {
    lit: of("lit"),
    fading: of("fading"),
    done: of("done"),
    inProgress: of("in-progress"),
    durable: Object.values(views)
      .filter((v) => v.durable)
      .map((v) => v.id),
  };
}

export function DevMapsScreen() {
  const gallery = useMemo(() => galleryPacks(), []);
  const stress = useMemo(() => RENDERERS.map((r) => stressPack(r).pack), []);
  const sheets = useMemo(() => RENDERERS.map((r) => ({ renderer: r, ...stateSheet(r) })), []);
  const installed = useQuery({ queryKey: qk.packs, queryFn: () => api.listPacks(), retry: false });
  const [source, setSource] = useState<string>(gallery[0]?.manifest.id ?? "");
  const [scenario, setScenario] = useState<Journey>("journey");
  const [reduced, setReduced] = useState(false);
  const [selected, setSelected] = useState<NodeId | undefined>();
  const [peek, setPeek] = useState<NodeId | undefined>();
  const [lightKey, setLightKey] = useState<string>();
  const [moment, setMoment] = useState<Moment>();
  const [stepped, setStepped] = useState<Record<NodeId, NodeView> | undefined>();
  const [log, setLog] = useState<string[]>([]);
  const counter = useRef(0);
  const nextKey = () => ++counter.current;

  const installedId = source.startsWith("installed:") ? source.slice("installed:".length) : undefined;
  const installedPack = useQuery({
    queryKey: qk.pack(installedId ?? ""),
    queryFn: () => api.getPack({ id: installedId ?? "" }),
    enabled: !!installedId,
    retry: false,
  });
  const installedProgress = useQuery({
    queryKey: qk.progress(installedId ?? ""),
    queryFn: () => api.getPackProgress({ packId: installedId ?? "" }),
    enabled: !!installedId,
    retry: false,
  });

  const pack: AnyPack | undefined = installedId
    ? installedPack.data
    : [...gallery, ...stress].find((p) => p.manifest.id === source);
  const baseViews: Record<NodeId, NodeView> = useMemo(() => {
    if (!pack) return {};
    if (scenario === "real") return installedId ? (installedProgress.data?.views ?? {}) : scenarioViews(pack, "fresh");
    return scenarioViews(pack, scenario);
  }, [pack, installedId, installedProgress.data, scenario]);
  const views = stepped ?? baseViews;

  // Reduced motion preview: the same override Settings › Appearance uses.
  useEffect(() => {
    const el = document.documentElement;
    const before = el.dataset.motion;
    if (reduced) el.dataset.motion = "reduced";
    else delete el.dataset.motion;
    return () => {
      if (before) el.dataset.motion = before;
      else delete el.dataset.motion;
    };
  }, [reduced]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the world or the journey changes.
  useEffect(() => {
    setSelected(undefined);
    setMoment(undefined);
    setStepped(undefined);
    setPeek(undefined);
  }, [source, scenario]);
  useEffect(() => {
    setScenario((s) => (source.startsWith("installed:") ? "real" : s === "real" ? "journey" : s));
  }, [source]);

  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 6));
  const title = (id: NodeId) => pack?.map.nodes[id]?.title ?? id;

  // ── stepping the journey forward
  const closeCard = () => {
    if (!pack) return;
    const order = pack.map.topo;
    const card =
      (selected &&
      pack.map.nodes[selected]?.kind === "node" &&
      ["ready", "in-progress"].includes(views[selected]?.state ?? "")
        ? selected
        : undefined) ??
      order.find(
        (id) => pack.map.nodes[id]?.kind === "node" && ["in-progress", "ready"].includes(views[id]?.state ?? ""),
      );
    if (!card) return say("No Ready card to close.");
    const p = progressOf(views);
    const after = simulateViews(pack, {
      ...p,
      done: [...(p.done ?? []), card],
      inProgress: (p.inProgress ?? []).filter((x) => x !== card),
    });
    const next = order.find(
      (id) =>
        id !== card &&
        pack.map.nodes[id]?.kind === "node" &&
        (after[id]?.state === "ready" || after[id]?.state === "in-progress"),
    );
    setStepped(after);
    setMoment({ kind: "cardDone", node: card, ...(next ? { next } : {}), key: nextKey() });
    say(`cardDone: ${title(card)}${next ? ` → ${title(next)}` : ""}`);
  };
  const passGate = () => {
    if (!pack) return;
    const gate = nextGate(pack.map, views);
    if (!gate) return say("Every checkpoint is open.");
    const covers = gateCovers(pack.map, gate);
    const p = progressOf(views);
    const lit = [...new Set([...(p.lit ?? []), ...covers, gate])];
    const after = simulateViews(pack, {
      ...p,
      lit,
      done: (p.done ?? []).filter((x) => !lit.includes(x)),
      inProgress: (p.inProgress ?? []).filter((x) => !lit.includes(x)),
    });
    const unlocked = pack.map.topo.filter((id) => views[id]?.state === "locked" && after[id]?.state === "ready");
    setStepped(after);
    setMoment({ kind: "gateOpen", gate, lit: covers, unlocked, key: nextKey() });
    say(`gateOpen: ${title(gate)} · lit ${covers.length} · ready ${unlocked.length}`);
  };
  const missGate = () => {
    if (!pack) return;
    const gate = nextGate(pack.map, views) ?? pack.map.topo.find((id) => pack.map.nodes[id]?.kind === "checkpoint");
    if (!gate) return;
    const to = gateCovers(pack.map, gate).slice(0, 2);
    const after: Record<NodeId, NodeView> = { ...views };
    for (const id of to) after[id] = { ...viewFor(pack.map, views, id), revisit: true };
    setStepped(after);
    setMoment({ kind: "revisit", from: gate, to, key: nextKey() });
    say(`revisit: ${to.map(title).join(", ")}`);
  };

  const litNodes = pack ? pack.map.topo.filter((id) => views[id]?.state === "lit") : [];
  const renderer = pack ? resolveRenderer(pack.manifest.theme.renderer, pack.map) : "metro";
  const collisions = pack ? labelCollisions(pack.map, renderer) : [];
  const playableCards = pack
    ? Object.values(pack.map.nodes).filter((n) => n.kind === "node" && n.status === "playable").length
    : 0;
  const strip = useMemo(() => {
    if (!pack) return [];
    const gate = nextGate(pack.map, views) ?? sectionsOf(pack.map)[0]?.checkpoint;
    return gate ? [...gateCovers(pack.map, gate), gate] : [];
  }, [pack, views]);

  return (
    <main className="mx-auto w-full max-w-[1376px] px-8 pt-10 pb-16" data-screen="dev-maps">
      <header className="flex flex-wrap items-end justify-between gap-6 pb-6">
        <div>
          <h1 className="t-title">Map gallery</h1>
          <p className="mt-2 max-w-[72ch] text-body text-ink-2">
            Four renderers, every world, every card and checkpoint state. Step a journey forward and watch the map
            moments. On the big map: arrows, ⏎, Space (peek), hold M for the whole map (Shift+M keeps it), F, +, −. Any
            key or click skips a gate opening.
          </p>
        </div>
        <Switch checked={reduced} onChange={setReduced} label="Reduced motion" />
      </header>

      <section aria-label="World on show" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-small text-ink-2">
            World
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="h-10 rounded-sm border border-line-strong bg-surface px-2 text-body text-ink"
            >
              <optgroup label="Gallery">
                {gallery.map((p) => (
                  <option key={p.manifest.id} value={p.manifest.id}>
                    {p.manifest.title} · {p.manifest.theme.world} ({p.manifest.theme.renderer})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Performance (30 entries)">
                {stress.map((p) => (
                  <option key={p.manifest.id} value={p.manifest.id}>
                    {p.manifest.title}
                  </option>
                ))}
              </optgroup>
              {installed.data?.length ? (
                <optgroup label="Installed">
                  {installed.data.map((p) => (
                    <option key={p.id} value={`installed:${p.id}`}>
                      {p.title} ({p.theme.renderer})
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <Segmented
            label="Journey"
            value={scenario}
            options={installedId ? INSTALLED_SCENARIOS : SCENARIOS}
            onChange={setScenario}
          />
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={closeCard} disabled={!pack}>
              Close a card
            </Button>
            <Button size="sm" onClick={passGate} disabled={!pack}>
              Pass the checkpoint
            </Button>
            <Button size="sm" onClick={missGate} disabled={!pack}>
              Miss it (revisit)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLightKey(String(nextKey()))}
              disabled={!litNodes.length}
            >
              Relight
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStepped(undefined)} disabled={!stepped}>
              Reset
            </Button>
          </span>
        </div>
        <p
          className={cn("text-small", collisions.length ? "text-ember-text" : "text-ink-3")}
          data-collisions={collisions.length}
        >
          {collisions.length
            ? `Readability: ${collisions.length} overlap${collisions.length === 1 ? "" : "s"}: ${collisions.slice(0, 3).join("; ")}`
            : `Readability: no glyph or label overlaps in ${renderer}.`}
          {pack ? ` Backdrop: ${resolveBackdrop(pack.manifest.theme, renderer) ?? "none"}.` : ""}
        </p>
        <div className="relative h-[640px] overflow-hidden rounded-stage border border-line shadow-2">
          {pack ? (
            <MapView
              key={`${source}:${scenario}`}
              pack={pack}
              views={views}
              variant="full"
              {...(selected ? { selectedId: selected } : {})}
              onSelect={setSelected}
              onOpen={(id) =>
                say(`open: ${title(id)} (${stateLabel(pack.map.nodes[id]?.kind, viewFor(pack.map, views, id).state)})`)
              }
              onPeek={(id) => setPeek(id)}
              {...(lightKey ? { lightUp: { nodes: litNodes, key: lightKey } } : {})}
              {...(moment?.kind === "cardDone"
                ? { cardDone: { node: moment.node, ...(moment.next ? { next: moment.next } : {}), key: moment.key } }
                : {})}
              {...(moment?.kind === "gateOpen"
                ? { gateOpen: { gate: moment.gate, lit: moment.lit, unlocked: moment.unlocked, key: moment.key } }
                : {})}
              {...(moment?.kind === "revisit"
                ? { revisit: { from: moment.from, to: moment.to, key: moment.key } }
                : {})}
              onMomentDone={(key) => {
                say(`onMomentDone(${key})`);
                setMoment((m) => (m?.key === key ? undefined : m));
              }}
            />
          ) : (
            <p className="p-6 text-small text-ink-3">
              {installedPack.isError ? "Couldn't load that pack." : "Loading…"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-6 text-small text-ink-2">
          {pack && selected ? (
            <p>
              Selected: <strong>{title(selected)}</strong> ·{" "}
              {stateLabel(pack.map.nodes[selected]?.kind, viewFor(pack.map, views, selected).state)}
            </p>
          ) : null}
          {pack && peek ? <p data-dev-peek={peek}>Peek pinned: {title(peek)}</p> : null}
          <ul className="flex flex-col gap-0.5 font-mono text-micro text-ink-3" aria-label="Moment log">
            {log.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a rolling log
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
        {pack ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
            <div className="max-h-[360px] overflow-auto rounded-md border border-line bg-surface p-3">
              <ListView
                pack={pack}
                views={views}
                {...(selected ? { selectedId: selected } : {})}
                onSelect={setSelected}
                onOpen={setSelected}
              />
            </div>
            <div className="flex flex-col items-start gap-4">
              <p className="text-micro text-ink-3">Section strip (card modal header)</p>
              <MiniMap
                pack={pack}
                views={views}
                path={strip}
                variant="strip"
                width={280}
                height={28}
                {...(selected ? { focusId: selected } : {})}
              />
              <MiniMap
                pack={pack}
                views={views}
                width={280}
                height={140}
                {...(selected ? { focusId: selected } : {})}
              />
              <div className="flex items-center gap-4">
                <MapBadge
                  pack={pack}
                  cards={playableCards}
                  finishedAt={Date.now()}
                  size={120}
                  mint
                  key={`${source}:${counter.current}`}
                />
                <MapPoster pack={pack} views={views} width={240} height={160} brand />
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-label="Every state" className="mt-12 flex flex-col gap-4">
        <h2 className="t-heading">Every state, every renderer</h2>
        <p className="text-small text-ink-2">
          Top row, cards: Later · Ready · In progress · Done (line colour, never gold) · Lit · Fading · Lit, durable ·
          Planned · Writing…. Bottom row, checkpoints: Locked · a Done card flagged Revisit · Ready · In progress · Open
          · the final gate (with its landmark).
        </p>
        <div className="grid gap-6 lg:grid-cols-2">
          {sheets.map((s) => (
            <figure key={s.renderer} className="flex flex-col gap-2">
              <div className="relative h-[300px] overflow-hidden rounded-stage border border-line">
                <MapView pack={s.pack} views={s.views} variant="mini" onSelect={() => {}} onOpen={() => {}} />
              </div>
              <figcaption className="text-small text-ink-3">{s.renderer}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section aria-label="Badges and the finished poster" className="mt-12 flex flex-col gap-4">
        <h2 className="t-heading">Badges and the finished poster</h2>
        <div className="flex flex-wrap items-center gap-6">
          {RENDERERS.map((r) => {
            const p = gallery.find((g) => g.manifest.theme.renderer === r);
            return p ? (
              <figure key={r} className="flex flex-col items-center gap-2">
                <MapBadge pack={p} cards={12} finishedAt={Date.UTC(2026, 9, 20)} size={140} />
                <figcaption className="text-micro text-ink-3">{r}</figcaption>
              </figure>
            ) : null;
          })}
        </div>
        {pack ? <FinishedPosters pack={pack} /> : null}
      </section>

      <section aria-label="Every world" className="mt-12 flex flex-col gap-4">
        <h2 className="t-heading">Every world as a poster</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {[...gallery, ...stress].map((p) => (
            <button
              key={p.manifest.id}
              type="button"
              onClick={() => setSource(p.manifest.id)}
              className="overflow-hidden rounded-md border border-line text-left hover:border-line-strong"
              aria-label={`Show ${p.manifest.title}`}
            >
              <MapPoster pack={p} views={scenarioViews(p, "journey")} width={300} height={200} />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function FinishedPosters({ pack }: { pack: AnyPack }) {
  const [status, setStatus] = useState<string>("");
  const exportPng = async (width: number, height: number) => {
    setStatus("Drawing…");
    try {
      const blob = await exportMapPosterPng(
        { pack, views: {}, width, height, layout: "finished" },
        { width, height, scale: 1 },
      );
      setStatus(`PNG ${width}×${height}: ${Math.round(blob.size / 1024)} KB`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not draw the poster.");
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="overflow-hidden rounded-stage shadow-2">
          <MapPoster pack={pack} views={{}} width={600} height={315} layout="finished" />
        </div>
        <div className="overflow-hidden rounded-stage shadow-2">
          <MapPoster pack={pack} views={{}} width={216} height={270} layout="finished" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void exportPng(1200, 630)}>
          Export 1200 × 630
        </Button>
        <Button size="sm" onClick={() => void exportPng(1080, 1350)}>
          Export 1080 × 1350
        </Button>
        <span className="text-small text-ink-3" data-export-status>
          {status}
        </span>
      </div>
    </div>
  );
}
