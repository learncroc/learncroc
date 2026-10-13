/**
 * light-clock: set the speed, trace the photon path, read the 3-4-5 triangle, switch frame,
 * hit a γ target (CONTRACTS §7.2 #9). Units: c = 1; mirror gap = 4 units.
 */
import { graded } from "../shared/spec-helpers";
import { type WidgetSpec, z } from "../shared/zod";
import { clockGeometry, fmt, gamma, V_MAX } from "./relativity";

export const LightClockProps = z.strictObject({
  /** Initial speed (0..0.99). */
  v: z.number().min(0).max(0.99),
  /** Slider range; equal values = fixed. */
  vRange: z.tuple([z.number(), z.number()]),
  frame: z.enum(["platform", "train"]),
  allowFrameSwitch: z.boolean(),
  task: z.enum(["view", "trace", "speed", "tick"]),
  showTriangle: z.boolean().optional(),
  /** Tick counters for both clocks. */
  showTicks: z.boolean().optional(),
  /** Emphasise one clock (used by choice visualState). */
  highlight: z.enum(["train", "platform"]).optional(),
});

export const LightClockGoal = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("trace"), path: z.literal("diagonal") }),
  /** Set v so gamma = 1/sqrt(1-v²) hits target. */
  z.strictObject({ kind: z.literal("gamma"), target: z.number(), tolerance: z.number() }),
  z.strictObject({ kind: z.literal("speed"), target: z.number(), tolerance: z.number() }),
]);

export const LightClockAnswer = z.object({
  traced: z.enum(["straight", "diagonal", "curve"]).optional(),
  v: z.number().optional(),
});

export type LightClockProps = z.infer<typeof LightClockProps>;
export type LightClockGoal = z.infer<typeof LightClockGoal>;
export type LightClockAnswer = z.infer<typeof LightClockAnswer>;

/** Is the slider fixed (no speed control)? */
export function isFixedSpeed(p: LightClockProps): boolean {
  return Math.abs(p.vRange[1] - p.vRange[0]) < 1e-9;
}

function validate(p: LightClockProps, goal?: LightClockGoal): string[] {
  const errors: string[] = [];
  const [lo, hi] = p.vRange;
  if (lo < 0 || hi > V_MAX) errors.push(`vRange must stay within 0..${V_MAX}`);
  if (lo > hi) errors.push("vRange must be [min, max] with min ≤ max");
  if (p.v < lo - 1e-9 || p.v > hi + 1e-9) errors.push(`initial v ${p.v} is outside vRange [${lo}, ${hi}]`);
  if (!goal) return errors;
  if (goal.kind === "trace") {
    if (p.task !== "trace") errors.push('a trace goal needs task "trace"');
    if (p.v <= 0 && hi <= 0) errors.push("a trace goal needs a moving clock (v > 0), or the path is straight");
  } else {
    if (p.task !== "speed" && p.task !== "tick") errors.push(`a ${goal.kind} goal needs task "speed" or "tick"`);
    if (isFixedSpeed(p)) errors.push(`a ${goal.kind} goal needs a speed slider (vRange min < max)`);
    if (goal.tolerance < 0) errors.push("tolerance must be ≥ 0");
    if (goal.kind === "speed") {
      if (goal.target < lo - goal.tolerance || goal.target > hi + goal.tolerance) {
        errors.push(`speed target ${goal.target} is outside vRange [${lo}, ${hi}]`);
      }
      if (Math.abs(p.v - goal.target) <= goal.tolerance) errors.push("the initial v already meets the speed goal");
    } else {
      if (goal.target < 1) errors.push("γ target must be ≥ 1");
      else if (lo >= 0 && hi < 1) {
        const gLo = gamma(Math.max(0, lo));
        const gHi = gamma(Math.min(hi, V_MAX));
        if (goal.target < gLo - goal.tolerance || goal.target > gHi + goal.tolerance) {
          errors.push(`γ target ${goal.target} is out of reach: vRange gives γ from ${fmt(gLo)} to ${fmt(gHi)}`);
        }
        if (p.v < 1 && Math.abs(gamma(p.v) - goal.target) <= goal.tolerance) {
          errors.push("the initial v already meets the γ goal");
        }
      }
    }
  }
  return errors;
}

function grade({ goal, answer }: { props: LightClockProps; goal: LightClockGoal; answer: LightClockAnswer }) {
  if (goal.kind === "trace") {
    const ok = answer.traced === "diagonal";
    const feedback =
      answer.traced === "straight"
        ? "That's the rider's view. From the platform, the mirrors slide sideways while the light travels."
        : answer.traced === "curve"
          ? "The light moves in a straight line between bounces, and the mirrors move steadily, so each leg is straight."
          : undefined;
    return graded(ok, ok ? 1 : 0, { solution: { traced: "diagonal" } satisfies LightClockAnswer, feedback });
  }
  const v = answer.v;
  if (v === undefined || !Number.isFinite(v) || v < 0 || v >= 1) {
    return graded(false, 0, { feedback: "Set a speed with the slider." });
  }
  if (goal.kind === "speed") {
    const err = Math.abs(v - goal.target);
    const ok = err <= goal.tolerance + 1e-9;
    return graded(ok, ok ? 1 : Math.max(0, 1 - err), { solution: { v: goal.target } satisfies LightClockAnswer });
  }
  const g = gamma(v);
  const err = Math.abs(g - goal.target);
  const ok = err <= goal.tolerance + 1e-9;
  const solution = { v: Math.sqrt(1 - 1 / (goal.target * goal.target)) } satisfies LightClockAnswer;
  return graded(ok, ok ? 1 : Math.max(0, 1 - err / goal.target), {
    solution,
    feedback: ok ? undefined : `At ${fmt(v)}c the slowdown is ${fmt(g)}.`,
  });
}

