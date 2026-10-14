/**
 * The bridge from the server to core's app services (createServices): one service set over the
 * learner's SQLite repo, the pack store, the test-aware clock, the AI ports and the widget specs
 * (every run route, `advance`, `crocHint` for the ask route, `numbers`, `noteCrocAsk`); plus
 * try-runs ("Try the first card"), each played on a throwaway in-memory store so it grades and
 * writes nothing.
 */
import {
  type AiPorts,
  createServices,
  createTryServices,
  type LearnServices,
  type ServiceDeps,
  type TryBundle,
} from "@learncroc/core";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import type { ServerContext } from "../context";
import type { SettingsStore } from "../settings/store";

export type CoreDeps = Omit<ServiceDeps, "repo" | "packs">;

/**
 * AiPorts that read `ctx.ai` on every call, so the server can swap in its AI runtime after the
 * services are built (startServer does, once the settings store exists).
 */
export function liveAiPorts(ctx: ServerContext): AiPorts {
  return {
    configured: () => ctx.ai.configured(),
    gradeExplain: (a) => ctx.ai.gradeExplain(a),
    rewriteHint: (a) => ctx.ai.rewriteHint(a),
    quizVariants: (a) => ctx.ai.quizVariants(a),
  };
}

export function coreDeps(ctx: ServerContext, settings: SettingsStore): CoreDeps {
  return {
    clock: ctx.clock,
    widgets: widgetSpecRegistry,
    ai: liveAiPorts(ctx),
    settings: () => settings.get(),
  };
}

export function learnServices(deps: CoreDeps & Pick<ServiceDeps, "repo" | "packs">): LearnServices {
  return createServices(deps);
}

interface TrySession {
  services: LearnServices;
  expiresAt: number;
}

const TRY_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TRY_SESSIONS = 50;

/** Try-runs live in memory only, keyed by run id, and expire after two hours. */
export class TryRuns {
  private readonly sessions = new Map<string, TrySession>();

  constructor(
    private readonly deps: () => CoreDeps,
    private readonly now: () => number,
  ) {}

  /** Services over a fresh in-memory store holding just this bundle's pack. */
  begin(bundle: TryBundle): { services: LearnServices; adopt(runId: string): void } {
    this.sweep();
    const services = createTryServices(bundle, this.deps());
    return {
      services,
      adopt: (runId) => {
        this.sessions.set(runId, { services, expiresAt: this.now() + TRY_TTL_MS });
      },
    };
  }

  /** The services for a try-run id, or undefined for ordinary runs. */
  get(runId: string): LearnServices | undefined {
    const s = this.sessions.get(runId);
    if (!s) return undefined;
    if (s.expiresAt <= this.now()) {
      this.sessions.delete(runId);
      return undefined;
    }
    return s.services;
  }

  end(runId: string): void {
    this.sessions.delete(runId);
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(id);
    while (this.sessions.size >= MAX_TRY_SESSIONS) {
      const first = this.sessions.keys().next().value;
      if (first === undefined) break;
      this.sessions.delete(first);
    }
  }
}
