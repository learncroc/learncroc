/**
 * The peek popover: ≤ 280 px, anchored to the glyph (or the Route panel row),
 * for entries that don't open a modal: Later, Planned and Writing… cards, Locked gates, and an Open gate
 * ("Practise again"). Later cards never show their hook. Esc or a click elsewhere closes it.
 */
import type { NodeId, NodeView } from "@learncroc/core";
import { viewFor } from "@learncroc/maps";
import { Button, Modal, StatePill } from "@learncroc/ui";
import { ArrowsClockwise, Path } from "@phosphor-icons/react";
import { useLayer } from "../../lib/layers";
import { gateName, type MapPack, peekCopy } from "./mapLogic";

export interface PeekProps {
  pack: MapPack;
  views: Record<NodeId, NodeView>;
  id: NodeId;
  anchor?: Element;
  onClose(): void;
  /** Highlight the path to this entry on the map. */
  onShowRoute(id: NodeId): void;
  /** Open gate: a practice run (no state change). */
  onPractise(id: NodeId): void;
}

export function Peek({ pack, views, id, anchor, onClose, onShowRoute, onPractise }: PeekProps) {
  useLayer("peek", { onClose });
  const node = pack.map.nodes[id];
  if (!node) return null;
  const view = viewFor(pack.map, views, id);
  const copy = peekCopy(pack, views, id);
  const gate = node.kind === "checkpoint";
  const title = gate ? gateName(pack, id) : node.title;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      hideTitle
      size="peek"
      {...(anchor ? { anchor } : {})}
      bodyClassName="flex flex-col gap-2.5 p-4"
    >
      <div className="flex items-start justify-between gap-3" data-peek-for={id}>
        <h2 className="m-0 text-body font-semibold text-ink">{title}</h2>
        <StatePill state={view.state} kind={node.kind} />
      </div>
      {copy.teaser ? <p className="m-0 text-small text-ink-2 voice-casual">{copy.teaser}</p> : null}
      {copy.lines.map((l) => (
        <p key={l} className="m-0 text-small text-ink-2">
          {l}
        </p>
      ))}
      {copy.minutes ? <p className="m-0 text-micro text-ink-3 tabular">About {copy.minutes} minutes</p> : null}
      {copy.actions.length ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {copy.actions.includes("route") ? (
            <Button size="sm" variant="secondary" icon={<Path size={14} />} onClick={() => onShowRoute(id)}>
              Show the route
            </Button>
          ) : null}
          {copy.actions.includes("practise") ? (
            <Button size="sm" variant="secondary" icon={<ArrowsClockwise size={14} />} onClick={() => onPractise(id)}>
              Practise again
            </Button>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
