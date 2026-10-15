/**
 * The AiPorts implementation handed to createServer (CONTRACTS §9.2). Every method resolves null on
 * any failure, so core always has its offline path: authored hints, self-rating, authored Nib lines,
 * the item bank.
 */
import type { AiPorts, CompiledPack, ExplainGrade, Item, NodeId, Settings } from "@learncroc/core";
import { AiClient, type AiClientEnv } from "./client";
import { findInteraction } from "./context";
import { itemFromDraft } from "./convert";
import { AiError } from "./errors";
import { answerLeak, describeAnswer, enforceCap, GRADE_FEEDBACK_MAX_WORDS, HINT_MAX_WORDS, tidyVoice } from "./guards";
import type { GradeInput, HintInput, SolveInput, VariantInput } from "./inputs";
import { modelFor } from "./models";
import { inputBlock, tag } from "./prompts";
import { ExplainGradeDraft, HintDraft, type ItemDraft, QuizVariantDraft, SolverAnswer } from "./schemas";
import { hash32, norm } from "./text";
import type { AIProvider } from "./types";

export interface AiPortsOptions extends Partial<Omit<AiClientEnv, "provider" | "models" | "providerId">> {
  /** Called when a port swallows an error (logging). */
  onError?(where: string, e: unknown): void;
}

/** Build the AiPorts implementation from settings and a provider (null provider = offline ports). */
export function createAiPorts(settings: Settings, provider: AIProvider | null, opts: AiPortsOptions = {}): AiPorts {
  if (!provider) {
    return {
      configured: async () => false,
      gradeExplain: async () => null,
      rewriteHint: async () => null,
      quizVariants: async () => null,
    };
  }
  const ai = settings.ai;
  const client = new AiClient({
    provider,
    providerId: provider.id,
    models: { fast: modelFor(ai, "fast"), smart: modelFor(ai, "smart"), deep: modelFor(ai, "deep") },
    now: opts.now ?? (() => Date.now()),
    ...(opts.meter ? { meter: opts.meter } : {}),
    capUsd: opts.capUsd ?? ai.monthlyCapUsd,
    ...(opts.onSent ? { onSent: opts.onSent } : {}),
    ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
  });
  return aiPortsFor(client, opts.onError);
}

/** AiPorts over an existing client (the runtime shares one client per settings revision). */
export function aiPortsFor(client: AiClient, onError?: (where: string, e: unknown) => void): AiPorts {
  const safe = async <T>(where: string, fn: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      onError?.(where, e);
      return null;
    }
  };

  return {
    configured: async () => true,

    gradeExplain: (a) =>
      safe("gradeExplain", async () => {
        const node = a.pack.nodes[a.nodeId];
        if (!node) return null;
        const input: GradeInput = {
          kind: "grade",
          keyPoints: a.keyPoints.map((k) => ({
            id: k.id,
            text: k.text,
            ...(k.keywords ? { keywords: k.keywords } : {}),
          })),
          minHits: a.minHits,
          text: a.text.slice(0, 1200),
          misconceptions: Object.entries(node.misconceptions).map(([id, m]) => ({ id, label: m.label })),
        };
        const { value } = await client.object({
          feature: "grade",
          promptId: "grade",
          schema: ExplainGradeDraft,
          schemaName: "ExplainGradeDraft",
          messages: [
            {
              role: "user",
              content: `Stop: ${node.title}\nKey points:\n${a.keyPoints.map((k) => `- ${k.id}: ${k.text}`).join("\n")}\nMinimum hits for correct: ${a.minHits}\n\n${tag("learner", a.text.slice(0, 1200))}\n\n${inputBlock(input)}`,
            },
          ],
        });
        const valid = new Set(a.keyPoints.map((k) => k.id));
        const hit = [...new Set(value.hit.filter((h) => valid.has(h)))];
        const missing =
          value.missing && valid.has(value.missing) && !hit.includes(value.missing)
            ? value.missing
            : (a.keyPoints.find((k) => !hit.includes(k.id))?.id ?? null);
        const grade: ExplainGrade = {
          hit,
          missing,
          correct: hit.length >= a.minHits,
          feedback: enforceCap(tidyVoice(value.feedback), GRADE_FEEDBACK_MAX_WORDS),
          source: "ai",
        };
        return grade;
      }),

    rewriteHint: (a) =>
      safe("rewriteHint", async () => {
        const node = a.pack.nodes[a.nodeId];
        const it = node ? findInteraction(node, a.interactionId) : undefined;
        if (!node || !it) return null;
        const input: HintInput = {
          kind: "hint",
          prompt: it.prompt,
          answer: describeAnswer(a.answer, it),
          authoredHint: a.authoredHint,
          level: a.level,
        };
        const level = Math.min(Math.max(a.level, 1), 3);
        for (let attempt = 0; attempt < 2; attempt++) {
          const { value } = await client.object({
            feature: "hint",
            promptId: "hint",
            vars: { hintLevel: level },
            schema: HintDraft,
            schemaName: "HintDraft",
            messages: [
              {
                role: "user",
                content: `Stop: ${node.title}. Big idea: ${node.bigIdea}\nQuestion: ${it.prompt}\nTheir answer: ${tag("learner", input.answer)}\nAuthored hint: ${a.authoredHint}${attempt > 0 ? "\nYour last hint gave the answer away. Point, don't tell." : ""}\n\n${inputBlock(input)}`,
              },
            ],
          });
          const hint = enforceCap(tidyVoice(value.hint), HINT_MAX_WORDS);
          if (!answerLeak(hint, it).leak) return hint;
        }
        return null;
      }),

    quizVariants: (a) =>
      safe("quizVariants", async () => {
        const bank = pickBank(a.pack, a.nodeIds, a.count);
        if (bank.length === 0) return null;
        const results = await Promise.all(
          bank.map(async ({ item, nodeId }) => {
            try {
              return await variantFor(client, a.pack, nodeId, item);
            } catch (e) {
              onError?.("quizVariant", e);
              return null;
            }
          }),
        );
        const ok = results.filter((r): r is Item & { nodeId: NodeId } => r !== null);
        return ok.length > 0 ? ok : null;
      }),
  };
}

