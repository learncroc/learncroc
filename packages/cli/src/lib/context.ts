/**
 * How CLI commands reach learner data (PLAN §17, one writer): if a server answers on the session
 * recorded in ~/.learncroc/.session, commands go through its API (authenticated with the session
 * cookie); otherwise the CLI takes ~/.learncroc/.lock and works on the files directly.
 */
import { type RouteKey, splitRoute } from "@learncroc/core";
import { homePaths, readSession, resolveConfig } from "@learncroc/server";
import { acquireLock, LockHeldError } from "@learncroc/server/util/fs";

export interface CliEnv {
  home: string;
  port: number;
  dev: boolean;
}

export function cliEnv(argv: string[]): CliEnv {
  const c = resolveConfig(argv);
  return { home: c.home, port: c.port, dev: c.dev };
}

export class ServerApi {
  constructor(
    readonly base: string,
    private readonly token: string,
    private readonly host: string,
  ) {}

  async request(key: RouteKey, opts: { path?: string; body?: unknown } = {}): Promise<Response> {
    const { method } = splitRoute(key);
    const path = opts.path ?? splitRoute(key).path;
    return fetch(`${this.base}/api${path}`, {
      method,
      headers: {
        cookie: `lm_session=${this.token}`,
        origin: `http://${this.host}`,
        accept: "application/json",
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  }

  async json<T>(key: RouteKey, opts: { path?: string; body?: unknown } = {}): Promise<T> {
    const res = await this.request(key, opts);
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) throw new Error(body.message ?? `${res.status} ${res.statusText}`);
    return body as T;
  }
}

/** A client for the running server, or null when none answers. */
export async function runningServer(home: string): Promise<ServerApi | null> {
  const s = readSession(home);
  if (!s) return null;
  const host = `127.0.0.1:${s.port}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`http://${host}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = (await res.json()) as { home?: string };
    if (body.home !== home) return null;
    return new ServerApi(`http://${host}`, s.token, host);
  } catch {
    return null;
  }
}

/** Run `fn` holding the one-writer lock. */
export async function withLock<T>(home: string, fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  try {
    release = acquireLock(homePaths(home).lock);
  } catch (e) {
    if (e instanceof LockHeldError)
      throw new Error(`another learncroc command is working on ${home} (pid ${e.pid}); try again in a moment`);
    throw e;
  }
  try {
    return await fn();
  } finally {
    release();
  }
}
