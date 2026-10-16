/**
 * TanStack Query hooks over the typed client, one per GET route plus the common mutations with
 * the cache invalidations they imply. Keys are shared app-wide (the shell and the player use the
 * same ones), so closing a card refreshes the map, the library, the logbook, the numbers and the
 * settings (the first card close marks `firstRun` completed).
 */
import type { InstallEvent, PackId, RouteBody, RouteQuery, SearchHit } from "@learncroc/core";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api } from "./client";

export const queryKeys = {
  health: ["health"] as const,
  packs: ["packs"] as const,
  pack: (id: string, version?: string) => (version ? (["packs", id, version] as const) : (["packs", id] as const)),
  progressAll: ["progress"] as const,
  progress: (packId: string) => ["progress", packId] as const,
  logbook: (packId?: string) => ["logbook", packId ?? "*"] as const,
  notes: (packId?: string) => ["notes", packId ?? "*"] as const,
  numbers: ["numbers"] as const,
  settings: ["settings"] as const,
  registry: ["registry"] as const,
  tryBundle: (id: string, registry?: string) => ["registry", id, "try", registry ?? ""] as const,
  cards: (packId?: string, kind?: string) =>
    kind ? (["cards", packId ?? "*", kind] as const) : (["cards", packId ?? "*"] as const),
  cardsDue: ["cards", "due"] as const,
  run: (runId: string) => ["runs", runId] as const,
  search: (q: string) => ["search", q] as const,
  aiStatus: ["ai", "status"] as const,
};

/** Everything that changes when learner state changes (after a run, a review, an import…). */
export function invalidateLearnerState(qc: QueryClient, packId?: string): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: packId ? queryKeys.progress(packId) : queryKeys.progressAll }),
    qc.invalidateQueries({ queryKey: queryKeys.progressAll, exact: true }),
    qc.invalidateQueries({ queryKey: queryKeys.packs, exact: true }),
    qc.invalidateQueries({ queryKey: ["logbook"] }),
    qc.invalidateQueries({ queryKey: ["notes"] }),
    qc.invalidateQueries({ queryKey: ["cards"] }),
    qc.invalidateQueries({ queryKey: queryKeys.numbers }),
    qc.invalidateQueries({ queryKey: queryKeys.settings }),
  ]).then(() => undefined);
}

// ── queries

export const useHealth = () => useQuery({ queryKey: queryKeys.health, queryFn: () => api.health() });
export const usePacks = () => useQuery({ queryKey: queryKeys.packs, queryFn: () => api.listPacks() });
export const usePack = (id: string, version?: string) =>
  useQuery({
    queryKey: queryKeys.pack(id, version),
    queryFn: () => api.getPack({ id }, version ? { version } : undefined),
    staleTime: 60_000,
  });
export const useProgress = () => useQuery({ queryKey: queryKeys.progressAll, queryFn: () => api.getProgress() });
export const usePackProgress = (packId: string) =>
  useQuery({ queryKey: queryKeys.progress(packId), queryFn: () => api.getPackProgress({ packId }) });
export const useLogbook = (packId?: PackId) =>
  useQuery({ queryKey: queryKeys.logbook(packId), queryFn: () => api.getLogbook(packId ? { packId } : {}) });
export const useNotes = (packId?: PackId) =>
  useQuery({ queryKey: queryKeys.notes(packId), queryFn: () => api.getNotes(packId ? { packId } : {}) });
/** GET /numbers (Settings → Data → Your numbers). */
export const useNumbers = () => useQuery({ queryKey: queryKeys.numbers, queryFn: () => api.numbers() });
export const useSettings = () => useQuery({ queryKey: queryKeys.settings, queryFn: () => api.getSettings() });
export const useRegistry = () =>
  useQuery({ queryKey: queryKeys.registry, queryFn: () => api.getRegistry(), staleTime: 60_000 });
export const useTryBundle = (id: string, registry?: string) =>
  useQuery({
    queryKey: queryKeys.tryBundle(id, registry),
    queryFn: () => api.getTryBundle({ id }, registry ? { registry } : undefined),
    staleTime: 5 * 60_000,
  });
