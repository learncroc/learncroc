import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type InstallEvent, RegistryIndex, TryBundle } from "@learncroc/core";
import { discoverSourcePacks } from "../src/packs/discover";
import { PackStore } from "../src/packs/store";
import { buildRegistry } from "../src/registry/build";
import { InstallError, RegistryClient } from "../src/registry/client";
import { FIXTURE_DIR, tempHome } from "./helpers";

const fixtureDirs = () => discoverSourcePacks(resolve(FIXTURE_DIR, ".."));

async function builtRegistry() {
  const out = tempHome("lm-reg-");
  const report = await buildRegistry({ dirs: fixtureDirs(), outDir: out, now: "2026-10-20T00:00:00Z" });
  return { out, report };
}

/** Serve a registry folder through a fake fetch at https://reg.example/ (DNS resolves publicly). */
function fakeRemote(dir: string, overrides: Record<string, () => Response> = {}) {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    const o = overrides[url.pathname];
    if (o) return o();
    if (url.hostname !== "reg.example") return new Response("nope", { status: 404 });
    try {
      return new Response(readFileSync(join(dir, url.pathname.replace(/^\/+/, ""))));
    } catch {
      return new Response("not found", { status: 404 });
    }
  }) as typeof fetch;
  return { fetchImpl, requested, resolveHost: async () => ["93.184.216.34"] };
}

describe("registry build", () => {
  test("writes index.json, .lmpack and try bundles; rebuilds are reproducible", async () => {
    const { out, report } = await builtRegistry();
    expect(report.errors).toEqual([]);
    const index = RegistryIndex.parse(JSON.parse(readFileSync(join(out, "index.json"), "utf8")));
    const p = index.packs[0];
    expect(p?.id).toBe("mini-pack");
    expect(p?.versions[0]?.url).toBe("dist/mini-pack-0.1.0.lmpack");
    expect(p?.sketch.nodes.length).toBe(5);
    expect(p?.sketch.nodes.find((n) => n.id === "average-speed")?.status).toBe("planned");
    const bundle = TryBundle.parse(JSON.parse(readFileSync(join(out, "dist/mini-pack-0.1.0.try.json"), "utf8")));
    expect(bundle.node.id).toBe("units");
    const again = await buildRegistry({ dirs: fixtureDirs(), outDir: out, now: "2026-11-01T00:00:00Z" });
    expect(again.built[0]?.sha256).toBe(report.built[0]?.sha256 as string);
    expect(again.index.packs[0]?.versions[0]?.published).toBe("2026-10-20T00:00:00Z");
  });
});

describe("builtin registry", () => {
  test("lists packs and installs from registry/dist with sha256 verification", async () => {
    const { out } = await builtRegistry();
    const store = new PackStore({ home: tempHome() });
    const client = new RegistryClient({ store, builtinDir: out });
    const view = await client.view(["builtin"]);
    expect(view.packs.map((p) => p.id)).toEqual(["mini-pack"]);
    expect(view.packs[0]?.installed).toBeUndefined();
    const events: InstallEvent[] = [];
    const pack = await client.install({ id: "mini-pack", registry: "builtin" }, (e) => events.push(e));
    expect(pack.manifest.id).toBe("mini-pack");
    expect(events.map((e) => e.type)).toEqual(["resolving", "downloading", "verifying", "extracting", "done"]);
    const after = await client.view(["builtin"], true);
    expect(after.packs[0]?.installed).toBe("0.1.0");
    expect(after.packs[0]?.updateAvailable).toBe(false);
  });

  test("without a built index, builtin is derived from the bundled source packs", async () => {
    const store = new PackStore({ home: tempHome() });
    const client = new RegistryClient({ store, builtinDir: tempHome("lm-empty-"), sourceDirs: fixtureDirs });
    const view = await client.view(["builtin"]);
    expect(view.packs[0]?.id).toBe("mini-pack");
    const bundle = await client.tryBundle("mini-pack", "builtin");
    expect(bundle.node.id).toBe("units");
    const pack = await client.install({ id: "mini-pack", registry: "builtin" });
    expect(pack.manifest.version).toBe("0.1.0");
  });
});

