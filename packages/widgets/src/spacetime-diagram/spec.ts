/**
 * spacetime-diagram: Minkowski diagram; drag events and worldlines, boost slider tilts the axes,
 * light cones, proper-time readout, "who flashed first?" (CONTRACTS §7.2 #11).
 * x and t in the same units, c = 1, light lines at 45°.
 */
import { fmt, orderInFrame, properTime, regionOf } from "../light-clock/relativity";
import type { WidgetCanvas } from "../shared/canvas";
import { graded } from "../shared/spec-helpers";
import { LineColor, type WidgetSpec, z } from "../shared/zod";

const XT = z.tuple([z.number(), z.number()]);

export const SpacetimeDiagramProps = z.strictObject({
  range: z.strictObject({ x: XT, t: XT }),
  /** e.g. { x: "ly", t: "yr" } */
  units: z.strictObject({ x: z.string(), t: z.string() }),
  events: z.array(
    z.strictObject({
      id: z.string(),
      x: z.number(),
      t: z.number(),
      label: z.string(),
      draggable: z.boolean().optional(),
    }),
  ),
  /** points are [x, t]. */
  worldlines: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      points: z.array(XT),
      editable: z.boolean().optional(),
      color: LineColor.optional(),
    }),
  ),
  /** Observer velocity; omit to hide the slider. */
  boost: z.strictObject({ value: z.number(), min: z.number(), max: z.number() }).optional(),
  /** Event ids. */
  lightCones: z.array(z.string()).optional(),
  /** "Now" line of the boosted frame. */
  showSimultaneity: z.boolean().optional(),
  readouts: z.array(z.enum(["proper-time", "interval", "order"])).optional(),
});

export const SpacetimeDiagramGoal = z.discriminatedUnion("kind", [
  /** Which event happens first (in the frame with velocity frameV). */
  z.strictObject({ kind: z.literal("order"), first: z.string(), frameV: z.number().optional() }),
  z.strictObject({ kind: z.literal("proper-time"), worldline: z.string(), target: z.number(), tolerance: z.number() }),
  z.strictObject({
    kind: z.literal("place"),
    event: z.string(),
    region: z.enum(["future", "past", "elsewhere"]),
    relativeTo: z.string(),
  }),
  z.strictObject({ kind: z.literal("boost"), target: z.number(), tolerance: z.number() }),
]);

export const SpacetimeDiagramAnswer = z.object({
  first: z.string().optional(),
  events: z.record(z.string(), XT).optional(),
  worldlines: z.record(z.string(), z.array(XT)).optional(),
  boost: z.number().optional(),
  properTime: z.number().optional(),
});

export type SpacetimeDiagramProps = z.infer<typeof SpacetimeDiagramProps>;
export type SpacetimeDiagramGoal = z.infer<typeof SpacetimeDiagramGoal>;
export type SpacetimeDiagramAnswer = z.infer<typeof SpacetimeDiagramAnswer>;
type Point = [number, number];

/** The answer value for "both at the same moment" in an order goal. */
export const SAME_TIME = "same";

/** Which points of a worldline the learner may drag: interior vertices, or the end of a two-point line. */
export function draggableVertices(points: readonly unknown[]): number[] {
  if (points.length < 2) return [];
  if (points.length === 2) return [1];
  return points.slice(1, -1).map((_, i) => i + 1);
}

/** The event or events that come first in the frame moving at v (several when simultaneous). */
export function earliest(events: SpacetimeDiagramProps["events"], v: number): string[] {
  const ordered = orderInFrame(events, v);
  const first = ordered[0];
  if (!first) return [];
  return ordered.filter((e) => Math.abs(e.t - first.t) <= 1e-6).map((e) => e.id);
}

function eventPos(p: SpacetimeDiagramProps, a: SpacetimeDiagramAnswer | undefined, id: string): Point | undefined {
  const moved = a?.events?.[id];
  if (moved) return moved;
  const e = p.events.find((x) => x.id === id);
  return e ? [e.x, e.t] : undefined;
}

