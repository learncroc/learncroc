import { CROC_NAME } from "@learncroc/core";
import { useEffect, useId, useState } from "react";
import { cn } from "../cn";
import { useReducedMotion } from "../motion";

/** Moss's states. There is no sad, sleepy or impatient state, by design. */
export type CrocState = "idle" | "listening" | "thinking" | "curious" | "happy" | "cheering";

/** Every state, in the order the dev gallery shows them. */
export const CROC_STATES: readonly CrocState[] = ["idle", "listening", "thinking", "curious", "happy", "cheering"];

/** The sizes the product uses: modal footer, map corner, checkpoint intro/result, finished map and poster. */
export const CROC_SIZES = { footer: 40, corner: 64, sheet: 96, hero: 160 } as const;

export interface CrocProps {
  state?: CrocState;
  /** px (square). 40 modal footer, 64 map corner, 96 checkpoint intro/result, 160 finished map. Default 64. */
  size?: number;
  /** The lantern glows Lumen and Lumen joins the confetti. Only at a gate opening or a finished map. */
  lumen?: boolean;
  /** Hide from assistive tech (a visible label names Moss nearby). */
  decorative?: boolean;
  /** Accessible name (default `CROC_NAME`, "Moss"). */
  title?: string;
  /** Change it to replay the current state's reaction (a second "happy" in a row). */
  reactKey?: string | number;
  /** Seed for the blink jitter (default: derived from the instance), so two crocs never blink in step. */
  seed?: number;
  className?: string;
}

/* ---------------------------------------------------------------- geometry (viewBox 0 0 120 120) */

const HEAD = "M91 47C91 30 79 19 62 19C50 19 42 25 38 33C25 33 12 40 12 50C12 60 22 66 36 66H66C82 66 91 60 91 47Z";
const BODY = "M35 106C29 86 38 65 61 63C84 61 95 80 90 106Z";
const BELLY = "M46 106C43 92 50 77 62 77C74 77 80 92 78 106Z";
const TAIL =
  "M86 97C97 104 112 101 113 89C114 80 106 75 100 78C95 81 95 88 100 89C103 90 105 87 104 84C107 86 107 93 101 95C96 97 91 96 87 92Z";
const FEET: [number, number][] = [
  [44, 106],
  [78, 106],
];
/** Eye bumps on top of the head: far (left) and near (right), three-quarters. */
const EYES = [
  { cx: 46, cy: 26, r: 8.5, w: 5.2 },
  { cx: 67, cy: 23, r: 9.5, w: 6 },
] as const;
const ARMS_REST = {
  left: "M47 77C41 79 35 82 29 85",
  right: "M78 76C83 81 83 87 79 91",
};
const ARMS_UP = {
  left: "M44 76C38 70 33 62 32 54",
  right: "M80 75C86 69 92 60 95 52",
};
/** Lantern on the ground by the left hand (rest), or raised high in the right hand (cheering). */
const LANTERN_REST = { x: 21, y: 85 };
const LANTERN_UP = { x: 97, y: 36 };

const CONFETTI: { x: number; y: number; shape: "c" | "t" | "s"; color: 1 | 2 | 3 | 4 | 5; rot: number }[] = [
  { x: 14, y: 22, shape: "c", color: 1, rot: 0 },
  { x: 30, y: 8, shape: "t", color: 2, rot: 20 },
  { x: 92, y: 6, shape: "s", color: 3, rot: -15 },
  { x: 110, y: 26, shape: "c", color: 4, rot: 0 },
  { x: 6, y: 44, shape: "s", color: 5, rot: 30 },
  { x: 114, y: 52, shape: "t", color: 1, rot: -30 },
  { x: 52, y: 4, shape: "c", color: 3, rot: 0 },
  { x: 76, y: 2, shape: "t", color: 4, rot: 45 },
  { x: 20, y: 64, shape: "c", color: 2, rot: 0 },
  { x: 106, y: 74, shape: "s", color: 2, rot: 10 },
  { x: 40, y: 12, shape: "s", color: 5, rot: -40 },
  { x: 100, y: 12, shape: "c", color: 5, rot: 0 },
];
/** Reduced motion: five still pieces around the raised arms. */
const STILL_CONFETTI = [0, 2, 3, 6, 10];

