/**
 * `learncroc play` live reload: app pages get a same-origin reload script, and the event stream says
 * `change` (debounced) when a played pack changes. Host and cross-site rules match the app.
 */
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_RELOAD_EVENTS, LIVE_RELOAD_SCRIPT, liveReloadChannel, serveStatic } from "../src/serve";
import { tempHome } from "./helpers";

const port = 4747;
const host = `127.0.0.1:${port}`;

function fakeStore() {
  const listeners = new Set<(id: string) => void>();
  return {
    onChange(fn: (id: string) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(id: string) {
      for (const l of listeners) l(id);
    },
    get size() {
      return listeners.size;
    },
  };
}

test("app pages carry the reload script only when live reload is on", async () => {
  const dir = tempHome("lm-web-");
  writeFileSync(
    join(dir, "index.html"),
    '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>',
  );
  const req = () => new Request(`http://${host}/p/my-pack`, { headers: { host } });
  const on = await (await serveStatic(req(), { dir, port, dev: false, liveReload: true })).text();
  expect(on).toContain(`<script type="module" src="${LIVE_RELOAD_SCRIPT}"></script></head>`);
  const off = await (await serveStatic(req(), { dir, port, dev: false })).text();
  expect(off).not.toContain(LIVE_RELOAD_SCRIPT);
});

test("the event stream says change once per burst of edits, and refuses other hosts and cross-site", async () => {
  const store = fakeStore();
  const channel = liveReloadChannel(store, { port, dev: false, debounceMs: 20 });
  expect(channel(new Request(`http://${host}/assets/app.js`, { headers: { host } }))).toBeNull();
  expect(
    channel(new Request(`http://evil.example${LIVE_RELOAD_EVENTS}`, { headers: { host: "evil.example" } }))?.status,
  ).toBe(403);
  expect(
    channel(new Request(`http://${host}${LIVE_RELOAD_EVENTS}`, { headers: { host, "sec-fetch-site": "cross-site" } }))
      ?.status,
  ).toBe(403);

  const script = channel(new Request(`http://${host}${LIVE_RELOAD_SCRIPT}`, { headers: { host } }));
  expect(script?.headers.get("content-type")).toContain("text/javascript");
  expect(await script?.text()).toContain("location.reload()");

  const ctrl = new AbortController();
  const res = channel(new Request(`http://${host}${LIVE_RELOAD_EVENTS}`, { headers: { host }, signal: ctrl.signal }));
  expect(res?.headers.get("content-type")).toContain("text/event-stream");
  if (!res?.body) throw new Error("no event stream");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  expect(dec.decode((await reader.read()).value)).toContain(": live");
  store.emit("my-pack");
  store.emit("my-pack");
  store.emit("my-pack");
  const chunk = dec.decode((await reader.read()).value);
  expect(chunk).toBe('event: change\ndata: "my-pack"\n\n');
  await reader.cancel();
  expect(store.size).toBe(0);
});
