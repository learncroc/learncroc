/**
 * train-scene: lamp, lightning or headlight scenario. Frame switch, slow-motion pulses,
 * "subtract light-travel time". Pick front, rear or same (CONTRACTS §7.2 #10).
 */
import { lampFirstHit, lightningFirstStrike, lightningFirstToPassenger } from "../light-clock/relativity";
import type { WidgetCanvas } from "../shared/canvas";
import { graded } from "../shared/spec-helpers";
import { type WidgetSpec, z } from "../shared/zod";

const Pick = z.enum(["front", "rear", "same", "c", "faster", "slower"]);

export const TrainSceneProps = z.strictObject({
  scenario: z.enum(["lamp", "lightning", "headlight"]),
  /** Train speed (fraction of c). */
  v: z.number(),
  frame: z.enum(["train", "platform"]),
  allowFrameSwitch: z.boolean(),
  /** "Subtract light-travel time" button. */
  showDelayCorrection: z.boolean().optional(),
  slowMo: z.boolean().optional(),
});

export const TrainSceneGoal = z.strictObject({ kind: z.literal("pick"), answer: Pick });
export const TrainSceneAnswer = z.object({ pick: Pick });

export type TrainSceneProps = z.infer<typeof TrainSceneProps>;
export type TrainSceneGoal = z.infer<typeof TrainSceneGoal>;
export type TrainSceneAnswer = z.infer<typeof TrainSceneAnswer>;
export type TrainScenePick = TrainSceneAnswer["pick"];

/** The picks each scenario offers, with their labels. */
export const SCENARIO_PICKS: Record<TrainSceneProps["scenario"], { value: TrainScenePick; label: string }[]> = {
  lamp: [
    { value: "front", label: "Front wall first" },
    { value: "rear", label: "Rear wall first" },
    { value: "same", label: "Both at the same time" },
  ],
  lightning: [
    { value: "front", label: "The front strike" },
    { value: "rear", label: "The rear strike" },
    { value: "same", label: "Both at the same time" },
  ],
  headlight: [
    { value: "c", label: "Exactly c" },
    { value: "faster", label: "Faster than c" },
    { value: "slower", label: "Slower than c" },
  ],
};

function validate(p: TrainSceneProps, goal?: TrainSceneGoal): string[] {
  const errors: string[] = [];
  if (!(p.v >= 0 && p.v <= 0.99)) errors.push("v must be between 0 and 0.99 (a fraction of c)");
  if (!goal) return errors;
  const allowed = SCENARIO_PICKS[p.scenario].map((o) => o.value);
  if (!allowed.includes(goal.answer)) {
    errors.push(`the ${p.scenario} scenario offers ${allowed.join(", ")}; goal answer "${goal.answer}" isn't one`);
    return errors;
  }
  if (p.scenario === "headlight" && goal.answer !== "c") {
    errors.push('light from the headlight travels at exactly c in every frame; the goal must be "c"');
  }
  if (!(p.v >= 0 && p.v <= 0.99)) return errors;
  if (p.scenario === "lamp") {
    // With the frame switch on, either frame may be the question: the answer must hold in at least one.
    const frames: TrainSceneProps["frame"][] = p.allowFrameSwitch ? ["train", "platform"] : [p.frame];
    const possible = new Set<string>(frames.map((f) => lampFirstHit(p.v, f)));
    if (!possible.has(goal.answer)) {
      errors.push(
        `at ${p.v}c the lamp's light hits ${[...possible].map((x) => (x === "same" ? "both walls at once" : `the ${x} wall first`)).join(" or ")} (${frames.join(" / ")} frame), never "${goal.answer}"`,
      );
    }
  }
  if (p.scenario === "lightning") {
    // The question is which strike happened first (frame dependent) or which flash reached the passenger
    // first (the front one whenever the train moves, in every frame).
    const frames: TrainSceneProps["frame"][] = p.allowFrameSwitch ? ["train", "platform"] : [p.frame];
    const possible = new Set<string>([
      ...frames.map((f) => lightningFirstStrike(p.v, f)),
      lightningFirstToPassenger(p.v),
    ]);
    if (!possible.has(goal.answer)) {
      errors.push(
        `at ${p.v}c (${frames.join(" / ")} frame) the answer can only be ${[...possible].map((x) => (x === "same" ? "both at once" : `the ${x} one first`)).join(" or ")}, never "${goal.answer}"`,
      );
    }
  }
  return errors;
}

const WRONG_FEEDBACK: Partial<Record<TrainSceneProps["scenario"], Partial<Record<TrainScenePick, string>>>> = {
  lamp: {
    front: "Light doesn't get pushed back by the train: it moves at c both ways from where it was emitted.",
    same: "From the platform the walls move: the rear wall rushes toward its pulse, the front wall runs away.",
    rear: "Inside the car nothing moves: the lamp is dead centre and light goes at c both ways.",
  },
  lightning: {
    rear: "The passenger rides toward the front flash and away from the rear one, so the front light reaches her first.",
    same: "The passenger rides toward the front flash. Its light reaches her first, and inside the car both flashes started the same distance away.",
  },
  headlight: {
    faster: "The train's speed doesn't add to light. Every observer measures c.",
    slower: "Light doesn't lag behind a moving source. Every observer measures c.",
  },
};