function textAlternative(p: LightClockProps): string {
  const moving = p.frame === "platform" ? "the train's clock" : "the platform's clock";
  const resting = p.frame === "platform" ? "the platform's clock" : "the train's clock";
  const parts = [
    `Two light clocks, each a pulse bouncing between mirrors 4 units apart, seen from the ${p.frame}.`,
    p.v > 0
      ? `At ${fmt(p.v)}c, ${moving} slides sideways, so its pulse runs a zigzag of diagonals while ${resting} pulse goes straight up and down.`
      : "Both clocks are at rest, so both pulses go straight up and down.",
  ];
  if (p.showTriangle && p.v > 0) {
    const g = clockGeometry(p.v);
    parts.push(
      `A triangle shows the gap of 4, a sideways slide of ${fmt(g.slide)} and a diagonal of ${fmt(g.diagonal)}.`,
    );
  }
  if (p.showTicks && p.v > 0) parts.push(`${moving} ticks ${fmt(gamma(p.v))} times slower.`);
  if (!isFixedSpeed(p)) parts.push(`A slider sets the speed from ${fmt(p.vRange[0])}c to ${fmt(p.vRange[1])}c.`);
  if (p.allowFrameSwitch) parts.push("A switch flips between the platform and the train view.");
  return parts.join(" ");
}

export const lightClockSpec: WidgetSpec<LightClockProps, LightClockGoal, LightClockAnswer> = {
  id: "light-clock",
  version: 1,
  title: "Light clock",
  family: "physics",
  description:
    "A light clock between two mirrors 4 units apart, seen from the platform or the train; trace, speed and γ tasks, tick counters and the 3-4-5 triangle.",
  llmDoc: {
    useWhen:
      "Time dilation and the γ factor: why a moving clock ticks slower (longer diagonal at the same c), mutual dilation via the frame switch, or hitting a γ target with the speed slider.",
    notFor: "Length contraction or simultaneity on their own (use train-scene or spacetime-diagram).",
    learnerDoes:
      "Traces the photon path with the pointer or arrow keys (task trace), drags the speed slider (task speed or tick), switches frame, and watches tick counters drift apart.",
    reports: '{ traced: "straight" | "diagonal" | "curve" } for trace goals, { v } for speed and gamma goals.',
  },
  props: LightClockProps,
  goal: LightClockGoal,
  answer: LightClockAnswer,
  validate,
  grade,
  initialAnswer: (p) => (p.task === "trace" ? {} : { v: p.v }),
  textAlternative,
  toText: (p, a) => {
    const base = textAlternative(p);
    if (a?.traced) return `${base} The learner traced a ${a.traced} path.`;
    if (a?.v !== undefined && a.v < 1) return `${base} Speed set to ${fmt(a.v)}c (γ = ${fmt(gamma(a.v))}).`;
    return base;
  },
  explore: (p) => ({
    ...p,
    vRange: [0, 0.99],
    task: "view",
    allowFrameSwitch: true,
    showTicks: true,
    showTriangle: p.showTriangle ?? true,
  }),
  examples: [
    {
      note: "Trace the pulse at 0.6c from the platform",
      props: {
        v: 0.6,
        vRange: [0.6, 0.6],
        frame: "platform",
        allowFrameSwitch: false,
        task: "trace",
        showTriangle: false,
        showTicks: false,
      },
      goal: { kind: "trace", path: "diagonal" },
      correctAnswer: { traced: "diagonal" },
      wrongAnswer: { traced: "straight" },
    },
    {
      note: "Make the moving clock run slow by 5/3 (0.8c)",
      props: {
        v: 0.3,
        vRange: [0, 0.95],
        frame: "platform",
        allowFrameSwitch: false,
        task: "tick",
        showTriangle: true,
        showTicks: true,
      },
      goal: { kind: "gamma", target: 5 / 3, tolerance: 0.03 },
      correctAnswer: { v: 0.8 },
      wrongAnswer: { v: 0.6 },
    },
    {
      note: "Show Nib: set the clock to 0.6c",
      props: {
        v: 0,
        vRange: [0, 0.9],
        frame: "platform",
        allowFrameSwitch: false,
        task: "speed",
        showTriangle: true,
        showTicks: true,
      },
      goal: { kind: "speed", target: 0.6, tolerance: 0.02 },
      correctAnswer: { v: 0.6 },
      wrongAnswer: { v: 0.45 },
    },
  ],
};
