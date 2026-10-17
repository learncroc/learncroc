/**
 * Test harness for Moss, the AI settings and the Create screens: a fetch double keyed by "METHOD /path" and a
 * renderer with a query client and a small memory router (so links resolve). Tests only.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

export type Reply = unknown | Response | ((req: { url: URL; body: unknown }) => unknown | Response);

export function sse<E extends { type: string }>(events: readonly E[]): Response {
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

export function mockFetch(routes: Record<string, Reply>) {
  const original = globalThis.fetch;
  const calls: { key: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://localhost:5173",
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const key = `${method} ${url.pathname}`;
    calls.push({ key, body });
    const hit = Object.entries(routes).find(([k]) => (k.endsWith("*") ? key.startsWith(k.slice(0, -1)) : k === key));
    if (!hit)
      return new Response(JSON.stringify({ error: "not_found", message: `no mock for ${key}` }), { status: 404 });
    let reply = hit[1];
    if (typeof reply === "function") reply = (reply as (r: { url: URL; body: unknown }) => unknown)({ url, body });
    if (reply instanceof Response) return reply;
    return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

export function renderWith(ui: ReactNode, path = "/") {
  const root = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
  });
  const leaf = (p: string) => createRoute({ getParentRoute: () => root, path: p, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([
      leaf("/"),
      leaf("/settings/$section"),
      leaf("/create"),
      leaf("/create/pocket"),
      leaf("/create/pocket/$job"),
      leaf("/p/$pack"),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
