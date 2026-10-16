/**
 * "/" (C17): the map opened in the last 14 days, else /library. There is no /welcome: first run is the
 * library's first-run variant. `firstRun.completed` turns true at the learner's first card close.
 */
import type { InstalledPackSummary } from "@learncroc/core";
import { Navigate } from "@tanstack/react-router";
import { usePacks, useProgressAll, useSettings } from "./queries";

const DAY = 86_400_000;

/** Where "/" goes: before the first card close → /library; else the last map opened in 14 days; else /library. */
export function homeTarget(input: {
  firstRunCompleted: boolean;
  packs: Pick<InstalledPackSummary, "id" | "lastOpenedAt" | "status">[];
  now: number;
}): string {
  if (!input.firstRunCompleted) return "/library";
  const recent = input.packs
    .filter((p) => p.status !== "invalid" && p.lastOpenedAt !== undefined && input.now - p.lastOpenedAt <= 14 * DAY)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
  return recent ? `/p/${recent.id}` : "/library";
}

export function HomeRedirect() {
  const settings = useSettings();
  const packs = usePacks();
  const progress = useProgressAll();
  if (settings.isError || packs.isError || progress.isError) return <Navigate to="/library" replace />;
  if (!settings.data || !packs.data || !progress.data) {
    return (
      <main aria-busy="true" className="min-h-dvh">
        <h1 className="sr-only">Opening Learncroc</h1>
      </main>
    );
  }
  const to = homeTarget({
    firstRunCompleted: settings.data.firstRun.completed,
    packs: packs.data,
    now: progress.data.now,
  });
  return <Navigate to={to} replace />;
}