function grade({ props, goal, answer }: { props: TrainSceneProps; goal: TrainSceneGoal; answer: TrainSceneAnswer }) {
  const ok = answer.pick === goal.answer;
  return graded(ok, ok ? 1 : 0, {
    solution: { pick: goal.answer } satisfies TrainSceneAnswer,
    feedback: ok ? undefined : WRONG_FEEDBACK[props.scenario]?.[answer.pick],
  });
}

function textAlternative(p: TrainSceneProps): string {
  const moving =
    p.frame === "platform"
      ? `A train car moves right at ${p.v}c past a platform, seen from the platform.`
      : `Seen from inside a train car; the platform slides left at ${p.v}c.`;
  const setup =
    p.scenario === "lamp"
      ? "A lamp hangs in the exact middle of the car and flashes once; two light pulses head for the front and rear walls."
      : p.scenario === "lightning"
        ? "Lightning strikes both ends of the car. A passenger sits in the middle of the car; an observer stands on the platform halfway between the scorch marks."
        : "The train's headlight flashes once; a light pulse races ahead of the train.";
  const extras = [
    p.allowFrameSwitch ? "A switch flips between the train and platform views." : "",
    p.showDelayCorrection ? "A stopwatch can subtract the light-travel time to the observer." : "",
  ].filter(Boolean);
  return [moving, setup, ...extras].join(" ");
}

/** Room this widget wants on the card modal's canvas (see shared/canvas.ts). */
export const trainSceneCanvas: WidgetCanvas = { minHeight: 440, prefersTall: true };

export const trainSceneSpec: WidgetSpec<TrainSceneProps, TrainSceneGoal, TrainSceneAnswer> = {
  id: "train-scene",
  version: 1,
  title: "Train scene",
  family: "physics",
  description:
    "Einstein's train: a lamp in mid-car, lightning at both ends, or a headlight, seen from the train or the platform, with slow motion, a time scrubber and a 'subtract light-travel time' stopwatch.",
  llmDoc: {
    useWhen:
      "Relativity of simultaneity (lamp: platform sees the rear wall lit first; lightning: the passenger concludes the front strike came first) or the constancy of light speed (headlight: c in every frame).",
    notFor: "Quantitative time dilation (use light-clock) or event diagrams (use spacetime-diagram).",
    learnerDoes:
      "Picks an answer first, then plays the scene (optionally in slow motion), scrubs time, switches frame and subtracts light-travel time.",
    reports:
      '{ pick } — lamp and lightning: "front" | "rear" | "same"; headlight: "c" | "faster" | "slower". Grading is pick === goal.answer.',
  },
  props: TrainSceneProps,
  goal: TrainSceneGoal,
  answer: TrainSceneAnswer,
  validate,
  grade,
  initialAnswer: () => ({ pick: "same" }),
  textAlternative,
  toText: (p, a) => (a ? `${textAlternative(p)} The learner picked "${a.pick}".` : textAlternative(p)),
  explore: (p) => ({ ...p, allowFrameSwitch: true, showDelayCorrection: p.scenario !== "headlight" }),
  examples: [
    {
      note: "Lamp in mid-car, inside the train: both walls at once",
      props: { scenario: "lamp", v: 0.6, frame: "train", allowFrameSwitch: false },
      goal: { kind: "pick", answer: "same" },
      correctAnswer: { pick: "same" },
      wrongAnswer: { pick: "front" },
    },
    {
      note: "Lamp in mid-car, from the platform: the rear wall first",
      props: { scenario: "lamp", v: 0.6, frame: "platform", allowFrameSwitch: false, showDelayCorrection: true },
      goal: { kind: "pick", answer: "rear" },
      correctAnswer: { pick: "rear" },
      wrongAnswer: { pick: "same" },
    },
    {
      note: "Einstein's lightning: which flash reaches the passenger first?",
      props: { scenario: "lightning", v: 0.6, frame: "platform", allowFrameSwitch: true, slowMo: true },
      goal: { kind: "pick", answer: "front" },
      correctAnswer: { pick: "front" },
      wrongAnswer: { pick: "same" },
    },
    {
      note: "Headlight at 0.5c: how fast is the light from the platform?",
      props: { scenario: "headlight", v: 0.5, frame: "platform", allowFrameSwitch: true },
      goal: { kind: "pick", answer: "c" },
      correctAnswer: { pick: "c" },
      wrongAnswer: { pick: "faster" },
    },
  ],
};
