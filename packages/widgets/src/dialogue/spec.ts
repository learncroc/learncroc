/**
 * dialogue: branching scripted conversation with a character (line, translation toggle, audio).
 * Choices can set state (Lola's speed). Typed-reply nodes accept accent-tolerant answers.
 */
import { graded } from "../shared/spec-helpers";
import { AssetPath, GuideGlyph, Normalize, type WidgetSpec, z } from "../shared/zod";
import { matchText, TYPED_DEFAULT } from "./text";

const StateValue = z.union([z.string(), z.number()]);

export const DialogueProps = z.strictObject({
  /** "A bar in Córdoba, 9 pm" */
  setting: z.string(),
  character: z.strictObject({
    name: z.string(),
    glyph: GuideGlyph.optional(),
    avatar: AssetPath.optional(),
    lang: z.string().optional(),
    speak: z.boolean().optional(),
  }),
  /** Node id. */
  start: z.string(),
  nodes: z.array(
    z.strictObject({
      id: z.string(),
      /** What the character says (target language allowed). */
      line: z.string(),
      /** Filled by the compiler from packs:audio. */
      audio: AssetPath.optional(),
      translation: z.string().optional(),
      /** next null = ending. */
      choices: z
        .array(
          z.strictObject({
            text: z.string(),
            next: z.string().nullable(),
            note: z.string().optional(),
            good: z.boolean().optional(),
            set: z.record(z.string(), StateValue).optional(),
          }),
        )
        .optional(),
      /** Typed production turn (accent-tolerant). */
      reply: z
        .strictObject({
          accept: z.array(z.string()),
          normalize: z.array(Normalize).optional(),
          next: z.string(),
          else: z.string(),
        })
        .optional(),
    }),
  ),
  /** e.g. { speed: 1.0 } — Lola's speed dial. */
  state: z.record(z.string(), StateValue).optional(),
  /** Shown as a checklist. */
  goals: z.array(z.string()).optional(),
  /** AI free-reply upgrade (key only). */
  ai: z
    .strictObject({
      enabled: z.boolean(),
      persona: z.string(),
      vocabulary: z.array(z.string()).optional(),
      maxWords: z.number().int().optional(),
    })
    .optional(),
});

export const DialogueGoal = z.discriminatedUnion("kind", [
  /** Node ids that count as success. */
  z.strictObject({ kind: z.literal("reach"), endings: z.array(z.string()) }),
  z.strictObject({ kind: z.literal("good-choices"), min: z.number().int() }),
]);

export const DialogueAnswer = z.object({
  path: z.array(z.string()),
  endedAt: z.string().nullable(),
  goodCount: z.number(),
  typed: z.record(z.string(), z.string()).optional(),
});

export type DialogueProps = z.infer<typeof DialogueProps>;
export type DialogueGoal = z.infer<typeof DialogueGoal>;
export type DialogueAnswer = z.infer<typeof DialogueAnswer>;
export type DialogueNode = DialogueProps["nodes"][number];

/** A node ends the conversation when it offers nothing more to say. */
export function isTerminal(n: DialogueNode): boolean {
  return (!n.choices || n.choices.length === 0) && !n.reply;
}

/** Can the conversation end at this node (terminal, or a choice whose next is null)? */
export function canEndAt(n: DialogueNode): boolean {
  return isTerminal(n) || (n.choices ?? []).some((c) => c.next === null);
}

/** Node ids reachable in one step from n. */
export function nextIds(n: DialogueNode): string[] {
  const out = (n.choices ?? []).flatMap((c) => (c.next === null ? [] : [c.next]));
  if (n.reply) out.push(n.reply.next, n.reply.else);
  return out;
}

function reachable(p: DialogueProps): Set<string> {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [p.start];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    const n = byId.get(id);
    if (!n) continue;
    seen.add(id);
    stack.push(...nextIds(n));
  }
  return seen;
}

/** Most good choices any walk from the start can collect (cycles are walked once). */
export function maxGoodChoices(p: DialogueProps): number {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const walk = (id: string, onPath: Set<string>, depth: number): number => {
    const n = byId.get(id);
    if (!n || onPath.has(id) || depth > 60) return 0;
    onPath.add(id);
    let best = 0;
    for (const c of n.choices ?? []) {
      const here = c.good ? 1 : 0;
      best = Math.max(best, here + (c.next === null ? 0 : walk(c.next, onPath, depth + 1)));
    }
    if (n.reply) best = Math.max(best, walk(n.reply.next, onPath, depth + 1), walk(n.reply.else, onPath, depth + 1));
    onPath.delete(id);
    return best;
  };
  return walk(p.start, new Set(), 0);
}

