import { CROC_NAME } from "@learncroc/core";
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "../cn";
import { useReducedMotion } from "../motion";

/** The croc's states. Asleep is not a state: an idle croc dozes off by itself after 20 s without input. */
export type CrocState = "idle" | "listening" | "thinking" | "curious" | "happy" | "cheering";

/** Every state, in the order the dev gallery shows them. */
export const CROC_STATES: readonly CrocState[] = ["idle", "listening", "thinking", "curious", "happy", "cheering"];

/** The sizes the product uses: modal footer, map corner, checkpoint intro/result, finished map and poster. */
export const CROC_SIZES = { footer: 40, corner: 64, sheet: 96, hero: 160 } as const;

/** "full": the whole croc (the mascot). "head": the head alone (the logo mark, small spaces). */
export type CrocPose = "full" | "head";

export interface CrocProps {
  state?: CrocState;
  /** px, the larger side. 40 modal footer, 64 map corner, 96 checkpoint intro/result, 160 finished map. Default 64. */
  size?: number;
  /** Default "full". The head is the logo croc and reads better under 40 px. */
  pose?: CrocPose;
  /** The croc turns gold for a moment, with sparkles. Only when a stop lights up or a map is finished. */
  lumen?: boolean;
  /** The logo croc: flat colour, no clay grain, no shadow, no blinking, no eye-following, never dozes. */
  still?: boolean;
  /** Hide from assistive tech (a visible label names the croc nearby). */
  decorative?: boolean;
  /** Accessible name (default `CROC_NAME`). */
  title?: string;
  /** Change it to replay the current state's reaction (a second "happy" in a row). */
  reactKey?: string | number;
  /** Seed for the blink jitter (default: derived from the instance), so two crocs never blink in step. */
  seed?: number;
  className?: string;
}

/* ------------------------------------------------- geometry: one drawing, shared with the brand page */

const HEAD =
  "M30 112C26 80 52 66 92 68C134 70 168 80 200 86C220 90 226 104 222 116C218 132 200 138 176 140C140 144 100 150 70 148C42 146 32 132 30 112Z";
const BUMPS = [
  { x: 78, y: 62, r: 22 },
  { x: 118, y: 59, r: 25 },
] as const;
const NOSE = { x: 204, y: 87, r: 10 };
const JAW = "M20 128C80 141 160 131 232 111L232 175L20 175Z";
const BODY = "M64 138C44 166 42 222 74 244C98 258 146 258 168 244C198 224 196 166 172 138Z";
const TAIL = "M70 212C38 212 12 226 12 244C12 255 25 258 31 250C37 242 50 238 72 240Z";
const OPEN = "M96 116C130 121 178 113 216 100C209 138 152 152 96 116Z";
/** Square for the full croc so `size` means the same box as before; the head is 228 × 134. */
const VIEW: Record<CrocPose, [number, number, number, number]> = {
  full: [-3, 26, 246, 246],
  head: [8, 30, 228, 134],
};

type Eye = "oval" | "happy" | "closed" | "half";
type Mouth = "smile" | "grin" | "flat" | "open";
interface Brow {
  a: number;
  dy: number;
}
interface Face {
  eyes: [Eye, Eye];
  mouth: Mouth;
  /** A fixed gaze (viewBox units); otherwise the eyes follow the pointer. */
  look?: [number, number];
  brows?: [Brow | null, Brow | null];
  /** Upper-lid line for "half" eyes (negative opens them wider). */
  lid?: number;
  blush?: boolean;
  fx?: "think" | "zzz" | "spark";
}

const FACES = {
  hello: { eyes: ["oval", "oval"], mouth: "smile" },
  listening: { eyes: ["oval", "oval"], mouth: "smile", look: [2.5, 3] },
  thinking: {
    eyes: ["oval", "oval"],
    mouth: "flat",
    look: [-3, -3.5],
    brows: [
      { a: 10, dy: 0 },
      { a: -4, dy: -3 },
    ],
    fx: "think",
  },
  curious: {
    eyes: ["oval", "oval"],
    mouth: "smile",
    look: [-3.5, 1],
    brows: [
      { a: -8, dy: -5 },
      { a: 6, dy: 0 },
    ],
  },
  happy: { eyes: ["happy", "happy"], mouth: "grin", blush: true },
  proud: { eyes: ["closed", "closed"], mouth: "grin", blush: true, fx: "spark" },
  sleepy: { eyes: ["half", "half"], mouth: "flat", lid: 4, fx: "zzz" },
  chomp: { eyes: ["oval", "oval"], mouth: "open" },
} satisfies Record<string, Face>;
type FaceKey = keyof typeof FACES;

