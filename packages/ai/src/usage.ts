/**
 * The spend meter and monthly cap (PLAN §15.1). Every call's usage is priced with prices.json and
 * stored per month and feature in <home>/ai/usage.json. Cloud providers only: local models cost 0.
 * At 100% of the cap AI pauses and every feature takes its offline path.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AiFallback, AiFeature, type Clock, type Usage, type UsageSummary } from "@learncroc/core";
import prices from "../prices.json";
import { AiError } from "./errors";
import { capApplies } from "./models";

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES = prices as unknown as Record<string, Record<string, Price>>;

/** USD for one call. Unknown cloud models use the provider's $default row; local models are free. */
export function priceUsage(provider: string, model: string, u: Usage): number {
  if (!capApplies(provider as Parameters<typeof capApplies>[0])) return 0;
  const table = PRICES[provider];
  const p = table?.[model] ?? table?.$default;
  if (!p) return 0;
  const m = 1_000_000;
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      (u.cacheReadTokens ?? 0) * p.cacheRead +
      (u.cacheWriteTokens ?? 0) * p.cacheWrite) /
    m
  );
}

/** Price for a token estimate (POST /ai/estimate). */
export function priceEstimate(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  return priceUsage(provider, model, { inputTokens, outputTokens });
}

type FeatureRow = { calls: number; usd: number };
interface MonthRow {
  spentUsd: number;
  byFeature: Partial<Record<AiFeature, FeatureRow>>;
}
interface UsageFile {
  version: 1;
  months: Record<string, MonthRow>;
}

export function monthOf(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export class UsageMeter {
  private data: UsageFile = { version: 1, months: {} };
  private readonly file: string | undefined;
  private readonly calls: number[] = [];

  /** `home` undefined = in-memory only (tests, the CLI build). */
  constructor(
    home: string | undefined,
    private readonly clock: Clock,
    private readonly ratePerMinute = 30,
  ) {
    this.file = home ? join(home, "ai", "usage.json") : undefined;
    if (this.file) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as UsageFile;
        if (parsed && parsed.version === 1 && typeof parsed.months === "object") this.data = parsed;
      } catch {
        /* first run */
      }
    }
  }

  /** Throws rate_limited after `ratePerMinute` AI calls in the last minute. */
  admit(): void {
    const now = this.clock.now();
    while (this.calls.length > 0 && (this.calls[0] ?? 0) <= now - 60_000) this.calls.shift();
    if (this.calls.length >= this.ratePerMinute) {
      throw new AiError("rate_limited", "Too many AI requests in the last minute. Try again shortly.", "none", true);
    }
    this.calls.push(now);
  }

  record(feature: AiFeature, provider: string, model: string, usage: Usage): number {
    const usd = priceUsage(provider, model, usage);
    const month = monthOf(this.clock.now());
    const row = this.data.months[month] ?? { spentUsd: 0, byFeature: {} };
    this.data.months[month] = row;
    const f = row.byFeature[feature] ?? { calls: 0, usd: 0 };
    row.byFeature[feature] = f;
    f.calls += 1;
    f.usd += usd;
    row.spentUsd += usd;
    this.save();
    return usd;
  }

  spent(): number {
    return this.data.months[monthOf(this.clock.now())]?.spentUsd ?? 0;
  }

  capReached(capUsd: number, provider: string): boolean {
    return capApplies(provider as Parameters<typeof capApplies>[0]) && this.spent() >= capUsd;
  }

  /** Throws cap_reached when the monthly cap is used up (cloud providers only). */
  checkCap(capUsd: number, provider: string, fallback: AiFallback = "none") {
    if (this.capReached(capUsd, provider)) {
      throw new AiError(
        "cap_reached",
        `This month's AI budget ($${capUsd.toFixed(2)}) is used up. AI features use their offline versions until next month or until you raise the cap.`,
        fallback,
      );
    }
  }

  summary(capUsd: number): UsageSummary {
    const month = monthOf(this.clock.now());
    const row = this.data.months[month];
    const byFeature = Object.fromEntries(
      AiFeature.options.map((f) => {
        const r = row?.byFeature[f];
        return [f, { calls: r?.calls ?? 0, usd: round(r?.usd ?? 0) }];
      }),
    ) as UsageSummary["byFeature"];
    return { month, spentUsd: round(row?.spentUsd ?? 0), capUsd, byFeature };
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      /* the meter must never break a feature */
    }
  }
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;
