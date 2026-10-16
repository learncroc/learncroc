import type { ReactNode } from "react";

export interface ScreenHeaderProps {
  title: string;
  /** One line under the title. */
  lead?: ReactNode;
  /** Right side: search, filters, the screen's ⋯ menu. */
  actions?: ReactNode;
}

/** Each screen owns its header (there is no top bar). Title at --t-title, sentence case. */
export function ScreenHeader({ title, lead, actions }: ScreenHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pt-10 pb-8">
      <div className="min-w-0">
        <h1 className="t-title text-ink">{title}</h1>
        {lead ? <p className="mt-2 max-w-[60ch] text-body text-ink-2">{lead}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** The content column: 12-column grid width at 1440 (32 px margins), centred on wider screens. */
export function Page({
  children,
  className,
  "aria-busy": busy,
}: {
  children?: ReactNode;
  className?: string;
  "aria-busy"?: "true";
}) {
  return (
    <main aria-busy={busy} className={`mx-auto w-full max-w-[1376px] px-8 pb-16 ${className ?? ""}`}>
      {children}
    </main>
  );
}
