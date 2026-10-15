/**
 * One API for CLI commands that act on learner state: the running server over HTTP when there is
 * one, otherwise the same routes in-process (createApp over the home, under the one-writer lock).
 * Either way the server's route handlers, and so the core services, do the work.
 */
import { type RouteKey, type RouteRes, splitRoute } from "@learncroc/core";
import { createApp, homePaths, PackStore } from "@learncroc/server";
import { acquireLock, LockHeldError } from "@learncroc/server/util/fs";
import { runningServer } from "./context";

export interface Transport {
  /** "server" (HTTP to the running app) or "local" (in-process). */
  mode: "server" | "local";
  call<K extends RouteKey>(key: K, opts?: { path?: string; body?: unknown }): Promise<RouteRes<K>>;
  close(): void;
}

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiCallError";
  }
}

async function parse<K extends RouteKey>(res: Response): Promise<RouteRes<K>> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiCallError(res.status, body.error ?? "invalid", body.message ?? `${res.status}`);
  return body as RouteRes<K>;
}

export async function openTransport(home: string, port: number): Promise<Transport> {
  const server = await runningServer(home);
  if (server) {
    return {
      mode: "server",
      call: async (key, opts = {}) => parse(await server.request(key, opts)),
      close: () => {},
    };
  }
  let release: () => void;
  try {
    release = acquireLock(homePaths(home).lock);
  } catch (e) {
    if (e instanceof LockHeldError) throw new Error(`another learncroc command is using ${home} (pid ${e.pid})`);
    throw e;
  }
  const token = crypto.randomUUID();
  const store = new PackStore({ home });
  const { app } = createApp({ home, port, packs: store, sessionToken: token });
  const host = `127.0.0.1:${port}`;
  return {
    mode: "local",
    call: async (key, opts = {}) => {
      const { method, path } = splitRoute(key);
      const res = await app.request(`http://${host}/api${opts.path ?? path}`, {
        method,
        headers: {
          host,
          cookie: `lm_session=${token}`,
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
      return parse(res);
    },
    close: () => {
      store.close();
      release();
    },
  };
}
