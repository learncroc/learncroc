/**
 * Screenshot rounds (PLAN §18 stage 3). `bun run shots` saves PNGs to
 * e2e/shots/round-<LM_ROUND>/<name>-<theme>.png at 1440×900.
 *
 * Skeleton: captures every route's current state in light and dark. The seeded home (fixture progress,
 * fake-provider key) and the full shot list arrive with the integration work.
 */
import { join } from "node:path";
import { test } from "@playwright/test";

const round = process.env.LM_ROUND ?? "0";
const outDir = join(import.meta.dirname, "shots", `round-${round}`);

const SHOTS: { name: string; path: string }[] = [
  { name: "welcome", path: "/welcome" },
  { name: "library", path: "/library" },
  { name: "map", path: "/p/mini-pack" },
  { name: "run", path: "/p/mini-pack/run/units" },
  { name: "toy", path: "/p/mini-pack/toy/units" },
  { name: "boss", path: "/p/mini-pack/boss/boss-trip" },
  { name: "teach", path: "/p/mini-pack/teach/unit-conversion" },
  { name: "placement", path: "/p/mini-pack/placement" },
  { name: "relight", path: "/relight" },
  { name: "cards", path: "/cards" },
  { name: "market", path: "/market" },
  { name: "market-detail", path: "/market/mini-pack" },
  { name: "create", path: "/create" },
  { name: "create-pocket", path: "/create/pocket" },
  { name: "logbook", path: "/logbook" },
  { name: "settings-ai", path: "/settings/ai" },
  { name: "dev-widgets", path: "/dev/widgets" },
  { name: "dev-maps", path: "/dev/maps" },
];

test.skip(!process.env.LM_SHOTS, "screenshots run with `bun run shots`");

for (const theme of ["light", "dark"] as const) {
  for (const shot of SHOTS) {
    test(`${shot.name} (${theme})`, async ({ page }) => {
      await page.goto(shot.path);
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: join(outDir, `${shot.name}-${theme}.png`), fullPage: false });
    });
  }
}
