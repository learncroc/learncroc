/**
 * VITE_LM_MOCK=1: answers GET routes from fixtures (the revision-3 mini-pack: done/lit cards, an open
 * gate, a ready gate, a planned card) so screens can be built without a server. Non-GET routes always
 * go to the network.
 */
import {
  type CompiledPack,
  CompiledPack as CompiledPackSchema,
  DEFAULT_SETTINGS,
  type FieldNote,
  type InstalledPackSummary,
  LEARNCROC_VERSION,
  type LocalNumbers,
  type Logbook,
  type PackProgress,
  PackProgress as PackProgressSchema,
  type RegistryView,
  type RouteKey,
  type RouteRes,
  type TryBundle,
} from "@learncroc/core";
import packJson from "@learncroc/core/fixtures/mini-pack/pack.json";
import progressJson from "@learncroc/core/fixtures/progress.json";
import { ApiClientError } from "./errors";

export const mockPack: CompiledPack = CompiledPackSchema.parse(packJson);
export const mockProgress: PackProgress = PackProgressSchema.parse(progressJson);

function summary(): InstalledPackSummary {
  const { manifest, stats, map } = mockPack;
  const states = Object.values(mockProgress.views).map((v) => v.state);
  const next = manifest.entry.suggestedStart ?? map.topo[0] ?? "";
  return {
    id: manifest.id,
    version: manifest.version,
    title: manifest.title,
    ...(manifest.subtitle ? { subtitle: manifest.subtitle } : {}),
    category: manifest.category,
    theme: manifest.theme,
    tier: "official",
    kind: "pack",
    profile: manifest.profile,
    review: manifest.status,
    customInteractives: false,
    nodes: stats.nodes,
    playable: stats.playable - stats.checkpoints,
    checkpoints: stats.checkpoints,
    done: states.filter((s) => s === "done").length,
    lit: Object.values(mockProgress.views).filter((v) => v.state === "lit" && map.nodes[v.id]?.kind === "node").length,
    fading: states.filter((s) => s === "fading").length,
    finished: mockProgress.finished,
    ...(mockProgress.lastOpenedAt ? { lastOpenedAt: mockProgress.lastOpenedAt } : {}),
    next: { nodeId: next, title: map.nodes[next]?.title ?? next },
    status: "ok",
  };
}

/**
 * Fixture content for screens that want more than the empty states. The mock defaults stay empty
 * (screen tests assert the empty states); pass these as overrides to show real content:
 * `{ "GET /registry": mockRegistryView, "GET /logbook": () => mockLogbook(now) }`.
 */
export function mockRegistryView(): RegistryView {
  return { packs: [mockRegistryEntry()], stale: false, errors: [], fetchedAt: mockProgress.now };
}

/** The fixture as a marketplace entry (installed), its poster sketch drawn from the compiled layout. */
export function mockRegistryEntry(): RegistryView["packs"][number] {
  const { manifest: m, map, stats } = mockPack;
  return {
    id: m.id,
    title: m.title,
    ...(m.subtitle ? { subtitle: m.subtitle } : {}),
    ...(m.tagline ? { tagline: m.tagline } : {}),
    publisher: m.publisher,
    tier: "official",
    category: m.category,
    tags: m.tags,
    lang: m.lang,
    profile: m.profile,
    review: m.status,
    customInteractives: false,
    theme: {
      renderer: m.theme.renderer,
      world: m.theme.world,
      mode: m.theme.mode,
      ground: m.theme.ground,
      texture: m.theme.texture,
      lines: m.theme.lines,
      token: m.theme.token,
    },
    outcomes: m.outcomes,
    sketch: {
      width: map.layout.width,
      height: map.layout.height,
      nodes: map.topo.map((id) => {
        const p = map.layout.nodes[id] ?? { x: 0, y: 0 };
        const n = map.nodes[id];
        return {
          id,
          x: p.x,
          y: p.y,
          line: n?.line ?? map.lines[0]?.id ?? "main",
          kind: n?.kind ?? "node",
          status: n?.status === "planned" ? ("planned" as const) : ("playable" as const),
        };
      }),
      edges: map.layout.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
      lines: map.lines.map((l) => ({ id: l.id, color: l.color })),
    },
    latest: m.version,
    versions: [
      {
        version: m.version,
        engine: m.engine,
        url: `dist/${m.id}-${m.version}.lmpack`,
        sha256: mockPack.contentHash,
        size: 48_000,
        nodes: stats.nodes,
        playable: stats.playable,
        estMinutes: m.estMinutes,
        license: m.license,
        published: "2026-10-01T00:00:00Z",
        tryUrl: `dist/${m.id}-${m.version}.try.json`,
      },
    ],
    installed: m.version,
    updateAvailable: false,
    registry: "builtin",
  };
}

