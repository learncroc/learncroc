/**
 * listen: play a phrase (pre-rendered pack audio; Web Speech fallback) at 0.7× or 1×, then pick or
 * type what was said. `shadow` task: record yourself (in memory, never uploaded), compare, self-rate.
 */
import { matchText, TYPED_DEFAULT } from "../dialogue/text";
import { graded } from "../shared/spec-helpers";
import { AssetPath, Normalize, SelfRating, type WidgetSpec, z } from "../shared/zod";

export const ListenProps = z.strictObject({
  /** Pre-rendered audio (required in curated language packs and in bosses/placement, L021). */
  src: AssetPath.optional(),
  /** Web Speech fallback; one of src/tts required. */
  tts: z.strictObject({ text: z.string(), lang: z.string() }).optional(),
  /** e.g. [0.7, 1] */
  speeds: z.array(z.number()),
  transcript: z.string(),
  translation: z.string().optional(),
  showTranscript: z.enum(["after", "toggle"]),
  /** Default "identify"; shadow = record yourself, compare, self-rate. */
  task: z.enum(["identify", "shadow"]).optional(),
  /** identify only. */
  answerKind: z.enum(["choice", "type"]).optional(),
  /** Choice mode. */
  options: z.array(z.string()).optional(),
});

export const ListenGoal = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("choice"), answer: z.string() }),
  z.strictObject({ kind: z.literal("type"), accept: z.array(z.string()), normalize: z.array(Normalize).optional() }),
  /** Self-rated; never counted toward a pass or used for tuning. */
  z.strictObject({ kind: z.literal("shadow") }),
]);

/** Recordings never leave the browser. */
export const ListenAnswer = z.object({
  choice: z.string().optional(),
  text: z.string().optional(),
  selfRating: SelfRating.optional(),
});

export type ListenProps = z.infer<typeof ListenProps>;
export type ListenGoal = z.infer<typeof ListenGoal>;
export type ListenAnswer = z.infer<typeof ListenAnswer>;

/** What the learner does: pick an option, type, or shadow. */
export function listenKind(p: ListenProps): "choice" | "type" | "shadow" {
  if (p.task === "shadow") return "shadow";
  return p.answerKind ?? (p.options?.length ? "choice" : "type");
}

function validate(p: ListenProps, goal?: ListenGoal): string[] {
  const errors: string[] = [];
  if (!p.src && !p.tts) errors.push("listen needs src (pack audio) or tts (speech fallback)");
  if (p.tts && p.tts.text.trim() === "") errors.push("tts.text is empty");
  if (p.speeds.length === 0) errors.push("speeds needs at least one value, e.g. [0.7, 1]");
  if (p.speeds.some((s) => !(s >= 0.5 && s <= 1.5))) errors.push("speeds must be between 0.5 and 1.5");
  if (new Set(p.speeds).size !== p.speeds.length) errors.push("speeds must be distinct");
  if (p.transcript.trim() === "") errors.push("transcript is required (it is the fallback when audio can't play)");
  const kind = listenKind(p);
  if (kind === "choice") {
    const opts = p.options ?? [];
    if (opts.length < 2 || opts.length > 5) errors.push("choice mode needs 2–5 options");
    if (new Set(opts).size !== opts.length) errors.push("options must be distinct");
  }
  if (kind === "shadow" && p.answerKind) errors.push("answerKind applies to the identify task only");
  if (!goal) return errors;
  if (goal.kind !== kind) errors.push(`goal kind "${goal.kind}" doesn't match the task (${kind})`);
  else if (goal.kind === "choice" && !(p.options ?? []).includes(goal.answer)) {
    errors.push(`goal answer "${goal.answer}" isn't one of the options`);
  } else if (goal.kind === "type" && goal.accept.length === 0) {
    errors.push("type goal needs at least one accepted answer");
  }
  return errors;
}

