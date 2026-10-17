/**
 * Live updates while an article map is still being written (pack `provisional`, or cards `building`):
 * building cards turn Ready on the open map and the "Writing card 4 of 8" bar moves on.
 *
 * When the create job's id is known (the create flow records it as `lm:job-for:<packId>` in
 * sessionStorage) the map follows the job's event stream and refreshes the pack and progress on
 * `layout`, `card-ready`, `plan-update` and `done`. A slow poll covers a fresh tab, a server restart
 * or a job that has already finished.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../../api/client";
import { qk } from "../../app/queries";

const POLL_MS = 3_000;
const REFRESH_ON = new Set(["layout", "card-ready", "card-failed", "plan-update", "plan-checkpoint", "done"]);

export const jobKeyFor = (packId: string) => `lm:job-for:${packId}`;

function jobIdFor(packId: string): string | undefined {
  try {
    return sessionStorage.getItem(jobKeyFor(packId)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function useLiveBuild(packId: string, building: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!building) return;
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: qk.pack(packId) });
      void qc.invalidateQueries({ queryKey: qk.progress(packId) });
    };
    const poll = setInterval(refresh, POLL_MS);
    const jobId = jobIdFor(packId);
    const ctl = new AbortController();
    if (jobId) {
      void (async () => {
        try {
          for await (const e of api.jobEvents({ jobId }, { signal: ctl.signal })) {
            if (REFRESH_ON.has(e.type)) refresh();
            if (e.type === "done" || e.type === "error") break;
          }
        } catch {
          /* the poll carries on */
        }
      })();
    }
    return () => {
      clearInterval(poll);
      ctl.abort();
    };
  }, [building, packId, qc]);
}
