/**
 * Loading and error states shared by run-like screens. Local content renders on the first frame, so
 * the loading state is a quiet line, never a skeleton shimmer.
 */
import type { CompiledPack } from "@learncroc/core";
import { Button } from "@learncroc/ui";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { usePackQuery } from "./queries";
import { errorText } from "./useRunSession";

export function RunLoading({ label = "Opening…" }: { label?: string }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center text-small text-ink-3" role="status" data-run-loading>
      {label}
    </div>
  );
}

export function RunProblem({
  title,
  body,
  packId,
  action,
}: {
  title: string;
  body: string;
  packId?: string;
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-start justify-center gap-3 px-6" role="alert">
      <h1 className="t-title">{title}</h1>
      <p className="text-body text-ink-2">{body}</p>
      {action ?? (
        <Button
          onClick={() => void navigate(packId ? { to: "/p/$pack", params: { pack: packId } } : { to: "/library" })}
        >
          {packId ? "Back to the map" : "Back to the library"}
        </Button>
      )}
    </div>
  );
}

export function PackGate({ packId, children }: { packId: string; children: (pack: CompiledPack) => ReactNode }) {
  const q = usePackQuery(packId);
  if (q.isError) return <RunProblem title="This pack didn't load" body={errorText(q.error)} />;
  if (!q.data) return <RunLoading />;
  return <>{children(q.data)}</>;
}
