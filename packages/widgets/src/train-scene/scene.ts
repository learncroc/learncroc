/**
 * The kinematics of a train scene in one frame (c = 1): where the car, the platform, the pulses and the
 * observers are at time t, plus the stamped events. All positions are exact Lorentz transforms of the
 * platform-frame setup in ../light-clock/relativity.ts.
 */
import {
  CAR_HALF,
  gamma,
  type SceneEvent,
  sceneEvents,
  type TrainFrame,
  type TrainScenario,
} from "../light-clock/relativity";

export interface Pulse {
  /** Emission point and time. */
  x: number;
  t: number;
  /** +1 right, −1 left. */
  dir: 1 | -1;
  /** Time the pulse is absorbed (hits a wall), if it is. */
  until?: number;
  /** Pulses that carry the story (the rest are drawn faint). */
  main: boolean;
}

export interface StampedEvent {
  id: SceneEvent["id"];
  label: string;
  x: number;
  t: number;
}

export interface SceneModel {
  scenario: TrainScenario;
  frame: TrainFrame;
  v: number;
  gamma: number;
  tStart: number;
  tEnd: number;
  /** Half the car's length in this frame (contracted on the platform). */
  carHalf: number;
  /** Car centre at time t. */
  carCenter: (t: number) => number;
  /** Where a point fixed on the platform (platform coordinate p) is at time t in this frame. */
  platformX: (p: number, t: number) => number;
  /** The observer at rest in this frame (platform observer or passenger) sits at x = 0. */
  observerX: 0;
  pulses: Pulse[];
  /** Events that get a stamp (wall hits, strikes, arrivals). */
  stamps: StampedEvent[];
  /** Events the stopwatch panel times (what "first" is about). */
  timed: StampedEvent[];
  /** Platform coordinates of scorch marks (lightning) and when each appears in this frame. */
  scorch: { p: number; t: number }[];
  /** x extent to fit on screen. */
  bounds: [number, number];
}

const LABELS: Record<SceneEvent["id"], string> = {
  flash: "Flash",
  "flash-front": "Front strike",
  "flash-rear": "Rear strike",
  "hit-front": "Front",
  "hit-rear": "Rear",
  "reach-observer": "Both reach the platform observer",
};

export function sceneModel(scenario: TrainScenario, v: number, frame: TrainFrame): SceneModel {
  const g = gamma(v);
  const ev = sceneEvents(scenario, v, frame);
  const at = (id: SceneEvent["id"]) => ev.find((e) => e.id === id);
  const carHalf = frame === "platform" ? CAR_HALF / g : CAR_HALF;
  const carCenter = frame === "platform" ? (t: number) => v * t : () => 0;
  const platformX = frame === "platform" ? (p: number) => p : (p: number, t: number) => p / g - v * t;

  let pulses: Pulse[] = [];
  let stamps: StampedEvent[] = [];
  let timed: StampedEvent[] = [];
  let scorch: { p: number; t: number }[] = [];
  let tStart = 0;
  let tEnd = 1;
  const stamp = (id: SceneEvent["id"], label = LABELS[id]): StampedEvent | undefined => {
    const e = at(id);
    return e ? { id, label, x: e.x, t: e.t } : undefined;
  };

  if (scenario === "lamp") {
    const flash = at("flash") as SceneEvent;
    const hr = at("hit-rear") as SceneEvent;
    const hf = at("hit-front") as SceneEvent;
    pulses = [
      { x: flash.x, t: flash.t, dir: -1, until: hr.t, main: true },
      { x: flash.x, t: flash.t, dir: 1, until: hf.t, main: true },
    ];
    stamps = [stamp("hit-rear", "Rear wall"), stamp("hit-front", "Front wall")].filter(isDefined);
    timed = [stamp("hit-rear", "Light hits the rear wall"), stamp("hit-front", "Light hits the front wall")].filter(
      isDefined,
    );
    tStart = flash.t;
    tEnd = Math.max(hr.t, hf.t) * 1.18 + 0.4;
  } else if (scenario === "lightning") {
    const ff = at("flash-front") as SceneEvent;
    const fr = at("flash-rear") as SceneEvent;
    const hf = at("hit-front") as SceneEvent;
    const hr = at("hit-rear") as SceneEvent;
    const ro = at("reach-observer") as SceneEvent;
    pulses = [
      { x: ff.x, t: ff.t, dir: -1, main: true },
      { x: fr.x, t: fr.t, dir: 1, main: true },
      { x: ff.x, t: ff.t, dir: 1, main: false },
      { x: fr.x, t: fr.t, dir: -1, main: false },
    ];
    stamps = [
      stamp("flash-rear"),
      stamp("flash-front"),
      stamp("hit-front", "Front flash reaches the passenger"),
      stamp("hit-rear", "Rear flash reaches the passenger"),
    ].filter(isDefined);
    timed = [stamp("flash-front"), stamp("flash-rear")].filter(isDefined);
    const halfP = CAR_HALF / g;
    scorch = [
      { p: halfP, t: ff.t },
      { p: -halfP, t: fr.t },
    ];
    tStart = Math.min(ff.t, fr.t) - 0.3;
    tEnd = Math.max(hf.t, hr.t, ro.t) * 1.08 + 0.6;
  } else {
    const flash = at("flash") as SceneEvent;
    pulses = [{ x: flash.x, t: flash.t, dir: 1, main: true }];
    stamps = [];
    timed = [];
    tStart = flash.t;
    tEnd = flash.t + 12;
  }

  // Fit the car at both ends of the timeline, the events and the observer.
  const xs: number[] = [0];
  for (const t of [tStart, tEnd]) xs.push(carCenter(t) - carHalf, carCenter(t) + carHalf);
  for (const e of ev) xs.push(e.x);
  if (scenario !== "headlight") {
    for (const t of [tStart, tEnd]) {
      xs.push(platformX(0, t));
      for (const m of scorch) xs.push(platformX(m.p, t));
    }
  }
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const pad = (hi - lo) * 0.08 + 0.5;
  // The headlight pulse runs off ahead: leave room in front of the train.
  const bounds: [number, number] = scenario === "headlight" ? [lo - pad, hi + pad + 6] : [lo - pad, hi + pad];

  return {
    scenario,
    frame,
    v,
    gamma: g,
    tStart,
    tEnd,
    carHalf,
    carCenter,
    platformX,
    observerX: 0,
    pulses,
    stamps,
    timed,
    scorch,
    bounds,
  };
}

/** Where a pulse is at time t, or null before emission / after absorption. */
export function pulseX(p: Pulse, t: number): number | null {
  if (t < p.t - 1e-9) return null;
  if (p.until !== undefined && t > p.until + 1e-9) return null;
  return p.x + p.dir * (t - p.t);
}

/** When light from an event reaches an observer at rest at x = 0 in this frame. */
export function seenAt(e: { x: number; t: number }): number {
  return e.t + Math.abs(e.x);
}

function isDefined<T>(x: T | undefined): x is T {
  return x !== undefined;
}
