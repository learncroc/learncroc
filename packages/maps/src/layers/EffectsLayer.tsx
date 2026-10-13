/**
 * EffectsLayer: the map moments' overlays, drawn over the renderer in layout coordinates. MapView
 * orchestrates the moments (cardDone, gateOpen, revisit, lightUp) and hands this layer a list of
 * short-lived effect items, each of which plays once on mount (Web Animations API, transform, opacity
 * and dash offset only):
 *
 * - `burst`: a Lumen burst (a card lighting, the gate opening). Only for mastery.
 * - `tick`: the small Sea/ink burst of a card closing (Done). Never Lumen.
 * - `lay`: track drawn along an edge in its line colour (the laid track of cardDone).
 * - `flow`: Lumen flowing along an edge (light running through the section, power through the gate).
 * - `ripple`: a single Sea ripple on a card that just became Ready.
 * - `pulse`: a Sea ring once (unfinished covers of a Locked gate, the next card).
 * - `label`: a short "+ brighter" / "Ready" label for reduced motion.
 *
 * Two overlays persist until MapView clears them: the revisit route (Sea dashes marching once from the
 * gate back to the cards worth a second look) and the route to a Later card (ink, dashed).
 */
import type { NodeId } from "@learncroc/core";
import { useEffect, useState } from "react";
import type { Scene } from "../lib/scene";

export type EffectItem =
  | { id: string; kind: "burst"; node: NodeId; delay: number; size?: number }
  | { id: string; kind: "tick"; node: NodeId; delay: number }
  | { id: string; kind: "lay"; from: NodeId; to: NodeId; delay: number; color: string; duration?: number }
  | { id: string; kind: "flow"; from: NodeId; to: NodeId; delay: number; duration?: number }
  | { id: string; kind: "ripple"; node: NodeId; delay: number }
  | { id: string; kind: "pulse"; node: NodeId; delay: number }
  | { id: string; kind: "label"; node: NodeId; delay: number; text: string; tone: "lumen" | "sea" };

export interface EffectsLayerProps {
  scene: Scene;
  reducedMotion: boolean;
  /** Relight return: cards light in sequence over --dur-lightup. */
  lightUp?: { nodes: NodeId[]; key: string };
  /** One-shot effects, keyed by id. */
  items?: EffectItem[];
  /** The revisit route: Sea dashes from the gate back to each card, marching once, then still. */
  revisit?: { paths: string[]; rings: NodeId[]; key: string };
  /** The route to a Later card (its peek is pinned): ink dashes drawn in once. */
  route?: { d: string; key: string };
  /** Called when the relight light-up finishes. */
  onDone?(kind: "light-up"): void;
}

const LIGHTUP_MS = 2400;
export const FLOW_MS = 900;

type Anim = { keyframes: Keyframe[]; options: KeyframeAnimationOptions };

/** Ref callback that plays a WAAPI animation once (no-op where element.animate is unavailable). */
function play(anim: Anim) {
  return (el: Element | null) => {
    if (!el || typeof (el as Element & { animate?: unknown }).animate !== "function") return;
    el.animate(anim.keyframes, { fill: "both", ...anim.options });
  };
}

export function EffectsLayer({ scene, reducedMotion, lightUp, items, revisit, route, onDone }: EffectsLayerProps) {
  const [activeLight, setActiveLight] = useState<typeof lightUp>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: replays only when the key changes.
  useEffect(() => {
    if (!lightUp?.key) return;
    setActiveLight(lightUp);
    const t = setTimeout(
      () => {
        setActiveLight(undefined);
        onDone?.("light-up");
      },
      reducedMotion ? 1600 : LIGHTUP_MS + 700,
    );
    return () => clearTimeout(t);
  }, [lightUp?.key]);

  return (
    <g data-layer="effects" aria-hidden pointerEvents="none">
      {route ? <RouteOverlay key={route.key} d={route.d} reduced={reducedMotion} /> : null}
      {revisit ? (
        <RevisitOverlay
          key={revisit.key}
          scene={scene}
          paths={revisit.paths}
          rings={revisit.rings}
          reduced={reducedMotion}
        />
      ) : null}
      {activeLight ? (
        <LightUpEffect key={activeLight.key} scene={scene} nodes={activeLight.nodes} reduced={reducedMotion} />
      ) : null}
      {items?.map((it) => (
        <Item key={it.id} scene={scene} item={it} reduced={reducedMotion} />
      ))}
    </g>
  );
}

function edgeBetween(scene: Scene, from: NodeId, to: NodeId): { d: string; reversed: boolean } | undefined {
  const fwd = scene.edgeByKey.get(`${from}>${to}`);
  if (fwd) return { d: fwd.d, reversed: false };
  const back = scene.edgeByKey.get(`${to}>${from}`);
  return back ? { d: back.d, reversed: true } : undefined;
}

