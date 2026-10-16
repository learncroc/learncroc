/** The static demo's thin banner (03 §5): progress lives in this browser; article maps and chat need the full app. */
import { ArrowSquareOut } from "@phosphor-icons/react";
import { INSTALL_COMMAND, INSTALL_URL } from "./demo";

export function DemoBanner() {
  return (
    <aside
      aria-label="Demo"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-surface-sunk px-4 py-1.5 text-small text-ink-2"
    >
      <span>
        This is the in-browser demo. Progress stays in this browser. Article maps and Moss's chat need the full app:{" "}
        <code className="voice-mono text-code text-ink">{INSTALL_COMMAND}</code>
      </span>
      <a
        href={INSTALL_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-semibold text-ink underline decoration-1 underline-offset-2"
      >
        How to install
        <ArrowSquareOut size={14} aria-hidden />
      </a>
    </aside>
  );
}
