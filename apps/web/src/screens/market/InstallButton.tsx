import { buttonClass, cn, KbdHint } from "@learncroc/ui";
import { DownloadSimple } from "@phosphor-icons/react";
import { type InstallState, phaseLabel } from "./useInstall";

/** A progress ring for the install button (shape, not colour alone: the arc grows). */
function Ring({ progress }: { progress: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden className="-rotate-90">
      <circle cx={9} cy={9} r={r} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={2.5} />
      <circle
        cx={9}
        cy={9}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={`${Math.max(0.04, progress) * c} ${c}`}
        className="transition-[stroke-dasharray] duration-base"
      />
    </svg>
  );
}

export interface InstallButtonProps {
  state: InstallState;
  onInstall: () => void;
  label?: string;
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
  kbd?: string;
  className?: string;
}

/** "Install" → a ring filling with the real progress → (the caller swaps in "Open map"). */
export function InstallButton({
  state,
  onInstall,
  label = "Install",
  variant = "secondary",
  size = "md",
  kbd,
  className,
}: InstallButtonProps) {
  const busy = state.phase !== "idle" && state.phase !== "error" && state.phase !== "done";
  return (
    <button
      type="button"
      onClick={onInstall}
      aria-disabled={busy || undefined}
      aria-keyshortcuts={kbd}
      className={cn(buttonClass({ variant, size }), "relative z-10 tabular", className)}
    >
      {busy ? <Ring progress={state.progress} /> : <DownloadSimple size={16} aria-hidden />}
      <span aria-live="polite">{busy ? phaseLabel(state) : label}</span>
      {kbd && !busy ? <KbdHint keyLabel={kbd} inverted={variant === "primary"} /> : null}
    </button>
  );
}
