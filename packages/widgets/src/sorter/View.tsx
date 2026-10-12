/**
 * sorter view: cards into buckets, or one ranked column.
 *
 * Drag a card onto a bucket, or tap a card then tap a bucket, or Tab to a card, Space to pick it up,
 * arrows to choose a bucket, Space to drop. "Use buttons instead" adds a button per bucket on each
 * card. In review every card shows where it belongs (a dotted outline and a note, never a red X).
 */
import type { AssetPath } from "@learncroc/core";
import { cn } from "@learncroc/ui";
import { useMemo, useRef } from "react";
import { useButtonsMode, usePickPlace } from "../shared/drag";
import { InlineMarkdown, KeyButton, plainMarkdown, ReviewNote, WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import { initialRankOrder, type SorterAnswer, type SorterGoal, type SorterProps } from "./spec";

type Props = WidgetViewProps<SorterProps, SorterGoal, SorterAnswer>;
type Card = SorterProps["cards"][number];

const TRAY = "__tray";

export { initialRankOrder };

export default function SorterView(p: Props) {
  const props = withReveal(p.props, p.revealProps);
  return props.mode === "rank" ? <Rank {...p} props={props} /> : <Buckets {...p} props={props} />;
}

function CardFace({ card, assetUrl }: { card: Card; assetUrl: (a: AssetPath) => string }) {
  return (
    <span className="flex items-center gap-2 text-left">
      {card.asset ? (
        <img src={assetUrl(card.asset)} alt="" className="size-8 shrink-0 rounded-xs object-contain" />
      ) : null}
      <InlineMarkdown text={card.text} />
    </span>
  );
}

function Grip() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" className="shrink-0 text-ink-3">
      <g fill="currentColor">
        <circle cx="2.5" cy="3" r="1.2" />
        <circle cx="7.5" cy="3" r="1.2" />
        <circle cx="2.5" cy="7" r="1.2" />
        <circle cx="7.5" cy="7" r="1.2" />
        <circle cx="2.5" cy="11" r="1.2" />
        <circle cx="7.5" cy="11" r="1.2" />
      </g>
    </svg>
  );
}

const cardClass =
  "flex min-h-11 w-full items-center gap-2 rounded-key border-[1.5px] border-ink bg-surface px-3 py-2 text-body font-semibold text-ink shadow-key-rest transition-shadow duration-press disabled:cursor-default";

// ── buckets ──────────────────────────────────────────────────────────────────────────────