const STATE_FACE: Record<CrocState, FaceKey> = {
  idle: "hello",
  listening: "listening",
  thinking: "thinking",
  curious: "curious",
  happy: "happy",
  cheering: "proud",
};

/** Mouth lines; the curl at the cheek end and the two teeth along the line are part of each. */
const MOUTHS: Record<Exclude<Mouth, "open">, { d: string; teeth: string[] }> = {
  smile: {
    d: "M96 118C125 130 172 126 212 110M96 118c-5 -1 -8 -5 -6 -9",
    teeth: ["M174.3 119.4L186.3 117.9L181.1 128.4Z", "M191.5 114.7L203.5 113.2L198.3 123.7Z"],
  },
  grin: {
    d: "M94 115C124 136 178 130 214 106M94 115c-5 -1 -8 -5 -6 -9",
    teeth: ["M176.1 120.7L188.1 119.2L182.9 129.7Z", "M193.7 113.7L205.7 112.2L200.5 122.7Z"],
  },
  flat: { d: "M102 122C132 126 176 122 212 112M102 122c-5 -1 -8 -5 -6 -9", teeth: [] },
};
const OPEN_TEETH = ["M166 117l9-1.5-4 7z", "M195 109l9-2.5-3.5 7z", "M180 133l9-2-3.5-6.5z", "M201 123.5l8-3-3.5-5.5z"];

const star = (x: number, y: number, s: number) =>
  `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`;
const SPARKS = [star(36, 52, 8), star(162, 36, 6), star(226, 74, 8)];
const THINK_DOTS: readonly (readonly [number, number, number])[] = [
  [150, 45, 3],
  [161, 37, 4.5],
  [176, 29, 6.5],
];
const ZZZ: readonly (readonly [number, number, number])[] = [
  [150, 50, 12],
  [161, 41, 15],
  [174, 32, 19],
];

/** Blink: 120 ms closed. Every 2.6–6 s, sometimes twice. */
const BLINK_MS = 120;
/** Thinking dots pulse at most this long, then hold still. */
const THINK_MAX_MS = 8000;
/** An idle croc dozes off after this long without pointer or key input. */
const DOZE_MS = 20000;
/** Gold lasts this long, then the croc is jade again. */
const GOLD_MS = 2200;
/** Click: the jaw opens, then a grin. */
const CHOMP_OPEN_MS = 190;
const CHOMP_GRIN_MS = 650;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG for the blink jitter. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The croc: a round jade croc made of clay, with two eye bumps, a long smile and two little teeth. The
 * same drawing is the logo (pass `still`, usually with `pose="head"`). Fills only, no outline; colours
 * come from the `--croc*` tokens and are never world-tinted. No red, no tongue except mid-chomp.
 *
 * Alive (not `still`, motion allowed): breathes, blinks every few seconds, follows the pointer with its
 * eyes, snaps its jaw when pressed and dozes off after 20 s idle. Reactions (hop, lean) live in theme.css
 * on `data-part` groups keyed on `data-croc-state`. Reduced motion holds a still face per state.
 */
