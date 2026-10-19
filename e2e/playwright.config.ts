/**
 * Playwright: Chromium only, a temp LEARNCROC_HOME per run, the fake AI provider, and the test clock.
 * Boots the server (--dev) on E2E_API_PORT and the Vite dev server on 5173 (proxying /api).
 *
 *   bun run e2e            all specs
 *   bun run shots          screenshot rounds (e2e/shots.spec.ts) into e2e/shots/round-N/
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const home = process.env.LEARNCROC_HOME ?? mkdtempSync(join(tmpdir(), "learncroc-e2e-"));
const apiPort = Number(process.env.E2E_API_PORT ?? 4747);
const webPort = 5173;

export default defineConfig({
  testDir: ".",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${webPort}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `bun apps/server/src/main.ts --dev --port ${apiPort}`,
      cwd: root,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: { LEARNCROC_HOME: home, LEARNCROC_FAKE_AI: "1", LEARNCROC_TEST: "1" },
      timeout: 30_000,
    },
    {
      command: "bun --cwd apps/web dev",
      cwd: root,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: !process.env.CI,
      env: { LEARNCROC_PORT: String(apiPort) },
      timeout: 60_000,
    },
  ],
});
