/**
 * The AI runtime the server holds: settings and key (env first, then <home>/config.json), the
 * provider, the spend meter and cap, the rate limit, "What did I send?", Ask threads and create
 * jobs. It implements AiPorts, so it is what createServer({ ai }) receives; the AI routes use the
 * rest of it.
 */
import {
  type AiFeature,
  type AiPorts,
  type AskEvent,
  type AskRequest,
  type AttemptRow,
  type CardDraft,
  type Clock,
  type CompiledPack,
  CREATE_SIZES,
  type CreateRequest,
  type ModelTier,
  type PackSource,
  type ProviderId,
  type Repo,
  type RunState,
  reduceRun,
  type Settings,
  systemClock,
  type Usage,
  type UsageSummary,
} from "@learncroc/core";
import { runAsk, ThreadStore } from "./ask";
import { cardsInput, draftCards } from "./cards";
import { AiClient, type SentRecord } from "./client";
import { type AiConfigSource, FileAiConfig } from "./config";
import type { Article } from "./create/extract";
import type { FetchOptions } from "./create/fetch";
import { JobManager } from "./create/jobs";
import { newPocketId } from "./create/pack";
import { runCreateJob } from "./create/pipeline";
import { type ToyValidation, ToyValidator } from "./create/toy";
import { AiError, redact, toAiError } from "./errors";
import { decideAskMode } from "./gate";
import { capApplies, modelFor, presetModels, suggestLocalModels } from "./models";
import { aiPortsFor } from "./ports";
import { createProvider, detectOllama, type FakeOptions, listOllamaModels } from "./providers/index";
import { addUsage, ZERO_USAGE } from "./providers/shared";
import type { AIProvider } from "./types";
import { priceEstimate, UsageMeter } from "./usage";

export interface AiRuntimeOptions {
  /** LEARNCROC_HOME. Undefined = nothing persisted (tests, the CLI). */
  home?: string;
  config?: AiConfigSource;
  env?: Record<string, string | undefined>;
  /** Default: env.LEARNCROC_FAKE_AI === "1". */
  fake?: boolean | FakeOptions;
  clock?: Clock;
  /** Provider and Ollama-detection fetch (tests). */
  fetch?: typeof fetch;
  /** Article fetch options for create (tests allow loopback). */
  articleFetch?: FetchOptions;
  toyTimeoutMs?: number;
  /** Socratic reply pace (ms per word). */
  paceMs?: number;
  /** Optional full lint for create (core lint once available). */
  lint?: (pack: CompiledPack, nodeId: string) => { errors: number; warnings: number };
  log?: (msg: string) => void;
  /** AI calls per minute for learner-initiated features (default 30). */
  ratePerMinute?: number;
}

/** What the AI routes pass per request: the server's pack source and (when available) its repo. */
export interface AiRequestDeps {
  packs: PackSource;
  repo?: Repo;
}

const AI_RUNTIME = Symbol.for("learncroc.aiRuntime");

export function isAiRuntime(x: unknown): x is AiRuntime {
  return typeof x === "object" && x !== null && (x as Record<symbol, unknown>)[AI_RUNTIME] === true;
}

interface Active {
  signature: string;
  provider: AIProvider;
  client: AiClient;
  ports: AiPorts;
  settings: Settings;
}

export class AiRuntime implements AiPorts {
  readonly [AI_RUNTIME] = true;
  readonly config: AiConfigSource;
  readonly meter: UsageMeter;
  readonly jobs: JobManager;
  readonly toys = new ToyValidator();
  private readonly threads = new ThreadStore();
  private readonly sent = new Map<AiFeature, SentRecord>();
  private lastSentAny: SentRecord | undefined;
  private active: Active | undefined;
  private readonly clock: Clock;
  private readonly env: Record<string, string | undefined>;
  private readonly fake: boolean | FakeOptions;
  private ollamaCache: { at: number; ok: boolean } | undefined;

  constructor(private readonly opts: AiRuntimeOptions = {}) {
    this.env = opts.env ?? process.env;
    this.clock = opts.clock ?? systemClock;
    this.config =
      opts.config ??
      // Without a home there is no config file: settings come from the defaults plus the environment.
      new FileAiConfig(opts.home ?? "/nonexistent-learncroc-home", this.env);
    this.meter = new UsageMeter(opts.home, this.clock, opts.ratePerMinute ?? 30);
    this.jobs = new JobManager(() => this.clock.now());
    this.fake = opts.fake ?? this.env.LEARNCROC_FAKE_AI === "1";
  }

  settings(): Settings {
    return this.config.settings();
  }