/** Field notes for the fixture's lit cards: the card's big idea stands in for the learner's words. */
export function mockFieldNotes(): FieldNote[] {
  const notes: FieldNote[] = [];
  for (const p of Object.values(mockProgress.nodes)) {
    if (p.status !== "lit" || p.litAt === undefined) continue;
    const node = mockPack.nodes[p.nodeId];
    if (!node) continue;
    notes.push({
      id: `note-${p.nodeId}`,
      packId: mockPack.manifest.id,
      nodeId: p.nodeId,
      title: node.title,
      myWords: node.bigIdea,
      litAt: p.litAt,
      durable: p.relightsOk > 0,
    });
  }
  return notes.sort((a, b) => b.litAt - a.litAt);
}

export function mockLogbook(now: number = mockProgress.now): Logbook {
  const notes = mockFieldNotes();
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const activity = new Map<string, number>();
  for (const n of notes) activity.set(day(n.litAt), (activity.get(day(n.litAt)) ?? 0) + 1);
  const lit = new Set(notes.map((n) => n.nodeId));
  return {
    canNow: mockPack.map.lines
      .filter((l) => mockPack.map.topo.some((id) => mockPack.map.nodes[id]?.line === l.id && lit.has(id)))
      .map((l) => ({ packId: mockPack.manifest.id, lineId: l.id, text: l.outcome })),
    fieldNotes: notes,
    usedToThink: [],
    activity: [...activity].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    badges: [],
    now,
  };
}

export function mockTryBundle(): TryBundle {
  const { manifest, map } = mockPack;
  const start = manifest.entry.suggestedStart ?? map.topo.find((id) => map.nodes[id]?.requires.length === 0) ?? "";
  const node = mockPack.nodes[start];
  if (!node) throw new ApiClientError(404, { error: "not_found", message: "no playable first card" });
  return { manifest, map, node };
}

/** Local numbers for a learner a few days in (illustrative, for Settings → Data → Your numbers). */
export function mockNumbers(now: number = mockProgress.now): LocalNumbers {
  const id = mockPack.manifest.id;
  return {
    nextDayExplain: { asked: 2, right: 1 },
    checkpointFirstTry: { attempted: 1, passedFirstTry: 1, perPack: { [id]: { attempted: 1, passedFirstTry: 1 } } },
    maps: { started: 1, finished: 0 },
    cameBack: { activeDays: 3, returned: 2 },
    linkToFirstCard: { medianSec: null, samples: 0, byModel: {} },
    cardCompletion: { opened: 5, closed: 4 },
    cardMinutes: { median: 3.5, samples: 4 },
    workedAnswers: { beats: 6, needed: 1 },
    mostMissed: [{ packId: id, nodeId: "unit-conversion", itemId: "i2", asked: 1, missed: 1 }],
    checkpointHints: { questions: 3, hinted: 1 },
    crocAsks: { chips: 3, freeText: 1 },
    relightPerWeek: { sessions: 0, weeks: 0 },
    now,
  };
}

const notMocked = (key: string) => new ApiClientError(501, { error: "not_implemented", message: `${key} has no mock` });

export function mockResponse<K extends RouteKey>(key: K, params: Record<string, string>): RouteRes<K> {
  const now = mockProgress.now;
  const byKey: Partial<Record<RouteKey, () => unknown>> = {
    "GET /health": () => ({
      ok: true,
      version: LEARNCROC_VERSION,
      home: "(mock)",
      aiConfigured: false,
      packs: 1,
      dev: true,
    }),
    "GET /packs": () => [summary()],
    "GET /packs/:id": () => {
      if (params.id !== mockPack.manifest.id)
        throw new ApiClientError(404, { error: "not_found", message: "no such pack" });
      return mockPack;
    },
    "GET /progress": () => {
      const s = summary();
      return {
        now,
        packs: {
          [s.id]: {
            done: s.done,
            lit: s.lit,
            fading: s.fading,
            playable: s.playable,
            due: mockProgress.due.relight,
            finished: s.finished,
          },
        },
      };
    },
    "GET /progress/:packId": () => mockProgress,
    "GET /logbook": () => ({ canNow: [], fieldNotes: [], usedToThink: [], activity: [], badges: [], now }),
    "GET /numbers": () => mockNumbers(now),
    "GET /notes": () => [],
    "GET /cards": () => [],
    "GET /cards/due": () => ({ now, cards: [] }),
    "GET /settings": () => DEFAULT_SETTINGS,
    "GET /search": () => [],
    "GET /registry": () => ({ packs: [], stale: false, errors: [] }),
    "GET /registry/:id/try": () => {
      if (params.id !== mockPack.manifest.id)
        throw new ApiClientError(404, { error: "not_found", message: "no such pack" });
      return mockTryBundle();
    },
    "GET /ai/status": () => ({
      configured: false,
      provider: "none",
      keySource: "none",
      ollamaDetected: false,
      capReached: false,
    }),
    "GET /ai/models": () => ({ models: [], source: "preset" }),
    "GET /ai/last-sent": () => null,
  };
  const fn = byKey[key];
  if (!fn) throw notMocked(key);
  return fn() as RouteRes<K>;
}
