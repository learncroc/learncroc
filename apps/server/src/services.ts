/**
 * Per-server services, built once per ServerContext and shared by every router: the SQLite repo,
 * settings, the pack store, the registry client, the frame store and the (test-aware) clock.
 *
 * Built lazily from the context so routers stay thin `(ctx) => Hono` factories. When the context
 * carries no PackStore (only a read-only PackSource), store-only routes answer 409.
 */
import type { Clock, LearnServices, PackSource } from "@learncroc/core";
import type { ServerContext } from "./context";
import { SqliteRepo } from "./db/sqlite-repo";
import { homePaths } from "./home";
import { coreDeps, learnServices, TryRuns } from "./learner/core";
import { FixturePackSource } from "./packs/fixture-source";
import { PackStore } from "./packs/store";
import { RegistryClient } from "./registry/client";
import { FrameStore } from "./sandbox/listener";
import { checkUrlSyntax } from "./security/url-guard";
import { SettingsStore } from "./settings/store";

/** A clock that POST /_test/clock can pin (only reachable with LEARNCROC_TEST=1). */
export class TestableClock implements Clock {
  private override: number | null = null;
  constructor(private readonly base: Clock) {}
  now(): number {
    return this.override ?? this.base.now();
  }
  set(now: number | null): void {
    this.override = now;
  }
}

export interface Services {
  ctx: ServerContext;
  repo: SqliteRepo;
  settings: SettingsStore;
  packs: PackSource;
  store: PackStore | null;
  registry: RegistryClient | null;
  frames: FrameStore;
  clock: TestableClock;
  /** Core's app services over the learner's data (every learner route wraps one of these). */
  learn: LearnServices;
  /** "Try the first card" runs: in-memory, never written to the learner's data. */
  tryRuns: TryRuns;
}

const cache = new WeakMap<ServerContext, Services>();

export function getServices(ctx: ServerContext): Services {
  const hit = cache.get(ctx);
  if (hit) return hit;
  // The stage default PackSource serves only the fixture; the real server reads installed packs.
  const packs: PackSource = ctx.packs instanceof FixturePackSource ? new PackStore({ home: ctx.home }) : ctx.packs;
  const store = packs instanceof PackStore ? packs : null;
  const clock = ctx.clock instanceof TestableClock ? ctx.clock : new TestableClock(ctx.clock);
  // Every router (including the AI ones) reads the same clock and pack source.
  ctx.clock = clock;
  ctx.packs = packs;
  const repo = SqliteRepo.open(homePaths(ctx.home).db);
  const settings = new SettingsStore({
    home: ctx.home,
    checkRegistry: (url) => {
      checkUrlSyntax(url, { dev: ctx.dev });
    },
  });
  const svc: Services = {
    ctx,
    repo,
    settings,
    packs,
    store,
    registry: store ? new RegistryClient({ store, dev: ctx.dev, now: () => clock.now() }) : null,
    frames: ctx.frames ?? new FrameStore(),
    clock,
    learn: learnServices({ ...coreDeps(ctx, settings), repo, packs }),
    tryRuns: new TryRuns(
      () => coreDeps(ctx, settings),
      () => clock.now(),
    ),
  };
  cache.set(ctx, svc);
  return svc;
}