  private models(s: Settings): Record<ModelTier, string> {
    if (this.fake) return { fast: "fake-fast", smart: "fake-smart", deep: "fake-deep" };
    return { fast: modelFor(s.ai, "fast"), smart: modelFor(s.ai, "smart"), deep: modelFor(s.ai, "deep") };
  }

  private providerId(s: Settings): string {
    return this.fake ? "fake" : s.ai.provider;
  }

  /** The current provider and client, rebuilt when settings or the key change. Null = AI off. */
  current(): Active | null {
    const s = this.settings();
    const key = this.config.key();
    const signature = JSON.stringify([
      s.ai.provider,
      s.ai.baseUrl,
      s.ai.models,
      s.ai.monthlyCapUsd,
      key?.length,
      key?.slice(-6),
      !!this.fake,
    ]);
    if (this.active && this.active.signature === signature) {
      this.active.settings = s;
      return this.active;
    }
    let provider: AIProvider | null;
    try {
      provider = createProvider({
        settings: s.ai,
        ...(key ? { apiKey: key } : {}),
        ...(this.fake ? { fake: this.fake } : {}),
        ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
      });
    } catch (e) {
      this.opts.log?.(`ai: ${redact(e instanceof Error ? e.message : String(e))}`);
      provider = null;
    }
    if (!provider) {
      this.active = undefined;
      return null;
    }
    const client = this.clientFor(provider, s);
    this.active = {
      signature,
      provider,
      client,
      ports: aiPortsFor(client, (where, e) => this.opts.log?.(`ai ${where}: ${redact(toAiError(e).message)}`)),
      settings: s,
    };
    return this.active;
  }

  private clientFor(
    provider: AIProvider,
    s: Settings,
    onUsage?: (f: AiFeature, u: Usage, usd: number) => void,
    /** False for a pocket-map job: the job was admitted once, its own calls don't count. */
    rateLimit = true,
  ): AiClient {
    return new AiClient({
      rateLimit,
      provider,
      providerId: this.providerId(s),
      models: this.models(s),
      meter: this.meter,
      capUsd: s.ai.monthlyCapUsd,
      now: () => this.clock.now(),
      onSent: (r) => {
        this.sent.set(r.feature, r);
        this.lastSentAny = r;
      },
      ...(onUsage ? { onUsage } : {}),
    });
  }

  /** Throws ai_not_configured / cap_reached with the right fallback for a feature. */
  require(fallback: Parameters<UsageMeter["checkCap"]>[2]): Active {
    const a = this.current();
    if (!a)
      throw new AiError("ai_not_configured", "AI is not set up. Add a key or a local model in Settings.", fallback);
    this.meter.checkCap(a.settings.ai.monthlyCapUsd, this.providerId(a.settings), fallback);
    return a;
  }

  // ── AiPorts (core calls these; null = take the offline path)

  async configured(): Promise<boolean> {
    const a = this.current();
    return !!a && !this.meter.capReached(a.settings.ai.monthlyCapUsd, this.providerId(a.settings));
  }
  private async port<K extends Exclude<keyof AiPorts, "configured">>(k: K, arg: Parameters<AiPorts[K]>[0]) {
    if (!(await this.configured())) return null;
    const a = this.current();
    if (!a) return null;
    return (a.ports[k] as (x: typeof arg) => ReturnType<AiPorts[K]>)(arg);
  }
  gradeExplain: AiPorts["gradeExplain"] = (a) => this.port("gradeExplain", a) as ReturnType<AiPorts["gradeExplain"]>;
  rewriteHint: AiPorts["rewriteHint"] = (a) => this.port("rewriteHint", a) as ReturnType<AiPorts["rewriteHint"]>;
  quizVariants: AiPorts["quizVariants"] = (a) => this.port("quizVariants", a) as ReturnType<AiPorts["quizVariants"]>;

  // ── routes

  async ollamaDetected(): Promise<boolean> {
    const now = this.clock.now();
    if (this.ollamaCache && now - this.ollamaCache.at < 15_000) return this.ollamaCache.ok;
    const ok = await detectOllama(
      this.opts.fetch ?? fetch,
      this.settings().ai.provider === "ollama" ? this.settings().ai.baseUrl : undefined,
    );
    this.ollamaCache = { at: now, ok };
    return ok;
  }

  async status(): Promise<{
    configured: boolean;
    provider: ProviderId;
    keySource: Settings["ai"]["keySource"];
    ollamaDetected: boolean;
    capReached: boolean;
  }> {
    const s = this.settings();
    const a = this.current();
    return {
      configured: !!a,
      provider: s.ai.provider,
      keySource: s.ai.keySource,
      ollamaDetected: await this.ollamaDetected(),
      capReached: !!a && this.meter.capReached(s.ai.monthlyCapUsd, this.providerId(s)),
    };
  }

