/**
 * The finished map: opens once after the last gate's moment and the dawn wash, and
 * again from the header badge ("See the badge") or `?finished=1`. The badge, the finished poster,
 * "You can now" with one line per map line, the sampler note, and Save image / Copy image, made on
 * this computer. No time spent, no streaks, no score.
 */
import { CROC_NAME, type NodeId, type NodeView } from "@learncroc/core";
import { MapBadge, MapPoster } from "@learncroc/maps";
import { Button, buttonClass, Croc, Kbd, Modal } from "@learncroc/ui";
import { Copy, DownloadSimple } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { useLayer } from "../../lib/layers";
import type { MapCounts, MapPack } from "./mapLogic";
import { SHARE_FORMATS } from "./ShareDialog";
import { usePosterExport } from "./usePosterExport";

const POSTER_W = 336;

export function FinishedModal({
  pack,
  views,
  counts,
  finishedAt,
  onClose,
}: {
  pack: MapPack;
  views: Record<NodeId, NodeView>;
  counts: MapCounts;
  finishedAt?: number;
  onClose(): void;
}) {
  useLayer("modal", { onClose });
  const save = useRef<HTMLButtonElement>(null);
  const f = SHARE_FORMATS.wide;
  const exporter = usePosterExport({
    pack,
    views,
    layout: "finished",
    options: { width: f.width, height: f.height, scale: 2, caption: `Finished · ${counts.playable} cards lit` },
  });
  const outcomes = pack.map.lines.map((l) => l.outcome.trim()).filter(Boolean);
  const sampler = pack.manifest.profile === "sampler";
  const date = finishedAt
    ? new Date(finishedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : undefined;
  const ph = Math.round((POSTER_W * f.height) / f.width);

  return (
    <Modal
      open
      onClose={onClose}
      title="Map finished"
      size="sheet"
      initialFocus={save}
      header={
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-3">
          <h2 className="m-0 t-heading">Map finished</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-sm px-2 py-1 text-small text-ink-2 hover:bg-surface-2"
          >
            Back to map <Kbd keys="Esc" />
          </button>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3">
          <Link to="/market" className={buttonClass({ variant: "ghost" })}>
            Find another map
          </Link>
          <span className="flex flex-wrap gap-2">
            {exporter.canCopy ? (
              <Button
                variant="secondary"
                onClick={() => void exporter.copy()}
                disabled={exporter.busy !== null}
                icon={<Copy size={16} />}
              >
                {exporter.busy === "copy" ? "Copying…" : "Copy image"}
              </Button>
            ) : null}
            <Button
              ref={save}
              variant="primary"
              onClick={() => void exporter.save()}
              disabled={exporter.busy !== null}
              icon={<DownloadSimple size={16} />}
              kbd="⏎"
            >
              {exporter.busy === "save" ? "Drawing…" : "Save image"}
            </Button>
          </span>
        </div>
      }
      bodyClassName="px-6 py-5"
    >
      <div className="flex flex-col gap-6 sm:flex-row" data-finished>
        <div className="flex shrink-0 flex-col items-center gap-3" style={{ width: POSTER_W }}>
          <div
            className="overflow-hidden rounded-stage border border-line shadow-2"
            style={{ width: POSTER_W, height: ph }}
          >
            <MapPoster pack={pack} views={views} width={POSTER_W} height={ph} brand layout="finished" />
          </div>
          <div className="flex items-center gap-2 self-start">
            <Croc state="cheering" size={56} lumen decorative />
            <p className="m-0 text-small text-ink-2 voice-casual">
              {CROC_NAME}: "That's the whole map. You can explain this now. Try it on someone."
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center gap-4">
            <span className="lm-pop-in inline-flex">
              <MapBadge pack={pack} cards={counts.playable} {...(finishedAt ? { finishedAt } : {})} size={104} />
            </span>
            <div className="min-w-0">
              <p className="m-0 t-heading text-ink">{pack.manifest.title}</p>
              <p className="m-0 text-small text-ink-2">{pack.manifest.theme.world}</p>
              {date ? <p className="m-0 text-small text-ink-3 tabular">Finished {date}</p> : null}
            </div>
          </div>
          {outcomes.length ? (
            <div>
              <h3 className="m-0 mb-1.5 text-small font-[650] text-ink">You can now</h3>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-body text-ink-2">
                {outcomes.map((o) => (
                  <li key={o}>{o.replace(/\.$/, "")}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="m-0 text-small text-ink-3 tabular">
            {counts.playable} cards · {counts.gates} checkpoint{counts.gates === 1 ? "" : "s"}
          </p>
          {sampler ? (
            <p className="m-0 text-small text-ink-2">You've finished the sampler. The full map is planned.</p>
          ) : counts.planned > 0 ? (
            <p className="m-0 text-small text-ink-2">
              There's more of this map coming: {counts.planned} planned card{counts.planned === 1 ? "" : "s"}.
            </p>
          ) : null}
          <p className="m-0 text-small text-ink-3">Relight brings cards back when they fade.</p>
          {exporter.error ? (
            <p role="alert" className="m-0 text-small text-ember-text">
              {exporter.error}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