export function Croc({
  state = "idle",
  size = 64,
  pose = "full",
  lumen = false,
  still = false,
  decorative,
  title,
  reactKey,
  seed,
  className,
}: CrocProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reducedMotion = useReducedMotion();
  const alive = !still && !reducedMotion;
  const ref = useRef<SVGSVGElement>(null);
  const [blink, setBlink] = useState(false);
  const [thinkHold, setThinkHold] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [gold, setGold] = useState(lumen);
  const [chomp, setChomp] = useState<"open" | "grin" | null>(null);

  // Blinks with seeded jitter, in any state with open eyes.
  useEffect(() => {
    if (!alive) return;
    const next = rng(seed ?? hash(uid));
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    const once = () => {
      setBlink(true);
      later(() => setBlink(false), BLINK_MS);
    };
    const schedule = () =>
      later(
        () => {
          once();
          if (next() < 0.25) later(once, 260);
          schedule();
        },
        2600 + next() * 3400,
      );
    schedule();
    return () => {
      for (const t of timers) clearTimeout(t);
      setBlink(false);
    };
  }, [alive, seed, uid]);

  // Eyes follow the pointer (a CSS variable on the root, no re-render); any input wakes a dozing croc.
  useEffect(() => {
    if (!alive) return;
    let doze: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(doze);
      setAsleep(false);
      if (state === "idle") doze = setTimeout(() => setAsleep(true), DOZE_MS);
    };
    const onMove = (ev: PointerEvent) => {
      arm();
      const svg = ref.current;
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const dx = ev.clientX - (r.left + r.width * 0.42);
      const dy = ev.clientY - (r.top + r.height * (pose === "full" ? 0.16 : 0.3));
      const d = Math.hypot(dx, dy) || 1;
      const m = Math.min(1, d / 280) * 3.8;
      svg.style.setProperty("--croc-look", `${((dx / d) * m).toFixed(2)}px ${((dy / d) * m * 0.85).toFixed(2)}px`);
    };
    arm();
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", arm, { passive: true });
    document.addEventListener("keydown", arm);
    return () => {
      clearTimeout(doze);
      setAsleep(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", arm);
      document.removeEventListener("keydown", arm);
    };
  }, [alive, state, pose]);

  // Thinking: dots pulse for at most 8 s, then hold. A new reactKey restarts the 8 s.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey restarts the timer on purpose
  useEffect(() => {
    if (state !== "thinking") return;
    setThinkHold(false);
    const t = setTimeout(() => setThinkHold(true), THINK_MAX_MS);
    return () => clearTimeout(t);
  }, [state, reactKey]);

  // Gold only for a moment. A static render (the share poster) keeps the first frame: gold.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey replays the moment on purpose
  useEffect(() => {
    setGold(lumen);
    if (!lumen) return;
    const t = setTimeout(() => setGold(false), GOLD_MS);
    return () => clearTimeout(t);
  }, [lumen, reactKey]);

  // Chomp on press: jaw open, then a grin, then back to the state's face.
  useEffect(() => {
    if (!chomp) return;
    const t = setTimeout(
      () => setChomp(chomp === "open" ? "grin" : null),
      chomp === "open" ? CHOMP_OPEN_MS : CHOMP_GRIN_MS,
    );
    return () => clearTimeout(t);
  }, [chomp]);

  const faceKey: FaceKey =
    chomp === "open" ? "chomp" : chomp === "grin" ? "happy" : asleep && state === "idle" ? "sleepy" : STATE_FACE[state];
  const face: Face = FACES[faceKey];
  const clay = !still;
  const f = clay ? `url(#${uid}-clay)` : undefined;
  const [vx, vy, vw, vh] = VIEW[pose];
  const w = vw >= vh ? size : (size * vw) / vh;
  const h = vh >= vw ? size : (size * vh) / vw;

  const label = title ?? CROC_NAME;
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };
  const colours = gold
    ? ({
        "--c": "var(--croc-gold)",
        "--c-d": "var(--croc-gold-shade)",
        "--c-b": "var(--croc-gold-belly)",
        "--c-k": "var(--croc-gold-blush)",
      } as CSSProperties)
    : ({
        "--c": "var(--croc)",
        "--c-d": "var(--croc-shade)",
        "--c-b": "var(--croc-belly)",
        "--c-k": "var(--croc-blush)",
      } as CSSProperties);

  const headShape = (
    <>
      <path d={HEAD} />
      {BUMPS.map((b) => (
        <circle key={b.x} cx={b.x} cy={b.y} r={b.r} />
      ))}
      <circle cx={NOSE.x} cy={NOSE.y} r={NOSE.r} />
    </>
  );

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: the <title> is rendered whenever the croc is not decorative
    <svg
      ref={ref}
      width={w}
      height={h}
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      data-croc-state={state}
      data-croc-face={faceKey}
      data-pose={pose}
      data-lumen={gold || undefined}
      data-blink={blink || undefined}
      data-still={still || undefined}
      data-hold={(state === "thinking" && thinkHold) || undefined}
      className={cn("lm-croc shrink-0 overflow-visible", className)}
      style={colours}
      onPointerDown={alive ? () => setChomp("open") : undefined}
      {...a11y}
    >
      {decorative ? null : <title>{label}</title>}
      <defs>
        {clay ? (
          <>
            <filter id={`${uid}-clay`} x="-5%" y="-5%" width="110%" height="115%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves={2} seed={7} result="n" />
              <feColorMatrix
                in="n"
                type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .45 0 0 0 -.17"
                result="dk"
              />
              <feComposite in="dk" in2="SourceAlpha" operator="in" result="dk2" />
              <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 .6 0 0 -.3" result="lt" />
              <feComposite in="lt" in2="SourceAlpha" operator="in" result="lt2" />
              <feMerge>
                <feMergeNode in="SourceGraphic" />
                <feMergeNode in="dk2" />
                <feMergeNode in="lt2" />
              </feMerge>
            </filter>
            <radialGradient id={`${uid}-hl`} cx="34%" cy="24%" r="70%">
              <stop offset="0" stopColor="#fff" stopOpacity={0.4} />
              <stop offset=".6" stopColor="#fff" stopOpacity={0} />
            </radialGradient>
          </>
        ) : null}
        <clipPath id={`${uid}-head`}>
          <path d={HEAD} />
        </clipPath>
        <clipPath id={`${uid}-open`}>
          <path d={OPEN} />
        </clipPath>
      </defs>

      {still ? null : pose === "full" ? (
        <ellipse cx={120} cy={263} rx={86} ry={6} fill="var(--croc-ink)" opacity={0.09} />
      ) : (
        <ellipse cx={128} cy={158} rx={84} ry={5} fill="var(--croc-ink)" opacity={0.09} />
      )}

      <g data-part="figure" key={reactKey}>
        <g data-part="bob">
          {pose === "full" ? <FullBody clay={clay} uid={uid} /> : null}
          <g data-part="head">
            <g fill="var(--c-d)" transform="translate(3 6)">
              {headShape}
            </g>
            <g fill="var(--c)" filter={f}>
              {headShape}
            </g>
            <path fill="var(--c-b)" clipPath={`url(#${uid}-head)`} d={JAW} filter={f} />
            {clay ? <g fill={`url(#${uid}-hl)`}>{headShape}</g> : null}
            {/* nostrils */}
            <ellipse fill="var(--croc-ink)" cx={200} cy={84} rx={2.6} ry={1.7} transform="rotate(-20 200 84)" />
            <ellipse fill="var(--croc-ink)" cx={209} cy={87.5} rx={2.6} ry={1.7} transform="rotate(-20 209 87.5)" />
            {face.blush ? <ellipse fill="var(--c-k)" opacity={0.5} cx={100} cy={125} rx={11} ry={6} /> : null}
            <g data-part="mouth">
              <MouthLines mouth={face.mouth} uid={uid} />
            </g>
            <g data-part="eyes">
              {BUMPS.map((b, i) => (
                <EyeOf key={b.x} face={face} i={i as 0 | 1} filter={f} />
              ))}
            </g>
          </g>
          <g data-part="fx">
            <Fx face={face} lumen={gold} />
          </g>
        </g>
      </g>
    </svg>
  );
}

