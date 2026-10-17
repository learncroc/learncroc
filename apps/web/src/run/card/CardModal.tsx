/**
 * The card modal (C3): 960 px max, centred over the map, one focus trap. The header holds the typed
 * card's place on the map (eyebrow), the stop title, this stop's progress dots, ⋯ and Back to
 * map. Moss talks in the player's thread; typed questions
 * to Moss go through the croc pane, folded into a footer bar. Esc, Back to map and a scrim click close
 * it without asking: the run is saved on the server and resumes where it was.
 *
 * Done, Lit and Fading cards open in replay (nothing on the map changes). `from` opens a revisit from a
 * missed checkpoint and ends "Back to the checkpoint".
 */
import type { StartRunBody } from "@learncroc/core";
import { Button, Dialog, Kbd, Modal, ProgressBeads, toast } from "@learncroc/ui";
import { ArrowCounterClockwise, CheckCircle, Flag, Keyboard } from "@phosphor-icons/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useIsTopLayer, useLayer } from "../../lib/layers";
import { CrocPane } from "../../slots";
import { isIntroNode, nodeCards } from "../content";
import type { CardModalProps } from "../index";
import { usePackQuery } from "../queries";
import { reportUrl } from "../RunFrame";
import { revisitFor } from "../revisit";
import { BackToMap, WithModalClose } from "../shell";
import { lineColor } from "../world";
import { CardMenu } from "./CardMenu";
import { CardPlayer, type CardPlayerStepInfo } from "./CardPlayer";

const SHORTCUTS: [string, string][] = [
  ["⏎", "The dark reply: go on, try it, next stop"],
  ["1–9", "Pick an option in a question"],
  ["H", "A hint on a beat's action"],
  ["Space", "Pick up and drop in lists"],
  ["Esc", "Back to the map (your place is kept)"],
];

