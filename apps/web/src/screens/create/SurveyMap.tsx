/**
 * The article map assembling on paper: cards appear as dotted pencil outlines as the
 * planner finds them ("Writing…"), edges draw in as order is decided, cards ink in as they pass their
 * checks, figures sketch in beside them, and each checkpoint is a taped barrier across the path.
 * Hand-drawn (seeded wobble), on the sketchbook's fixed cream paper whatever the app theme. Reduced
 * motion: states change at once.
 */
import { POCKET_INKS, POCKET_PAPER } from "@learncroc/ai/layout";
import type { NodeId } from "@learncroc/core";
import { type CSSProperties, useEffect, useState } from "react";
import { assetUrl } from "../../api/client";
import { arrowHead, inkEdge, seedOf, wobblyCircle } from "./ink";
import { type SurveyState, type SurveyStop, surveyLayout } from "./survey";

const R = 22;
const PAD = 40;
const PENCIL = "#3A342C";
const PENCIL_2 = "#6B6358";

const STYLE = `
.lm-survey .draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: lm-survey-draw 900ms var(--ease-out, ease-out) forwards; }
.lm-survey .pop { transform-box: fill-box; transform-origin: center; animation: lm-survey-pop 420ms var(--ease-out, ease-out) both; }
.lm-survey .fill { animation: lm-survey-fill 700ms var(--ease-out, ease-out) both; }
.lm-survey .sketch { animation: lm-survey-sketch 1100ms var(--ease-out, ease-out) both; }
.lm-survey .spin { transform-box: fill-box; transform-origin: center; animation: lm-survey-spin 2.4s linear infinite; }
.lm-survey .pos { transition: transform 360ms var(--ease-in-out, ease-in-out); }
@keyframes lm-survey-draw { to { stroke-dashoffset: 0; } }
@keyframes lm-survey-pop { from { opacity: 0; transform: scale(.6) rotate(-8deg); } to { opacity: 1; transform: none; } }
@keyframes lm-survey-fill { from { opacity: 0; } to { opacity: 1; } }
@keyframes lm-survey-sketch { from { clip-path: inset(0 100% 0 0); opacity: .2; } to { clip-path: inset(0 0 0 0); opacity: 1; } }
@keyframes lm-survey-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .lm-survey .draw, .lm-survey .pop, .lm-survey .fill, .lm-survey .sketch, .lm-survey .spin { animation: none; stroke-dashoffset: 0; } .lm-survey .pos { transition: none; } }
:root[data-motion="reduced"] .lm-survey .draw, :root[data-motion="reduced"] .lm-survey .pop, :root[data-motion="reduced"] .lm-survey .fill, :root[data-motion="reduced"] .lm-survey .sketch, :root[data-motion="reduced"] .lm-survey .spin { animation: none; stroke-dashoffset: 0; }
:root[data-motion="reduced"] .lm-survey .pos { transition: none; }
`;

const THEME_COLOURS: Record<string, string> = {
  "--ink": PENCIL,
  "--ink-2": PENCIL_2,
  "--lumen": "#FFC23D",
  "--sea": "#12877A",
  ...Object.fromEntries(POCKET_INKS.map((c, i) => [`--w-${i + 1}`, c])),
};

/**
 * Generated figures colour themselves with var(--…), which an <image> can't see. For the small
 * preview, substitute the pocket world's colours and show it as a data URL.
 */
