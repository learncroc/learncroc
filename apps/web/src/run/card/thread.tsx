/**
 * The card thread's building blocks: a segment is a list of items (Moss's lines, the article, a figure,
 * a question) shown one after another with Moss "typing" before each line, and what each typed card
 * puts in it. Segments are derived from the server's run state, so a resumed or replayed run rebuilds
 * the same thread; only new segments animate.
 */
import {
  type Block,
  type CompiledPack,
  defaultCheckpointSize,
  type NodeId,
  nextCardInOrder,
  type PackNode,
  type RunSummary,
  type Visual,
} from "@learncroc/core";
import { type ReactNode, useEffect, useRef } from "react";
import { BlockView } from "../Blocks";
import { Canvas } from "../Canvas";
import { checkpointLabel, titleOf } from "../content";
import { Md } from "../Markdown";
import { Indent, MossLine, type MossMood, Passage, Typing, typingMs, useReveal } from "./moss";

export interface Item {
  id: string;
  /** Moss's words (paces the typing dots). */
  moss?: string;
  node: ReactNode;
}

/** A segment's items, revealed in order. `onDone` fires once everything is on screen. */
export function Seq(p: { items: Item[]; animate: boolean; lang?: string; onDone?(): void }) {
  const delays = p.items.map((it, i) => (it.moss !== undefined ? typingMs(it.moss) : i === 0 ? 120 : 220));
  const { shown, typing } = useReveal(delays, p.animate);
  const done = shown >= p.items.length;
  const onDone = p.onDone;
  useEffect(() => {
    if (done) onDone?.();
  }, [done, onDone]);
  return (
    <>
      {p.items.slice(0, shown).map((it) => (
        <div key={it.id} className="contents">
          {it.node}
        </div>
      ))}
      {typing ? <Typing /> : null}
    </>
  );
}

export function moss(id: string, text: string, packId: string, mood: MossMood = "idle", rm?: boolean): Item {
  return { id, moss: text, node: <MossLine text={text} mood={mood} packId={packId} reducedMotion={rm} /> };
}

export function plain(id: string, node: ReactNode): Item {
  return { id, node };
}

/**
 * A beat's blocks as thread items: stories are Moss talking, quotes are the article (Moss introduces one
 * when the author didn't), anything else sits under Moss. The picture goes after the line that follows
 * the last passage (the plain-words line), else after the first line.
 */
export function blockItems(
  prefix: string,
  blocks: readonly Block[],
  ctx: { packId: string; lang?: string; rm?: boolean; visual?: ReactNode },
): Item[] {
  const out: Item[] = [];
  blocks.forEach((b, i) => {
    const id = `${prefix}-b${i}`;
    if (b.type === "say")
      out.push({
        id,
        moss: b.text,
        node: (
          <MossLine
            text={b.text}
            mood={b.mood ?? "idle"}
            packId={ctx.packId}
            reducedMotion={ctx.rm}
            {...(b.outside ? { outside: true } : {})}
          />
        ),
      });
    else if (b.type === "story") out.push(moss(id, b.text, ctx.packId, "idle", ctx.rm));
    else if (b.type === "quote") {
      if (out.at(-1)?.moss === undefined) out.push(moss(`${id}-lead`, "Here's how the article puts it:", ctx.packId));
      out.push(
        plain(
          id,
          <Indent>
            <Passage block={b} />
          </Indent>,
        ),
      );
    } else
      out.push(
        plain(
          id,
          <Indent>
            <BlockView block={b} packId={ctx.packId} {...(ctx.lang ? { lang: ctx.lang } : {})} />
          </Indent>,
        ),
      );
  });
  if (ctx.visual) {
    const lastQuote = blocks.map((b) => b.type).lastIndexOf("quote");
    // Items can include an extra lead line before a quote: place by block, then map to item position.
    const after = lastQuote >= 0 ? lastQuote + 1 : 0;
    const anchorId = `${prefix}-b${Math.min(after, blocks.length - 1)}`;
    const at = out.findIndex((it) => it.id === anchorId);
    out.splice(at >= 0 ? at + 1 : out.length, 0, plain(`${prefix}-visual`, <Indent>{ctx.visual}</Indent>));
  }
  return out;
}

