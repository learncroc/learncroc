/**
 * Draw a map poster to PNG on the client (offline, never uploaded) and either save it or copy it to
 * the clipboard where the browser allows images there.
 */
import type { CompiledPack, NodeId, NodeView } from "@learncroc/core";
import { exportMapPosterPng, type MapPosterPngOptions, posterFileName } from "@learncroc/maps";
import { toast } from "@learncroc/ui";
import { useCallback, useState } from "react";
import { downloadFile } from "../../app/download";

export interface PosterSource {
  pack: Pick<CompiledPack, "manifest" | "map">;
  views: Record<NodeId, NodeView>;
  options: MapPosterPngOptions;
  layout?: "default" | "finished";
}

/** Can this browser put a PNG on the clipboard? */
export function canCopyImage(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as { ClipboardItem?: unknown }).ClipboardItem === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

export function usePosterExport({ pack, views, options, layout }: PosterSource) {
  const [busy, setBusy] = useState<"save" | "copy" | null>(null);
  const [error, setError] = useState<string>();

  const draw = useCallback(
    () =>
      exportMapPosterPng(
        {
          pack,
          views,
          width: options.width,
          height: options.height,
          ...(options.caption !== undefined ? { caption: options.caption } : {}),
          ...(layout ? { layout } : {}),
        },
        options,
      ),
    [pack, views, options, layout],
  );

  const save = useCallback(async () => {
    setBusy("save");
    setError(undefined);
    try {
      downloadFile(posterFileName(pack.manifest.id), await draw(), "image/png");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't draw the poster.");
    } finally {
      setBusy(null);
    }
  }, [draw, pack.manifest.id]);

  const copy = useCallback(async () => {
    setBusy("copy");
    setError(undefined);
    try {
      // The promise form keeps the user gesture alive in Safari while the PNG draws.
      const item = new ClipboardItem({ "image/png": draw() });
      await navigator.clipboard.write([item]);
      toast({ message: "Image copied." });
    } catch (e) {
      setError(e instanceof Error ? `Couldn't copy the image: ${e.message}` : "Couldn't copy the image.");
    } finally {
      setBusy(null);
    }
  }, [draw]);

  return { save, copy, busy, error, canCopy: canCopyImage() };
}
