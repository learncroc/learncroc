import type { NodeState } from "@learncroc/core";
import { cn } from "../cn";
import { type EntryKind, stateLabel } from "./states";

export interface StopGlyphProps {
  /** Shape-coded: Later = dotted ring, Ready = ring + dot, In progress = ring + dot + quarter arc, Done = line-colour disc + ground tick (never Lumen), Lit = disc + 8 rays, Fading = lower-half disc, Planned = dashed square, Building = ring + rotating dash. */
  state: NodeState;
  /** Card (default) or gate. Gates draw a barrier: closed (Locked), ajar (Ready / In progress), swung open (Open). No padlocks. */
  kind?: EntryKind;
  /** The last gate of a map: a pennant on the gate (the map draws the world's landmark behind it). */
  final?: boolean;
  /** Done fill: the card's line colour (default `--w-1`). The tick is the world ground colour. */
  lineColor?: string;
  /** Durable: a small diamond notch after a successful relight on a later day. */
  durable?: boolean;
  /** px, default 20. */
  size?: number;
  /** Accessible name; omit when a visible label sits next to it (pass `decorative`). */
  title?: string;
  /** Hide from assistive tech (a visible label already names the state). */
  decorative?: boolean;
  /** Ready stops breathe (3.2 s); static ring under reduced motion. */
  breathe?: boolean;
  className?: string;
}

const C = 12;
/** 8 rays around the lit disc. */
const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const [r1, r2] = [8.2, 10.8];
  return `M${(C + Math.cos(a) * r1).toFixed(2)} ${(C + Math.sin(a) * r1).toFixed(2)}L${(C + Math.cos(a) * r2).toFixed(2)} ${(C + Math.sin(a) * r2).toFixed(2)}`;
}).join("");
const TICK = "M8.5 12.2l2.4 2.4 4.6-5";

/** Custom stop-state glyphs. Colour is never the only signal: every state has its own shape. */
export function StopGlyph({
  state,
  kind = "node",
  final,
  durable,
  lineColor,
  size = 20,
  title,
  decorative,
  breathe,
  className,
}: StopGlyphProps) {
  const gate = kind === "checkpoint";
  const label =
    title ??
    `${gate ? (final ? "Final checkpoint, " : "Checkpoint, ") : ""}${stateLabel(kind, state)}${durable ? ", durable" : ""}`;
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: the <title> is rendered whenever the glyph is not decorative
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      data-state={state}
      data-kind={kind}
      data-final={final || undefined}
      className={cn("shrink-0 overflow-visible", className)}
      {...a11y}
    >
      {decorative ? null : <title>{label}</title>}
      {gate ? (
        <GateShape state={state} breathe={breathe} final={final} />
      ) : state === "planned" ? (
        <rect
          x={5.5}
          y={5.5}
          width={13}
          height={13}
          rx={2}
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth={1.75}
          strokeDasharray="3 2.2"
        />
      ) : state === "lit" ? (
        <g>
          <path d={RAYS} stroke="var(--lumen-text)" strokeWidth={1.75} strokeLinecap="round" />
          <circle cx={C} cy={C} r={6} fill="var(--lumen)" stroke="var(--lumen-text)" strokeWidth={1.25} />
        </g>
      ) : state === "fading" ? (
        <g>
          <path d="M5 12a7 7 0 0 0 14 0Z" fill="var(--ember)" />
          <circle cx={C} cy={C} r={7} fill="none" stroke="var(--ember-text)" strokeWidth={1.75} />
        </g>
      ) : state === "done" ? (
        <g>
          <circle
            cx={C}
            cy={C}
            r={7.5}
            fill={lineColor ?? "var(--w-1, var(--ink-2))"}
            stroke="var(--ink)"
            strokeWidth={1.25}
          />
          <path
            d={TICK}
            fill="none"
            stroke="var(--w-ground, var(--surface))"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      ) : state === "building" ? (
        <g>
          <circle cx={C} cy={C} r={7} fill="none" stroke="var(--ink-3)" strokeWidth={1.75} />
          <path
            d="M12 5a7 7 0 0 1 6.06 3.5"
            fill="none"
            stroke="var(--iris)"
            strokeWidth={2.5}
            strokeLinecap="round"
            className="lm-spin origin-center"
            style={{ transformBox: "view-box" }}
          />
        </g>
      ) : state === "locked" ? (
        <circle cx={C} cy={C} r={7} fill="none" stroke="var(--ink-3)" strokeWidth={1.75} strokeDasharray="1.6 2.6" />
      ) : (
        <g>
          {breathe ? (
            <circle cx={C} cy={C} r={10} fill="var(--sea)" className="lm-breathe-halo" style={{ opacity: 0.18 }} />
          ) : null}
          <circle cx={C} cy={C} r={7} fill="var(--surface)" stroke="var(--sea)" strokeWidth={2} />
          <circle cx={C} cy={C} r={2.75} fill="var(--sea)" />
          {state === "in-progress" ? (
            <path d="M12 5a7 7 0 0 1 7 7" fill="none" stroke="var(--sea)" strokeWidth={3.5} strokeLinecap="round" />
          ) : null}
        </g>
      )}
      {durable ? <path d="M19 1.5l2.5 2.5-2.5 2.5-2.5-2.5Z" fill="var(--lumen-text)" data-part="durable" /> : null}
    </svg>
  );
}

