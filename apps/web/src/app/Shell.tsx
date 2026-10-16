/**
 * App shell: a 64 px left rail and no top bar; the rail hides in focus mode (Relight only; cards and
 * checkpoints play in modals over the map). Mounts the global keys, the command palette, the
 * shortcut sheet, toasts, the demo banner, appearance settings and the sound engine.
 */
import { buttonClass, Toaster } from "@learncroc/ui";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { FOCUS_ROUTE_RE } from "../router";
import { useAppearance } from "./appearance";
import { CommandPalette } from "./CommandPalette";
import { DemoBanner } from "./DemoBanner";
import { isDemo } from "./demo";
import { useGlobalKeys } from "./keys";
import { usePacks, useSettings } from "./queries";
import { Rail } from "./Rail";
import { ShortcutSheet } from "./ShortcutSheet";
import { SoundProvider } from "./sound";

/** The most recently opened pack, for "Current map" (G M). */
function useCurrentMap(): { href: string; title: string } | null {
  const { data: packs } = usePacks();
  return useMemo(() => {
    const recent = (packs ?? [])
      .filter((p) => p.lastOpenedAt !== undefined && p.status !== "invalid")
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
    return recent ? { href: `/p/${recent.id}`, title: recent.title } : null;
  }, [packs]);
}

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const focus = FOCUS_ROUTE_RE.test(pathname);
  const { data: settings } = useSettings();
  useAppearance(settings?.appearance);
  const currentMap = useCurrentMap();
  useGlobalKeys({ focus, currentMapHref: currentMap?.href ?? null });
  // The card modal centres right of the rail; with the rail hidden (focus mode) it centres on the page.
  useEffect(() => {
    const root = document.documentElement;
    if (focus) root.style.setProperty("--modal-inset-left", "0px");
    else root.style.removeProperty("--modal-inset-left");
  }, [focus]);

  return (
    <SoundProvider>
      <a
        href="#main"
        className="sr-only z-[70] rounded-sm bg-ink px-3 py-2 text-bg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {isDemo() ? <DemoBanner /> : null}
      <div className="flex min-h-dvh bg-bg text-ink" data-focus-mode={focus || undefined}>
        {focus ? null : <Rail currentMap={currentMap} />}
        <div id="main" className="min-w-0 flex-1" tabIndex={-1}>
          <Outlet />
        </div>
      </div>
      <CommandPalette currentMapHref={currentMap?.href ?? null} />
      <ShortcutSheet />
      <Toaster />
    </SoundProvider>
  );
}

export function NotFound() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <main data-screen="Not found" className="mx-auto grid min-h-[70dvh] max-w-xl place-content-center gap-4 p-8">
      <h1 className="t-title">Not found</h1>
      <p className="text-lead text-ink-2">
        There's no screen at <code className="voice-mono text-code">{pathname}</code>. The link may be from an older
        version, or a map that was removed.
      </p>
      <div className="flex gap-2">
        <Link to="/library" className={buttonClass({ variant: "primary" })}>
          Go to the Library
        </Link>
      </div>
    </main>
  );
}