export function CardModal(p: CardModalProps) {
  const pack = usePackQuery(p.packId).data;
  const [info, setInfo] = useState<CardPlayerStepInfo>();
  const again = Boolean(p.again);
  const [restartSignal, setRestartSignal] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dialogOpen = confirmRestart || shortcuts || menuOpen;
  const infoRef = useRef(info);
  infoRef.current = info;

  const entry = pack?.map.nodes[p.nodeId];
  const title = pack?.nodes[p.nodeId]?.title ?? entry?.title ?? "Card";
  const line = pack ? pack.map.lines.find((l) => l.id === entry?.line) : undefined;
  const node = pack?.nodes[p.nodeId];
  const stopCards = useMemo(() => (node ? nodeCards(node) : []), [node]);
  const stopAt = info ? stopCards.findIndex((c) => c.key === info.card.key) : -1;
  // Stops are the map's playable cards in reading order; the intro isn't counted.
  const stops = useMemo(
    () =>
      pack
        ? pack.map.topo.filter((id) => {
            const e = pack.map.nodes[id];
            const n = pack.nodes[id];
            return e?.kind === "node" && e.status !== "planned" && !(n && isIntroNode(n));
          })
        : [],
    [pack],
  );
  const stopNo = stops.indexOf(p.nodeId);
  const accent = pack ? lineColor(pack.manifest.theme, pack.map.lines, entry?.line) : undefined;
  const revisit = p.from ? revisitFor(p.packId, p.from, p.nodeId) : undefined;

  const close = useCallback(() => {
    const i = infoRef.current;
    if (i && !i.done && !i.replay && (i.step === "beat" || i.step === "card")) {
      toast({ message: `Saved. ${title} picks up where you left it.`, tone: "info", duration: 4000 });
    }
    p.onClose();
  }, [p.onClose, title]);

  // Esc inside the restart / shortcuts dialog closes only that dialog.
  const onDismiss = useCallback(() => (dialogOpen ? false : undefined), [dialogOpen]);

  const layerId = useLayer("modal", { onClose: close });
  const top = useIsTopLayer(layerId);

  const start = useMemo<StartRunBody>(
    () => ({
      kind: "card",
      packId: p.packId,
      target: p.nodeId,
      mode: again ? "again" : "replay",
      ...(p.from ? { from: p.from } : {}),
    }),
    [p.packId, p.nodeId, again, p.from],
  );
  const onStep = useCallback((i: CardPlayerStepInfo) => setInfo(i), []);
  const croc = (
    <CrocPane
      packId={p.packId}
      nodeId={p.nodeId}
      {...(info?.screenId ? { screenId: info.screenId } : {})}
      {...(info?.runId ? { runId: info.runId } : {})}
      context="card"
      collapsed
    />
  );

  return (
    <Modal open onClose={close} onDismiss={onDismiss} title={title} hideTitle size="card" initialFocus={-1}>
      <WithModalClose>
        {(exit) => (
          <div className="flex h-full min-h-0" data-modal="card" data-layer-id={layerId}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <header
                className="flex shrink-0 items-center gap-4 border-b border-line bg-surface-2 px-6 py-3 lg:px-8"
                style={accent ? { borderTop: `4px solid ${accent}` } : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className="t-micro truncate text-ink-3 uppercase tracking-wide" data-card-eyebrow>
                    {[
                      line?.title,
                      stopNo >= 0 ? `Stop ${stopNo + 1} of ${stops.length}` : undefined,
                      info?.replay && !p.from ? "Again" : undefined,
                      p.from ? "Revisit · about 1 min" : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="flex min-w-0 items-center gap-4 text-ink">
                    <span className="t-heading truncate" aria-hidden>
                      {info?.card.type === "intro" ? "Before you start" : title}
                    </span>
                    {stopCards.length > 1 && stopAt >= 0 ? (
                      <ProgressBeads
                        className="hidden shrink-0 md:flex"
                        total={stopCards.length}
                        done={info?.done ? stopCards.length : stopAt}
                        {...(info?.done ? {} : { current: stopAt })}
                        label={`Card ${stopAt + 1} of ${stopCards.length} in this stop`}
                      />
                    ) : null}
                  </div>
                </div>
                {info?.done ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-pill border border-ink px-2.5 py-0.5 text-small font-semibold text-ink"
                    data-done-pill
                  >
                    Done
                    <CheckCircle size={14} weight="fill" aria-hidden />
                  </span>
                ) : null}
                <CardMenu
                  open={menuOpen}
                  onOpenChange={setMenuOpen}
                  items={[
                    {
                      label: "Restart this card",
                      icon: <ArrowCounterClockwise size={16} />,
                      onSelect: () => setConfirmRestart(true),
                    },
                    {
                      label: "Report this card",
                      icon: <Flag size={16} />,
                      onSelect: () =>
                        window.open(
                          reportUrl({
                            screen: "Card",
                            packId: p.packId,
                            ...(pack ? { packVersion: pack.manifest.version } : {}),
                            nodeId: p.nodeId,
                            ...(info?.screenId ? { screenId: info.screenId } : {}),
                          }),
                          "_blank",
                          "noopener,noreferrer",
                        ),
                    },
                    { label: "Keyboard shortcuts", icon: <Keyboard size={16} />, onSelect: () => setShortcuts(true) },
                  ]}
                />
                <BackToMap />
              </header>

              {p.from ? (
                <p
                  className="shrink-0 border-b border-line bg-sea-soft px-6 py-2 text-small text-ink lg:px-8"
                  data-revisit-band
                >
                  {revisit?.prompt
                    ? `You missed: ${revisit.prompt}${/[.?!]$/.test(revisit.prompt.trim()) ? "" : "."} This card has what you need.`
                    : "This card has what you need for the checkpoint."}
                </p>
              ) : null}

              {pack ? (
                <CardPlayer
                  key={`${p.nodeId}:${again ? "again" : "play"}`}
                  start={start}
                  pack={pack}
                  {...(p.guess && !again ? { guess: p.guess } : {})}
                  {...(p.from ? { from: p.from } : {})}
                  keysActive={top && !dialogOpen}
                  restartSignal={restartSignal}
                  onStep={onStep}
                  onNavigate={p.onNavigate}
                  onSummary={p.onSummary}
                  onExit={exit}
                />
              ) : (
                <div className="grid flex-1 place-items-center text-small text-ink-3" role="status">
                  Opening the card…
                </div>
              )}
              {croc}
            </div>
          </div>
        )}
      </WithModalClose>

      <Dialog
        open={confirmRestart}
        onClose={() => setConfirmRestart(false)}
        title={`Start ${title} over?`}
        description="Your guess and answers on this card are cleared. Done and Lit stay."
        role="alertdialog"
        actions={
          <>
            <Button onClick={() => setConfirmRestart(false)}>Keep going</Button>
            <Button
              variant="primary"
              autoFocus
              onClick={() => {
                setConfirmRestart(false);
                setRestartSignal((n) => n + 1);
              }}
            >
              Start over
            </Button>
          </>
        }
      />
      <Dialog
        open={shortcuts}
        onClose={() => setShortcuts(false)}
        title="Card shortcuts"
        actions={
          <Button variant="primary" onClick={() => setShortcuts(false)} autoFocus>
            Done
          </Button>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <Kbd keys={k} />
              </dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </Modal>
  );
}