/** Blink: 120 ms close, 80 ms hold, 120 ms open. */
const BLINK_MS = 320;
/** Thinking dots pulse at most this long, then hold as a still "…". */
const THINK_MAX_MS = 8000;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG for the blink jitter (6–9 s). */
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
 * Moss, the croc: an old, patient river croc with a mossy back and a small lantern (01-cpo §7, 02-game-ux §7).
 * One inline SVG, flat fills, round strokes in `--croc-ink`, a `--surface` halo behind the outline so it
 * reads on any world ground, and never world-tinted. Mouth is a line, never red, no tongue.
 *
 * Motion lives in theme.css on `data-part` groups (figure, halo, tail, arms, lantern, head, eyes, pupils,
 * lids, brow, fx), keyed on `data-croc-state`. Idle only blinks (every 6–9 s, seeded). Reduced motion
 * holds a static pose per state.
 */
export function Croc({
  state = "idle",
  size = 64,
  lumen = false,
  decorative,
  title,
  reactKey,
  seed,
  className,
}: CrocProps) {
  const uid = useId();
  const reducedMotion = useReducedMotion();
  const [blink, setBlink] = useState(false);
  const [thinkHold, setThinkHold] = useState(false);

  // Idle blink with seeded jitter; the only idle loop. Off under reduced motion.
  useEffect(() => {
    if (state !== "idle" || reducedMotion) return;
    const next = rng(seed ?? hash(uid));
    let t: ReturnType<typeof setTimeout>;
    let open: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      t = setTimeout(
        () => {
          setBlink(true);
          open = setTimeout(() => {
            setBlink(false);
            schedule();
          }, BLINK_MS);
        },
        6000 + next() * 3000,
      );
    };
    schedule();
    return () => {
      clearTimeout(t);
      if (open) clearTimeout(open);
      setBlink(false);
    };
  }, [state, reducedMotion, seed, uid]);

  // Thinking: dots pulse for at most 8 s, then hold. A new reactKey restarts the 8 s.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey restarts the timer on purpose
  useEffect(() => {
    if (state !== "thinking") return;
    setThinkHold(false);
    const t = setTimeout(() => setThinkHold(true), THINK_MAX_MS);
    return () => clearTimeout(t);
  }, [state, reactKey]);

  const label = title ?? CROC_NAME;
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };
  const happyEyes = state === "happy" || state === "cheering";
  const armsUp = state === "cheering";
  const arms = armsUp ? ARMS_UP : ARMS_REST;
  const lantern = armsUp ? LANTERN_UP : LANTERN_REST;
  // Strokes stay legible when small: the 40 px footer croc draws heavier lines.
  const sw = size <= 48 ? 3.4 : size <= 80 ? 2.5 : 2;
  const halo = sw + 6;
  const confetti =
    state !== "cheering" ? [] : reducedMotion ? CONFETTI.filter((_, i) => STILL_CONFETTI.includes(i)) : CONFETTI;

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: the <title> is rendered whenever the croc is not decorative
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      data-croc-state={state}
      data-lumen={lumen || undefined}
      data-blink={blink || undefined}
      data-hold={(state === "thinking" && thinkHold) || undefined}
      className={cn("lm-croc shrink-0 overflow-visible", className)}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      {decorative ? null : <title>{label}</title>}
      {lumen ? (
        <defs>
          <radialGradient id={`${uid}-glow`}>
            <stop offset="0%" stopColor="var(--lumen)" stopOpacity={0.75} />
            <stop offset="100%" stopColor="var(--lumen)" stopOpacity={0} />
          </radialGradient>
        </defs>
      ) : null}
      <g data-part="figure" key={reactKey}>
        {/* the halo: the silhouette in --surface, 3 px past the outline, behind everything */}
        <g data-part="halo" fill="var(--surface)" stroke="var(--surface)" strokeWidth={halo}>
          <path data-part="tail" d={TAIL} />
          <path d={BODY} />
          {FEET.map(([x, y]) => (
            <ellipse key={x} cx={x} cy={y} rx={8} ry={4} />
          ))}
          <g data-part="lantern">
            <rect x={lantern.x - 7.5} y={lantern.y + 2} width={15} height={17} rx={3.5} />
          </g>
          <g data-part="arms" fill="none">
            <path d={arms.left} strokeWidth={9 + 6} />
            <path d={arms.right} strokeWidth={9 + 6} />
          </g>
          <g data-part="head">
            <path d={HEAD} />
            {EYES.map((e) => (
              <circle key={e.cx} cx={e.cx} cy={e.cy} r={e.r} />
            ))}
          </g>
        </g>

        <g stroke="var(--croc-ink)" strokeWidth={sw}>
          {/* tail, curled in front */}
          <path data-part="tail" d={TAIL} fill="var(--croc)" />
          {/* body, mossy back, belly */}
          <path d={BODY} fill="var(--croc)" />
          <path
            d="M40 80c3-3 6-3 8 0M37 92c3-3 6-3 8 0M84 76c3-2 5-1 6 2"
            stroke="var(--croc-ink)"
            strokeOpacity={0.45}
            strokeWidth={sw * 0.7}
          />
          <circle cx={88} cy={88} r={2.2} fill="var(--croc-belly)" stroke="none" opacity={0.8} />
          <circle cx={39} cy={70} r={1.8} fill="var(--croc-belly)" stroke="none" opacity={0.8} />
          <path d={BELLY} fill="var(--croc-belly)" />
          <path d="M54 86h16M52 94h20M51 101h22" stroke="var(--croc-ink)" strokeOpacity={0.35} strokeWidth={sw * 0.6} />
          {FEET.map(([x, y]) => (
            <ellipse key={x} cx={x} cy={y} rx={8} ry={4} fill="var(--croc)" />
          ))}

          {/* lantern: unlit glass in ink; Lumen only at a gate opening or a finished map */}
          <g data-part="lantern">
            {lumen ? (
              <circle
                data-part="glow"
                cx={lantern.x}
                cy={lantern.y + 10}
                r={20}
                fill={`url(#${uid}-glow)`}
                stroke="none"
              />
            ) : null}
            <path d={`M${lantern.x - 4} ${lantern.y + 2}c0-6 8-6 8 0`} />
            <rect
              x={lantern.x - 7.5}
              y={lantern.y + 2}
              width={15}
              height={17}
              rx={3.5}
              fill={lumen ? "var(--lumen)" : "var(--croc-eye, var(--surface))"}
            />
            <path
              d={`M${lantern.x - 5} ${lantern.y + 2}h10M${lantern.x - 5} ${lantern.y + 19}h10`}
              strokeWidth={sw + 0.6}
            />
            <path
              d={`M${lantern.x} ${lantern.y + 6.5}c-2.4 3-2.4 5.5 0 7.5c2.4-2 2.4-4.5 0-7.5Z`}
              fill={lumen ? "var(--lumen-text)" : "none"}
              strokeWidth={sw * 0.6}
              strokeOpacity={lumen ? 0 : 0.5}
            />
          </g>

          {/* arms: two short strokes with an outline; the right hand holds the lantern */}
          <g data-part="arms">
            <path d={arms.left} strokeWidth={9} />
            <path d={arms.right} strokeWidth={9} />
            <path d={arms.left} strokeWidth={9 - sw * 2} stroke="var(--croc)" />
            <path d={arms.right} strokeWidth={9 - sw * 2} stroke="var(--croc)" />
          </g>

          {/* head: tilts around the neck when curious */}
          <g data-part="head">
            <path d={HEAD} fill="var(--croc)" />
            {/* mossy scutes along the crown */}
            <path d="M78 26c2-3 5-3 7 0M84 34c2-3 5-2 6 1" stroke="var(--croc-ink)" strokeOpacity={0.45} />
            {/* snout highlight, one light from the top left */}
            <path d="M18 44c6-5 14-7 20-7" stroke="var(--croc-belly)" strokeWidth={sw + 1} />
            {/* nostrils */}
            <circle cx={17} cy={46} r={1.4} fill="var(--croc-ink)" stroke="none" />
            <circle cx={23} cy={43.5} r={1.4} fill="var(--croc-ink)" stroke="none" />
            {/* mouth: a calm line in ink, no red, no tongue; a wider smile when happy */}
            <path
              data-part="mouth"
              d={happyEyes ? "M17 56C30 63 46 63 60 57c2-1 3-3 2-5" : "M17 57C30 61 46 61 59 58c2-.5 3-2 2.5-4"}
            />
            {/* cheek */}
            <ellipse cx={66} cy={54} rx={5.5} ry={3.2} fill="var(--ember-soft)" opacity={0.6} stroke="none" />

            {/* eyes on top of the head */}
            <g data-part="eyes">
              {EYES.map((e) => (
                <circle key={e.cx} cx={e.cx} cy={e.cy} r={e.r} fill="var(--croc)" />
              ))}
              {happyEyes ? (
                // ^^ : closed, smiling eyes
                <g data-part="happy-eyes" strokeWidth={sw + 0.6}>
                  {EYES.map((e) => (
                    <path
                      key={e.cx}
                      d={`M${e.cx - e.w} ${e.cy + 1.5}c${e.w * 0.5}-${e.w} ${e.w * 1.5}-${e.w} ${e.w * 2} 0`}
                    />
                  ))}
                </g>
              ) : (
                <>
                  {EYES.map((e) => (
                    <circle
                      key={e.cx}
                      cx={e.cx}
                      cy={e.cy}
                      r={e.w}
                      fill="var(--croc-eye, var(--surface))"
                      strokeWidth={sw * 0.7}
                    />
                  ))}
                  <g data-part="pupils">
                    {EYES.map((e) => (
                      <g key={e.cx}>
                        <circle cx={e.cx + 0.6} cy={e.cy + 0.8} r={e.w * 0.46} fill="var(--croc-ink)" stroke="none" />
                        <circle
                          cx={e.cx - 0.6}
                          cy={e.cy - 0.6}
                          r={0.9}
                          fill="var(--croc-eye, var(--surface))"
                          stroke="none"
                        />
                      </g>
                    ))}
                  </g>
                  <g data-part="lids">
                    {EYES.map((e) => (
                      <circle key={e.cx} cx={e.cx} cy={e.cy} r={e.w + 0.6} fill="var(--croc)" strokeWidth={sw * 0.7} />
                    ))}
                  </g>
                </>
              )}
              {/* the brow lifts 2 px when curious */}
              <path data-part="brow" d="M61 11.5c3-1.6 7-1.8 10-.6" strokeWidth={sw} />
            </g>
          </g>
        </g>
      </g>

      {/* effects: never bounce with the body */}
      <g data-part="fx">
        {state === "curious" ? (
          <text
            x={98}
            y={24}
            fontSize={22}
            fontWeight={800}
            fill="var(--ink)"
            stroke="var(--surface)"
            strokeWidth={4}
            paintOrder="stroke"
            className="lm-pop-in"
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          >
            ?
          </text>
        ) : null}
        {state === "thinking" ? (
          <g fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} paintOrder="stroke">
            {[0, 1, 2].map((i) => (
              <circle
                key={i}
                data-part="dot"
                cx={92 + i * 8}
                cy={18 - i * 4}
                r={3}
                style={{ animationDelay: `${i * 300}ms` }}
              />
            ))}
          </g>
        ) : null}
        {confetti.map((c, i) => {
          // Lumen joins the confetti only when the lantern is lit (a gate opening, a finished map).
          const fill = lumen && i % 3 === 0 ? "var(--lumen)" : `var(--w-${c.color})`;
          return (
            <g
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed confetti layout
              key={`${String(reactKey ?? "")}-${i}`}
              data-part="confetti"
              data-lumen-piece={(lumen && i % 3 === 0) || undefined}
              style={{ animationDelay: `${(i % 4) * 60}ms` }}
              transform={`translate(${c.x} ${c.y}) rotate(${c.rot})`}
            >
              {c.shape === "c" ? (
                <circle r={3} fill={fill} />
              ) : c.shape === "t" ? (
                <path d="M0-3.5l3.5 6h-7Z" fill={fill} />
              ) : (
                <path d="M-4 0c1.3-2.6 2.7-2.6 4 0s2.7 2.6 4 0" stroke={fill} strokeWidth={2} />
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