function FullBody({ clay, uid }: { clay: boolean; uid: string }) {
  const f = clay ? `url(#${uid}-clay)` : undefined;
  const body = (
    <>
      <path d={TAIL} />
      <circle cx={47} cy={213} r={6} />
      <circle cx={29} cy={221} r={5} />
      <circle cx={19} cy={230} r={4} />
      <path d={BODY} />
      <ellipse cx={90} cy={251} rx={22} ry={10} />
      <ellipse cx={150} cy={251} rx={22} ry={10} />
    </>
  );
  const arms = (
    <>
      <ellipse cx={54} cy={182} rx={10} ry={16} transform="rotate(30 54 182)" />
      <ellipse cx={186} cy={180} rx={10} ry={16} transform="rotate(-30 186 180)" />
    </>
  );
  return (
    <>
      <g fill="var(--c-d)" transform="translate(3 6)">
        {body}
      </g>
      <g fill="var(--c)" filter={f}>
        {body}
      </g>
      {clay ? <path fill={`url(#${uid}-hl)`} d={BODY} /> : null}
      <ellipse fill="var(--c-b)" cx={120} cy={204} rx={42} ry={40} filter={f} />
      <g fill="none" stroke="var(--c-d)" strokeOpacity={0.22} strokeWidth={3} strokeLinecap="round">
        {[182, 198, 214, 230].map((y) => {
          const w = Math.sqrt(Math.max(0, 1 - ((y - 204) / 40) ** 2)) * 42 * 0.78;
          return <path key={y} d={`M${(120 - w).toFixed(1)} ${y}Q120 ${y + 7} ${(120 + w).toFixed(1)} ${y}`} />;
        })}
      </g>
      <g data-part="arms">
        <g fill="var(--c-d)" transform="translate(2 3)">
          {arms}
        </g>
        <g fill="var(--c)" filter={f}>
          {arms}
        </g>
      </g>
    </>
  );
}