function Buckets(p: Props) {
  const { props } = p;
  const root = useRef<HTMLDivElement>(null);
  const [buttons] = useButtonsMode();
  const buckets = props.buckets ?? [];
  const assignment = p.value?.assignment ?? {};
  const interactive = p.mode !== "review" && !!p.onChange;
  const review = p.mode === "review";
  const truth = p.goal?.kind === "buckets" ? p.goal.assignment : p.solution?.assignment;
  const cardText = (id: string) => plainMarkdown(props.cards.find((c) => c.id === id)?.text ?? id);
  const bucketLabel = (id: string) => buckets.find((b) => b.id === id)?.label ?? id;

  const targets = [...buckets.map((b) => ({ id: b.id, label: b.label })), { id: TRAY, label: "the unsorted pile" }];
  const place = (cardId: string, bucketId: string) => {
    const next = { ...assignment };
    if (bucketId === TRAY) delete next[cardId];
    else next[cardId] = bucketId;
    p.onChange?.({ assignment: next });
  };
  const kit = usePickPlace({
    rootRef: root,
    targets,
    itemLabel: cardText,
    locate: (id) => assignment[id] ?? buckets[0]?.id ?? TRAY,
    onPlace: place,
    announce: p.announce,
    disabled: !interactive,
  });

  const tray = props.cards.filter((c) => !assignment[c.id]);
  const left = tray.length;

  const renderCard = (card: Card) => {
    const at = assignment[card.id];
    const right = truth?.[card.id];
    const misplaced = review && right !== undefined && at !== right;
    return (
      <li key={card.id} className="flex flex-col gap-1">
        <button
          type="button"
          {...kit.itemProps(card.id)}
          disabled={!interactive}
          aria-label={`${cardText(card.id)}${at ? `, in ${bucketLabel(at)}` : ", not sorted yet"}${
            misplaced && right ? `, belongs in ${bucketLabel(right)}` : ""
          }`}
          className={cn(
            cardClass,
            interactive && "cursor-grab active:cursor-grabbing",
            kit.held === card.id && "shadow-2 ring-2 ring-sea",
            misplaced && "border-dashed shadow-none",
          )}
        >
          {interactive ? <Grip /> : null}
          <CardFace card={card} assetUrl={p.assetUrl} />
          {review && right !== undefined && !misplaced ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="ml-auto shrink-0">
              <circle cx="8" cy="8" r="7" fill="var(--sea)" />
              <path
                d="M4.6 8.3l2.2 2.1 4.4-4.8"
                fill="none"
                stroke="var(--surface)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </button>
        {misplaced && right ? <ReviewNote className="pl-1">belongs in {bucketLabel(right)}</ReviewNote> : null}
        {review && card.why ? (
          <span className="pl-1 text-small text-w-ink-2">
            <InlineMarkdown text={card.why} />
          </span>
        ) : null}
        {buttons && interactive ? (
          <span className="flex flex-wrap gap-1 pl-1">
            {buckets.map((b) => (
              <KeyButton
                key={b.id}
                size="sm"
                pressed={at === b.id}
                aria-label={`Put ${cardText(card.id)} in ${b.label}`}
                onClick={() => kit.place(card.id, b.id)}
              >
                {b.label}
              </KeyButton>
            ))}
          </span>
        ) : null}
      </li>
    );
  };

  return (
    <WidgetShell id="sorter" mode={p.mode} buttonsToggle={!review} label="Sort the cards">
      <div ref={root} className="flex flex-col gap-3">
        <div
          {...kit.targetProps(TRAY)}
          className={cn(
            "flex min-h-16 flex-col gap-2 rounded-md border-[1.5px] border-dashed border-w-grid p-3 transition-colors duration-quick",
            kit.held && kit.over === TRAY && "border-sea bg-sea-soft/40",
          )}
        >
          <span className="text-small text-w-ink-2">
            {left ? `To sort (${left})` : "All sorted. Move any card to change your mind."}
          </span>
          {left ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">{tray.map(renderCard)}</ul>
          ) : null}
        </div>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, buckets.length)}, minmax(0, 1fr))` }}
        >
          {buckets.map((b) => {
            const cards = props.cards.filter((c) => assignment[c.id] === b.id);
            const over = kit.held && kit.over === b.id;
            return (
              <section
                key={b.id}
                {...kit.targetProps(b.id)}
                aria-label={`${b.label}: ${cards.length} card${cards.length === 1 ? "" : "s"}`}
                className={cn(
                  "flex min-h-28 flex-col gap-2 rounded-md border-[1.5px] bg-w-ground p-3 transition-[border-color,background-color,transform] duration-quick",
                  over ? "-translate-y-0.5 border-sea bg-sea-soft/40" : "border-w-grid",
                  kit.held && interactive && "cursor-copy",
                )}
              >
                <header className="flex flex-col">
                  <span className="text-heading text-w-ink">{b.label}</span>
                  {b.hint ? <span className="text-small text-w-ink-2">{b.hint}</span> : null}
                </header>
                <ul className="flex flex-col gap-2">{cards.map(renderCard)}</ul>
              </section>
            );
          })}
        </div>
      </div>
    </WidgetShell>
  );
}

// ── rank ─────────────────────────────────────────────────────────────────────────────────

function Rank(p: Props) {
  const { props } = p;
  const root = useRef<HTMLDivElement>(null);
  const [buttons] = useButtonsMode();
  const start = useMemo(() => initialRankOrder(props.cards), [props.cards]);
  const ids = new Set(props.cards.map((c) => c.id));
  const valueOrder = p.value?.order;
  const order =
    valueOrder && valueOrder.length === ids.size && valueOrder.every((id) => ids.has(id)) ? valueOrder : start;
  const interactive = p.mode !== "review" && !!p.onChange;
  const review = p.mode === "review";
  const truth = p.goal?.kind === "rank" ? p.goal.order : p.solution?.order;
  const cardText = (id: string) => plainMarkdown(props.cards.find((c) => c.id === id)?.text ?? id);
  const [first, last] = props.rankLabels ?? ["first", "last"];
  const targets = order.map((_, i) => ({ id: `pos-${i}`, label: `position ${i + 1} of ${order.length}` }));

  const moveTo = (id: string, index: number) => {
    const next = order.filter((x) => x !== id);
    next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
    p.onChange?.({ order: next });
  };
  const kit = usePickPlace({
    rootRef: root,
    targets,
    itemLabel: cardText,
    locate: (id) => `pos-${order.indexOf(id)}`,
    onPlace: (id, target) => moveTo(id, Number(target.slice(4))),
    announce: p.announce,
    disabled: !interactive,
    verb: "moved to",
  });

  return (
    <WidgetShell id="sorter" mode={p.mode} buttonsToggle={!review} label={`Rank from ${first} to ${last}`}>
      <div ref={root} className="flex gap-4">
        <div className="flex w-6 shrink-0 flex-col items-center justify-between py-1 text-w-ink-2" aria-hidden="true">
          <span className="text-small [writing-mode:vertical-rl] rotate-180">{first}</span>
          <svg width="12" height="40" viewBox="0 0 12 40" className="my-2 flex-1" aria-hidden="true">
            <path
              d="M6 2 V36 M2 31 L6 37 L10 31"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-small [writing-mode:vertical-rl] rotate-180">{last}</span>
        </div>
        <ol className="flex flex-1 flex-col gap-2" aria-label={`Ranked from ${first} to ${last}`}>
          {order.map((id, i) => {
            const card = props.cards.find((c) => c.id === id);
            if (!card) return null;
            const want = truth?.indexOf(id);
            const off = review && want !== undefined && want !== i;
            return (
              <li
                key={id}
                {...kit.targetProps(`pos-${i}`)}
                className={cn(
                  "flex items-center gap-3 rounded-key",
                  kit.held &&
                    kit.over === `pos-${i}` &&
                    kit.held !== id &&
                    "outline-2 outline-offset-2 outline-sea outline-dashed",
                )}
              >
                <span className="w-5 text-right text-small font-semibold text-w-ink-2 tabular">{i + 1}</span>
                <button
                  type="button"
                  {...kit.itemProps(id)}
                  disabled={!interactive}
                  aria-label={`${cardText(id)}, position ${i + 1}${off && want !== undefined ? `, belongs at ${want + 1}` : ""}`}
                  className={cn(
                    cardClass,
                    "max-w-xl",
                    interactive && "cursor-grab active:cursor-grabbing",
                    kit.held === id && "shadow-2 ring-2 ring-sea",
                    off && "border-dashed shadow-none",
                  )}
                >
                  {interactive ? <Grip /> : null}
                  <CardFace card={card} assetUrl={p.assetUrl} />
                </button>
                {off && want !== undefined ? <ReviewNote>belongs at {want + 1}</ReviewNote> : null}
                {buttons && interactive ? (
                  <span className="flex gap-1">
                    <KeyButton
                      size="sm"
                      aria-label={`Move ${cardText(id)} up`}
                      disabled={i === 0}
                      onClick={() => moveTo(id, i - 1)}
                    >
                      ↑
                    </KeyButton>
                    <KeyButton
                      size="sm"
                      aria-label={`Move ${cardText(id)} down`}
                      disabled={i === order.length - 1}
                      onClick={() => moveTo(id, i + 1)}
                    >
                      ↓
                    </KeyButton>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </WidgetShell>
  );
}
