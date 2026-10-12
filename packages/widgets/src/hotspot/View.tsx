/**
 * hotspot view: a picture with parts you can touch.
 *
 * tap    tap the parts that answer the question (each tap drops a numbered pin).
 * label  drag labels from the tray onto the parts (or Space + arrows + Space; or buttons mode).
 * Parts are named by position ("part 2, upper right") until the answer is in, so the names never
 * give the answer away. Review shows every part's name and rings the right ones.
 */
import { cn } from "@learncroc/ui";
import { useRef, useState } from "react";
import { useButtonsMode, usePickPlace } from "../shared/drag";
import { KeyButton, ReviewNote, WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import { type HotspotAnswer, type HotspotGoal, type HotspotProps, type HotspotSpot, spotBox, spotPlace } from "./spec";

type Props = WidgetViewProps<HotspotProps, HotspotGoal, HotspotAnswer>;

const TRAY = "__tray";

export default function HotspotView(p: Props) {
  const props = withReveal(p.props, p.revealProps);
  const root = useRef<HTMLDivElement>(null);
  const [buttons] = useButtonsMode();
  const [imgFailed, setImgFailed] = useState(false);
  const [vw, vh] = props.viewBox;
  const review = p.mode === "review";
  const interactive = !review && (!!p.onChange || p.mode === "explore");
  const tapped = new Set(p.value?.tapped ?? []);
  const labels = p.value?.labels ?? {};
  const showNames = review || props.showLabels === true;
  const goal = p.goal;
  const correctTaps = review && goal?.kind === "tap" ? new Set(goal.correct) : null;
  const mapping = review && goal?.kind === "label" ? goal.mapping : null;
  const labelMode = props.mode === "label";

  const spotName = (s: HotspotSpot, i: number) => (showNames ? s.label : `part ${i + 1}`);
  const spotFull = (s: HotspotSpot, i: number) => `${spotName(s, i)}, ${spotPlace(props, s)}`;

  const toggle = (s: HotspotSpot, i: number) => {
    if (!interactive) return;
    const next = new Set(tapped);
    if (next.has(s.id)) next.delete(s.id);
    else next.add(s.id);
    const list = props.spots.filter((x) => next.has(x.id)).map((x) => x.id);
    p.onChange?.({ tapped: list });
    p.announce(`${spotFull(s, i)} ${next.has(s.id) ? "tapped" : "untapped"}.`);
  };

  // Label mode: labels are the items, spots (plus the tray) are the targets.
  const targets = [
    ...props.spots.map((s, i) => ({ id: s.id, label: spotFull(s, i) })),
    { id: TRAY, label: "the label tray" },
  ];
  const placeLabel = (label: string, spotId: string) => {
    const next: Record<string, string> = {};
    for (const [s, l] of Object.entries(labels)) if (l !== label && s !== spotId) next[s] = l;
    if (spotId !== TRAY) next[spotId] = label;
    p.onChange?.({ labels: next });
  };
  const kit = usePickPlace({
    rootRef: root,
    targets,
    itemLabel: (l) => l,
    locate: (l) => Object.entries(labels).find(([, x]) => x === l)?.[0] ?? props.spots[0]?.id ?? TRAY,
    onPlace: placeLabel,
    announce: p.announce,
    disabled: !interactive || !labelMode,
  });
  const placedLabels = new Set(Object.values(labels));
  const tray = (props.labels ?? []).filter((l) => !placedLabels.has(l));

  return (
    <WidgetShell id="hotspot" mode={p.mode} buttonsToggle={labelMode && !review} label="Picture with marked parts">
      <div ref={root} className="flex flex-col gap-3">
        <div
          className="relative mx-auto w-full overflow-hidden rounded-md border border-w-grid bg-w-ground"
          // The picture keeps its aspect and caps its height, so the tray stays on the modal canvas.
          style={{ aspectRatio: `${vw} / ${vh}`, maxWidth: `${Math.round(((labelMode ? 176 : 232) * vw) / vh)}px` }}
        >
          {imgFailed ? (
            <div className="absolute inset-0 flex items-end justify-start bg-surface-sunk p-3 text-small text-ink-2">
              The picture didn't load; the parts still work.
            </div>
          ) : (
            <img
              src={p.assetUrl(props.image)}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
              onError={() => setImgFailed(true)}
              draggable={false}
            />
          )}
          {/* biome-ignore lint/a11y/useSemanticElements: an overlay of positioned parts, not a form fieldset. */}
          <div
            className="absolute inset-0"
            role="group"
            aria-label={labelMode ? "Parts: drop a label on each" : "Parts: tap the right ones"}
          >
            {props.spots.map((s, i) => {
              const b = spotBox(props, s);
              const isTapped = tapped.has(s.id);
              const isCorrect = correctTaps?.has(s.id) ?? false;
              const placed = Object.entries(labels).find(([spot]) => spot === s.id)?.[1];
              const want = mapping?.[s.id];
              const round = s.w === undefined;
              const over = labelMode && kit.held && kit.over === s.id;
              const style = {
                left: `${(b.x0 / vw) * 100}%`,
                top: `${(b.y0 / vh) * 100}%`,
                width: `${((b.x1 - b.x0) / vw) * 100}%`,
                height: `${((b.y1 - b.y0) / vh) * 100}%`,
              };
              const shape = cn(
                "absolute border-2 transition-[background-color,border-color,transform] duration-quick",
                round ? "rounded-pill" : "rounded-sm",
              );
              return (
                <div key={s.id} style={style} className="absolute">
                  {labelMode ? (
                    // biome-ignore lint/a11y/useSemanticElements: a drop zone over a part of the picture.
                    <div
                      {...kit.targetProps(s.id)}
                      aria-label={`${spotFull(s, i)}${placed ? `: labelled ${placed}` : ": no label yet"}`}
                      role="group"
                      className={cn(
                        shape,
                        "inset-0 border-dashed",
                        over
                          ? "scale-105 border-sea bg-sea-soft/50"
                          : placed
                            ? "border-w-ink bg-surface/20"
                            : "border-w-ink-2 bg-surface/10",
                        want && "border-solid border-sea",
                      )}
                    />
                  ) : (
                    <button
                      type="button"
                      aria-pressed={isTapped}
                      aria-label={spotFull(s, i)}
                      disabled={!interactive}
                      onClick={() => toggle(s, i)}
                      data-spot={s.id}
                      className={cn(
                        shape,
                        "inset-0 cursor-pointer disabled:cursor-default",
                        isTapped
                          ? "border-w-ink bg-[color-mix(in_srgb,var(--w-1)_35%,transparent)]"
                          : "border-dashed border-w-ink-2/70 hover:border-w-ink hover:bg-surface/20",
                        isCorrect && "border-solid border-sea outline-2 outline-dashed outline-sea outline-offset-4",
                      )}
                    />
                  )}
                  {!labelMode && isTapped ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-pill border-[1.5px] border-ink bg-surface text-micro font-bold text-ink shadow-1"
                    >
                      {[...tapped].indexOf(s.id) + 1}
                    </span>
                  ) : null}
                  {showNames && !labelMode ? (
                    <span className="pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap rounded-xs bg-surface px-1.5 text-micro font-semibold text-ink shadow-1">
                      {s.label}
                    </span>
                  ) : null}
                  {labelMode && placed ? (
                    <button
                      type="button"
                      {...kit.itemProps(placed)}
                      disabled={!interactive}
                      aria-label={`${placed}, on ${spotFull(s, i)}`}
                      className={cn(
                        "absolute top-full left-1/2 z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-sm border-[1.5px] border-ink bg-surface px-2 py-0.5 text-small font-semibold text-ink shadow-key-rest disabled:cursor-default",
                        interactive && "cursor-grab",
                        kit.held === placed && "ring-2 ring-sea",
                        want && want !== placed && "border-dashed shadow-none",
                      )}
                    >
                      {placed}
                    </button>
                  ) : null}
                  {labelMode && want && want !== placed ? (
                    <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap">
                      <ReviewNote className="rounded-xs bg-surface px-1">{want}</ReviewNote>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {labelMode ? (
          <div
            {...kit.targetProps(TRAY)}
            className={cn(
              "flex min-h-14 flex-wrap items-center gap-2 rounded-md border-[1.5px] border-dashed border-w-grid p-3",
              kit.held && kit.over === TRAY && "border-sea bg-sea-soft/40",
            )}
            data-tray
          >
            <span className="text-small text-w-ink-2">{tray.length ? "Labels:" : "All labels placed."}</span>
            {tray.map((l) => (
              <span key={l} className="flex items-center gap-1">
                <button
                  type="button"
                  {...kit.itemProps(l)}
                  disabled={!interactive}
                  aria-label={`${l} (not placed)`}
                  className={cn(
                    "h-10 rounded-key border-[1.5px] border-ink bg-surface px-4 text-body font-semibold text-ink shadow-key-rest disabled:cursor-default",
                    interactive && "cursor-grab active:cursor-grabbing",
                    kit.held === l && "shadow-2 ring-2 ring-sea",
                  )}
                >
                  {l}
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {labelMode && buttons && interactive ? (
          <ButtonsPlacer
            labels={props.labels ?? []}
            spots={props.spots.map((s, i) => ({ id: s.id, name: spotFull(s, i) }))}
            current={labels}
            onPlace={(l, spot) => kit.place(l, spot)}
          />
        ) : null}
      </div>
    </WidgetShell>
  );
}

function ButtonsPlacer(p: {
  labels: string[];
  spots: { id: string; name: string }[];
  current: Record<string, string>;
  onPlace: (label: string, spot: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3" data-buttons-placer>
      {p.spots.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2">
          <span className="w-44 text-small text-ink-2">{s.name}</span>
          {p.labels.map((l) => (
            <KeyButton
              key={l}
              size="sm"
              pressed={p.current[s.id] === l}
              aria-label={`Label ${s.name} as ${l}`}
              onClick={() => p.onPlace(l, s.id)}
            >
              {l}
            </KeyButton>
          ))}
        </div>
      ))}
    </div>
  );
}
