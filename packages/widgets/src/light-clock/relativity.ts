/**
 * Special-relativity maths shared by light-clock, train-scene and spacetime-diagram.
 * Units: c = 1. Speeds are fractions of c. Spacetime points are [x, t]. No React: specs import this.
 */

/** Numeric slack for comparisons of computed times and positions. */
export const EPS = 1e-9;

/** Largest speed any widget simulates (the slider's hard ceiling). */
export const V_MAX = 0.999;

/** Lorentz factor γ = 1/√(1 − v²). Throws for |v| ≥ 1 (no clock can ride that). */
export function gamma(v: number): number {
  if (!Number.isFinite(v) || Math.abs(v) >= 1) throw new RangeError(`speed must be below c, got ${v}`);
  return 1 / Math.sqrt(1 - v * v);
}

/** The speed (≥ 0) whose γ equals `g` (g ≥ 1). */
export function speedForGamma(g: number): number {
  if (!Number.isFinite(g) || g < 1) throw new RangeError(`gamma must be ≥ 1, got ${g}`);
  return Math.sqrt(1 - 1 / (g * g));
}

/** Lorentz transform of an event into a frame moving at velocity `v` along +x: [γ(x − vt), γ(t − vx)]. */
export function boostEvent([x, t]: readonly [number, number], v: number): [number, number] {
  const g = gamma(v);
  return [g * (x - v * t), g * (t - v * x)];
}

/** Time coordinate of an event in the frame moving at `v`. */
export function timeInFrame(point: readonly [number, number], v: number): number {
  return boostEvent(point, v)[1];
}

/** Squared interval s² = Δt² − Δx² (positive = timelike, zero = lightlike, negative = spacelike). */
export function interval2(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dt = b[1] - a[1];
  return dt * dt - dx * dx;
}

export type Separation = "timelike" | "lightlike" | "spacelike";

export function separation(a: readonly [number, number], b: readonly [number, number]): Separation {
  const s2 = interval2(a, b);
  if (Math.abs(s2) <= 1e-7) return "lightlike";
  return s2 > 0 ? "timelike" : "spacelike";
}

/**
 * Where `event` sits relative to `origin`: inside or on its future light cone, its past cone, or elsewhere
 * (spacelike: order can flip between frames). The origin itself counts as future.
 */
export function regionOf(
  event: readonly [number, number],
  origin: readonly [number, number],
): "future" | "past" | "elsewhere" {
  if (separation(origin, event) === "spacelike") return "elsewhere";
  return event[1] - origin[1] >= -EPS ? "future" : "past";
}

export interface ProperTime {
  /** Total clock time along the timelike segments. */
  tau: number;
  /** Indices of segments that are spacelike (faster than light): `tau` is not meaningful when non-empty. */
  fasterThanLight: number[];
  /** Indices of segments that run backwards in time. */
  backwards: number[];
}

/** Proper time along a worldline of [x, t] points: Σ √(Δt² − Δx²) over its segments. */
export function properTime(points: readonly (readonly [number, number])[]): ProperTime {
  let tau = 0;
  const fasterThanLight: number[] = [];
  const backwards: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as readonly [number, number];
    const b = points[i] as readonly [number, number];
    if (b[1] - a[1] < -EPS) backwards.push(i - 1);
    const s2 = interval2(a, b);
    if (s2 < -1e-7) fasterThanLight.push(i - 1);
    else tau += Math.sqrt(Math.max(0, s2));
  }
  return { tau, fasterThanLight, backwards };
}

/** Event ids ordered by their time in the frame moving at `v`, with that time. */
export function orderInFrame(
  events: readonly { id: string; x: number; t: number }[],
  v: number,
): { id: string; t: number }[] {
  return events
    .map((e) => ({ id: e.id, t: timeInFrame([e.x, e.t], v) }))
    .sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
}

/**
 * Which of two events happens first in the frame moving at `v`: an event id, or "same" when their times agree
 * (within `eps`).
 */
export function firstInFrame(
  a: { id: string; x: number; t: number },
  b: { id: string; x: number; t: number },
  v: number,
  eps = 1e-6,
): string {
  const ta = timeInFrame([a.x, a.t], v);
  const tb = timeInFrame([b.x, b.t], v);
  if (Math.abs(ta - tb) <= eps) return "same";
  return ta < tb ? a.id : b.id;
}

// ─── Light clock ────────────────────────────────────────────────────────────────────────────────

/** Mirror gap of every light clock (units of length; light crosses it in 4 units of time at rest). */
export const MIRROR_GAP = 4;

export interface ClockGeometry {
  gamma: number;
  /** Time for one crossing (one tick), seen from a frame where the clock moves at v. */
  tickTime: number;
  /** How far the mirrors slide sideways during one crossing. */
  slide: number;
  /** Length of the diagonal the pulse runs. Equals tickTime because light covers it at c = 1. */
  diagonal: number;
}

