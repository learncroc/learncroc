/**
 * The `⋯` menu every learning screen carries, with "Report this screen": a prefilled
 * GitHub issue naming the map, version, card, beat and app version. No learner data is sent.
 */
import { LEARNCROC_VERSION } from "@learncroc/core";
import { Menu, MenuItem } from "@learncroc/ui";
import { Flag, Keyboard } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { REPO_URL } from "./demo";
import { useShell } from "./store";

export interface ScreenContext {
  packId?: string;
  packVersion?: string;
  nodeId?: string;
  screenId?: string;
  /** Screen name, e.g. "Card", "Relight". */
  screen: string;
}

/** The prefilled "new issue" URL for a screen report. Only ids and versions, never answers or text. */
export function reportScreenUrl(ctx: ScreenContext, appVersion = LEARNCROC_VERSION): string {
  const where = [ctx.packId, ctx.nodeId, ctx.screenId].filter(Boolean).join(" / ") || ctx.screen;
  const rows: [string, string | undefined][] = [
    ["Screen", ctx.screen],
    ["Map", ctx.packId ? `${ctx.packId}${ctx.packVersion ? `@${ctx.packVersion}` : ""}` : undefined],
    ["Card (node)", ctx.nodeId],
    ["Beat (screen id)", ctx.screenId],
    ["App version", appVersion],
  ];
  const body = [
    "**What's wrong with this screen?**",
    "",
    "<!-- A typo, a wrong answer marked right, something confusing, a broken interaction... -->",
    "",
    "**Where**",
    "",
    ...rows.filter((r): r is [string, string] => Boolean(r[1])).map(([k, v]) => `- ${k}: \`${v}\``),
    "",
    "_No learner data is included in this report._",
  ].join("\n");
  const q = new URLSearchParams({ title: `Screen report: ${where}`, labels: "screen-report", body });
  return `${REPO_URL}/issues/new?${q.toString()}`;
}

export interface ScreenMenuProps {
  context: ScreenContext;
  /** Extra items above the defaults. */
  children?: ReactNode;
  className?: string;
}

export function ScreenMenu({ context, children, className }: ScreenMenuProps) {
  const openLayer = useShell((s) => s.open);
  return (
    <Menu label="More" triggerClassName={className}>
      {children}
      <MenuItem icon={<Keyboard size={16} />} hint="?" onSelect={() => openLayer("shortcuts")}>
        Keyboard shortcuts
      </MenuItem>
      <MenuItem
        icon={<Flag size={16} />}
        onSelect={() => window.open(reportScreenUrl(context), "_blank", "noopener,noreferrer")}
      >
        Report this screen
      </MenuItem>
    </Menu>
  );
}