function grade({ goal, answer }: { props: ListenProps; goal: ListenGoal; answer: ListenAnswer }) {
  if (goal.kind === "choice") {
    const ok = answer.choice === goal.answer;
    return graded(ok, ok ? 1 : 0, { solution: { choice: goal.answer } satisfies ListenAnswer });
  }
  if (goal.kind === "type") {
    const m = matchText(answer.text ?? "", goal.accept, goal.normalize ?? TYPED_DEFAULT);
    return graded(m.matched, m.matched ? 1 : 0, {
      solution: { text: goal.accept[0] ?? "" } satisfies ListenAnswer,
      feedback: m.matched && m.accentSlip ? `Understood. With accents: ${m.accepted}` : undefined,
    });
  }
  // Shadowing is self-rated practice: any rating completes it; nothing here is scored against the learner.
  const rated = answer.selfRating !== undefined;
  return graded(rated, rated ? 1 : 0);
}

export const listenSpec: WidgetSpec<ListenProps, ListenGoal, ListenAnswer> = {
  id: "listen",
  version: 1,
  title: "Listen",
  family: "language",
  description:
    "Play a phrase at natural or slow speed (pack audio, else the browser's voice), then pick or type what was said; or shadow it: record yourself in memory, play it next to the model line, and rate yourself. The transcript is always available after answering, or whenever audio can't play.",
  llmDoc: {
    useWhen: "Listening comprehension or pronunciation practice in a language pack.",
    notFor: "Reading comprehension, or anything graded on pronunciation (shadowing is self-rated and never counted).",
    learnerDoes:
      "Plays the clip at each speed, then picks an option or types what was said (accent-tolerant), or records, compares and self-rates (shadow).",
    reports: '{ choice } | { text } | { selfRating: "got-it" | "partly" | "missed" }',
  },
  props: ListenProps,
  goal: ListenGoal,
  answer: ListenAnswer,
  validate,
  grade,
  initialAnswer: () => ({}),
  textAlternative: (p) =>
    `An audio clip of a phrase${p.tts ? ` in ${p.tts.lang}` : ""}, playable at ${p.speeds.map((s) => `${s}×`).join(" or ")}${
      p.showTranscript === "toggle" ? "; the transcript can be shown" : "; the transcript appears after answering"
    }.`,
  toText: (p, a) => {
    const base = `Audio: "${p.transcript}"${p.translation ? ` (${p.translation})` : ""}.`;
    if (a?.choice) return `${base} Picked: ${a.choice}.`;
    if (a?.text) return `${base} Typed: ${a.text}.`;
    if (a?.selfRating) return `${base} Shadowed it, self-rated ${a.selfRating}.`;
    return base;
  },
  examples: [
    {
      note: "Pick what Lola said",
      props: {
        src: "assets/audio/mas-despacio.ogg",
        tts: { text: "¿Más despacio, por favor?", lang: "es-ES" },
        speeds: [0.7, 1],
        transcript: "¿Más despacio, por favor?",
        translation: "Slower, please?",
        showTranscript: "after",
        answerKind: "choice",
        options: ["¿Más despacio, por favor?", "¿Más espacio, por favor?", "Más tarde, por favor."],
      },
      goal: { kind: "choice", answer: "¿Más despacio, por favor?" },
      correctAnswer: { choice: "¿Más despacio, por favor?" },
      wrongAnswer: { choice: "¿Más espacio, por favor?" },
    },
    {
      note: "Type the order you heard (accents optional)",
      props: {
        tts: { text: "Una caña, por favor.", lang: "es-ES" },
        speeds: [0.7, 1],
        transcript: "Una caña, por favor.",
        translation: "A small beer, please.",
        showTranscript: "toggle",
        answerKind: "type",
      },
      goal: { kind: "type", accept: ["Una caña, por favor"] },
      correctAnswer: { text: "una cana por favor" },
      wrongAnswer: { text: "una cama por favor" },
    },
    {
      note: "Shadow Lola's line and rate yourself",
      props: {
        src: "assets/audio/la-cuenta.ogg",
        tts: { text: "La cuenta, por favor.", lang: "es-ES" },
        speeds: [0.7, 1],
        transcript: "La cuenta, por favor.",
        translation: "The bill, please.",
        showTranscript: "toggle",
        task: "shadow",
      },
      goal: { kind: "shadow" },
      correctAnswer: { selfRating: "partly" },
      wrongAnswer: {},
    },
  ],
};