const STROKE = {
  fill: "none",
  stroke: "var(--croc-ink)",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function MouthLines({ mouth, uid }: { mouth: Mouth; uid: string }) {
  const tooth = (d: string) => (
    <path key={d} d={d} fill="#fff" stroke="var(--c-d)" strokeWidth={1} strokeLinejoin="round" />
  );
  if (mouth === "open") {
    return (
      <>
        <path d={OPEN} fill="#3a2350" stroke="var(--croc-ink)" strokeWidth={3.4} strokeLinejoin="round" />
        <ellipse cx={166} cy={134} rx={22} ry={6} fill="#f28fae" clipPath={`url(#${uid}-open)`} />
        {OPEN_TEETH.map(tooth)}
      </>
    );
  }
  const m = MOUTHS[mouth];
  return (
    <>
      {m.teeth.map(tooth)}
      <path d={m.d} {...STROKE} strokeWidth={3.6} />
    </>
  );
}

function EyeOf({ face, i, filter }: { face: Face; i: 0 | 1; filter: string | undefined }) {
  const b = BUMPS[i];
  const kind = face.eyes[i];
  const s = i ? 1.12 : 1;
  const R = b.r - 0.6;
  let inner: ReactNode;
  if (kind === "happy") inner = <path d="M-8 3Q0-8 8 3" {...STROKE} strokeWidth={4.2} />;
  else if (kind === "closed") inner = <path d="M-8-1Q0 7 8-1" {...STROKE} strokeWidth={4.2} />;
  else
    inner = (
      <>
        <ellipse fill="var(--croc-ink)" rx={7.4} ry={11} />
        <circle fill="#fff" opacity={0.9} cx={-2.4} cy={-4.6} r={2.2} />
      </>
    );
  let lid: ReactNode = null;
  if (kind === "half") {
    const y = face.lid ?? 0;
    const w = Math.sqrt(R * R - y * y);
    lid = (
      <>
        <path
          fill="var(--c)"
          filter={filter}
          d={`M${(-w).toFixed(2)} ${y}A${R} ${R} 0 ${y > 0 ? 1 : 0} 1 ${w.toFixed(2)} ${y}Z`}
        />
        <path d={`M${(-w * 0.72).toFixed(2)} ${y}L${(w * 0.72).toFixed(2)} ${y}`} {...STROKE} strokeWidth={4.2} />
      </>
    );
  }
  const br = face.brows?.[i];
  const look = face.look ? ({ translate: `${face.look[0]}px ${face.look[1]}px` } as CSSProperties) : undefined;
  return (
    <g transform={`translate(${b.x} ${b.y})`}>
      <g data-part="look" data-fixed={face.look ? true : undefined} style={look}>
        <g transform={`translate(2 2) scale(${s})`}>
          <g data-part="eyeball">{inner}</g>
        </g>
      </g>
      {lid}
      {br ? (
        <g transform={`translate(1 ${-14 + br.dy}) rotate(${br.a})`}>
          <path d="M-7 0H7" {...STROKE} strokeWidth={4.2} />
        </g>
      ) : null}
    </g>
  );
}

function Fx({ face, lumen }: { face: Face; lumen: boolean }) {
  if (face.fx === "think")
    return (
      <g fill="#fff" stroke="var(--ink-3)" strokeWidth={1.6}>
        {THINK_DOTS.map(([cx, cy, r], i) => (
          <circle key={cx} data-part="dot" cx={cx} cy={cy} r={r} style={{ animationDelay: `${i * 200}ms` }} />
        ))}
      </g>
    );
  if (face.fx === "zzz")
    return (
      <g fill="var(--ink-3)" fontWeight={800} style={{ fontFamily: "var(--font-recursive)" }}>
        {ZZZ.map(([x, y, fs], i) => (
          <text key={x} data-part="z" x={x} y={y} fontSize={fs} style={{ animationDelay: `${i * 400}ms` }}>
            z
          </text>
        ))}
      </g>
    );
  if (face.fx === "spark")
    // Gold sparkles only with gold (a lit stop); otherwise the world's line colours.
    return (
      <g>
        {SPARKS.map((d, i) => (
          <path
            key={d}
            data-part="spark"
            data-lumen-piece={lumen || undefined}
            d={d}
            fill={lumen ? "var(--lumen)" : `var(--w-${i + 1})`}
            style={{ animationDelay: `${i * 300}ms` }}
          />
        ))}
      </g>
    );
  return null;
}
