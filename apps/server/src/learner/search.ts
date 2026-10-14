/**
 * Command-palette search (GET /search): packs, stops, the learner's own cards, app actions and
 * settings sections. Case- and accent-insensitive substring match, ranked by where it matches.
 */
import type { CompiledPack, Repo, SearchHit } from "@learncroc/core";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const ACTIONS: SearchHit[] = [
  { type: "action", title: "Relight", subtitle: "Five minutes on stops that are fading", href: "/relight" },
  { type: "action", title: "Make a pocket map", subtitle: "From an article or your notes", href: "/create/pocket" },
  { type: "action", title: "Browse packs", subtitle: "Marketplace", href: "/market" },
  { type: "action", title: "Library", href: "/library" },
  { type: "action", title: "Cards", subtitle: "Your flashcards", href: "/cards" },
  { type: "action", title: "Logbook", subtitle: "What you can do now", href: "/logbook" },
];

const SETTINGS: SearchHit[] = [
  { type: "setting", title: "AI provider and key", subtitle: "Settings", href: "/settings/ai" },
  { type: "setting", title: "Appearance", subtitle: "Theme, font, text size, motion", href: "/settings/appearance" },
  { type: "setting", title: "Learning", subtitle: "Relight size, retention, reminder", href: "/settings/learning" },
  { type: "setting", title: "Sound", subtitle: "Settings", href: "/settings/sound" },
  { type: "setting", title: "Data", subtitle: "Export, import, reset", href: "/settings/data" },
  { type: "setting", title: "Experiments", subtitle: "Settings", href: "/settings/experiments" },
  { type: "setting", title: "About", subtitle: "Settings", href: "/settings/about" },
];

function score(text: string, q: string): number {
  const t = fold(text);
  if (t === q) return 4;
  if (t.startsWith(q)) return 3;
  if (t.split(/\s+/).some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}

export async function search(q: string, packs: CompiledPack[], repo: Repo, limit = 30): Promise<SearchHit[]> {
  const query = fold(q.trim());
  if (!query) return [];
  const hits: { hit: SearchHit; s: number }[] = [];
  for (const pack of packs) {
    const m = pack.manifest;
    const ps = Math.max(
      score(m.title, query),
      score(m.subtitle ?? "", query) - 1,
      m.tags.some((t) => fold(t) === query) ? 2 : 0,
    );
    if (ps > 0)
      hits.push({
        hit: {
          type: "pack",
          title: m.title,
          ...(m.subtitle ? { subtitle: m.subtitle } : {}),
          href: `/p/${m.id}`,
          packId: m.id,
        },
        s: ps + 1,
      });
    for (const id of pack.map.topo) {
      const n = pack.map.nodes[id];
      if (!n || n.status === "building") continue;
      const node = pack.nodes[id];
      const ns = Math.max(
        score(n.title, query),
        node ? score(node.tagline ?? "", query) - 1 : 0,
        score(n.teaser, query) - 2,
      );
      if (ns > 0)
        hits.push({
          hit: {
            type: "node",
            title: n.title,
            subtitle: m.title,
            href: `/p/${m.id}?stop=${id}`,
            packId: m.id,
            nodeId: id,
          },
          s: ns,
        });
    }
  }
  for (const c of await repo.cards({ kind: "user" })) {
    const cs = Math.max(score(c.front ?? "", query), score(c.back ?? "", query) - 1);
    if (cs > 0)
      hits.push({
        hit: {
          type: "card",
          title: (c.front ?? "").slice(0, 80),
          href: "/cards",
          packId: c.packId,
          ...(c.nodeId ? { nodeId: c.nodeId } : {}),
        },
        s: cs,
      });
  }
  for (const a of [...ACTIONS, ...SETTINGS]) {
    const s = Math.max(score(a.title, query), score(a.subtitle ?? "", query) - 1);
    if (s > 0) hits.push({ hit: a, s });
  }
  return hits
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((h) => h.hit);
}