describe("remote registries", () => {
  test("installs over https through the guard and serves try bundles", async () => {
    const { out } = await builtRegistry();
    const remote = fakeRemote(out);
    const store = new PackStore({ home: tempHome() });
    const client = new RegistryClient({ store, ...remote });
    const reg = "https://reg.example/index.json";
    const view = await client.view([reg]);
    expect(view.errors).toEqual([]);
    expect(view.packs[0]?.registry).toBe(reg);
    const bundle = await client.tryBundle("mini-pack", reg);
    expect(bundle.manifest.id).toBe("mini-pack");
    await client.install({ id: "mini-pack", registry: reg });
    expect(store.readInstalled().packs["mini-pack"]?.versions["0.1.0"]?.source).toBe("registry");
    expect(remote.requested).toContain("https://reg.example/dist/mini-pack-0.1.0.lmpack");
  });

  const tamperedIndex = async (mutate: (index: RegistryIndex) => void) => {
    const { out } = await builtRegistry();
    const index = RegistryIndex.parse(JSON.parse(readFileSync(join(out, "index.json"), "utf8")));
    mutate(index);
    return fakeRemote(out, { "/index.json": () => new Response(JSON.stringify(index)) });
  };

  test("an index pointing at file:// is refused", async () => {
    const remote = await tamperedIndex((i) => {
      (i.packs[0]?.versions[0] as { url: string }).url = "file:///etc/passwd";
    });
    const client = new RegistryClient({ store: new PackStore({ home: tempHome() }), ...remote });
    const events: InstallEvent[] = [];
    await expect(
      client.install({ id: "mini-pack", registry: "https://reg.example/index.json" }, (e) => events.push(e)),
    ).rejects.toBeInstanceOf(InstallError);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "url_refused" });
  });

  test("an index pointing at the metadata address is refused", async () => {
    const remote = await tamperedIndex((i) => {
      (i.packs[0]?.versions[0] as { url: string }).url = "http://169.254.169.254/latest/meta-data";
    });
    const client = new RegistryClient({ store: new PackStore({ home: tempHome() }), ...remote });
    const events: InstallEvent[] = [];
    await expect(
      client.install({ id: "mini-pack", registry: "https://reg.example/index.json" }, (e) => events.push(e)),
    ).rejects.toThrow();
    expect(events.at(-1)).toMatchObject({ type: "error", code: "url_refused" });
    expect(remote.requested.some((u) => u.includes("169.254"))).toBe(false);
  });

  test("a tryUrl escaping the registry origin is refused", async () => {
    const remote = await tamperedIndex((i) => {
      (i.packs[0]?.versions[0] as { tryUrl: string }).tryUrl = "https://10.0.0.5/try.json";
    });
    const client = new RegistryClient({ store: new PackStore({ home: tempHome() }), ...remote });
    await expect(client.tryBundle("mini-pack", "https://reg.example/index.json")).rejects.toThrow(/refused/);
  });

  test("a bad sha256 is refused before anything is extracted", async () => {
    const remote = await tamperedIndex((i) => {
      (i.packs[0]?.versions[0] as { sha256: string }).sha256 = "0".repeat(64);
    });
    const store = new PackStore({ home: tempHome() });
    const client = new RegistryClient({ store, ...remote });
    const events: InstallEvent[] = [];
    await expect(
      client.install({ id: "mini-pack", registry: "https://reg.example/index.json" }, (e) => events.push(e)),
    ).rejects.toThrow();
    expect(events.at(-1)).toMatchObject({ type: "error", code: "hash_mismatch" });
    expect(store.readInstalled().packs).toEqual({});
  });

  test("a registry URL that isn't https is refused; a failed refresh serves the cache marked stale", async () => {
    const { out } = await builtRegistry();
    const store = new PackStore({ home: tempHome() });
    const client = new RegistryClient({ store, ...fakeRemote(out) });
    const plain = await client.view(["http://reg.example/index.json"]);
    expect(plain.errors[0]?.message).toMatch(/https/);
    const reg = "https://reg.example/index.json";
    await client.view([reg]);
    const down = new RegistryClient({
      store,
      fetchImpl: (async () => new Response("down", { status: 503 })) as unknown as typeof fetch,
      resolveHost: async () => ["93.184.216.34"],
    });
    const view = await down.view([reg], true);
    expect(view.stale).toBe(true);
    expect(view.packs[0]?.id).toBe("mini-pack");
  });
});
