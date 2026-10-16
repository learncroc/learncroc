/**
 * Command palette (`⌘K`): maps, cards (by title and by their hook question: "strawberry" finds
 * Tokens), flashcards, settings and actions (Relight, Map an article, Open the next card). Local
 * actions, installed maps and their cards answer instantly; `/api/search` adds the rest as you type.
 */

import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import type { CompiledPack, InstalledPackSummary, SearchHit } from "@learncroc/core";
import { cn, Kbd, StopGlyph } from "@learncroc/ui";
import {
  Books,
  Cards as CardsIcon,
  CircleHalf,
  Compass,
  GearSix,
  type Icon,
  Keyboard,
  MagnifyingGlass,
  MapTrifold,
  Moon,
  Notebook,
  PlusCircle,
  Storefront,
  Sun,
} from "@phosphor-icons/react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { modKey } from "../lib/keys";
import { qk, usePacks, usePatchSettings } from "./queries";
import { useShell } from "./store";

export interface PaletteEntry {
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
  run?: () => void;
  icon: Icon | "card" | "gate";
  group: "Go to" | "Actions" | "Your maps" | "Cards" | "Flashcards" | "Settings" | "Maps";
  keywords?: string[];
  hint?: string[];
}

const HIT_GROUP: Record<SearchHit["type"], PaletteEntry["group"]> = {
  pack: "Maps",
  node: "Cards",
  card: "Flashcards",
  action: "Actions",
  setting: "Settings",
};
const HIT_ICON: Record<SearchHit["type"], PaletteEntry["icon"]> = {
  pack: MapTrifold,
  node: "card",
  card: CardsIcon,
  action: Compass,
  setting: GearSix,
};
const GROUP_ORDER: PaletteEntry["group"][] = [
  "Go to",
  "Actions",
  "Your maps",
  "Cards",
  "Maps",
  "Flashcards",
  "Settings",
];

