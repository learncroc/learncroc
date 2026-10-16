/**
 * Query hooks for the shell and the library-side screens, over the typed API client. Keys match the
 * starter hooks in api/hooks.ts so caches are shared ("packs", ["packs", id], ["progress", id], "settings").
 */
import type { PackId, Settings, SettingsPatch } from "@learncroc/core";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export const qk = {
  health: ["health"] as const,
  packs: ["packs"] as const,
  pack: (id: string) => ["packs", id] as const,
  progressAll: ["progress"] as const,
  progress: (packId: string) => ["progress", packId] as const,
  settings: ["settings"] as const,
  registry: ["registry"] as const,
  tryBundle: (id: string, registry?: string) => ["registry", id, "try", registry ?? ""] as const,
  cards: (packId?: string) => ["cards", packId ?? "*"] as const,
  cardsDue: ["cards", "due"] as const,
  logbook: (packId?: string) => ["logbook", packId ?? "*"] as const,
  aiStatus: ["ai", "status"] as const,
  search: (q: string) => ["search", q] as const,
  numbers: ["numbers"] as const,
  run: (runId: string) => ["runs", runId] as const,
};

/** Shell queries refresh quietly; library data is local and fast. */
const QUIET = { refetchOnWindowFocus: false } as const;

export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: () => api.health(), ...QUIET });
export const usePacks = () => useQuery({ queryKey: qk.packs, queryFn: () => api.listPacks(), ...QUIET });
export const useProgressAll = () => useQuery({ queryKey: qk.progressAll, queryFn: () => api.getProgress(), ...QUIET });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: () => api.getSettings(), ...QUIET });
export const useAiStatus = () => useQuery({ queryKey: qk.aiStatus, queryFn: () => api.getAiStatus(), ...QUIET });
export const useRegistry = () =>
  useQuery({ queryKey: qk.registry, queryFn: () => api.getRegistry(), ...QUIET, staleTime: 60_000 });
export const useLogbook = (packId?: PackId) =>
  useQuery({
    queryKey: qk.logbook(packId),
    queryFn: () => api.getLogbook(packId ? { packId } : {}),
    placeholderData: keepPreviousData,
    ...QUIET,
  });
export const useCards = (packId?: PackId) =>
  useQuery({
    queryKey: qk.cards(packId),
    queryFn: () => api.listCards(packId ? { packId } : {}),
    placeholderData: keepPreviousData,
    ...QUIET,
  });
/** Settings → Data → Your numbers (computed on this machine; nothing is sent). */
export const useNumbers = (enabled = true) =>
  useQuery({ queryKey: qk.numbers, queryFn: () => api.numbers(), enabled, retry: false, ...QUIET });
export const useCardsDue = () => useQuery({ queryKey: qk.cardsDue, queryFn: () => api.listDueCards(), ...QUIET });

/** The compiled pack and its progress for each id (posters need both). */
export function usePackPosters(ids: PackId[]) {
  const packs = useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.pack(id),
      queryFn: () => api.getPack({ id }),
      staleTime: 60_000,
      ...QUIET,
    })),
  });
  const progress = useQueries({
    queries: ids.map((packId) => ({
      queryKey: qk.progress(packId),
      queryFn: () => api.getPackProgress({ packId }),
      ...QUIET,
    })),
  });
  return ids.map((id, i) => ({ id, pack: packs[i]?.data, progress: progress[i]?.data }));
}

/** Deep-merge a settings patch (one level of sections) for optimistic updates. */
export function mergeSettings(s: Settings, patch: SettingsPatch): Settings {
  return {
    ...s,
    ai: { ...s.ai, ...patch.ai },
    learning: { ...s.learning, ...patch.learning },
    appearance: { ...s.appearance, ...patch.appearance },
    sound: { ...s.sound, ...patch.sound },
    croc: { ...s.croc, ...patch.croc },
    experiments: { ...s.experiments, ...patch.experiments },
    ...(patch.registries ? { registries: patch.registries } : {}),
  };
}

/** PATCH /settings with an optimistic cache update; rolls back if the server refuses. */
export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patchSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.settings });
      const before = qc.getQueryData<Settings>(qk.settings);
      if (before) qc.setQueryData(qk.settings, mergeSettings(before, patch));
      return { before };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.before) qc.setQueryData(qk.settings, ctx.before);
    },
    onSuccess: (settings) => {
      qc.setQueryData(qk.settings, settings);
    },
  });
}