function validate(p: SpacetimeDiagramProps, goal?: SpacetimeDiagramGoal): string[] {
  const errors: string[] = [];
  const [x0, x1] = p.range.x;
  const [t0, t1] = p.range.t;
  if (!(x0 < x1) || !(t0 < t1)) errors.push("range must be [min, max] with min < max on both axes");
  const inRange = (x: number, t: number) => x >= x0 - 1e-9 && x <= x1 + 1e-9 && t >= t0 - 1e-9 && t <= t1 + 1e-9;
  const eventIds = p.events.map((e) => e.id);
  if (new Set(eventIds).size !== eventIds.length) errors.push("event ids must be unique");
  for (const e of p.events) if (!inRange(e.x, e.t)) errors.push(`event "${e.id}" is outside the visible range`);
  const wlIds = p.worldlines.map((w) => w.id);
  if (new Set(wlIds).size !== wlIds.length) errors.push("worldline ids must be unique");
  for (const w of p.worldlines) {
    if (w.points.length < 2) errors.push(`worldline "${w.id}" needs at least 2 points`);
    const pt = properTime(w.points);
    if (pt.fasterThanLight.length) errors.push(`worldline "${w.id}" has a faster-than-light segment`);
    if (pt.backwards.length) errors.push(`worldline "${w.id}" runs backwards in time`);
    for (const [x, t] of w.points) {
      if (!inRange(x, t)) {
        errors.push(`worldline "${w.id}" leaves the visible range`);
        break;
      }
    }
  }
  for (const id of p.lightCones ?? []) if (!eventIds.includes(id)) errors.push(`light cone for unknown event "${id}"`);
  if (p.boost) {
    const { min, max, value } = p.boost;
    if (!(min < max)) errors.push("boost needs min < max");
    if (min <= -1 || max >= 1) errors.push("boost must stay strictly between −1 and 1 (below light speed)");
    if (value < min || value > max) errors.push("boost value must lie within [min, max]");
  }
  if (!goal) return errors;

  switch (goal.kind) {
    case "order": {
      if (p.events.length < 2) {
        errors.push("an order goal needs at least two events");
        break;
      }
      const v = goal.frameV ?? p.boost?.value ?? 0;
      if (!(Math.abs(v) < 1)) {
        errors.push("frameV must be below light speed");
        break;
      }
      const first = earliest(p.events, v);
      if (goal.first === SAME_TIME) {
        if (first.length < 2) {
          errors.push(`in the frame moving at ${fmt(v)}c, "${first[0]}" comes first; the events are not simultaneous`);
        }
      } else if (!eventIds.includes(goal.first)) {
        errors.push(`order goal names unknown event "${goal.first}"`);
      } else if (first.length > 1) {
        errors.push(`in the frame moving at ${fmt(v)}c, ${first.join(" and ")} are simultaneous`);
      } else if (first[0] !== goal.first) {
        errors.push(`in the frame moving at ${fmt(v)}c, "${first[0]}" happens first, not "${goal.first}"`);
      }
      break;
    }
    case "proper-time": {
      const w = p.worldlines.find((x) => x.id === goal.worldline);
      if (!w) errors.push(`proper-time goal names unknown worldline "${goal.worldline}"`);
      if (goal.tolerance < 0) errors.push("tolerance must be ≥ 0");
      if (goal.target < 0) errors.push("proper time can't be negative");
      if (w && w.points.length >= 2) {
        const tau = properTime(w.points).tau;
        const meets = Math.abs(tau - goal.target) <= goal.tolerance + 1e-9;
        if (w.editable && meets) {
          errors.push(`worldline "${w.id}" already shows ${fmt(tau)}: the learner has nothing to bend`);
        } else if (!w.editable && !meets) {
          errors.push(`worldline "${w.id}" has proper time ${fmt(tau)}, but the goal says ${fmt(goal.target)}`);
        }
      }
      break;
    }
    case "place": {
      const e = p.events.find((x) => x.id === goal.event);
      if (!e) errors.push(`place goal names unknown event "${goal.event}"`);
      else if (!e.draggable) errors.push(`event "${goal.event}" must be draggable for a place goal`);
      if (!eventIds.includes(goal.relativeTo))
        errors.push(`place goal is relative to unknown event "${goal.relativeTo}"`);
      if (goal.event === goal.relativeTo) errors.push("an event can't be placed relative to itself");
      const a = eventPos(p, undefined, goal.event);
      const o = eventPos(p, undefined, goal.relativeTo);
      if (e && a && o && goal.event !== goal.relativeTo && regionOf(a, o) === goal.region) {
        errors.push(`event "${goal.event}" already starts in the ${goal.region} of "${goal.relativeTo}"`);
      }
      break;
    }
    case "boost": {
      if (!p.boost) errors.push("a boost goal needs the boost slider (props.boost)");
      else {
        if (goal.target < p.boost.min || goal.target > p.boost.max) errors.push("boost target is outside the slider");
        if (Math.abs(p.boost.value - goal.target) <= goal.tolerance) errors.push("the slider already starts on target");
      }
      if (goal.tolerance < 0) errors.push("tolerance must be ≥ 0");
      break;
    }
  }
  return errors;
}

