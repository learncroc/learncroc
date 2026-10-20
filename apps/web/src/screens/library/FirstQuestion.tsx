/**
 * "Or start with one question": the flagship's first hook, live from the compiled
 * pack. Pressing a guess (1–4, or 0 for "No idea yet") opens the card on the map with that guess
 * locked in (`?card=<id>&guess=<optionId|idk>`), so the card lands on its first beat. The hook gives
 * no right or wrong here either; the card's close is where the guess is named.
 */
import type { CompiledPack, HookInteraction, InstalledPackSummary, NodeId, PackNode } from "@learncroc/core";
import { AnswerKey, Button, Croc, Kbd } from "@learncroc/ui";
import { useRouter } from "@tanstack/react-router";
import { useScreenKeys } from "../../app/keys";
import { Inline } from "../../lib/inline";
import { PosterFrame } from "./posterKit";

/** The flagship and the card its home question comes from. */
export const FLAGSHIP = { packId: "how-llms-work", nodeId: "tokens" } as const;

type ChoiceHook = Extract<HookInteraction, { kind: "choice" }>;

export interface FirstQuestionPick {
  summary: InstalledPackSummary;
  pack: CompiledPack;
  node: PackNode & { hook: { interaction: ChoiceHook } };
}

/** The first playable card of a map (map order), for maps without a suggested start. */
function firstCard(pack: CompiledPack): NodeId | undefined {
  return pack.map.topo.find((id) => pack.map.nodes[id]?.kind === "node" && pack.nodes[id] !== undefined);
}

const isChoice = (node: PackNode | undefined): node is FirstQuestionPick["node"] =>
  node?.hook.interaction.kind === "choice";

/**
 * Which question to ask: the flagship's Tokens card; else the suggested start of the first installed
 * curated map (then samplers) whose hook is a choice; none when nothing fits (the block hides).
 */
export function pickFirstQuestion(
  candidates: { summary: InstalledPackSummary; pack?: CompiledPack }[],
): FirstQuestionPick | null {
  const flagship = candidates.find((c) => c.summary.id === FLAGSHIP.packId && c.summary.status === "ok" && c.pack);
  if (flagship?.pack) {
    const p = flagship.pack;
    const id = p.nodes[FLAGSHIP.nodeId] ? FLAGSHIP.nodeId : (p.manifest.entry?.suggestedStart ?? firstCard(p));
    const node = id ? p.nodes[id] : undefined;
    if (isChoice(node)) return { summary: flagship.summary, pack: p, node };
  }
  const rank = (s: InstalledPackSummary) => (s.profile === "curated" ? 0 : s.profile === "sampler" ? 1 : 9);
  const rest = candidates
    .filter((c) => c.summary.status === "ok" && c.summary.kind === "pack" && c.pack && rank(c.summary) < 9)
    .sort((a, b) => rank(a.summary) - rank(b.summary));
  for (const c of rest) {
    const p = c.pack as CompiledPack;
    const id = p.manifest.entry?.suggestedStart ?? firstCard(p);
    const node = id ? p.nodes[id] : undefined;
    if (isChoice(node)) return { summary: c.summary, pack: p, node };
  }
  return null;
}

/** The map URL a guess opens. */
export function guessHref(packId: string, nodeId: string, guess: string): string {
  return `/p/${packId}?card=${encodeURIComponent(nodeId)}&guess=${encodeURIComponent(guess)}`;
}

export function FirstQuestion({ pick }: { pick: FirstQuestionPick }) {
  const router = useRouter();
  const { summary, pack, node } = pick;
  const hook = node.hook.interaction;
  const options = hook.options.slice(0, 9);
  const go = (guess: string) => router.history.push(guessHref(summary.id, node.id, guess));
  const cardNo = Math.max(1, pack.map.topo.filter((id) => pack.map.nodes[id]?.kind === "node").indexOf(node.id) + 1);

  useScreenKeys({
    "0": (e) => {
      e.preventDefault();
      go("idk");
    },
  });

  return (
    <PosterFrame theme={summary.theme} className="shadow-2">
      <section aria-labelledby="first-question" className="grid gap-6 px-8 pt-7 pb-6 md:px-10">
        <p className="text-micro tracking-[0.08em] text-w-ink-2 uppercase">
          {summary.title} · Card {cardNo}
        </p>
        <div className="grid max-w-[64ch] gap-2">
          {(node.hook.blocks ?? []).map((b, i) =>
            "text" in b && typeof b.text === "string" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: authored blocks in fixed order
              <p key={i} className="voice-guide text-lead text-w-ink">
                <Inline text={b.text} />
              </p>
            ) : null,
          )}
          <h3 id="first-question" className="t-heading text-w-ink">
            <Inline text={hook.prompt} />
          </h3>
        </div>
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Your guess">
          {options.map((o, i) => (
            <li key={o.id}>
              <AnswerKey n={i + 1} hotkey onPress={() => go(o.id)} className="w-full">
                <Inline text={o.text} />
              </AnswerKey>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Croc size={44} state="curious" decorative />
            <p className="voice-casual text-body text-w-ink">Guess first. The card will tell you why.</p>
          </div>
          <Button variant="ghost" onClick={() => go("idk")} className="text-w-ink hover:bg-w-grid">
            No idea yet <Kbd keys="0" />
          </Button>
        </div>
      </section>
    </PosterFrame>
  );
}
