/**
 * Map designs on the client: the learner's per-map pick lives in settings (`appearance.mapDesigns`) and is
 * applied wherever a map is drawn (the map page, library posters, the share card) via `withMapDesign`.
 */
import { type MapDesignChoice, type PackId, type PackTheme, withMapDesign } from "@learncroc/core";
import { useCallback, useMemo } from "react";
import { usePatchSettings, useSettings } from "./queries";

/** The pick for one map (undefined: never changed, so the map's own theme). */
export function useMapDesignChoice(packId: PackId | undefined): MapDesignChoice | undefined {
  const settings = useSettings();
  return packId ? settings.data?.appearance.mapDesigns?.[packId] : undefined;
}

/** `pack` in the learner's pick for it (the same object when there is none). */
export function useDesignedPack<T extends { manifest: { id: PackId; theme: PackTheme } }>(pack: T): T;
export function useDesignedPack<T extends { manifest: { id: PackId; theme: PackTheme } }>(
  pack: T | undefined,
): T | undefined;
export function useDesignedPack<T extends { manifest: { id: PackId; theme: PackTheme } }>(
  pack: T | undefined,
): T | undefined {
  const choice = useMapDesignChoice(pack?.manifest.id);
  return useMemo(() => (pack ? withMapDesign(pack, choice) : pack), [pack, choice]);
}

/** Save a map's pick. Sends the whole record so the optimistic merge and the server agree. */
export function useSetMapDesign(): (packId: PackId, choice: MapDesignChoice) => void {
  const settings = useSettings();
  const patch = usePatchSettings();
  const current = settings.data?.appearance.mapDesigns;
  return useCallback(
    (packId, choice) => patch.mutate({ appearance: { mapDesigns: { ...current, [packId]: choice } } }),
    [patch.mutate, current],
  );
}
