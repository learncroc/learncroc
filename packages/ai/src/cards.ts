/**
 * Flashcards from a card run: at most 3 flashcards from this learner's own trace — the wrong
 * hook guess, the misconception they showed, a cloze of the card's close.
 */

import type { AttemptRow, CardDraft, CompiledPack, RunState } from "@learncroc/core";
import { plainText } from "@learncroc/core";
import type { AiClient } from "./client";
import { describeAnswer, enforceCap, tidyVoice } from "./guards";
import type { CardsInput } from "./inputs";
import { inputBlock, tag } from "./prompts";
import { CardDraftsDraft } from "./schemas";
import { norm } from "./text";

export function cardsInput(
  pack: CompiledPack,
  run: RunState,
  attempts: AttemptRow[],
  existing: string[],
): CardsInput | undefined {
  const nodeId = run.target;
  const node = nodeId ? pack.nodes[nodeId] : undefined;
  if (!node || !nodeId) return undefined;
  const hookIt = node.hook.interaction;
  const closeText = plainText(node.close.text.replaceAll("{guess}", "your guess"));
  const truth = (() => {
    if (hookIt.kind === "choice") {
      const ids = Array.isArray(hookIt.answer) ? hookIt.answer : [hookIt.answer];
      return `${ids.map((id) => hookIt.options.find((o) => o.id === id)?.text ?? id).join(", ")}. ${closeText}`;
    }
    return closeText;
  })();
  const shown = new Map<string, { id: string; label: string; hint: string }>();
  for (const a of attempts) {
    if (a.correct || a.answer.kind !== "choice") continue;
    const it = [
      node.hook.interaction,
      ...node.screens.flatMap((s) => (s.interaction ? [s.interaction] : [])),
      ...node.items,
    ].find((i) => i.id === a.interactionId);
    if (it?.kind !== "choice") continue;
    const sel = Array.isArray(a.answer.selected) ? a.answer.selected : [a.answer.selected];
    for (const id of sel) {
      const m = it.options.find((o) => o.id === id)?.misconception;
      const mis = m ? node.misconceptions[m] : undefined;
      if (m && mis) shown.set(m, { id: m, label: mis.label, hint: mis.hint });
    }
  }
  const myWords = closeText;
  return {
    kind: "cards",
    nodeId,
    nodeTitle: node.title,
    ...(run.guess
      ? {
          hook: {
            prompt: hookIt.prompt,
            guess: describeAnswer(run.guess.answer, hookIt),
            truth,
            correct: run.guess.correct,
          },
        }
      : {}),
    misconceptions: [...shown.values()],
    ...(myWords ? { myWords } : {}),
    existing,
  };
}

export async function draftCards(client: AiClient, input: CardsInput): Promise<CardDraft[]> {
  if (!input.hook && input.misconceptions.length === 0 && !input.myWords) return [];
  const { value } = await client.object({
    feature: "cards",
    promptId: "cards",
    schema: CardDraftsDraft,
    schemaName: "CardDraftsDraft",
    messages: [
      {
        role: "user",
        content: `Stop: ${input.nodeTitle}\n${input.hook ? `Hook: ${input.hook.prompt}\nTheir guess: ${tag("learner", input.hook.guess)} (${input.hook.correct ? "right" : "wrong"})\nWhat is true: ${input.hook.truth}\n` : ""}Misconceptions they showed: ${input.misconceptions.map((m) => m.label).join("; ") || "none"}\n${input.myWords ? `Their Say it sentence: ${tag("learner", input.myWords)}\n` : ""}Existing card fronts: ${input.existing.join(" | ") || "none"}\n\n${inputBlock(input)}`,
      },
    ],
  });
  const seen = new Set(input.existing.map(norm));
  const out: CardDraft[] = [];
  for (const c of value.cards) {
    const front = enforceCap(tidyVoice(c.front), 20);
    const back = enforceCap(tidyVoice(c.back), 25);
    if (!front || !back || seen.has(norm(front))) continue;
    if (c.kind === "cloze" && (front.match(/\{\{answer\}\}/g) ?? []).length !== 1) continue;
    seen.add(norm(front));
    out.push({ front, back, kind: c.kind, nodeId: input.nodeId, reason: c.reason });
    if (out.length === 3) break;
  }
  return out;
}