/** Proper time the answer claims (typed) or implies (edited worldline, else the authored one). */
export function answeredProperTime(
  p: SpacetimeDiagramProps,
  a: SpacetimeDiagramAnswer,
  worldline: string,
): { tau: number; fasterThanLight: boolean; typed: boolean } | undefined {
  if (a.properTime !== undefined) return { tau: a.properTime, fasterThanLight: false, typed: true };
  const pts = a.worldlines?.[worldline] ?? p.worldlines.find((w) => w.id === worldline)?.points;
  if (!pts) return undefined;
  const r = properTime(pts);
  return { tau: r.tau, fasterThanLight: r.fasterThanLight.length > 0 || r.backwards.length > 0, typed: false };
}

function grade({
  props,
  goal,
  answer,
}: {
  props: SpacetimeDiagramProps;
  goal: SpacetimeDiagramGoal;
  answer: SpacetimeDiagramAnswer;
}) {
  switch (goal.kind) {
    case "order": {
      const ok = answer.first === goal.first;
      return graded(ok, ok ? 1 : 0, { solution: { first: goal.first } satisfies SpacetimeDiagramAnswer });
    }
    case "proper-time": {
      const r = answeredProperTime(props, answer, goal.worldline);
      if (!r) return graded(false, 0);
      if (r.fasterThanLight) {
        return graded(false, 0, { feedback: "Part of that path is faster than light: no clock can ride it." });
      }
      const err = Math.abs(r.tau - goal.target);
      const ok = err <= goal.tolerance + 1e-9;
      return graded(ok, ok ? 1 : Math.max(0, 1 - err / Math.max(goal.target, 1)), {
        solution: { properTime: goal.target } satisfies SpacetimeDiagramAnswer,
      });
    }
    case "place": {
      const a = eventPos(props, answer, goal.event);
      const o = eventPos(props, answer, goal.relativeTo);
      if (!a || !o) return graded(false, 0);
      const region = regionOf(a, o);
      const ok = region === goal.region;
      return graded(ok, ok ? 1 : 0, {
        feedback: ok ? undefined : `That spot is in the ${region === "elsewhere" ? "elsewhere region" : region} of it.`,
      });
    }
    case "boost": {
      const b = answer.boost;
      if (b === undefined) return graded(false, 0);
      const err = Math.abs(b - goal.target);
      const ok = err <= goal.tolerance + 1e-9;
      return graded(ok, ok ? 1 : Math.max(0, 1 - err), {
        solution: { boost: goal.target } satisfies SpacetimeDiagramAnswer,
      });
    }
  }
}