export const useCards = (query: RouteQuery<"GET /cards"> = {}) =>
  useQuery({ queryKey: queryKeys.cards(query.packId, query.kind), queryFn: () => api.listCards(query) });
export const useCardsDue = () => useQuery({ queryKey: queryKeys.cardsDue, queryFn: () => api.listDueCards() });
export const useRun = (runId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.run(runId ?? ""),
    queryFn: () => api.getRun({ runId: runId as string }),
    enabled: !!runId,
  });
export const useSearch = (q: string) =>
  useQuery<SearchHit[]>({
    queryKey: queryKeys.search(q),
    queryFn: ({ signal }) => api.search({ q }, { signal }),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  });

// ── mutations

export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: RouteBody<"PATCH /settings">) => api.patchSettings(patch),
    onSuccess: (settings) => qc.setQueryData(queryKeys.settings, settings),
  });
}

export function useSetAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RouteBody<"PUT /settings/ai-key">) => api.setAiKey(body),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.settings }),
        qc.invalidateQueries({ queryKey: ["ai"] }),
        qc.invalidateQueries({ queryKey: queryKeys.health }),
      ]),
  });
}

export function useClearAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearAiKey(),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: queryKeys.settings }), qc.invalidateQueries({ queryKey: ["ai"] })]),
  });
}

export function useMarkPackOpened() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: PackId) => api.markPackOpened({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.packs, exact: true }),
  });
}

export function useRemovePack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: PackId; version?: string }) =>
      api.removePack({ id: a.id }, a.version ? { version: a.version } : undefined),
    onSuccess: (_r, a) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.packs }),
        qc.invalidateQueries({ queryKey: queryKeys.registry }),
        invalidateLearnerState(qc, a.id),
      ]),
  });
}

export function useResetPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (packId: PackId) => api.resetPack({ packId }, { confirm: packId }),
    onSuccess: (_r, packId) => invalidateLearnerState(qc, packId),
  });
}

export function useImportData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: RouteBody<"POST /import">) => api.importData(file),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useCreateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RouteBody<"POST /cards">) => api.createCard(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}

export function useUpdateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: string; patch: RouteBody<"PATCH /cards/:id"> }) => api.updateCard({ id: a.id }, a.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}

export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCard({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}

export function useReviewCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: string; body: RouteBody<"POST /cards/:id/review"> }) => api.reviewCard({ id: a.id }, a.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}

/** Finishing a run changes the map, the library, the logbook and the cards. */
export function useFinishRun(packId?: PackId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { runId: string }) => api.finishRun({ runId: a.runId }),
    onSuccess: () => invalidateLearnerState(qc, packId),
  });
}

export interface InstallState {
  /** The latest event (null before the first one). */
  event: InstallEvent | null;
  installing: boolean;
  error: Extract<InstallEvent, { type: "error" }> | null;
  done: Extract<InstallEvent, { type: "done" }> | null;
}

/**
 * POST /packs/install as a hook: streams InstallEvents into state and refreshes the library and the
 * marketplace when it finishes.
 */
export function useInstallPack(): InstallState & {
  install(body: RouteBody<"POST /packs/install">): Promise<PackId | null>;
} {
  const qc = useQueryClient();
  const [state, setState] = useState<InstallState>({ event: null, installing: false, error: null, done: null });
  const install = useCallback(
    async (body: RouteBody<"POST /packs/install">) => {
      setState({ event: null, installing: true, error: null, done: null });
      try {
        for await (const event of api.installPack(body)) {
          setState((s) => ({
            ...s,
            event,
            ...(event.type === "error" ? { error: event, installing: false } : {}),
            ...(event.type === "done" ? { done: event, installing: false } : {}),
          }));
          if (event.type === "done") {
            await Promise.all([
              qc.invalidateQueries({ queryKey: queryKeys.packs }),
              qc.invalidateQueries({ queryKey: queryKeys.registry }),
              qc.invalidateQueries({ queryKey: queryKeys.progressAll }),
            ]);
            return event.id;
          }
          if (event.type === "error") return null;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, installing: false, error: { type: "error", code: "network", message } }));
        return null;
      }
      setState((s) => ({ ...s, installing: false }));
      return null;
    },
    [qc],
  );
  return { ...state, install };
}
