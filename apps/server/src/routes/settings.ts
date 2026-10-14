/**
 * Settings and the AI key. GET never returns the key (keySource + keyMasked only).
 */
import { type RouteRes, SettingsPatch } from "@learncroc/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { ServerContext } from "../context";
import { invalid, readBody, router } from "../http";
import { UrlRefusedError } from "../security/url-guard";
import { getServices } from "../services";
import { SettingsError } from "../settings/store";

const KeyBody = z.object({
  provider: z.enum(["anthropic", "openai-compatible", "ollama"]),
  key: z.string().min(1).max(512),
  baseUrl: z.string().max(2048).optional(),
});

function checkBaseUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw invalid("baseUrl is not a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw invalid("baseUrl must be http(s)");
  if (u.username || u.password) throw invalid("baseUrl may not contain credentials");
}

export function settingsRoutes(ctx: ServerContext): Hono {
  const svc = getServices(ctx);
  const r = router();

  r.get("/settings", (c) => {
    const body: RouteRes<"GET /settings"> = svc.settings.get();
    return c.json(body);
  });

  r.patch("/settings", async (c) => {
    const patch = await readBody(c, SettingsPatch);
    if (patch.ai?.baseUrl) checkBaseUrl(patch.ai.baseUrl);
    try {
      const body: RouteRes<"PATCH /settings"> = svc.settings.patch(patch);
      return c.json(body);
    } catch (e) {
      if (e instanceof SettingsError || e instanceof UrlRefusedError) throw invalid(e.message);
      throw e;
    }
  });

  r.put("/settings/ai-key", async (c) => {
    const body = await readBody(c, KeyBody);
    if (body.baseUrl) checkBaseUrl(body.baseUrl);
    try {
      const { keyMasked } = svc.settings.setKey(body);
      const res: RouteRes<"PUT /settings/ai-key"> = { ok: true, keyMasked };
      return c.json(res);
    } catch (e) {
      if (e instanceof SettingsError) throw invalid(e.message);
      throw e;
    }
  });

  r.delete("/settings/ai-key", (c) => {
    svc.settings.clearKey();
    const res: RouteRes<"DELETE /settings/ai-key"> = { ok: true };
    return c.json(res);
  });

  return r;
}
