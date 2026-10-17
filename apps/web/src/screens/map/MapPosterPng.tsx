/**
 * Share card (slot): a preview of the map poster and a client-side PNG, drawn at the requested size
 * (and scale) from the same poster SVG and signed "Learncroc". Offline; nothing is uploaded. "Copy
 * image" appears where the browser can put an image on the clipboard.
 */
import { MapPoster } from "@learncroc/maps";
import { Button } from "@learncroc/ui";
import { Copy, DownloadSimple } from "@phosphor-icons/react";
import type { MapPosterPngProps } from "../../slots";
import { usePosterExport } from "./usePosterExport";

const PREVIEW_MAX_W = 600;
const PREVIEW_MAX_H = 420;

export function MapPosterPng({ pack, views, options, label = "Download PNG", layout }: MapPosterPngProps) {
  const { save, copy, busy, error, canCopy } = usePosterExport({ pack, views, options, ...(layout ? { layout } : {}) });
  const k = Math.min(1, PREVIEW_MAX_W / options.width, PREVIEW_MAX_H / options.height);
  const pw = Math.round(options.width * k);
  const ph = Math.round(options.height * k);

  return (
    <figure data-slot="map-poster-png" className="m-0 flex flex-col items-center gap-3">
      <div className="overflow-hidden rounded-stage border border-line shadow-2" style={{ width: pw, height: ph }}>
        <MapPoster
          pack={pack}
          views={views}
          width={pw}
          height={ph}
          brand
          {...(layout ? { layout } : {})}
          {...(options.caption !== undefined ? { caption: options.caption } : {})}
        />
      </div>
      <figcaption className="flex w-full flex-wrap items-center justify-between gap-3">
        <span className="text-small text-ink-3 tabular">
          {options.width} × {options.height} PNG{options.scale === 2 ? " at 2×" : ""} · made on this computer
        </span>
        <span className="flex gap-2">
          {canCopy ? (
            <Button variant="secondary" onClick={() => void copy()} disabled={busy !== null} icon={<Copy size={16} />}>
              {busy === "copy" ? "Copying…" : "Copy image"}
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={busy !== null}
            icon={<DownloadSimple size={16} />}
          >
            {busy === "save" ? "Drawing…" : label}
          </Button>
        </span>
      </figcaption>
      {error ? (
        <p role="alert" className="m-0 self-start text-small text-ember-text">
          {error}
        </p>
      ) : null}
    </figure>
  );
}
