import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FileAiConfig, maskKey } from "../src/config";
import { redact } from "../src/errors";
import { priceUsage, UsageMeter } from "../src/usage";
import { tempHome } from "./helpers";

describe("spend meter", () => {
  test("prices Anthropic usage including cache reads; local and fake are free", () => {
    const usd = priceUsage("anthropic", "claude-sonnet-5-5", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(2 + 1 + 0.2, 6);
    expect(priceUsage("ollama", "qwen3:14b", { inputTokens: 1e6, outputTokens: 1e6 })).toBe(0);
    expect(priceUsage("fake", "fake-smart", { inputTokens: 1e6, outputTokens: 1e6 })).toBe(0);
  });

  test("records per month and feature, persists, and enforces the cap", () => {
    const home = tempHome();
    const clock = { now: () => Date.UTC(2026, 9, 20) };
    const m = new UsageMeter(home, clock);
    m.record("ask", "anthropic", "claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 300_000 });
    expect(m.summary(5).byFeature.ask).toEqual({ calls: 1, usd: 5 });
    expect(m.capReached(5, "anthropic")).toBe(true);
    expect(m.capReached(5, "ollama")).toBe(false);
    expect(() => m.checkCap(5, "anthropic", "authored-faq")).toThrow(/budget/);
    const again = new UsageMeter(home, clock);
    expect(again.spent()).toBe(5);
    const nextMonth = new UsageMeter(home, { now: () => Date.UTC(2026, 10, 2) });
    expect(nextMonth.spent()).toBe(0);
  });

  test("rate limit: 30 calls per minute", () => {
    let t = 0;
    const m = new UsageMeter(undefined, { now: () => t });
    for (let i = 0; i < 30; i++) m.admit();
    expect(() => m.admit()).toThrow(/Too many/);
    t = 61_000;
    expect(() => m.admit()).not.toThrow();
  });
});

describe("config and keys", () => {
  test("env beats the file; the key is masked, never returned", () => {
    const home = tempHome();
    const cfg = new FileAiConfig(home, {});
    expect(cfg.settings().ai.provider).toBe("none");
    const masked = cfg.setKey("anthropic", "sk-ant-api03-SECRETSECRETSECRET-3f2a");
    expect(masked).toBe("sk-ant-…3f2a");
    expect(cfg.settings().ai).toMatchObject({ provider: "anthropic", keySource: "file", keyMasked: "sk-ant-…3f2a" });
    expect(statSync(join(home, "config.json")).mode & 0o777).toBe(0o600);
    const env = new FileAiConfig(home, { ANTHROPIC_API_KEY: "sk-ant-envkey-000000000000-9999" });
    expect(env.settings().ai.keySource).toBe("env");
    expect(env.key()).toBe("sk-ant-envkey-000000000000-9999");
    expect(JSON.stringify(env.settings())).not.toContain("envkey");
  });

  test("an env key selects its provider when none is chosen", () => {
    const cfg = new FileAiConfig(tempHome(), { ANTHROPIC_API_KEY: "sk-ant-x-123456789" });
    expect(cfg.settings().ai.provider).toBe("anthropic");
    expect(maskKey("short")).toBe("…");
    expect(existsSync(join(tempHome(), "config.json"))).toBe(false);
  });

  test("the redactor masks keys in messages", () => {
    expect(redact("bad key sk-ant-api03-abcdefghijklmnop-zzzz")).not.toContain("abcdefghijkl");
    expect(redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toContain("Bearer …");
    void readFileSync;
  });
});