  /** POST /ai/test: one tiny call on the fast tier. */
  async test(): Promise<{ ok: boolean; provider: ProviderId; model: string; latencyMs: number; error?: string }> {
    const s = this.settings();
    const a = this.current();
    const model = this.models(s).fast;
    if (!a) return { ok: false, provider: s.ai.provider, model, latencyMs: 0, error: "AI is not set up yet." };
    const t0 = performance.now();
    try {
      const { text } = await a.client.textAll({
        feature: "test",
        promptId: "repair",
        system: [{ text: "Reply with the single word OK." }],
        messages: [{ role: "user", content: "Say OK." }],
        tier: "fast",
        effort: "low",
        maxTokens: 400,
      });
      const latencyMs = Math.round(performance.now() - t0);
      return text.trim().length > 0
        ? { ok: true, provider: s.ai.provider, model, latencyMs }
        : { ok: false, provider: s.ai.provider, model, latencyMs, error: "The model returned an empty reply." };
    } catch (e) {
      return {
        ok: false,
        provider: s.ai.provider,
        model,
        latencyMs: Math.round(performance.now() - t0),
        error: toAiError(e).message,
      };
    }
  }

  async listModels(): Promise<{ models: string[]; source: "provider" | "preset" }> {
    const s = this.settings();
    const a = this.current();
    try {
      if (s.ai.provider === "ollama")
        return { models: await listOllamaModels(s.ai.baseUrl, this.opts.fetch), source: "provider" };
      if (a?.provider.listModels) return { models: await a.provider.listModels(), source: "provider" };
    } catch {
      /* fall through to the preset */
    }
    return { models: presetModels(s.ai.provider), source: "preset" };
  }

  /** Suggested tier models for a local provider (Settings pre-fills them). */
  async suggestModels(): Promise<Record<ModelTier, string> | null> {
    const { models, source } = await this.listModels();
    return source === "provider" && models.length > 0 ? suggestLocalModels(models) : null;
  }

  usage(): UsageSummary {
    return this.meter.summary(this.settings().ai.monthlyCapUsd);
  }

  lastSent(feature?: AiFeature): { feature: AiFeature; at: number; payload: unknown } | null {
    const r = feature ? this.sent.get(feature) : this.lastSentAny;
    return r ? { feature: r.feature, at: r.at, payload: r.payload } : null;
  }

  /** POST /ai/ask. Throws AiError before streaming (not configured, cap, unknown pack). */
  async ask(req: AskRequest, deps: AiRequestDeps, signal?: AbortSignal): Promise<AsyncGenerator<AskEvent>> {
    const a = this.require("authored-faq");
    const pack = await deps.packs.get(req.packId).catch(() => {
      throw new AiError("invalid", `pack "${req.packId}" is not installed`);
    });
    if (req.nodeId && !pack.nodes[req.nodeId]) throw new AiError("invalid", `stop "${req.nodeId}" is not playable`);
    let run: RunState | null = null;
    let attempts: AttemptRow[] = [];
    if (req.runId && deps.repo) {
      run = await deps.repo.run(req.runId);
      if (run && run.packId !== req.packId && run.packId !== "*") run = null;
      if (run) attempts = await deps.repo.attempts({ runId: run.id });
    }
    const nodeId = req.nodeId ?? run?.target;
    const progress = deps.repo ? await deps.repo.progress(req.packId).catch(() => ({})) : {};
    const p = progress as Record<string, { status: string }>;
    const decision = decideAskMode({
      pack,
      ...(req.nodeId ? { nodeId: req.nodeId } : {}),
      ...(req.screenId ? { screenId: req.screenId } : {}),
      run,
      attempts,
      nodeLit: nodeId ? p[nodeId]?.status === "lit" || p[nodeId]?.status === "done" : false,
    });
    const prereqStates: Record<string, string> = {};
    for (const r of nodeId ? (pack.map.nodes[nodeId]?.requires ?? []) : [])
      prereqStates[r] = p[r]?.status ?? "not started";
    const repo = deps.repo;
    return runAsk({
      client: a.client,
      tier: a.settings.ai.tutorTier,
      pack,
      request: req,
      decision,
      attempts,
      prereqStates,
      threads: this.threads,
      ...(this.opts.paceMs !== undefined ? { paceMs: this.opts.paceMs } : {}),
      ...(signal ? { signal } : {}),
      ...(repo && run
        ? {
            onAssist: async (interactionId: string) => {
              const fresh = (await repo.run(run.id)) ?? run;
              let next: RunState;
              try {
                next = reduceRun(fresh, pack, { type: "assist", interactionId }, this.clock.now());
              } catch {
                next = fresh.assisted.includes(interactionId)
                  ? fresh
                  : { ...fresh, assisted: [...fresh.assisted, interactionId] };
              }
              await repo.putRun(next);
            },
          }
        : {}),
    });
  }