function useThemedFigure(url: string | undefined): string | undefined {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (!url) return;
    const ctl = new AbortController();
    fetch(url, { credentials: "same-origin", signal: ctl.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((svg) => {
        const themed = svg.replace(/var\((--[a-z0-9-]+)\)/g, (m, name: string) => THEME_COLOURS[name] ?? m);
        setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(themed)}`);
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [url]);
  return src;
}

function FigureThumb({ url }: { url: string }) {
  const src = useThemedFigure(url);
  return src ? (
    <image href={src} width={64} height={40} transform="rotate(-3)" preserveAspectRatio="xMidYMid meet" />
  ) : null;
}

/** Two lines at most, split near the middle, so neighbouring labels don't run together. */
function titleLines(title: string): string[] {
  const words = title.split(/\s+/);
  if (title.length <= 16 || words.length < 2) return [title];
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
}

function ink(i: number): string {
  return `var(--w-${(i % 5) + 1})`;
}

function StopMark({
  stop,
  line,
  building,
  packId,
  selected,
}: {
  stop: SurveyStop;
  line: number;
  building: boolean;
  packId?: string;
  selected: boolean;
}) {
  const seed = seedOf(stop.id);
  const color = ink(line);
  const fig = stop.figures.filter((f) => f.ok);
  const firstFig = fig[0];
  return (
    <g className="pop">
      {stop.status === "failed" ? (
        <>
          <rect
            x={-R}
            y={-R}
            width={R * 2}
            height={R * 2}
            rx={6}
            fill="none"
            stroke={PENCIL_2}
            strokeWidth={2}
            strokeDasharray="4 5"
          />
          <text y={6} textAnchor="middle" fontSize={18} fill={PENCIL_2}>
            ?
          </text>
        </>
      ) : (
        <>
          {stop.status === "ready" ? (
            <path
              className="fill"
              d={wobblyCircle(0, 0, R - 2, seed + 7, 1)}
              fill={color}
              fillOpacity={0.16}
              stroke="none"
            />
          ) : null}
          <path
            d={wobblyCircle(0, 0, R, seed)}
            fill="none"
            stroke={stop.status === "ready" ? color : PENCIL_2}
            strokeWidth={stop.status === "ready" ? 2.5 : 2}
            strokeLinecap="round"
            strokeDasharray={stop.status === "ready" ? undefined : "3 6"}
          />
          {stop.status === "ready" ? <circle className="fill" r={4.5} fill={color} /> : null}
          {stop.status === "found" && building ? (
            // The unpainted circle centres the group's fill-box on the stop, so the arc orbits it.
            <g className="spin">
              <circle r={R + 6} fill="none" stroke="none" />
              <path
                d={`M ${R + 6} 0 A ${R + 6} ${R + 6} 0 0 1 0 ${R + 6}`}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </g>
          ) : null}
          {selected ? (
            <path d={wobblyCircle(0, 0, R + 9, seed + 3, 1.2)} fill="none" stroke={PENCIL} strokeWidth={1.5} />
          ) : null}
        </>
      )}
      {titleLines(stop.title).map((line, i) => (
        <text
          key={line}
          y={R + 22 + i * 18}
          textAnchor="middle"
          fontSize={16}
          fontWeight={650}
          fill={PENCIL}
          className="voice-casual"
        >
          {line}
        </text>
      ))}
      {stop.landmark ? (
        <text
          y={R + 40 + (titleLines(stop.title).length - 1) * 18}
          textAnchor="middle"
          fontSize={13}
          fontStyle="italic"
          fill={PENCIL_2}
        >
          {stop.landmark}
        </text>
      ) : null}
      {firstFig && packId ? (
        <g transform={`translate(${R + 4} ${-R - 30})`} className="sketch">
          <rect
            x={-2}
            y={-2}
            width={68}
            height={45}
            rx={3}
            fill="#FFFDF8"
            stroke={PENCIL_2}
            strokeWidth={1}
            transform="rotate(-3)"
          />
          <FigureThumb url={assetUrl(packId, `assets/fig-${stop.id}-${firstFig.screenId}.svg`)} />
          {fig.length > 1 ? (
            <text x={66} y={50} fontSize={11} fill={PENCIL_2}>
              +{fig.length - 1}
            </text>
          ) : null}
        </g>
      ) : null}
    </g>
  );
}

export interface SurveyMapProps {
  state: SurveyState;
  packId?: string;
  selected?: NodeId;
  onSelect?(id: NodeId): void;
  className?: string;
}

export function SurveyMap({ state, packId, selected, onSelect, className }: SurveyMapProps) {
  const lay = surveyLayout(state);
  const building = state.stages.cards === "active" || state.stages.plan === "active";
  const vw = lay.width + PAD * 2;
  const vh = lay.height + PAD * 2 + 30;
  const vars = Object.fromEntries(POCKET_INKS.map((c, i) => [`--w-${i + 1}`, c])) as CSSProperties;
  const ready = state.stops.filter((s) => s.status === "ready").length;
  return (
    <div className={className} style={{ ...vars, background: POCKET_PAPER }}>
      <svg
        className="lm-survey block h-full w-full"
        viewBox={`${-PAD} ${-PAD} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Article map, ${state.stops.length} cards planned, ${ready} ready to play${state.checkpoints.length ? `, ${state.checkpoints.length} checkpoints` : ""}.`}
      >
        <style>{STYLE}</style>
        <defs>
          <pattern id="lm-survey-dots" width={24} height={24} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={1} fill={PENCIL} opacity={0.12} />
          </pattern>
        </defs>
        <rect x={-PAD} y={-PAD} width={vw} height={vh} fill="url(#lm-survey-dots)" />
        {state.stops.length === 0 ? (
          <text
            x={lay.width / 2}
            y={lay.height / 2}
            textAnchor="middle"
            fontSize={16}
            fill={PENCIL_2}
            className="voice-casual"
          >
            {state.stages.plan === "active" ? "Planning the cards…" : "Reading the article…"}
          </text>
        ) : null}
        <g>
          {state.edges.map((e) => {
            const a = lay.nodes[e.from];
            const b = lay.nodes[e.to];
            if (!a || !b) return null;
            const seed = seedOf(`${e.from}>${e.to}`);
            const color = ink(lay.lineIndex[e.to] ?? 0);
            return (
              <g key={`${e.from}>${e.to}`}>
                <path
                  className="draw"
                  pathLength={1}
                  d={inkEdge(a, b, R, seed)}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <path
                  className="fill"
                  d={arrowHead(a, b, R)}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
        </g>
        {state.checkpoints.map((cp) => {
          const p = lay.nodes[cp.id];
          if (!p) return null;
          const covered = cp.covers.every((id) => state.stops.find((st) => st.id === id)?.status === "ready");
          return (
            <g key={cp.id} className="pos" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
              {cp.requires.map((r) => {
                const a = lay.nodes[r];
                if (!a) return null;
                return (
                  <path
                    key={r}
                    className="draw"
                    pathLength={1}
                    d={inkEdge({ x: a.x - p.x, y: a.y - p.y }, { x: 0, y: 0 }, R, seedOf(`${r}>${cp.id}`))}
                    fill="none"
                    stroke={PENCIL_2}
                    strokeWidth={1.6}
                    strokeDasharray="4 5"
                    strokeLinecap="round"
                  />
                );
              })}
              <g className="pop">
                <line x1={-14} y1={-16} x2={-14} y2={16} stroke={PENCIL} strokeWidth={3} strokeLinecap="round" />
                <line x1={14} y1={-16} x2={14} y2={16} stroke={PENCIL} strokeWidth={3} strokeLinecap="round" />
                <rect
                  x={-20}
                  y={-5}
                  width={40}
                  height={10}
                  rx={2}
                  fill={covered ? "#F3D98B" : "#FFFDF8"}
                  stroke={PENCIL}
                  strokeWidth={1.5}
                  transform="rotate(-4)"
                />
              </g>
              <text y={R + 18} textAnchor="middle" fontSize={13} fill={PENCIL_2} className="voice-casual">
                Checkpoint · {cp.size} questions
              </text>
            </g>
          );
        })}
        {state.stops.map((st) => {
          const p = lay.nodes[st.id];
          if (!p) return null;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: stops are also reachable as buttons in the list beside the map
            <g
              key={st.id}
              className="pos"
              style={{
                transform: `translate(${p.x}px, ${p.y}px)`,
                cursor: onSelect && st.status === "ready" ? "pointer" : "default",
              }}
              onClick={() => st.status === "ready" && onSelect?.(st.id)}
            >
              <StopMark
                stop={st}
                line={lay.lineIndex[st.id] ?? 0}
                building={building}
                {...(packId ? { packId } : {})}
                selected={selected === st.id}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export { ink as inkVar };
