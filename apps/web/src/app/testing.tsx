/**
 * Test helpers for screens: a fetch double that answers API routes (fixtures by default, overridable
 * per route) and a renderer that mounts the real router at a path. Used by *.test.tsx files only.
 */
import { API_ROUTES, type RouteKey, splitRoute } from "@learncroc/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { mockResponse } from "../api/mock";
import { createAppRouter } from "../router";

export interface ApiCall {
  key: RouteKey;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

/** A handler returns a JSON value, a Response (status, SSE, text), or throws for a 500. */
export type Handler = (call: ApiCall) => unknown;

const ROUTES = API_ROUTES.map((key) => {
  const { method, path } = splitRoute(key);
  const names: string[] = [];
  const re = new RegExp(
    `^/api${path
      .replace(/[.]/g, "\\.")
      .replace(/:([A-Za-z]+)/g, (_, n: string) => {
        names.push(n);
        return "([^/]+)";
      })
      .replace(/\*$/, () => {
        names.push("*");
        return "(.+)";
      })}$`,
  );
  return { key, method, re, names };
});

export function matchRoute(method: string, pathname: string): { key: RouteKey; params: Record<string, string> } | null {
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.names.forEach((n, i) => {
      params[n] = decodeURIComponent(m[i + 1] ?? "");
    });
    return { key: r.key, params };
  }
  return null;
}

/** An SSE response body from a list of events. */
export function sseResponse<E extends { type: string }>(events: E[]): Response {
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

export interface MockApi {
  calls: ApiCall[];
  restore(): void;
}

/** Replace global fetch with a route-aware double. Unhandled GETs fall back to the fixture mock; others 501. */
export function mockApi(handlers: Partial<Record<RouteKey, Handler>> = {}): MockApi {
  const original = globalThis.fetch;
  const calls: ApiCall[] = [];
  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://localhost:5173",
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const hit = matchRoute(method, url.pathname);
    if (!hit) return new Response(JSON.stringify({ error: "not_found", message: "no route" }), { status: 404 });
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call: ApiCall = { key: hit.key, params: hit.params, query: url.searchParams, body };
    calls.push(call);
    const handler = handlers[hit.key];
    try {
      const value = handler ? await handler(call) : method === "GET" ? mockResponse(hit.key, hit.params) : undefined;
      if (value instanceof Response) return value;
      if (value === undefined && !handler)
        return new Response(JSON.stringify({ error: "not_implemented", message: `${hit.key} not mocked` }), {
          status: 501,
        });
      return new Response(JSON.stringify(value ?? { ok: true }), { headers: { "content-type": "application/json" } });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      const message = err instanceof Error ? err.message : "error";
      return new Response(JSON.stringify({ error: status === 404 ? "not_found" : "invalid", message }), { status });
    }
  };
  globalThis.fetch = fake as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Mount the whole app (shell + router) at a path. */
export function renderApp(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, client };
}