  /** POST /ai/cards. */
  async cards(runId: string, deps: AiRequestDeps): Promise<CardDraft[]> {
    const a = this.require("none");
    if (!deps.repo) throw new AiError("invalid", "runs are not available on this server");
    const run = await deps.repo.run(runId);
    if (!run) throw new AiError("invalid", "unknown run");
    if (run.packId === "*") return [];
    const pack = await deps.packs.get(run.packId, run.packVersion === "*" ? undefined : run.packVersion);
    const attempts = await deps.repo.attempts({ runId });
    const node = run.target ? pack.nodes[run.target] : undefined;
    const user = await deps.repo.cards({ packId: run.packId, kind: "user" });
    const existing = [
      ...(node?.flashcards ?? []).map((c) => c.front),
      ...user.filter((c) => c.nodeId === run.target && c.front).map((c) => c.front as string),
    ];
    const input = cardsInput(pack, run, attempts, existing);
    return input ? draftCards(a.client, input) : [];
  }

  /** POST /ai/estimate: tokens and dollars for a pocket map, before running. */
  estimate(req: CreateRequest): { tokens: number; usd: number; model: string; overCap: boolean } {
    const s = this.settings();
    const pid = this.providerId(s);
    const models = this.models(s);
    const articleWords = req.source.kind === "text" ? req.source.text.split(/\s+/).filter(Boolean).length : 4500;
    const article = Math.ceil(Math.min(articleWords, 15_000) * 1.35);
    const n = CREATE_SIZES[req.size ?? "standard"][1];
    const skeleton = { in: article + 2_500, out: 2_500 };
    const fill = { in: article + 3_000, out: 3_000 };
    const figure = { in: 900, out: 1_500 };
    const toy = { in: 2_500, out: 5_000 };
    const tokens =
      skeleton.in + skeleton.out + n * (fill.in + fill.out) + 2 * n * (figure.in + figure.out) + toy.in + toy.out;
    const usd =
      priceEstimate(pid, models.smart, skeleton.in, skeleton.out) +
      // Fills after the first read the article from the cache (about a tenth of the price).
      priceEstimate(pid, models.fast, fill.in + (n - 1) * (fill.in - article + article * 0.1), n * fill.out) +
      priceEstimate(pid, models.fast, 2 * n * figure.in, 2 * n * figure.out) +
      priceEstimate(pid, models.smart, toy.in, toy.out);
    const overCap = capApplies(pid as ProviderId) && this.meter.spent() + usd > s.ai.monthlyCapUsd;
    return { tokens, usd: Math.round(usd * 10_000) / 10_000, model: models.smart, overCap };
  }

  /** POST /create: starts a job and returns at once. */
  startCreate(
    req: CreateRequest,
    home: string,
    io: Pick<Parameters<typeof runCreateJob>[0], "writePack" | "removePack"> = {},
  ): { jobId: string; packId: string } {
    const s = this.settings();
    const active = this.require("none");
    const est = this.estimate(req);
    if (est.overCap) {
      throw new AiError(
        "cap_reached",
        `This map would cost about $${est.usd.toFixed(2)}, which goes over this month's AI budget.`,
        "none",
      );
    }
    this.meter.admit();
    const packId = newPocketId();
    const job = this.jobs.create(packId);
    let total = { usage: ZERO_USAGE, usd: 0 };
    const client = this.clientFor(
      active.provider,
      s,
      (_f, u, usd) => {
        total = { usage: addUsage(total.usage, u), usd: total.usd + usd };
      },
      false,
    );
    void runCreateJob({
      jobId: job.id,
      packId,
      request: req,
      client,
      home,
      now: () => this.clock.now(),
      emit: (e) => this.jobs.emit(job.id, e),
      signal: job.controller.signal,
      toyValidator: this.toys,
      ...(this.opts.toyTimeoutMs !== undefined ? { toyTimeoutMs: this.opts.toyTimeoutMs } : {}),
      ...(this.opts.articleFetch ? { fetchOptions: this.opts.articleFetch } : {}),
      ...(this.opts.lint ? { lint: this.opts.lint } : {}),
      onArticle: (article: Article) => {
        job.article = article;
      },
      usage: () => total,
      ...(io.writePack ? { writePack: io.writePack } : {}),
      ...(io.removePack ? { removePack: io.removePack } : {}),
    });
    return { jobId: job.id, packId };
  }

  /** The browser's verdict on a job's generated toy. */
  reportToy(jobId: string, v: ToyValidation): boolean {
    return this.toys.report(jobId, v);
  }
}

export function createAiRuntime(opts: AiRuntimeOptions = {}): AiRuntime {
  return new AiRuntime(opts);
}