/** One gate leaf from its hinge, rotated `deg` up from closed (0 closed, 12 ajar, 80 swung open). */
function leaf(hx: number, dir: 1 | -1, deg: number, len = 6.4): string {
  const a = (deg * Math.PI) / 180;
  const x = hx + dir * len * Math.cos(a);
  const y = 12.5 - len * Math.sin(a);
  return `M${hx} 12.5L${x.toFixed(2)} ${y.toFixed(2)}`;
}

/**
 * Gate (checkpoint): a frame of two posts and two leaves on hinges. Locked = closed (ink-3), Ready = ajar
 * 12° in Sea with a key notch (and the breathing halo), In progress = Ready plus a quarter arc, Open =
 * swung 80° with short Lumen rays from the opening. No padlock anywhere.
 */
function GateShape({ state, breathe, final }: { state: NodeState; breathe?: boolean; final?: boolean }) {
  const open = state === "lit" || state === "fading" || state === "done";
  const ajar = state === "ready" || state === "in-progress";
  const ink = open ? "var(--lumen-text)" : ajar ? "var(--sea)" : "var(--ink-3)";
  const deg = open ? 80 : ajar ? 12 : 0;
  return (
    <g data-gate={open ? "open" : ajar ? "ajar" : "closed"} strokeLinecap="round">
      {ajar && breathe ? (
        <circle cx={C} cy={C} r={11} fill="var(--sea)" className="lm-breathe-halo" style={{ opacity: 0.18 }} />
      ) : null}
      {open ? (
        <>
          <circle cx={C} cy={12.5} r={4.2} fill="var(--lumen)" opacity={0.55} />
          <path d="M12 3.2v2.4M8.2 4.4l1.1 1.9M15.8 4.4l-1.1 1.9" stroke="var(--lumen-text)" strokeWidth={1.4} />
        </>
      ) : null}
      {/* frame: two posts */}
      <path d="M4.5 7.5v12.5M19.5 7.5v12.5" stroke={ink} strokeWidth={2.25} />
      <circle cx={4.5} cy={6} r={1.6} fill={ink} />
      <circle cx={19.5} cy={6} r={1.6} fill={ink} />
      {/* leaves: two paddles on hinges, a small gap where they meet */}
      <path d={`${leaf(5, 1, deg, 5.8)}${leaf(19, -1, deg, 5.8)}`} stroke={ink} strokeWidth={3.25} />
      {ajar ? <circle cx={C} cy={16.5} r={1.3} fill="var(--sea)" data-part="key" /> : null}
      {state === "in-progress" ? (
        <path d="M12 20.5a8.5 8.5 0 0 0 8.2-6.3" fill="none" stroke="var(--sea)" strokeWidth={2} opacity={0.8} />
      ) : null}
      {final ? (
        // The last gate: a pennant on the right post (the map draws the world's landmark behind it).
        <path
          d="M19.5 7V2.5l3.6 1.5-3.6 1.5"
          data-part="final"
          fill={open ? "var(--lumen)" : "none"}
          stroke={ink}
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
      ) : null}
    </g>
  );
}
