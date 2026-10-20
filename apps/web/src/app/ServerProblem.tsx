/**
 * The calm "server isn't answering / hit a problem" panel, shared by the data screens.
 * Never an error page: what happened, the one command that fixes it, and Try again.
 */
import { Button } from "@learncroc/ui";
import { ArrowClockwise } from "@phosphor-icons/react";
import { DOCTOR_COMMAND, INSTALL_COMMAND } from "./demo";
import { errorText, isServerError } from "./errors";

export function ServerProblem({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const answered = isServerError(error);
  return (
    <section
      role="alert"
      className={`grid max-w-xl gap-4 rounded-md border border-line bg-surface p-6 shadow-1 ${className ?? ""}`}
    >
      <h2 className="text-heading">{answered ? "The Learncroc server hit a problem" : "Learncroc isn't answering"}</h2>
      {answered ? (
        <p className="text-body text-ink-2">
          The Learncroc server hit a problem ({errorText(error)}). Try again; if it repeats,{" "}
          <code className="voice-mono text-code">{DOCTOR_COMMAND}</code> checks the data folder.
        </p>
      ) : (
        <p className="text-body text-ink-2">
          If you closed the terminal that runs it, start it again with{" "}
          <code className="voice-mono text-code">{INSTALL_COMMAND}</code>.
        </p>
      )}
      {onRetry ? (
        <div>
          <Button icon={<ArrowClockwise size={16} />} onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </section>
  );
}