export function VisualCanvas(p: {
  pack: CompiledPack;
  node: PackNode;
  visual: Visual;
  visualKey: string;
  rm: boolean;
}) {
  return (
    <Canvas
      packId={p.pack.manifest.id}
      nodeId={p.node.id}
      theme={p.pack.manifest.theme}
      content={{ kind: "visual", key: p.visualKey, visual: p.visual }}
      reducedMotion={p.rm}
      className="min-h-[240px] lg:min-h-[300px]"
    />
  );
}

/** The question a stop opens with, as a headline. */
export function Headline({ label, text, packId }: { label: string; text: string; packId: string }) {
  return (
    <div
      className="rounded-md border-2 border-ink bg-surface-2 px-5 py-4"
      style={{ boxShadow: "var(--key-rest)" }}
      data-headline
    >
      <p className="t-micro mb-1 text-ink-3 uppercase tracking-wide">{label}</p>
      <h2 className="t-title voice-casual m-0 text-ink" style={{ fontVariationSettings: '"CASL" 0.7' }}>
        <Md text={text} packId={packId} />
      </h2>
    </div>
  );
}

// ── what comes after a stop

export interface NextStep {
  /** The primary reply, or undefined (embed, end of map). */
  label?: string;
  /** Moss's line about what's next (replaces the teaser for checkpoints and revisits). */
  line?: string;
  disabled: boolean;
  kind?: "node" | "checkpoint";
  go(): void;
}

/** The next stop after this one: the next card, its section's checkpoint, or back to a checkpoint. */
export function useNextStep(p: {
  pack: CompiledPack;
  node: PackNode;
  summary?: RunSummary;
  from?: NodeId;
  variant: "modal" | "embed";
  onNavigate?(to: { nodeId: NodeId; kind: "node" | "checkpoint"; from?: NodeId }): void;
}): NextStep {
  const { pack, node, summary, from } = p;
  const next = summary?.next;
  // A card still being written (article maps): the reply waits and wakes when the pack refetches.
  const waitingFor = useRef<NodeId | undefined>(undefined);
  if (summary && !next && waitingFor.current === undefined) {
    const after = nextCardInOrder(pack.map, node.id);
    if (after && isBuilding(pack, after)) waitingFor.current = after;
  }
  const target: { nodeId: NodeId; kind: "node" | "checkpoint" } | undefined =
    next ?? (waitingFor.current ? { nodeId: waitingFor.current, kind: "node" } : undefined);
  const building = target?.kind === "node" && isBuilding(pack, target.nodeId);
  const gate = target?.kind === "checkpoint" ? pack.map.nodes[target.nodeId] : undefined;
  const gateSize = gate ? (gate.size ?? defaultCheckpointSize(gate.covers?.length ?? 2)) : 0;

  let label: string | undefined;
  let line: string | undefined;
  let disabled = !summary;
  if (p.variant === "embed") {
    line = "Install to keep going.";
  } else if (from) {
    label = "Back to the checkpoint";
    line = "Fresh questions are waiting at the checkpoint.";
  } else if (target?.kind === "checkpoint") {
    label = checkpointLabel(pack, target.nodeId);
    line = `That's the section. ${gateSize} questions open the next part of the map. I give hints there, not answers.`;
  } else if (target) {
    label = `Next: ${titleOf(pack, target.nodeId)}`;
    if (building) {
      disabled = true;
      line = "The next stop is still being written. Usually under a minute.";
    }
  } else if (summary) {
    line = "That's the last stop on this map.";
  }
  return {
    ...(label ? { label } : {}),
    ...(line ? { line } : {}),
    disabled: disabled || !p.onNavigate,
    ...(target ? { kind: target.kind } : {}),
    go: () => {
      if (disabled || !summary) return;
      if (from) p.onNavigate?.({ nodeId: from, kind: "checkpoint" });
      else if (target) p.onNavigate?.({ nodeId: target.nodeId, kind: target.kind });
    },
  };
}

function isBuilding(pack: CompiledPack, id: NodeId): boolean {
  const e = pack.map.nodes[id];
  return e?.kind === "node" && (e.status === "building" || !pack.nodes[id]);
}
