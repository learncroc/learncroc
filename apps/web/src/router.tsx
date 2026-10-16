/**
 * Every route (04 §4.1, 03 §2), code-defined. Each screen lives in screens/<area>/ and is lazy-loaded
 * (widgets and KaTeX stay out of the first chunk). The card and checkpoint play inside the map
 * (`/p/$pack?card=` / `?checkpoint=`); `/relight` is the only focus route. Frozen after wave 0.
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouterHistory,
  redirect,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { HomeRedirect } from "./app/HomeRedirect";
import { AppShell, NotFound } from "./app/Shell";
import { validateMapSearch } from "./screens/map/search";

export type { MapSearch } from "./screens/map/search";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: NotFound });

const route = <P extends string>(path: P, load: () => Promise<Record<string, unknown>>, exportName: string) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: lazyRouteComponent(load as () => Promise<Record<string, () => ReactNode>>, exportName),
  });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomeRedirect });
const libraryRoute = route("/library", () => import("./screens/library/index"), "LibraryScreen");
const packMapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$pack",
  validateSearch: validateMapSearch,
  component: lazyRouteComponent(() => import("./screens/map/index"), "PackMapScreen"),
});
const relightRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/relight",
  validateSearch: (s: Record<string, unknown>): { pack?: string } => {
    const pack = str(s.pack);
    return pack ? { pack } : {};
  },
  component: lazyRouteComponent(() => import("./screens/relight/index"), "RelightScreen"),
});
const flashcardsRoute = route("/flashcards", () => import("./screens/flashcards/index"), "FlashcardsScreen");
const cardsRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cards",
  beforeLoad: () => {
    throw redirect({ to: "/flashcards", replace: true });
  },
});
const marketRoute = route("/market", () => import("./screens/market/index"), "MarketScreen");
const marketPackRoute = route("/market/$pack", () => import("./screens/market/index"), "MarketPackScreen");
const createHubRoute = route("/create", () => import("./screens/create/index"), "CreateScreen");
const pocketIntakeRoute = route("/create/pocket", () => import("./screens/create/index"), "PocketIntakeScreen");
const pocketJobRoute = route("/create/pocket/$job", () => import("./screens/create/index"), "PocketJobScreen");
const logbookRoute = route("/logbook", () => import("./screens/logbook/index"), "LogbookScreen");
const settingsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  beforeLoad: () => {
    throw redirect({ to: "/settings/$section", params: { section: "ai" } });
  },
});
const settingsRoute = route("/settings/$section", () => import("./screens/settings/index"), "SettingsScreen");
const devWidgetsRoute = route("/dev/widgets", () => import("./screens/dev-widgets/index"), "DevWidgetsScreen");
const devMapsRoute = route("/dev/maps", () => import("./screens/dev-maps/index"), "DevMapsScreen");

export const routeTree = rootRoute.addChildren([
  indexRoute,
  libraryRoute,
  packMapRoute,
  relightRoute,
  flashcardsRoute,
  cardsRedirectRoute,
  marketRoute,
  marketPackRoute,
  createHubRoute,
  pocketIntakeRoute,
  pocketJobRoute,
  logbookRoute,
  settingsIndexRoute,
  settingsRoute,
  devWidgetsRoute,
  devMapsRoute,
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, defaultPreload: "intent", ...(history ? { history } : {}) });
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

/** Routes where the rail hides (focus mode): Relight only. */
export const FOCUS_ROUTE_RE = /^\/relight(?:\/|$)/;