const VARIANT_KINDS = new Set(["choice", "numeric", "order", "text"]);

/** Bank items to vary: quiz-eligible, built-in kinds, interleaved across nodes (A4). */
function pickBank(pack: CompiledPack, nodeIds: NodeId[], count: number): { item: Item; nodeId: NodeId }[] {
  const perNode = nodeIds.map((id) =>
    (pack.nodes[id]?.items ?? [])
      .filter((i) => VARIANT_KINDS.has(i.kind) && (!i.use || i.use.includes("checkpoint")) && !i.params)
      .map((item) => ({ item, nodeId: id })),
  );
  const out: { item: Item; nodeId: NodeId }[] = [];
  for (let round = 0; out.length < count && perNode.some((l) => l.length > round); round++) {
    for (const list of perNode) {
      const pick = list[round];
      if (pick && out.length < count) out.push(pick);
    }
  }
  return out;
}

async function variantFor(
  client: AiClient,
  pack: CompiledPack,
  nodeId: NodeId,
  item: Item,
): Promise<(Item & { nodeId: NodeId }) | null> {
  const node = pack.nodes[nodeId];
  if (!node) return null;
  const misconceptions = Object.entries(node.misconceptions).map(([id, m]) => ({ id, label: m.label }));
  const input: VariantInput = {
    kind: "quiz-variant",
    item,
    keyPoints: node.screens.flatMap((sc) => (sc.newIdea ? [sc.newIdea] : [])),
    misconceptions,
  };
  const { value } = await client.object({
    feature: "quiz",
    promptId: "quiz-variant",
    schema: QuizVariantDraft,
    schemaName: "QuizVariantDraft",
    messages: [
      {
        role: "user",
        content: `Stop: ${node.title}. Big idea: ${node.bigIdea}\nKey points: ${input.keyPoints.join("; ")}\nMisconceptions: ${misconceptions.map((m) => `${m.id}: ${m.label}`).join("; ")}\nOriginal item:\n${JSON.stringify(item)}\n\n${inputBlock(input)}`,
      },
    ],
  });
  const draft: ItemDraft = { ...value.item, kind: item.kind as ItemDraft["kind"], level: item.level };
  const id = `qv-${(hash32(`${item.id}:${draft.prompt}`) % 0xffffff).toString(36)}`;
  const issues: { path: string; message: string }[] = [];
  const variant = itemFromDraft(draft, id, new Set(Object.keys(node.misconceptions)), "item", issues);
  if (!variant || norm(variant.prompt) === norm(item.prompt)) return null;
  const agrees = await blindSolve(client, variant);
  return agrees ? { ...variant, use: ["checkpoint"], nodeId } : null;
}

/** The fast tier answers the variant without the key; it must match (PLAN §15.4). */
async function blindSolve(client: AiClient, it: Item): Promise<boolean> {
  const input: SolveInput = {
    kind: "solve",
    itemKind: it.kind,
    question: it.prompt,
    ...(it.kind === "choice" ? { options: it.options.map((o) => ({ id: o.id, text: o.text })) } : {}),
    ...(it.kind === "order" ? { steps: it.items } : {}),
  };
  const shown =
    it.kind === "choice"
      ? `\nOptions:\n${it.options.map((o) => `${o.id}: ${o.text}`).join("\n")}`
      : it.kind === "order"
        ? `\nItems (index: text):\n${it.items.map((s, i) => `${i}: ${s}`).join("\n")}`
        : "";
  const { value } = await client.object({
    feature: "quiz",
    promptId: "solve",
    houseStyle: false,
    schema: SolverAnswer,
    schemaName: "SolverAnswer",
    messages: [{ role: "user", content: `Question (${it.kind}): ${it.prompt}${shown}\n\n${inputBlock(input)}` }],
  });
  switch (it.kind) {
    case "choice":
      return value.choice === it.answer;
    case "numeric":
      return value.number !== null && Math.abs(value.number - it.answer) <= (it.tolerance ?? 0) + 1e-9;
    case "order":
      return value.order !== null && value.order.join(",") === it.answer.join(",");
    case "text":
      return value.text !== null && it.accept.some((a) => norm(a) === norm(value.text ?? ""));
    default:
      return false;
  }
}

export { AiError };