function textAlternative(p: SpacetimeDiagramProps): string {
  const parts = [
    `A spacetime diagram: distance in ${p.units.x} across, time in ${p.units.t} upward, light moving along 45° lines.`,
  ];
  if (p.events.length) {
    parts.push(
      `Events: ${p.events.map((e) => `${e.label} at x ${fmt(e.x)}, t ${fmt(e.t)}${e.draggable ? " (movable)" : ""}`).join("; ")}.`,
    );
  }
  for (const w of p.worldlines) {
    parts.push(
      `${w.label}'s worldline: ${w.points.map(([x, t]) => `(${fmt(x)}, ${fmt(t)})`).join(" to ")}${w.editable ? " (bendable)" : ""}.`,
    );
  }
  if (p.lightCones?.length) parts.push(`Light cones around ${p.lightCones.join(", ")}.`);
  if (p.boost) parts.push(`A slider tilts the axes of an observer moving at ${fmt(p.boost.value)}c.`);
  return parts.join(" ");
}

/** Room this widget wants on the card modal's canvas (see shared/canvas.ts). */
export const spacetimeDiagramCanvas: WidgetCanvas = { minHeight: 440, prefersTall: true };

export const spacetimeDiagramSpec: WidgetSpec<SpacetimeDiagramProps, SpacetimeDiagramGoal, SpacetimeDiagramAnswer> = {
  id: "spacetime-diagram",
  version: 1,
  title: "Spacetime diagram",
  family: "physics",
  description:
    "A Minkowski diagram (c = 1, light at 45°) with draggable events, bendable worldlines, light cones, a boost slider that tilts the axes, simultaneity lines and proper-time, interval and order readouts.",
  llmDoc: {
    useWhen:
      "Event order and simultaneity across frames, causality (light cones), proper time along worldlines and the twin paradox.",
    notFor: "Introductory light-speed ideas before diagrams are taught (use train-scene or light-clock).",
    learnerDoes:
      "Drags events or worldline vertices (pointer or arrow keys), boosts the frame with a slider, types a clock reading, or picks which event came first.",
    reports:
      '{ first } (an event id, or "same") | { events: { id: [x, t] } } | { worldlines: { id: [[x, t]…] } } | { boost } | { properTime }',
  },
  props: SpacetimeDiagramProps,
  goal: SpacetimeDiagramGoal,
  answer: SpacetimeDiagramAnswer,
  validate,
  grade,
  initialAnswer: (p) => (p.boost ? { boost: p.boost.value } : {}),
  textAlternative,
  toText: (p, a) => {
    const base = textAlternative(p);
    if (!a) return base;
    const bits: string[] = [];
    if (a.first) bits.push(`picked ${a.first === SAME_TIME ? "same time" : a.first} as first`);
    if (a.boost !== undefined) bits.push(`boost ${fmt(a.boost)}c`);
    if (a.properTime !== undefined) bits.push(`clock reading ${fmt(a.properTime)} ${p.units.t}`);
    for (const [id, [x, t]] of Object.entries(a.events ?? {})) bits.push(`moved ${id} to (${fmt(x)}, ${fmt(t)})`);
    for (const [id, pts] of Object.entries(a.worldlines ?? {})) {
      bits.push(`bent ${id} through ${pts.map(([x, t]) => `(${fmt(x)}, ${fmt(t)})`).join(", ")}`);
    }
    return bits.length ? `${base} The learner ${bits.join("; ")}.` : base;
  },
  explore: (p) => ({
    ...p,
    boost: p.boost ?? { value: 0, min: -0.9, max: 0.9 },
    showSimultaneity: p.showSimultaneity ?? true,
  }),
  examples: [
    {
      note: "Twin paradox: Ava's clock reading after the round trip at 0.8c",
      props: {
        range: { x: [-1, 6], t: [0, 11] },
        units: { x: "ly", t: "yr" },
        events: [
          { id: "depart", x: 0, t: 0, label: "Depart" },
          { id: "star", x: 4, t: 5, label: "Star" },
          { id: "reunion", x: 0, t: 10, label: "Reunion" },
        ],
        worldlines: [
          {
            id: "ben",
            label: "Ben",
            points: [
              [0, 0],
              [0, 10],
            ],
            color: 1,
          },
          {
            id: "ava",
            label: "Ava",
            points: [
              [0, 0],
              [4, 5],
              [0, 10],
            ],
            color: 2,
          },
        ],
        readouts: ["proper-time"],
      },
      goal: { kind: "proper-time", worldline: "ava", target: 6, tolerance: 0.05 },
      correctAnswer: { properTime: 6 },
      wrongAnswer: { properTime: 10 },
    },
    {
      note: "Who flashed first? Two flashes 3 ly apart, seen by an observer at 0.6c",
      props: {
        range: { x: [-2, 5], t: [-3, 4] },
        units: { x: "ly", t: "yr" },
        events: [
          { id: "a", x: 0, t: 0, label: "Flash A" },
          { id: "b", x: 3, t: 0, label: "Flash B" },
        ],
        worldlines: [],
        boost: { value: 0.6, min: -0.9, max: 0.9 },
        showSimultaneity: true,
        readouts: ["order"],
      },
      goal: { kind: "order", first: "b", frameV: 0.6 },
      correctAnswer: { first: "b", boost: 0.6 },
      wrongAnswer: { first: "same", boost: 0.6 },
    },
    {
      note: "Causality: drag the reply where the email could have caused it",
      props: {
        range: { x: [-4, 4], t: [0, 6] },
        units: { x: "light-min", t: "min" },
        events: [
          { id: "email", x: 0, t: 1, label: "You send an email" },
          { id: "reply", x: 3, t: 2, label: "Friend replies", draggable: true },
        ],
        worldlines: [],
        lightCones: ["email"],
        readouts: ["order"],
      },
      goal: { kind: "place", event: "reply", region: "future", relativeTo: "email" },
      correctAnswer: { events: { reply: [1, 4] } },
      wrongAnswer: { events: { reply: [3.5, 2] } },
    },
    {
      note: "Bend the traveller's path so her clock shows 6 years",
      props: {
        range: { x: [-1, 6], t: [0, 11] },
        units: { x: "ly", t: "yr" },
        events: [],
        worldlines: [
          {
            id: "ava",
            label: "Ava",
            points: [
              [0, 0],
              [1, 5],
              [0, 10],
            ],
            editable: true,
            color: 2,
          },
        ],
        readouts: ["proper-time"],
      },
      goal: { kind: "proper-time", worldline: "ava", target: 6, tolerance: 0.1 },
      correctAnswer: {
        worldlines: {
          ava: [
            [0, 0],
            [4, 5],
            [0, 10],
          ],
        },
      },
      wrongAnswer: {
        worldlines: {
          ava: [
            [0, 0],
            [2, 5],
            [0, 10],
          ],
        },
      },
    },
    {
      note: "Boost until the two flashes are simultaneous",
      props: {
        range: { x: [-1, 5], t: [-1, 4] },
        units: { x: "ly", t: "yr" },
        events: [
          { id: "a", x: 0, t: 0, label: "Flash A" },
          { id: "b", x: 4, t: 2, label: "Flash B" },
        ],
        worldlines: [],
        boost: { value: 0, min: -0.9, max: 0.9 },
        showSimultaneity: true,
        readouts: ["order", "interval"],
      },
      goal: { kind: "boost", target: 0.5, tolerance: 0.02 },
      correctAnswer: { boost: 0.5 },
      wrongAnswer: { boost: -0.5 },
    },
  ],
};
