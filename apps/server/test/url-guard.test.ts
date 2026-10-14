import { describe, expect, test } from "bun:test";
import {
  checkUrl,
  checkUrlSyntax,
  guardedFetch,
  isPrivateAddress,
  resolveRemoteUrl,
  UrlRefusedError,
} from "../src/security/url-guard";

const publicDns = async () => ["93.184.216.34"];

describe("URL guard", () => {
  test("only https (http to loopback only in --dev)", () => {
    expect(() => checkUrlSyntax("file:///etc/passwd")).toThrow(UrlRefusedError);
    expect(() => checkUrlSyntax("ftp://example.com/x")).toThrow(UrlRefusedError);
    expect(() => checkUrlSyntax("http://example.com/index.json")).toThrow(UrlRefusedError);
    expect(() => checkUrlSyntax("http://127.0.0.1:8080/index.json")).toThrow(UrlRefusedError);
    expect(checkUrlSyntax("http://127.0.0.1:8080/index.json", { dev: true }).host).toBe("127.0.0.1:8080");
    expect(() => checkUrlSyntax("http://192.168.1.2/index.json", { dev: true })).toThrow(UrlRefusedError);
    expect(checkUrlSyntax("https://learncroc.github.io/registry/index.json").hostname).toBe("learncroc.github.io");
  });

  test("metadata, private and loopback addresses are refused", () => {
    for (const u of [
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.1/x",
      "https://172.16.5.4/x",
      "https://192.168.0.10/x",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://[::1]/x",
      "https://[fd00::1]/x",
      "https://[::ffff:169.254.169.254]/x",
      "https://0.0.0.0/x",
      "https://printer.local/x",
      "https://intranet/x",
      "https://user:pass@example.com/x",
    ])
      expect(() => checkUrlSyntax(u)).toThrow(UrlRefusedError);
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  test("a host that resolves to a private address is refused", async () => {
    await expect(checkUrl("https://evil.example/x", { resolve: async () => ["169.254.169.254"] })).rejects.toThrow(
      UrlRefusedError,
    );
    await expect(checkUrl("https://ok.example/x", { resolve: publicDns })).resolves.toBeInstanceOf(URL);
  });

  test("relative URLs keep the index's scheme and origin; absolute ones pass the guard", () => {
    const base = "https://learncroc.github.io/registry/index.json";
    expect(resolveRemoteUrl("dist/a-1.0.0.lmpack", base)).toBe(
      "https://learncroc.github.io/registry/dist/a-1.0.0.lmpack",
    );
    expect(() => resolveRemoteUrl("file:///etc/passwd", base)).toThrow(UrlRefusedError);
    expect(() => resolveRemoteUrl("http://169.254.169.254/latest", base)).toThrow(UrlRefusedError);
    expect(() => resolveRemoteUrl("//169.254.169.254/x", base)).toThrow(UrlRefusedError);
    expect(resolveRemoteUrl("https://github.com/learncroc/x.lmpack", base)).toBe(
      "https://github.com/learncroc/x.lmpack",
    );
  });

  test("redirects are re-checked hop by hop", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).startsWith("https://ok.example/"))
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
      return new Response("secret");
    }) as typeof fetch;
    await expect(guardedFetch("https://ok.example/index.json", { fetchImpl, resolve: publicDns })).rejects.toThrow(
      UrlRefusedError,
    );
  });

  test("responses over the size cap are refused", async () => {
    const fetchImpl = (async () => new Response(new Uint8Array(2048))) as unknown as typeof fetch;
    await expect(
      guardedFetch("https://ok.example/big", { fetchImpl, resolve: publicDns, maxBytes: 1024 }),
    ).rejects.toThrow(/too large/);
  });
});
