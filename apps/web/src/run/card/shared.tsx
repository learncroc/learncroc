/**
 * Pieces both card players use: the typed hunch in session storage, side-question labels, Moss's
 * feedback lines, the divider between typed cards and the intro's list of questions.
 */
import type { CompiledPack, NodeId } from "@learncroc/core";
import { askHeadline, type TypedCard } from "../content";
import type { TaskFeedback } from "../TaskView";
import { Indent, MossLine } from "./moss";

// ── the typed hunch (client only; the server gets "No idea yet")

function hunchKey(packId: string, nodeId: string) {
  return `lm.hunch.${packId}.${nodeId}`;
}
export function readHunch(packId: string, nodeId: string): string {
  try {
    return sessionStorage.getItem(hunchKey(packId, nodeId)) ?? "";
  } catch {
    return "";
  }
}
export function writeHunch(packId: string, nodeId: string, v: string) {
  try {
    if (v) sessionStorage.setItem(hunchKey(packId, nodeId), v);
    else sessionStorage.removeItem(hunchKey(packId, nodeId));
  } catch {
    /* storage off */
  }
}

export const ALT_LABEL: Record<string, string> = {
  simpler: "Explain it another way",
  example: "Another example",
  analogy: "Give me an analogy",
  why: "Why does that work?",
  story: "Tell it as a story",
};

export interface Aside {
  seg: string;
  q: string;
  a: string;
}

/** A graded answer, in Moss's words. */
export function Feedback({ f, packId, rm }: { f: TaskFeedback; packId: string; rm: boolean }) {
  if (f.tone === "right") {
    return (
      <div className="flex flex-col gap-3" data-feedback="right">
        <MossLine text={f.text ?? "That's it."} mood="happy" packId={packId} reducedMotion={rm} />
        {f.reveal && f.reveal !== f.text ? (
          <MossLine text={f.reveal} mood="happy" packId={packId} reducedMotion={rm} />
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-feedback={f.second ? "second-miss" : "wrong"}>
      <MossLine
        text={f.text ?? (f.second ? (f.worked ?? "Here's how it goes.") : "Not quite. Have another go.")}
        mood="curious"
        packId={packId}
        reducedMotion={rm}
      />
      {f.second && f.text && f.worked ? (
        <MossLine text={f.worked} mood="idle" packId={packId} reducedMotion={rm} />
      ) : null}
      {f.reveal ? <MossLine text={f.reveal} mood="idle" packId={packId} reducedMotion={rm} /> : null}
    </div>
  );
}

/** A thin rule between typed cards (no label: the card's job shows in what Moss says). */
export function TypeDivider(_: { card: TypedCard }) {
  return <hr className="my-1 border-line" aria-hidden />;
}

/** The map's other playable stops, each with the question it asks. */
export function introStops(pack: CompiledPack, selfId: NodeId): NodeId[] {
  return pack.map.topo.filter((id) => {
    const e = pack.map.nodes[id];
    return id !== selfId && e?.kind === "node" && e.status !== "planned";
  });
}

export function IntroQuestions({ pack, stops }: { pack: CompiledPack; stops: NodeId[] }) {
  return (
    <Indent>
      <ol className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2" data-intro-questions>
        {stops.map((id, i) => {
          const n = pack.nodes[id];
          return (
            <li key={id} className="flex gap-2.5 rounded-sm bg-surface-2 px-3 py-2 text-small">
              <span className="grid size-5 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-micro font-semibold">
                {i + 1}
              </span>
              <span className="min-w-0">
                <b className="block font-semibold text-ink">{n?.title ?? pack.map.nodes[id]?.title ?? id}</b>
                <span className="text-ink-2">{n ? askHeadline(n) : "Still being written."}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Indent>
  );
}