function validate(p: DialogueProps, goal?: DialogueGoal): string[] {
  const errors: string[] = [];
  const ids = p.nodes.map((n) => n.id);
  const known = new Set(ids);
  if (p.nodes.length === 0) errors.push("dialogue needs at least one node");
  if (known.size !== ids.length) errors.push("node ids must be unique");
  if (!known.has(p.start)) errors.push(`start node "${p.start}" doesn't exist`);
  for (const n of p.nodes) {
    if (n.choices?.length && n.reply) errors.push(`node "${n.id}" has both choices and a typed reply; pick one`);
    if (n.choices && n.choices.length > 5) errors.push(`node "${n.id}" has more than 5 choices`);
    for (const c of n.choices ?? []) {
      if (c.next !== null && !known.has(c.next))
        errors.push(`node "${n.id}" has a choice leading to unknown node "${c.next}"`);
    }
    if (n.reply) {
      if (n.reply.accept.length === 0) errors.push(`node "${n.id}" reply needs at least one accepted answer`);
      for (const k of [n.reply.next, n.reply.else]) {
        if (!known.has(k)) errors.push(`node "${n.id}" reply leads to unknown node "${k}"`);
      }
    }
  }
  if (p.character.speak && !p.character.lang) errors.push("character.speak needs character.lang");
  if (errors.length) return errors;
  const reach = reachable(p);
  for (const id of ids) if (!reach.has(id)) errors.push(`node "${id}" can't be reached from the start`);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  if (![...reach].some((id) => canEndAt(byId.get(id) as DialogueNode))) {
    errors.push("the conversation never ends: add a node with no choices or a choice with next: null");
  }
  if (!goal) return errors;
  if (goal.kind === "reach") {
    if (goal.endings.length === 0) errors.push("reach goal needs at least one ending");
    for (const id of goal.endings) {
      const n = byId.get(id);
      if (!n) errors.push(`reach goal names unknown node "${id}"`);
      else if (!canEndAt(n)) errors.push(`reach goal ending "${id}" isn't an ending (it has more to say)`);
      else if (!reach.has(id)) errors.push(`reach goal ending "${id}" can't be reached`);
    }
  } else {
    const max = maxGoodChoices(p);
    if (goal.min < 1) errors.push("good-choices min must be at least 1");
    if (goal.min > max) errors.push(`good-choices min ${goal.min} is more than any path offers (${max})`);
  }
  return errors;
}

/** Check the answer is a real walk through the conversation; returns the good choices it could contain. */
export function checkPath(p: DialogueProps, a: DialogueAnswer): { valid: boolean; goodBound: number } {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  if (a.path[0] !== p.start) return { valid: false, goodBound: 0 };
  let good = 0;
  for (let i = 1; i < a.path.length; i++) {
    const from = byId.get(a.path[i - 1] as string);
    const to = a.path[i] as string;
    if (!from || !nextIds(from).includes(to)) return { valid: false, goodBound: 0 };
    if ((from.choices ?? []).some((c) => c.next === to && c.good)) good++;
    // A typed turn only leads to its success branch when what was typed matches.
    const reply = from.reply;
    if (reply && to === reply.next && reply.next !== reply.else) {
      const typed = a.typed?.[from.id] ?? "";
      if (!matchText(typed, reply.accept, reply.normalize ?? TYPED_DEFAULT).matched) {
        return { valid: false, goodBound: 0 };
      }
    }
  }
  if (a.endedAt !== null) {
    const last = byId.get(a.path[a.path.length - 1] as string);
    if (a.endedAt !== last?.id || !canEndAt(last)) return { valid: false, goodBound: 0 };
    if ((last.choices ?? []).some((c) => c.next === null && c.good)) good++;
  }
  return { valid: true, goodBound: good };
}

function grade({ props, goal, answer }: { props: DialogueProps; goal: DialogueGoal; answer: DialogueAnswer }) {
  const { valid, goodBound } = checkPath(props, answer);
  if (!valid) return graded(false, 0, { feedback: "That path doesn't follow the conversation." });
  if (goal.kind === "reach") {
    const ok = answer.endedAt !== null && goal.endings.includes(answer.endedAt);
    return graded(ok, ok ? 1 : 0, {
      feedback: ok ? undefined : answer.endedAt === null ? "The conversation isn't finished yet." : undefined,
    });
  }
  const good = Math.min(answer.goodCount, goodBound);
  const ok = good >= goal.min;
  return graded(ok, Math.min(1, good / Math.max(1, goal.min)));
}