function Item({ scene, item, reduced }: { scene: Scene; item: EffectItem; reduced: boolean }) {
  switch (item.kind) {
    case "burst": {
      const n = scene.byId.get(item.node);
      return n ? (
        <Burst x={n.x} y={n.y} delay={item.delay} reduced={reduced} size={item.size ?? (n.gate ? 1.6 : 1)} />
      ) : null;
    }
    case "tick": {
      const n = scene.byId.get(item.node);
      if (!n || reduced) return null;
      return (
        <g transform={`translate(${n.x} ${n.y})`} data-effect="tick">
          <circle
            r={16}
            fill="none"
            stroke="var(--sea)"
            strokeWidth={3}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            ref={play({
              keyframes: [
                { opacity: 0.8, transform: "scale(0.6)" },
                { opacity: 0, transform: "scale(1.6)" },
              ],
              options: { duration: 600, delay: item.delay, easing: "cubic-bezier(.2,.8,.2,1)" },
            })}
          />
          <circle
            r={11}
            fill="none"
            stroke="var(--w-ink)"
            strokeWidth={1.5}
            strokeDasharray="2 4"
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            ref={play({
              keyframes: [
                { opacity: 0.7, transform: "scale(0.8)" },
                { opacity: 0, transform: "scale(1.9)" },
              ],
              options: { duration: 600, delay: item.delay + 60, easing: "cubic-bezier(.2,.8,.2,1)" },
            })}
          />
        </g>
      );
    }
    case "lay": {
      const e = edgeBetween(scene, item.from, item.to);
      if (!e || reduced) return null;
      return (
        <path
          data-effect="lay"
          d={e.d}
          fill="none"
          stroke={item.color}
          strokeWidth={7}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          ref={play({
            keyframes: [
              { strokeDashoffset: e.reversed ? -1 : 1, opacity: 1 },
              { strokeDashoffset: 0, opacity: 1, offset: 0.85 },
              { strokeDashoffset: 0, opacity: 0 },
            ],
            options: { duration: item.duration ?? 700, delay: item.delay, easing: "cubic-bezier(.65,0,.35,1)" },
          })}
        />
      );
    }
    case "flow": {
      const e = edgeBetween(scene, item.from, item.to);
      if (!e || reduced) return null;
      return (
        <path
          data-effect="flow"
          d={e.d}
          fill="none"
          stroke="var(--lumen)"
          strokeWidth={7}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          ref={play({
            keyframes: [
              { strokeDashoffset: e.reversed ? -1 : 1, opacity: 0.95 },
              { strokeDashoffset: 0, opacity: 0.95, offset: 0.62 },
              { strokeDashoffset: 0, opacity: 0 },
            ],
            options: {
              duration: (item.duration ?? FLOW_MS) + 500,
              delay: item.delay,
              easing: "cubic-bezier(.65,0,.35,1)",
            },
          })}
        />
      );
    }
    case "ripple":
    case "pulse": {
      const n = scene.byId.get(item.node);
      if (!n) return null;
      const r = n.gate ? 30 : 18;
      if (reduced)
        return (
          <circle
            cx={n.x}
            cy={n.y}
            r={r + 6}
            fill="none"
            stroke="var(--sea)"
            strokeWidth={2}
            strokeDasharray="3 3"
            ref={play({
              keyframes: [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }],
              options: { duration: 1500, delay: item.delay },
            })}
          />
        );
      return (
        <g transform={`translate(${n.x} ${n.y})`} data-effect={item.kind}>
          <circle
            r={r}
            fill="none"
            stroke="var(--sea)"
            strokeWidth={item.kind === "ripple" ? 3 : 2.5}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            ref={play({
              keyframes: [
                { opacity: item.kind === "ripple" ? 0.5 : 0.9, transform: "scale(1)" },
                { opacity: 0, transform: `scale(${item.kind === "ripple" ? 2.2 : 1.6})` },
              ],
              options: { duration: 700, delay: item.delay, easing: "cubic-bezier(.2,.8,.2,1)" },
            })}
          />
        </g>
      );
    }
    case "label": {
      const n = scene.byId.get(item.node);
      if (!n) return null;
      return (
        <text
          x={n.x + 18}
          y={n.y - 18}
          fontSize={12}
          fontWeight={650}
          fill={item.tone === "lumen" ? "var(--lumen-text)" : "var(--sea-text, var(--sea))"}
          stroke="var(--w-ground)"
          strokeWidth={3}
          style={{ paintOrder: "stroke" }}
          data-effect="label"
          ref={play({
            keyframes: [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }],
            options: { duration: 1500, delay: item.delay },
          })}
        >
          {item.text}
        </text>
      );
    }
  }
}