/** Plain words of a Markdown string, for matching (no rendering). */
const plain = (md: string | undefined): string => (md ?? "").replace(/[*_`#>[\]()=~|]/g, " ");

/** Every card and checkpoint of an installed map, searchable by title and by its hook question. */
export function cardEntries(summary: InstalledPackSummary, pack: CompiledPack): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const id of pack.map.topo) {
    const m = pack.map.nodes[id];
    if (!m || m.status === "planned") continue;
    if (m.kind === "checkpoint") {
      out.push({
        id: `cp-${summary.id}-${id}`,
        title: `Checkpoint: ${m.title}`,
        subtitle: summary.title,
        href: `/p/${summary.id}?checkpoint=${encodeURIComponent(id)}`,
        icon: "gate",
        group: "Cards",
        keywords: ["checkpoint", "gate"],
      });
      continue;
    }
    const node = pack.nodes[id];
    const hookText = node
      ? [
          ...(node.hook.blocks ?? []).map((b) => ("text" in b ? plain(b.text) : "")),
          plain(node.hook.interaction.prompt),
        ].join(" ")
      : m.teaser;
    out.push({
      id: `card-${summary.id}-${id}`,
      title: m.title,
      subtitle: `${summary.title} · ${m.teaser || "card"}`,
      href: `/p/${summary.id}?card=${encodeURIComponent(id)}`,
      icon: "card",
      group: "Cards",
      keywords: [hookText, m.teaser, node?.tagline ?? "", id],
    });
  }
  return out;
}

/** Case- and accent-insensitive "every word appears" match. */
export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const hay = norm(fields.filter(Boolean).join(" "));
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Where "Open the next card" goes: the most recent map's next card or checkpoint. */
function nextCardEntry(
  packs: InstalledPackSummary[] | undefined,
  kindOf: (packId: string, nodeId: string) => "node" | "checkpoint" | undefined,
): PaletteEntry | null {
  const recent = (packs ?? [])
    .filter((p) => p.status === "ok" && p.next && !p.finished)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
  if (!recent?.next) return null;
  const isGate = kindOf(recent.id, recent.next.nodeId) === "checkpoint";
  return {
    id: "act-next",
    title: "Open the next card",
    subtitle: `${recent.title} · ${recent.next.title}`,
    href: `/p/${recent.id}?${isGate ? "checkpoint" : "card"}=${encodeURIComponent(recent.next.nodeId)}`,
    icon: Compass,
    group: "Actions",
    keywords: ["continue", "next", "resume"],
  };
}

export function CommandPalette({ currentMapHref }: { currentMapHref: string | null }) {
  const open = useShell((s) => s.layer === "palette");
  const close = useShell((s) => s.close);
  const openLayer = useShell((s) => s.open);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 120);
  const { data: packs } = usePacks();
  const patch = usePatchSettings();
  const okPacks = useMemo(() => (packs ?? []).filter((p) => p.status !== "invalid"), [packs]);
  // Installed maps' cards, loaded when the palette opens (cached with the map screen's queries).
  const compiled = useQueries({
    queries: okPacks.map((p) => ({
      queryKey: qk.pack(p.id),
      queryFn: () => api.getPack({ id: p.id }),
      enabled: open,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    })),
  });
  const compiledKey = compiled.map((c) => c.dataUpdatedAt).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: compiledKey tracks the query results
  const cards = useMemo(
    () => okPacks.flatMap((p, i) => (compiled[i]?.data ? cardEntries(p, compiled[i].data as CompiledPack) : [])),
    [okPacks, compiledKey],
  );

  const { refs, context } = useFloating({ open, onOpenChange: (o) => (o ? undefined : close()) });
  const { getFloatingProps } = useInteractions([useDismiss(context), useRole(context, { role: "dialog" })]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const search = useQuery({
    queryKey: qk.search(q),
    queryFn: ({ signal }) => api.search({ q }, { signal }),
    enabled: open && q.length >= 2,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 10_000,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: compiledKey tracks the query results
  const nextEntry = useMemo(
    () =>
      nextCardEntry(packs, (packId, nodeId) => {
        const i = okPacks.findIndex((p) => p.id === packId);
        return (compiled[i]?.data as CompiledPack | undefined)?.map.nodes[nodeId]?.kind;
      }),
    [packs, okPacks, compiledKey],
  );

  const mod = modKey();
  const local = useMemo<PaletteEntry[]>(() => {
    const dark = document.documentElement.dataset.theme === "dark";
    const list: PaletteEntry[] = [
      { id: "go-library", title: "Library", href: "/library", icon: Books, group: "Go to", hint: ["G", "L"] },
      ...(currentMapHref
        ? [
            {
              id: "go-map",
              title: "Current map",
              href: currentMapHref,
              icon: MapTrifold,
              group: "Go to" as const,
              hint: ["G", "M"],
            },
          ]
        : []),
      {
        id: "go-relight",
        title: "Relight",
        subtitle: "About 5 minutes of mixed review",
        href: "/relight",
        icon: CircleHalf,
        group: "Go to",
        hint: ["G", "R"],
        keywords: ["review", "spaced"],
      },
      {
        id: "go-market",
        title: "Marketplace",
        href: "/market",
        icon: Storefront,
        group: "Go to",
        hint: ["G", "K"],
        keywords: ["install", "packs", "browse"],
      },
      { id: "go-create", title: "Create", href: "/create", icon: PlusCircle, group: "Go to", hint: ["G", "C"] },
      {
        id: "go-logbook",
        title: "Logbook",
        href: "/logbook",
        icon: Notebook,
        group: "Go to",
        hint: ["G", "J"],
        keywords: ["field notes", "journal"],
      },
      {
        id: "go-flashcards",
        title: "Flashcards",
        href: "/flashcards",
        icon: CardsIcon,
        group: "Go to",
        hint: ["G", "F"],
        keywords: ["flashcards", "review", "export", "anki"],
      },
      { id: "go-settings", title: "Settings", href: "/settings/ai", icon: GearSix, group: "Go to", hint: ["G", "S"] },
      ...(nextEntry ? [nextEntry] : []),
      {
        id: "act-relight",
        title: "Relight",
        subtitle: "Bring back the cards that are fading",
        href: "/relight",
        icon: CircleHalf,
        group: "Actions",
        keywords: ["review", "fading", "spaced"],
      },
      {
        id: "act-article",
        title: "Map an article",
        subtitle: "Paste a link; get a short map of cards",
        href: "/create/pocket",
        icon: PlusCircle,
        group: "Actions",
        keywords: ["article", "url", "link", "pocket", "create"],
      },
      {
        id: "act-theme",
        title: dark ? "Switch to the light theme" : "Switch to the dark theme",
        icon: dark ? Sun : Moon,
        group: "Actions",
        keywords: ["theme", "appearance", "dark", "light"],
        run: () => patch.mutate({ appearance: { theme: dark ? "light" : "dark" } }),
      },
      {
        id: "act-keys",
        title: "Keyboard shortcuts",
        icon: Keyboard,
        group: "Actions",
        hint: ["?"],
        run: () => openLayer("shortcuts"),
      },
      {
        id: "set-ai",
        title: "AI provider and key",
        href: "/settings/ai",
        icon: GearSix,
        group: "Settings",
        keywords: ["anthropic", "ollama", "openai"],
      },
      {
        id: "set-appearance",
        title: "Appearance",
        subtitle: "Theme, font, text size, motion",
        href: "/settings/appearance",
        icon: GearSix,
        group: "Settings",
      },
      {
        id: "set-learning",
        title: "Learning",
        subtitle: "Relight size, retention, reminder",
        href: "/settings/learning",
        icon: GearSix,
        group: "Settings",
      },
      {
        id: "set-moss",
        title: "Moss",
        subtitle: "Reactions: Chatty or Quiet",
        href: "/settings/moss",
        icon: GearSix,
        group: "Settings",
        keywords: ["croc", "reactions", "quiet", "chatty"],
      },
      { id: "set-sound", title: "Sound", href: "/settings/sound", icon: GearSix, group: "Settings" },
      {
        id: "set-data",
        title: "Data",
        subtitle: "Export, import, reset, your numbers",
        href: "/settings/data",
        icon: GearSix,
        group: "Settings",
      },
    ];
    for (const p of packs ?? []) {
      list.push({
        id: `pack-${p.id}`,
        title: p.title,
        subtitle: p.lit ? `${p.lit} of ${p.playable} cards lit` : p.theme.world,
        href: `/p/${p.id}`,
        icon: MapTrifold,
        group: "Your maps",
        keywords: [p.theme.world, p.id],
      });
    }
    return list;
  }, [packs, currentMapHref, patch, openLayer, nextEntry]);

  const searchable = useMemo(() => [...local, ...cards], [local, cards]);

  const entries = useMemo(() => {
    const out: PaletteEntry[] = q
      ? searchable.filter((e) => matches(q, e.title, e.subtitle, ...(e.keywords ?? []))).slice(0, 60)
      : local.filter((e) => e.group === "Go to" || e.group === "Your maps" || e.group === "Actions");
    const seen = new Set(out.map((e) => e.href).filter(Boolean));
    if (q.length >= 2) {
      for (const [i, hit] of (search.data ?? []).entries()) {
        if (seen.has(hit.href)) continue;
        seen.add(hit.href);
        out.push({
          id: `hit-${i}-${hit.href}`,
          title: hit.title,
          ...(hit.subtitle ? { subtitle: hit.subtitle } : {}),
          href: hit.href,
          icon: HIT_ICON[hit.type],
          group: HIT_GROUP[hit.type],
        });
      }
    }
    return out;
  }, [q, local, searchable, search.data]);

  const groups = GROUP_ORDER.map((g) => [g, entries.filter((e) => e.group === g)] as const).filter(
    ([, list]) => list.length > 0,
  );
  const firstId = groups[0]?.[1][0]?.id ?? "";

  // The selection is controlled: results change after the (debounced) query and when search hits
  // arrive, and cmdk only re-selects on its own input change, which would leave nothing selected
  // (so Enter did nothing). A new query selects the first result; otherwise keep the selection
  // while it is still listed.
  const [selected, setSelected] = useState("");
  const lastQ = useRef(q);
  useEffect(() => {
    if (lastQ.current !== q) {
      lastQ.current = q;
      setSelected(firstId);
      return;
    }
    setSelected((cur) => (entries.some((e) => e.id === cur) ? cur : firstId));
  }, [q, entries, firstId]);

  const pick = (e: PaletteEntry) => {
    close();
    if (e.run) e.run();
    else if (e.href) router.history.push(e.href);
  };

  if (!open) return null;
  return (
    <FloatingPortal>
      <FloatingOverlay lockScroll className="lm-fade-in z-50 bg-scrim">
        <FloatingFocusManager context={context} modal returnFocus initialFocus={0}>
          <div
            ref={refs.setFloating}
            role="dialog"
            aria-label="Command palette"
            aria-modal
            className="lm-pop-in mx-auto mt-[12vh] w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-md border border-line bg-surface text-ink shadow-3"
            {...getFloatingProps()}
          >
            <Command label="Command palette" shouldFilter={false} loop value={selected} onValueChange={setSelected}>
              <div className="flex items-center gap-3 border-b border-line px-4">
                <MagnifyingGlass size={20} aria-hidden className="text-ink-3" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search maps, cards, flashcards and settings"
                  className="h-14 min-w-0 flex-1 bg-transparent text-lead text-ink outline-none placeholder:text-ink-3"
                />
                {search.isFetching ? <span className="text-micro text-ink-3">Searching</span> : null}
              </div>
              <Command.List className="max-h-[min(440px,60vh)] scroll-py-2 overflow-y-auto p-2">
                <Command.Empty className="px-3 py-8 text-center text-small text-ink-2">
                  {search.isFetching || query.trim() !== q
                    ? "Searching your maps…"
                    : `Nothing matches “${query.trim()}”. Try a card name, like “attention”.`}
                </Command.Empty>
                {groups.map(([group, list]) => (
                  <Command.Group
                    key={group}
                    heading={group}
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:text-ink-3"
                  >
                    {list.map((e) => (
                      <Command.Item
                        key={e.id}
                        value={e.id}
                        onSelect={() => pick(e)}
                        className={cn(
                          "relative flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5",
                          "data-[selected=true]:bg-surface-2 data-[selected=true]:before:absolute data-[selected=true]:before:inset-y-2 data-[selected=true]:before:left-0 data-[selected=true]:before:w-[3px] data-[selected=true]:before:rounded-pill data-[selected=true]:before:bg-sea",
                        )}
                      >
                        <span aria-hidden className="grid size-6 place-items-center text-ink-2">
                          {e.icon === "card" ? (
                            <StopGlyph state="ready" size={18} decorative />
                          ) : e.icon === "gate" ? (
                            <StopGlyph state="ready" kind="checkpoint" size={18} decorative />
                          ) : (
                            <e.icon size={18} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body">{e.title}</span>
                          {e.subtitle ? (
                            <span className="block truncate text-small text-ink-2">{e.subtitle}</span>
                          ) : null}
                        </span>
                        {e.hint ? <Kbd keys={e.hint} compact /> : null}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
              <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-micro text-ink-2">
                <span className="inline-flex items-center gap-1.5">
                  <Kbd keys="↑" />
                  <Kbd keys="↓" /> move
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd keys="⏎" /> open
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd keys="Esc" /> close
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5">
                  <Kbd keys={[mod, "K"]} /> toggle
                </span>
              </div>
            </Command>
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