export const dialogueSpec: WidgetSpec<DialogueProps, DialogueGoal, DialogueAnswer> = {
  id: "dialogue",
  version: 1,
  title: "Dialogue",
  family: "language",
  description:
    "A branching conversation with a character: lines with audio and a translation toggle, reply choices that can change state (Lola's speed dial), and typed replies checked accent-tolerantly.",
  llmDoc: {
    useWhen:
      "A realistic exchange (ordering, asking for help, persuading) where the learner chooses or produces replies; boss set pieces like dinner in Sevilla.",
    notFor: "Single-question checks (use a choice interaction) or long reading.",
    learnerDoes:
      "Listens to each line (audio, or speech in character.lang, at state.speed), picks a reply or types one, and plays until an ending; can toggle translations.",
    reports:
      "{ path: [nodeId…], endedAt: nodeId | null, goodCount, typed?: { nodeId: text } } — the widget commits itself when an ending is reached.",
  },
  props: DialogueProps,
  goal: DialogueGoal,
  answer: DialogueAnswer,
  validate,
  grade,
  initialAnswer: (p) => ({ path: [p.start], endedAt: null, goodCount: 0 }),
  textAlternative: (p) => `A conversation with ${p.character.name}: ${p.setting}.`,
  toText: (p, a) => {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const path = a?.path ?? [p.start];
    const lines = path.map((id) => `${p.character.name}: ${byId.get(id)?.line ?? id}`);
    const end = a?.endedAt ? ` (ended at ${a.endedAt})` : "";
    return `${p.setting}. ${lines.join(" / ")}${end}`;
  },
  examples: [
    {
      note: "Lola talks too fast: ask her to slow down, then order",
      props: {
        setting: "A tapas bar in Sevilla, 9 pm",
        character: { name: "Lola", glyph: "lola", lang: "es-ES", speak: true },
        start: "hola",
        state: { speed: 1.2 },
        goals: ["Ask Lola to slow down", "Order a drink"],
        nodes: [
          {
            id: "hola",
            line: "¡Hola! ¿Qué te pongo, cariño?",
            translation: "Hi. What can I get you, love?",
            choices: [
              {
                text: "¿Más despacio, por favor?",
                next: "despacio",
                good: true,
                set: { speed: 0.8 },
                note: "Asking for slower speech is a power move.",
              },
              { text: "Sí.", next: "confused", note: "Sí answers a yes/no question; she asked what you want." },
            ],
          },
          {
            id: "confused",
            line: "¿Sí qué? ¿Una caña, un vino…?",
            translation: "Yes what? A small beer, a wine…?",
            choices: [{ text: "¿Más despacio, por favor?", next: "despacio", good: true, set: { speed: 0.8 } }],
          },
          {
            id: "despacio",
            line: "Claro. ¿Qué… te… pongo?",
            translation: "Sure. What… can I… get you?",
            reply: { accept: ["Una caña, por favor", "Una cerveza, por favor"], next: "served", else: "again" },
          },
          {
            id: "again",
            line: "Perdona, no te he entendido. ¿Una caña?",
            translation: "Sorry, I didn't get that. A small beer?",
            choices: [{ text: "Sí, una caña, por favor.", next: "served", good: true }],
          },
          { id: "served", line: "¡Marchando una caña!", translation: "One small beer, coming up." },
        ],
      },
      goal: { kind: "reach", endings: ["served"] },
      correctAnswer: {
        path: ["hola", "despacio", "served"],
        endedAt: "served",
        goodCount: 1,
        typed: { despacio: "una cana por favor" },
      },
      wrongAnswer: { path: ["hola", "confused", "despacio"], endedAt: null, goodCount: 1 },
    },
    {
      note: "The elevator pitch: two good moves out of three",
      props: {
        setting: "An elevator, 30 seconds to the fifth floor",
        character: { name: "Dana, a busy investor", glyph: "generic" },
        start: "ask",
        nodes: [
          {
            id: "ask",
            line: "So, what are you working on?",
            choices: [
              { text: "A tool that saves nurses an hour a shift.", next: "interest", good: true },
              { text: "It's hard to explain, it's very technical.", next: "flat" },
            ],
          },
          {
            id: "interest",
            line: "An hour? How do you know?",
            choices: [
              { text: "We timed 40 shifts at two hospitals.", next: "card", good: true },
              { text: "Everyone says so.", next: "flat" },
            ],
          },
          {
            id: "flat",
            line: "Hm. Well, this is my floor.",
            choices: [{ text: "Thanks for listening.", next: null }],
          },
          { id: "card", line: "Send me the numbers. Here's my card." },
        ],
      },
      goal: { kind: "good-choices", min: 2 },
      correctAnswer: { path: ["ask", "interest", "card"], endedAt: "card", goodCount: 2 },
      wrongAnswer: { path: ["ask", "interest", "flat"], endedAt: "flat", goodCount: 1 },
    },
  ],
};
