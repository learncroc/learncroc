/**
 * Route tests with Hono app.request against a temp home: every non-AI route's happy path plus its
 * 404/400 cases. Run routes live in runs.test.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  API_ROUTES,
  CardState,
  CompiledPack,
  ExportFile,
  InstalledPackSummary,
  Logbook,
  PackProgress,
  RegistryView,
  SearchHit,
  Settings,
  splitRoute,
} from "@learncroc/core";
import { type FrameDoc, FrameStore, handleSandboxRequest } from "../src/sandbox/listener";
import { ASSET_CSP } from "../src/security/assets";
import { fixedClock, testApp } from "./helpers";

describe("system", async () => {
  const t = await testApp();

  test("GET /health", async () => {
    const { status, body } = await t.json<{ ok: boolean; home: string; packs: number; aiConfigured: boolean }>(
      "GET",
      "/health",
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, home: t.home, packs: 1, aiConfigured: false });
  });

  test("every contract route is mounted (never a 404 for the route itself)", async () => {
    const t = await testApp();
    const fill = (p: string) => p.replace(/:[A-Za-z]+/g, "mini-pack").replace("*", "assets/img/clock-and-road.svg");
    for (const key of API_ROUTES) {
      const { method, path } = splitRoute(key);
      const res = await t.req(method, fill(path), method === "GET" || method === "DELETE" ? undefined : {});
      const body = res.headers.get("content-type")?.includes("json")
        ? ((await res.json()) as { message?: string })
        : {};
      const routeMissing = res.status === 404 && /^no route/.test(body.message ?? "");
      expect({ key, routeMissing }).toEqual({ key, routeMissing: false });
    }
  });

  test("unknown routes are a JSON 404", async () => {
    const res = await t.req("GET", "/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });

  test("GET /search finds packs, stops, actions and settings", async () => {
    const hits = SearchHit.array().parse((await t.json("GET", "/search?q=minutes")).body);
    expect(hits.some((h) => h.type === "node" && h.nodeId === "unit-conversion")).toBe(true);
    const pack = SearchHit.array().parse((await t.json("GET", "/search?q=mini")).body);
    expect(pack[0]).toMatchObject({ type: "pack", packId: "mini-pack", href: "/p/mini-pack" });
    const action = SearchHit.array().parse((await t.json("GET", "/search?q=relight")).body);
    expect(action.some((h) => h.type === "action" && h.href === "/relight")).toBe(true);
    expect((await t.json("GET", "/search?q=")).body).toEqual([]);
  });

  test("export → import round-trips learner data; unknown tables are rejected", async () => {
    await t.json("POST", "/cards", { packId: "mini-pack", front: "Q", back: "A", source: "manual" });
    const exp = await t.req("GET", "/export");
    expect(exp.headers.get("content-disposition")).toContain("attachment");
    const file = ExportFile.parse(await exp.json());
    expect(file.tables.card?.length).toBe(1);
    const other = await testApp();
    const imported = await other.json<{ ok: boolean; counts: Record<string, number> }>("POST", "/import", file);
    expect(imported.status).toBe(200);
    expect(imported.body.counts.card).toBe(1);
    expect((await other.json<unknown[]>("GET", "/cards")).body.length).toBe(1);
    const bad = await other.json("POST", "/import", { ...file, tables: { ...file.tables, secrets: [] } });
    expect(bad.status).toBe(400);
    const garbage = await other.json("POST", "/import", { format: "nope" });
    expect(garbage.status).toBe(400);
  });

  test("POST /reset/:packId needs confirm = packId and validates the id", async () => {
    expect((await t.json("POST", "/reset/mini-pack", { confirm: "other" })).status).toBe(400);
    expect((await t.json("POST", "/reset/BAD..ID", { confirm: "BAD..ID" })).status).toBe(400);
    const ok = await t.json("POST", "/reset/mini-pack", { confirm: "mini-pack" });
    expect(ok).toEqual({ status: 200, body: { ok: true } });
  });

  test("POST /_test/clock pins the clock (LEARNCROC_TEST only)", async () => {
    expect((await t.json("POST", "/_test/clock", { now: 1_800_000_000_000 })).status).toBe(200);
    expect(PackProgress.parse((await t.json("GET", "/progress/mini-pack")).body).now).toBe(1_800_000_000_000);
    await t.json("POST", "/_test/clock", { now: null });
    const prod = await testApp({ test: false });
    expect((await prod.json("POST", "/_test/clock", { now: 1 })).status).toBe(404);
  });
});

describe("packs", async () => {
  const t = await testApp();

  test("GET /packs and /packs/:id", async () => {
    const list = InstalledPackSummary.array().parse((await t.json("GET", "/packs")).body);
    expect(list.map((p) => p.id)).toEqual(["mini-pack"]);
    expect(list[0]).toMatchObject({ tier: "official", status: "ok", next: { nodeId: "units" } });
    const pack = CompiledPack.parse((await t.json("GET", "/packs/mini-pack")).body);
    expect(pack.manifest.id).toBe("mini-pack");
    expect((await t.req("GET", "/packs/nope-pack")).status).toBe(404);
    expect((await t.req("GET", "/packs/BAD..ID")).status).toBe(400);
    expect((await t.req("GET", "/packs/mini-pack?version=latest")).status).toBe(400);
    expect((await t.req("GET", "/packs/mini-pack?version=9.9.9")).status).toBe(404);
  });

  test("assets carry the sandbox CSP and nosniff; traversal and html are refused", async () => {
    const res = await t.req("GET", "/packs/mini-pack/assets/assets/img/clock-and-road.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toBe(ASSET_CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    for (const bad of [
      "assets/../../x",
      "assets/%2e%2e/%2e%2e/pack.json",
      "assets/img/..%2F..%2Fpack.json",
      "pack.json",
      "assets/interactive/toy.html",
      "assets/img/missing.svg",
      "assets/img/CLOCK.SVG",
    ]) {
      const r = await t.req("GET", `/packs/mini-pack/assets/${bad}`);
      expect({ bad, status: r.status }).toEqual({ bad, status: 404 });
    }
  });

  test("POST /packs/:id/opened records lastOpenedAt", async () => {
    expect((await t.json("POST", "/packs/mini-pack/opened")).body).toEqual({ ok: true });
    const list = InstalledPackSummary.array().parse((await t.json("GET", "/packs")).body);
    expect(typeof list[0]?.lastOpenedAt).toBe("number");
    expect((await t.json("POST", "/packs/nope-pack/opened")).status).toBe(404);
  });

  test("DELETE /packs/:id removes the pack and keeps progress", async () => {
    const u = await testApp();
    await u.json("POST", "/cards", { packId: "mini-pack", front: "Q", back: "A", source: "manual" });
    expect((await u.json("DELETE", "/packs/mini-pack")).body).toEqual({ ok: true });
    expect((await u.json<unknown[]>("GET", "/packs")).body).toEqual([]);
    expect((await u.json("DELETE", "/packs/mini-pack")).status).toBe(404);
    expect((await u.json<unknown[]>("GET", "/export")).status).toBe(200);
    const exp = ExportFile.parse((await u.json("GET", "/export")).body);
    expect(exp.tables.card?.length).toBe(1);
  });

  test("POST /packs/install streams events (builtin registry, derived from bundled sources)", async () => {
    const res = await t.req("POST", "/packs/install", { id: "not-a-real-pack", registry: "builtin" });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: resolving");
    expect(text).toContain("event: error");
    expect(
      (await t.json("POST", "/packs/install", { id: "x", registry: "https://not-configured.example/index.json" }))
        .status,
    ).toBe(400);
    expect((await t.json("POST", "/packs/install", { id: "BAD ID" })).status).toBe(400);
  });

  test("POST /frames registers a one-time sandbox document", async () => {
    const pack = CompiledPack.parse((await t.json("GET", "/packs/mini-pack")).body);
    void pack;
    expect(
      (await t.json("POST", "/frames", { packId: "mini-pack", asset: "assets/interactive/none.html" })).status,
    ).toBe(404);
    expect(
      (await t.json("POST", "/frames", { packId: "mini-pack", asset: "assets/img/clock-and-road.svg" })).status,
    ).toBe(400);
    expect((await t.json("POST", "/frames", { packId: "mini-pack" })).status).toBe(400);
    expect((await t.json("POST", "/frames", { packId: "mini-pack", generated: true, nodeId: "units" })).status).toBe(
      404,
    );
  });
});

describe("sandbox origin", () => {
  const frames = new FrameStore(new Map<string, FrameDoc>());
  const opts = { port: 4748, mainPort: 4747, frames };
  const get = (path: string, host = "127.0.0.1:4748", method = "GET") =>
    handleSandboxRequest(new Request(`http://${host}${path}`, { method, headers: { host } }), opts);

  test("serves a registered document once, with the frame CSP", async () => {
    const token = frames.register("<p>hi</p>");
    const res = get(`/frame/${token}`);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors http://127.0.0.1:4747 http://localhost:4747");
    expect(await res.text()).toBe("<p>hi</p>");
    expect(get(`/frame/${token}`).status).toBe(404);
  });

  test("refuses other hosts, paths and methods; tokens expire", () => {
    const t1 = frames.register("<p>x</p>");
    expect(get(`/frame/${t1}`, "localhost:4748").status).toBe(404);
    expect(get(`/frame/${t1}`, "127.0.0.1:4748", "POST").status).toBe(404);
    expect(get("/api/health").status).toBe(404);
    expect(get(`/frame/${t1}?x=1`).status).toBe(404);
    const t2 = frames.register("<p>y</p>", 0);
    expect(frames.take(t2, 61_000)).toBeUndefined();
  });
});

describe("settings", async () => {
  const t = await testApp();

  test("GET /settings returns defaults without any key", async () => {
    const s = Settings.parse((await t.json("GET", "/settings")).body);
    expect(s.ai).toMatchObject({ provider: "none", keySource: "none" });
    expect(s.ai.keyMasked).toBeUndefined();
  });

  test("PATCH /settings merges, validates and refuses bad registries", async () => {
    const s = Settings.parse((await t.json("PATCH", "/settings", { learning: { dailyRelight: 12 } })).body);
    expect(s.learning.dailyRelight).toBe(12);
    expect(s.learning.targetRetention).toBe(0.9);
    expect((await t.json("PATCH", "/settings", { learning: { dailyRelight: 7 } })).status).toBe(400);
    expect((await t.json("PATCH", "/settings", { registries: ["builtin", "file:///etc"] })).status).toBe(400);
    expect((await t.json("PATCH", "/settings", { registries: ["builtin", "https://169.254.169.254/x"] })).status).toBe(
      400,
    );
    expect(
      (await t.json("PATCH", "/settings", { registries: ["builtin", "https://example.org/index.json"] })).status,
    ).toBe(200);
  });

  test("PUT /settings/ai-key stores a masked key; the key never appears in responses", async () => {
    const key = "sk-ant-api03-abcdefghijklmnop-3f2a";
    const put = await t.json<{ ok: boolean; keyMasked: string }>("PUT", "/settings/ai-key", {
      provider: "anthropic",
      key,
    });
    expect(put.body).toEqual({ ok: true, keyMasked: "sk-ant-…3f2a" });
    const res = await t.req("GET", "/settings");
    const text = await res.text();
    expect(text).not.toContain("abcdefghijklmnop");
    const s = Settings.parse(JSON.parse(text));
    expect(s.ai).toMatchObject({ provider: "anthropic", keySource: "file", keyMasked: "sk-ant-…3f2a" });
    const exp = await t.req("GET", "/export");
    expect(await exp.text()).not.toContain("abcdefghijklmnop");
    expect((await t.json("DELETE", "/settings/ai-key")).body).toEqual({ ok: true });
    expect(Settings.parse((await t.json("GET", "/settings")).body).ai.keySource).toBe("none");
    expect((await t.json("PUT", "/settings/ai-key", { provider: "nope", key })).status).toBe(400);
  });
});

describe("cards", async () => {
  const clock = fixedClock();
  const t = await testApp({ clock });

  test("create, list, due, edit, suspend, review, export, delete", async () => {
    const created = CardState.parse(
      (
        await t.json("POST", "/cards", {
          packId: "mini-pack",
          nodeId: "units",
          front: "Front",
          back: "Back",
          source: "manual",
        })
      ).body,
    );
    expect(created.kind).toBe("user");
    const list = (await t.json<{ id: string; front: string }[]>("GET", "/cards?packId=mini-pack")).body;
    expect(list.map((c) => c.front)).toEqual(["Front"]);
    const due = (await t.json<{ now: number; cards: unknown[] }>("GET", "/cards/due")).body;
    expect(due.now).toBe(clock.t);
    expect(due.cards.length).toBe(1);
    const id = encodeURIComponent(created.id);
    const edited = CardState.parse(
      (await t.json("PATCH", `/cards/${id}`, { front: "New front", suspended: true })).body,
    );
    expect(edited).toMatchObject({ front: "New front", suspended: true });
    expect((await t.json<{ cards: unknown[] }>("GET", "/cards/due")).body.cards.length).toBe(0);
    const reviewed = CardState.parse((await t.json("POST", `/cards/${id}/review`, { grade: 3 })).body);
    expect(reviewed.reps).toBe(1);
    expect(reviewed.due).toBeGreaterThan(clock.t);
    expect((await t.json("POST", `/cards/${id}/review`, {})).status).toBe(400);
    const csv = await t.req("GET", "/cards/export?format=csv");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("New front");
    const md = await t.req("GET", "/cards/export?format=md");
    expect(await md.text()).toContain("**New front**");
    expect((await t.req("GET", "/cards/export?format=pdf")).status).toBe(400);
    expect((await t.json("DELETE", `/cards/${id}`)).body).toEqual({ ok: true });
    expect((await t.json("DELETE", `/cards/${id}`)).status).toBe(404);
  });

  test("bad inputs are 400; unknown packs and cards are 404", async () => {
    expect(
      (await t.json("POST", "/cards", { packId: "mini-pack", front: "", back: "x", source: "manual" })).status,
    ).toBe(400);
    expect(
      (await t.json("POST", "/cards", { packId: "nope-pack", front: "x", back: "x", source: "manual" })).status,
    ).toBe(404);
    expect(
      (await t.json("POST", "/cards", { packId: "mini-pack", nodeId: "zzz", front: "x", back: "x", source: "manual" }))
        .status,
    ).toBe(404);
    expect((await t.json("GET", "/cards?kind=weird")).status).toBe(400);
    expect((await t.json("PATCH", "/cards/user:nope", { suspended: true })).status).toBe(404);
  });
});

describe("progress, logbook and notes", async () => {
  const clock = fixedClock();
  const t = await testApp({ clock });

  test("GET /progress and /progress/:packId carry now and node views", async () => {
    const all = (
      await t.json<{ now: number; packs: Record<string, { playable: number; lit: number }> }>("GET", "/progress")
    ).body;
    expect(all.now).toBe(clock.t);
    expect(all.packs["mini-pack"]).toMatchObject({ playable: 4, lit: 0 });
    const p = PackProgress.parse((await t.json("GET", "/progress/mini-pack")).body);
    expect(p.views.units?.state).toBe("ready");
    expect(p.views["unit-conversion"]?.state).toBe("locked");
    expect(p.views["average-speed"]?.state).toBe("planned");
    expect(p.now).toBe(clock.t);
    expect((await t.json("GET", "/progress/nope-pack")).status).toBe(404);
    expect((await t.json("GET", "/progress/BAD..ID")).status).toBe(400);
  });

  test("GET /logbook and /notes", async () => {
    const lb = Logbook.parse((await t.json("GET", "/logbook")).body);
    expect(lb).toMatchObject({ canNow: [], fieldNotes: [], usedToThink: [], now: clock.t });
    expect((await t.json("GET", "/notes?packId=mini-pack")).body).toEqual([]);
    expect((await t.json("GET", "/notes?packId=BAD..ID")).status).toBe(400);
  });
});

describe("registry", async () => {
  const t = await testApp();
  test("GET /registry merges configured registries; /registry/:id/try validates", async () => {
    const view = RegistryView.parse((await t.json("GET", "/registry")).body);
    expect(Array.isArray(view.packs)).toBe(true);
    expect((await t.json("GET", "/registry/BAD..ID/try")).status).toBe(400);
    expect((await t.json("GET", "/registry/not-a-pack/try")).status).toBe(404);
    expect((await t.json("GET", "/registry/mini-pack/try?registry=https://unknown.example/i.json")).status).toBe(400);
  });
});

describe("sandboxed interactives end to end", async () => {
  const { cpSync, mkdirSync: mk, writeFileSync: wf } = await import("node:fs");
  const { join: pj } = await import("node:path");
  const { compilePackDir } = await import("../src/packs/compile");
  const { PackStore } = await import("../src/packs/store");
  const { FIXTURE_DIR, tempHome } = await import("./helpers");
  const src = pj(tempHome("lm-src-"), "mini-pack");
  cpSync(FIXTURE_DIR, src, { recursive: true });
  mk(pj(src, "assets", "interactive"), { recursive: true });
  wf(pj(src, "assets", "interactive", "dial.html"), "<p id=v>0</p><script>lm.ready();</script>");
  const t = await testApp();
  t.store.install(PackStore.filesFromSource(await compilePackDir(src), src), { source: "file", tier: "local" });
  // Installs refuse networked html; plant one afterwards to check the route's own scan (dev packs).
  wf(
    pj(t.home, "packs", "mini-pack@0.1.0", "assets", "interactive", "leaky.html"),
    "<script>lm.ready(); fetch('https://e.x')</script>",
  );

  test("POST /frames returns a one-time sandbox URL whose document carries the bridge", async () => {
    const res = await t.json<{ url: string; expiresAt: number }>("POST", "/frames", {
      packId: "mini-pack",
      asset: "assets/interactive/dial.html",
    });
    expect(res.status).toBe(200);
    const m = /^http:\/\/127\.0\.0\.1:4748\/frame\/([a-f0-9]{32})$/.exec(res.body.url);
    expect(m).not.toBeNull();
    const doc = handleSandboxRequest(new Request(res.body.url, { headers: { host: "127.0.0.1:4748" } }), {
      port: 4748,
      mainPort: 4747,
      frames: new FrameStore(),
    });
    expect(doc.status).toBe(200);
    const html = await doc.text();
    expect(html).toContain("<p id=v>0</p>");
    expect(html).toContain("Content-Security-Policy");
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("<p id=v>"));
  });

  test("html interactives are never served from the app origin; leaky ones are refused", async () => {
    expect((await t.req("GET", "/packs/mini-pack/assets/assets/interactive/dial.html")).status).toBe(404);
    expect(
      (await t.json("POST", "/frames", { packId: "mini-pack", asset: "assets/interactive/leaky.html" })).status,
    ).toBe(400);
  });
});
