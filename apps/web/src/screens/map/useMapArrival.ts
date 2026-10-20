/**
 * What Moss says when a map opens, at most one line:
 * 1. first visit to this map (nothing started, never greeted here): "This is the map. Pick any Ready card."
 * 2. back after 3+ days: "Welcome back. The map kept your place." (never a count of days)
 * 3. cards fading, once per local day per map: "{card} is fading. A short Relight brings it back."
 *
 * "Back after days" keeps its own per-map last-visit stamp in localStorage, read before it is written,
 * because `PackProgress.lastOpenedAt` is overwritten by the same open. Stamps use server time (`now`).
 */
import type { NodeId, NodeView, PackProgress } from "@learncroc/core";
import { useEffect, useRef } from "react";
import { crocReactions } from "../../croc/reactions";
import { localDay, type MapPack, store } from "./mapLogic";

const DAY = 24 * 60 * 60 * 1000;
export const BACK_AFTER_MS = 3 * DAY;
/** The croc walks in before it speaks. */
const ARRIVAL_MS = 1_300;

export const arrivalKeys = (packId: string) => ({
  greeted: `lm:croc:greeted:${packId}`,
  lastVisit: `lm:croc:last-visit:${packId}`,
  fadingSaid: `lm:croc:fading-said:${packId}`,
});

export type ArrivalLine = "map-first-visit" | "back-after-days" | "fading" | null;

/** Pure decision (and the stamps to write), for tests and the hook. */
export function arrivalLine(
  packId: string,
  progress: Pick<PackProgress, "nodes" | "now">,
  fadingCount: number,
  read: (k: string) => string | null,
): ArrivalLine {
  const keys = arrivalKeys(packId);
  if (Object.keys(progress.nodes).length === 0 && !read(keys.greeted)) return "map-first-visit";
  const last = Number(read(keys.lastVisit) ?? Number.NaN);
  if (Number.isFinite(last) && progress.now - last >= BACK_AFTER_MS) return "back-after-days";
  if (fadingCount > 0 && read(keys.fadingSaid) !== localDay(progress.now)) return "fading";
  return null;
}

export function useMapArrival(pack: MapPack, views: Record<NodeId, NodeView>, progress: PackProgress | undefined) {
  const packId = pack.manifest.id;
  const done = useRef(false);
  useEffect(() => {
    if (!progress || done.current) return;
    done.current = true;
    const keys = arrivalKeys(packId);
    const fading = pack.map.topo.filter((id) => pack.map.nodes[id]?.kind === "node" && views[id]?.state === "fading");
    const line = arrivalLine(packId, progress, fading.length, store.get);
    // Read first, then stamp this visit.
    store.set(keys.lastVisit, String(progress.now));
    if (!line) return;
    if (line === "map-first-visit") store.set(keys.greeted, "1");
    if (line === "fading") store.set(keys.fadingSaid, localDay(progress.now));
    // Not cleared on unmount: emitting with nobody listening is harmless, and StrictMode remounts.
    setTimeout(() => {
      if (line === "fading") {
        const id = fading[0] as NodeId;
        crocReactions.emit({ type: "fading", packId, nodeId: id, title: pack.map.nodes[id]?.title ?? id });
      } else crocReactions.emit({ type: line, packId });
    }, ARRIVAL_MS);
  }, [progress, packId, pack.map, views]);
}