/** The 3-4-5 style triangle of a light clock moving at `v`: gap 4, slide 4vγ, diagonal 4γ. */
export function clockGeometry(v: number): ClockGeometry {
  const g = gamma(v);
  const tickTime = MIRROR_GAP * g;
  return { gamma: g, tickTime, slide: v * tickTime, diagonal: tickTime };
}

/** Whole ticks completed after `time` by a clock of speed `v` in the observer's frame. */
export function ticksAfter(time: number, v: number): number {
  return Math.floor((time + EPS) / clockGeometry(v).tickTime);
}

// ─── Train scene ────────────────────────────────────────────────────────────────────────────────

/** The car's length in its own frame. Walls sit at ±CAR_HALF in the train frame. */
export const CAR_LENGTH = 8;
export const CAR_HALF = CAR_LENGTH / 2;

export type TrainScenario = "lamp" | "lightning" | "headlight";
export type TrainFrame = "train" | "platform";

export interface SceneEvent {
  id: "flash" | "flash-front" | "flash-rear" | "hit-front" | "hit-rear" | "reach-observer";
  x: number;
  t: number;
}

/**
 * Key events of a train scenario in the chosen frame (c = 1). The car moves at +v in the platform frame; the
 * platform moves at −v in the train frame. Event origin: the lamp flash (lamp), the platform's simultaneous
 * strikes (lightning), or the headlight flash (headlight), all Lorentz-consistent between frames.
 */
export function sceneEvents(scenario: TrainScenario, v: number, frame: TrainFrame): SceneEvent[] {
  const g = gamma(v);
  const halfP = CAR_HALF / g; // half the car's length as measured on the platform
  // Everything is computed in the platform frame, then boosted if needed.
  let platform: SceneEvent[];
  if (scenario === "lamp") {
    const tr = halfP / (1 + v);
    const tf = halfP / (1 - v);
    platform = [
      { id: "flash", x: 0, t: 0 },
      { id: "hit-rear", x: -tr, t: tr },
      { id: "hit-front", x: tf, t: tf },
    ];
  } else if (scenario === "lightning") {
    // Strikes at both ends at platform time 0; "hit-*" = that flash reaching the passenger (car middle, x = vt).
    const tf = halfP / (1 + v);
    const tr = halfP / (1 - v);
    platform = [
      { id: "flash-front", x: halfP, t: 0 },
      { id: "flash-rear", x: -halfP, t: 0 },
      { id: "hit-front", x: v * tf, t: tf },
      { id: "hit-rear", x: v * tr, t: tr },
      { id: "reach-observer", x: 0, t: halfP },
    ];
  } else {
    // Headlight at the front wall flashes at t = 0; the pulse runs ahead of the train.
    platform = [{ id: "flash", x: halfP, t: 0 }];
  }
  if (frame === "platform") return platform;
  return platform.map((e) => {
    const [x, t] = boostEvent([e.x, e.t], v);
    return { ...e, x, t };
  });
}

/** Which wall the lamp's light reaches first in a frame ("same" in the train frame or at rest). */
export function lampFirstHit(v: number, frame: TrainFrame): "front" | "rear" | "same" {
  const ev = sceneEvents("lamp", v, frame);
  const f = ev.find((e) => e.id === "hit-front")?.t ?? 0;
  const r = ev.find((e) => e.id === "hit-rear")?.t ?? 0;
  if (Math.abs(f - r) <= 1e-9) return "same";
  return f < r ? "front" : "rear";
}

/** Which lightning strike happens first in a frame ("same" on the platform, "front" on the train when v > 0). */
export function lightningFirstStrike(v: number, frame: TrainFrame): "front" | "rear" | "same" {
  const ev = sceneEvents("lightning", v, frame);
  const f = ev.find((e) => e.id === "flash-front")?.t ?? 0;
  const r = ev.find((e) => e.id === "flash-rear")?.t ?? 0;
  if (Math.abs(f - r) <= 1e-9) return "same";
  return f < r ? "front" : "rear";
}

/** Which flash reaches the passenger first: frame independent (both arrivals happen where she is). */
export function lightningFirstToPassenger(v: number): "front" | "rear" | "same" {
  const ev = sceneEvents("lightning", v, "platform");
  const f = ev.find((e) => e.id === "hit-front")?.t ?? 0;
  const r = ev.find((e) => e.id === "hit-rear")?.t ?? 0;
  if (Math.abs(f - r) <= 1e-9) return "same";
  return f < r ? "front" : "rear";
}

/** Format a number for readouts: trims trailing zeros, at most `digits` decimals. */
export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "∞";
  if (Math.abs(n) < 0.5 * 10 ** -digits) return "0";
  const s = n.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
