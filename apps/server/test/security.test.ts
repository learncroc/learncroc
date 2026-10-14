import { describe, expect, test } from "bun:test";
import { HOST, ORIGIN, testApp } from "./helpers";

const raw = async (
  t: Awaited<ReturnType<typeof testApp>>,
  method: string,
  path: string,
  headers: Record<string, string>,
) => t.app.request(`http://${HOST}/api${path}`, { method, headers });

describe("Host, Origin and session cookie guard", async () => {
  const t = await testApp();

  test("a bad Host is refused (DNS rebinding)", async () => {
    for (const host of ["evil.example:4747", "127.0.0.1:9999", "localhost:5173", "127.0.0.1.nip.io:4747", ""]) {
      const res = await raw(t, "GET", "/packs", { host, cookie: `lm_session=${t.token}` });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "forbidden" });
    }
  });

  test("localhost:<port> is accepted like 127.0.0.1:<port>", async () => {
    const res = await raw(t, "GET", "/packs", { host: "localhost:4747", cookie: `lm_session=${t.token}` });
    expect(res.status).toBe(200);
  });

  test("a request without cookie or same-origin fetch metadata is refused", async () => {
    const res = await raw(t, "GET", "/packs", { host: HOST });
    expect(res.status).toBe(403);
  });

  test("a wrong cookie is refused", async () => {
    const res = await raw(t, "GET", "/packs", { host: HOST, cookie: "lm_session=nope" });
    expect(res.status).toBe(403);
  });

  test("Sec-Fetch-Site same-origin or none sets the HttpOnly SameSite=Strict cookie", async () => {
    for (const site of ["same-origin", "none"]) {
      const res = await raw(t, "GET", "/settings", { host: HOST, "sec-fetch-site": site });
      expect(res.status).toBe(200);
      const cookie = res.headers.get("set-cookie") ?? "";
      expect(cookie).toContain(`lm_session=${t.token}`);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
    }
  });

  test("cross-site and same-site requests are refused even with the cookie", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const res = await raw(t, "GET", "/settings", {
        host: HOST,
        "sec-fetch-site": site,
        cookie: `lm_session=${t.token}`,
      });
      expect(res.status).toBe(403);
    }
  });

  test("state-changing requests need an allowed Origin (or the cookie without Origin, like the CLI)", async () => {
    const bad = await raw(t, "POST", "/packs/mini-pack/opened", {
      host: HOST,
      origin: "https://evil.example",
      cookie: `lm_session=${t.token}`,
    });
    expect(bad.status).toBe(403);
    const opaque = await raw(t, "POST", "/packs/mini-pack/opened", {
      host: HOST,
      origin: "null",
      cookie: `lm_session=${t.token}`,
    });
    expect(opaque.status).toBe(403);
    const good = await raw(t, "POST", "/packs/mini-pack/opened", {
      host: HOST,
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    });
    expect(good.status).toBe(200);
    const cli = await raw(t, "POST", "/packs/mini-pack/opened", { host: HOST, cookie: `lm_session=${t.token}` });
    expect(cli.status).toBe(200);
    const anonymous = await raw(t, "POST", "/packs/mini-pack/opened", { host: HOST, "sec-fetch-site": "none" });
    expect(anonymous.status).toBe(403);
  });

  test("GET /health answers without a cookie but still checks Host and cross-site", async () => {
    expect((await raw(t, "GET", "/health", { host: HOST })).status).toBe(200);
    expect((await raw(t, "GET", "/health", { host: "evil.example" })).status).toBe(403);
    expect((await raw(t, "GET", "/health", { host: HOST, "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  test("responses carry nosniff and never CORS headers", async () => {
    const res = await t.req("GET", "/settings", undefined, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    const ok = await t.req("GET", "/settings");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("through the Vite proxy (--dev, changeOrigin: false)", async () => {
  const t = await testApp({ dev: true });

  test("the first proxied request (Host localhost:5173, same-origin) gets the cookie", async () => {
    const res = await raw(t, "GET", "/packs", { host: "localhost:5173", "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("lm_session=");
  });

  test("writes from the Vite origin are accepted; other origins are not", async () => {
    const ok = await raw(t, "POST", "/packs/mini-pack/opened", {
      host: "localhost:5173",
      origin: "http://localhost:5173",
      "sec-fetch-site": "same-origin",
    });
    expect(ok.status).toBe(200);
    const bad = await raw(t, "POST", "/packs/mini-pack/opened", {
      host: "localhost:5173",
      origin: "http://localhost:3000",
      cookie: `lm_session=${t.token}`,
    });
    expect(bad.status).toBe(403);
  });

  test("without --dev the Vite host is refused", async () => {
    const prod = await testApp({ dev: false });
    const res = await raw(prod, "GET", "/packs", { host: "localhost:5173", "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(403);
  });
});
