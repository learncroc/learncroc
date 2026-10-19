import { expect, test } from "@playwright/test";

test("the app shell renders and the API answers through the Vite proxy", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ ok: true });

  await page.goto("/library");
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});