function Burst({
  x,
  y,
  delay,
  reduced,
  size = 1,
}: {
  x: number;
  y: number;
  delay: number;
  reduced: boolean;
  size?: number;
}) {
  if (reduced) {
    return (
      <g transform={`translate(${x} ${y})`}>
        <circle
          r={18 * size}
          fill="var(--lumen)"
          ref={play({
            keyframes: [{ opacity: 0 }, { opacity: 0.45 }, { opacity: 0 }],
            options: { duration: 120, delay },
          })}
        />
      </g>
    );
  }
  return (
    <g transform={`translate(${x} ${y})`} data-effect="burst">
      <circle
        r={16 * size}
        fill="none"
        stroke="var(--lumen)"
        strokeWidth={5}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        ref={play({
          keyframes: [
            { opacity: 0, transform: "scale(0.6)" },
            { opacity: 0.95, transform: "scale(1)", offset: 0.15 },
            { opacity: 0, transform: `scale(${3.4 * Math.min(size, 1.4)})` },
          ],
          options: { duration: 900, delay, easing: "cubic-bezier(.2,.8,.2,1)" },
        })}
      />
      <circle
        r={14 * size}
        fill="var(--lumen)"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        ref={play({
          keyframes: [
            { opacity: 0, transform: "scale(0.4)" },
            { opacity: 0.85, transform: "scale(1.25)", offset: 0.3 },
            { opacity: 0, transform: "scale(1)" },
          ],
          options: { duration: 700, delay, easing: "cubic-bezier(.2,.8,.2,1)" },
        })}
      />
    </g>
  );
}

function Brighter({ delay }: { delay: number }) {
  return (
    <text
      x={18}
      y={-16}
      fontSize={12}
      fontWeight={650}
      fill="var(--lumen-text)"
      stroke="var(--w-ground)"
      strokeWidth={3}
      style={{ paintOrder: "stroke" }}
      ref={play({
        keyframes: [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }],
        options: { duration: 1500, delay },
      })}
    >
      + brighter
    </text>
  );
}

function LightUpEffect({ scene, nodes, reduced }: { scene: Scene; nodes: NodeId[]; reduced: boolean }) {
  const step = nodes.length > 1 ? Math.min(320, (LIGHTUP_MS - 900) / (nodes.length - 1)) : 0;
  return (
    <g data-effect="light-up">
      {nodes.map((id, i) => {
        const n = scene.byId.get(id);
        if (!n) return null;
        return (
          <g key={id}>
            <Burst x={n.x} y={n.y} delay={reduced ? 0 : i * step} reduced={reduced} size={n.gate ? 1.6 : 1} />
            {reduced ? (
              <g transform={`translate(${n.x} ${n.y})`}>
                <Brighter delay={0} />
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/** Sea dashes (8 8, 4 px) from the gate to each revisit card; they march once over 800 ms, then hold. */
function RevisitOverlay({
  scene,
  paths,
  rings,
  reduced,
}: {
  scene: Scene;
  paths: string[];
  rings: NodeId[];
  reduced: boolean;
}) {
  return (
    <g data-effect="revisit" fill="none">
      {paths.map((d) => (
        <path
          key={d}
          d={d}
          stroke="var(--sea)"
          strokeWidth={4}
          strokeDasharray="8 8"
          strokeLinecap="round"
          opacity={0.95}
          ref={
            reduced
              ? undefined
              : play({
                  keyframes: [{ strokeDashoffset: 64 }, { strokeDashoffset: 0 }],
                  options: { duration: 800, easing: "cubic-bezier(.65,0,.35,1)" },
                })
          }
        />
      ))}
      {rings.map((id) => {
        const n = scene.byId.get(id);
        if (!n) return null;
        return (
          <circle
            key={id}
            cx={n.x}
            cy={n.y}
            r={n.gate ? 34 : 22}
            stroke="var(--sea)"
            strokeWidth={2.5}
            strokeDasharray="4 4"
          />
        );
      })}
    </g>
  );
}

/** The route to a Later card: 1.5 px ink dashes drawn in once (360 ms). */
function RouteOverlay({ d, reduced }: { d: string; reduced: boolean }) {
  return (
    <g data-effect="route" fill="none">
      <path
        d={d}
        stroke="var(--w-ink-2)"
        strokeWidth={1.5}
        strokeDasharray="5 5"
        strokeLinecap="round"
        ref={
          reduced
            ? undefined
            : play({
                keyframes: [{ opacity: 0 }, { opacity: 1 }],
                options: { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" },
              })
        }
      />
    </g>
  );
}
