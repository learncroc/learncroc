/**
 * Query hooks over the player's API seam. Keys match api/hooks.ts so the cache is shared with the
 * rest of the app (the map refetches progress after a claim, for example).
 */
import type { CompiledPack } from "@learncroc/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "../api/hooks";
import { useRunApi } from "./api";

export const runQueryKeys = {
  ...queryKeys,
  aiStatus: ["ai", "status"] as const,
};

/**
 * The server-reduced RunState of one run. The player keeps every response here, and Moss invalidates it
 * after a hint-mode ask (`sent.hintLevel`), so the checkpoint's hint control and Moss share one counter.
 */
export const runQueryKey = (runId: string) => ["run", runId] as const;

export function usePackQuery(packId: string | undefined, initial?: CompiledPack) {
  const client = useRunApi();
  return useQuery({
    queryKey: runQueryKeys.pack(packId ?? ""),
    queryFn: () => client.getPack({ id: packId ?? "" }),
    enabled: Boolean(packId) && !initial,
    staleTime: Number.POSITIVE_INFINITY,
    ...(initial ? { initialData: initial } : {}),
  });
}

export function useProgressQuery(packId: string | undefined, enabled = true) {
  const client = useRunApi();
  return useQuery({
    queryKey: runQueryKeys.progress(packId ?? ""),
    queryFn: () => client.getPackProgress({ packId: packId ?? "" }),
    enabled: Boolean(packId) && enabled,
  });
}

export function useSettingsQuery() {
  const client = useRunApi();
  return useQuery({ queryKey: runQueryKeys.settings, queryFn: () => client.getSettings(), staleTime: 30_000 });
}

/** Is an AI provider configured? Defaults to false (the offline path) while loading or on error. */
export function useAiConfigured(): boolean {
  const client = useRunApi();
  const q = useQuery({
    queryKey: runQueryKeys.aiStatus,
    queryFn: () => client.getAiStatus(),
    staleTime: 30_000,
    retry: false,
  });
  return Boolean(q.data?.configured && !q.data.capReached);
}

/** Invalidate learner state after a run changes it (progress, library counts). */
export function useInvalidateProgress() {
  const qc = useQueryClient();
  return useCallback(
    (packId?: string) => {
      void qc.invalidateQueries({ queryKey: packId ? runQueryKeys.progress(packId) : ["progress"] });
      void qc.invalidateQueries({ queryKey: runQueryKeys.packs });
    },
    [qc],
  );
}
