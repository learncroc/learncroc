/**
 * The focus-mode frame shared by every run-like screen: a slim header (back with Esc, the title,
 * progress beads, the ⋯ menu with "Report this screen"), skip links, the world tint and the
 * "leave?" confirmation. No rail, no top bar beyond this.
 */
import { LEARNCROC_VERSION, type PackTheme } from "@learncroc/core";
import { Button, cn, Dialog, Kbd, Menu, MenuItem, ProgressBeads } from "@learncroc/ui";
import { ArrowLeft, Flag } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { useKeys } from "./keys";
import { useReducedMotion } from "./prefs";
import { worldTint, worldVars } from "./world";

const REPO_URL = "https://github.com/learncroc/learncroc";

export interface ReportContext {
  screen: string;
  packId?: string;
  packVersion?: string;
  nodeId?: string;
  screenId?: string;
}

/** A prefilled "new issue" URL naming only ids and versions, never answers or learner text. */
export function reportUrl(ctx: ReportContext): string {
  const where = [ctx.packId, ctx.nodeId, ctx.screenId].filter(Boolean).join(" / ") || ctx.screen;
  const rows: [string, string | undefined][] = [
    ["Screen", ctx.screen],
    ["Pack", ctx.packId ? `${ctx.packId}${ctx.packVersion ? `@${ctx.packVersion}` : ""}` : undefined],
    ["Card (node)", ctx.nodeId],
    ["Screen id", ctx.screenId],
    ["App version", LEARNCROC_VERSION],
  ];
  const body = [
    "**What's wrong with this screen?**",
    "",
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

export interface RunFrameProps {
  theme?: PackTheme;
  /** The session name. */
  title: string;
  /** Small line next to the title ("Relight · 3 of 8"). */
  subtitle?: ReactNode;
  backLabel: string;
  onBack: () => void;
  /** Ask before leaving (Esc and the back button). */
  confirmLeave?: { title: string; body: string };
  beads?: { labels: string[]; current: number };
  /** Right side of the header, before the ⋯ menu. */
  actions?: ReactNode;
  report: ReportContext;
  /** Footer row. */
  footer?: ReactNode;
  /** Tint the page with the world ground. */
  tinted?: boolean;
  /** Esc and the leave dialog are off (an overlay owns Esc). */
  escDisabled?: boolean;
  /** Embedded (marketplace try-run): no page chrome. */
  embedded?: boolean;
  children: ReactNode;
}

export function RunFrame(p: RunFrameProps) {
  const [confirming, setConfirming] = useState(false);
  const reducedMotion = useReducedMotion();
  const leave = () => {
    if (p.confirmLeave) setConfirming(true);
    else p.onBack();
  };
  useKeys(
    (e) => {
      if (e.key !== "Escape" || confirming) return false;
      leave();
      return true;
    },
    { enabled: !p.escDisabled && !confirming, inFields: true },
  );
  const style = p.theme ? { ...worldVars(p.theme), ...(p.tinted ? worldTint(p.theme, 9) : {}) } : undefined;

  return (
    <div
      className={cn("flex flex-col bg-bg text-ink", p.embedded ? "min-h-[640px] rounded-stage" : "min-h-dvh")}
      style={style}
      data-run-frame
      data-motion={reducedMotion ? "reduced" : "full"}
    >
      <a
        href="#run-canvas"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to canvas
      </a>
      <a
        href="#run-question"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-32 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to question
      </a>
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line/70 px-6">
        <button
          type="button"
          onClick={leave}
          className="inline-flex items-center gap-2 rounded-sm px-2 py-1 text-small text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft size={16} aria-hidden />
          {p.backLabel}
          {!p.escDisabled ? <Kbd keys="Esc" className="ml-1" /> : null}
        </button>
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="truncate text-body font-semibold text-ink">{p.title}</h1>
          {p.subtitle ? <span className="truncate text-small text-ink-3">{p.subtitle}</span> : null}
        </div>
        {p.beads && p.beads.labels.length > 0 ? (
          <div className="mx-auto">
            <ProgressBeads
              total={p.beads.labels.length}
              done={p.beads.current}
              current={p.beads.current}
              label={`${p.beads.labels[p.beads.current] ?? ""}, step ${Math.min(p.beads.current + 1, p.beads.labels.length)} of ${p.beads.labels.length}`}
            />
          </div>
        ) : (
          <div className="mx-auto" />
        )}
        <div className="flex items-center gap-2">
          {p.actions}
          <Menu label="More">
            <MenuItem
              icon={<Flag size={16} />}
              onSelect={() => window.open(reportUrl(p.report), "_blank", "noopener,noreferrer")}
            >
              Report this screen
            </MenuItem>
          </Menu>
        </div>
      </header>
      <main className="flex flex-1 flex-col px-6 py-6 min-[1100px]:px-8">{p.children}</main>
      {p.footer ? (
        <footer className="flex h-12 shrink-0 items-center gap-4 border-t border-line/70 px-6 text-small text-ink-2">
          {p.footer}
        </footer>
      ) : null}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={p.confirmLeave?.title ?? "Leave?"}
        description={p.confirmLeave?.body}
        actions={
          <>
            <Button
              onClick={() => {
                setConfirming(false);
                p.onBack();
              }}
            >
              Leave
            </Button>
            <Button variant="primary" onClick={() => setConfirming(false)} autoFocus>
              Stay
            </Button>
          </>
        }
      />
    </div>
  );
}
