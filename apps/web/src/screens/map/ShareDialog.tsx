/**
 * Share (S): the map poster as a PNG in two formats, 1200 × 630 (link preview, the default) and
 * 1080 × 1350 (portrait). Unfinished maps carry a small "6 of 11 cards lit" caption and no badge;
 * a finished map uses the finished layout and shows its badge. Offline; nothing about the learner.
 */
import type { NodeId, NodeView } from "@learncroc/core";
import { MapBadge } from "@learncroc/maps";
import { Modal, Segmented } from "@learncroc/ui";
import { useState } from "react";
import { useLayer } from "../../lib/layers";
import { MapPosterPng } from "../../slots";
import { type MapCounts, type MapPack, partialCaption } from "./mapLogic";

export const SHARE_FORMATS = {
  wide: { width: 1200, height: 630, label: "1200 × 630" },
  tall: { width: 1080, height: 1350, label: "1080 × 1350" },
} as const;
export type ShareFormat = keyof typeof SHARE_FORMATS;

export function ShareDialog({
  open,
  onClose,
  pack,
  views,
  counts,
  finished,
  finishedAt,
}: {
  open: boolean;
  onClose(): void;
  pack: MapPack;
  views: Record<NodeId, NodeView>;
  counts: MapCounts;
  finished: boolean;
  finishedAt?: number;
}) {
  useLayer("modal", { open, onClose });
  const [format, setFormat] = useState<ShareFormat>("wide");
  const f = SHARE_FORMATS[format];
  const caption = finished ? `Finished · ${counts.playable} cards lit` : partialCaption(counts);
  return (
    <Modal open={open} onClose={onClose} title="Share your map" size="sheet" bodyClassName="px-6 pt-2 pb-6">
      <div className="flex flex-col gap-4" data-share>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 max-w-[46ch] text-small text-ink-2">
            A poster of where you are on {pack.manifest.title}. It's drawn on this computer; nothing is uploaded.
          </p>
          <Segmented
            label="Image size"
            value={format}
            options={(Object.keys(SHARE_FORMATS) as ShareFormat[]).map((k) => ({
              value: k,
              label: SHARE_FORMATS[k].label,
            }))}
            onChange={setFormat}
          />
        </div>
        {finished ? (
          <div className="flex items-center gap-3">
            <MapBadge pack={pack} cards={counts.playable} {...(finishedAt ? { finishedAt } : {})} size={56} />
            <p className="m-0 text-small text-ink-2">Finished. The badge goes on the poster.</p>
          </div>
        ) : null}
        <MapPosterPng
          key={format}
          pack={pack}
          views={views}
          layout={finished ? "finished" : "default"}
          options={{ width: f.width, height: f.height, scale: 2, caption }}
        />
      </div>
    </Modal>
  );
}
