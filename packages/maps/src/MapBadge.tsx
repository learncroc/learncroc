/**
 * MapBadge: the finished-map badge (derived, never revoked; 02 §9.2). A self-contained 240×240 SVG
 * medallion shaped by the renderer:
 *
 * - circuit: a square chip with seven pins a side and a die window;
 * - metro: a roundel with a bar across carrying the world name;
 * - atlas: a wax seal with a scalloped edge and a compass rose;
 * - sketchbook: a die-cut sticker with a peeled corner and a strip of tape.
 *
 * Inside: the world's token on the ground colour, the final landmark small behind it, the world name on a
 * circular path, the card count and the finish date. The rim is the only Lumen (plus the mint sheen).
 * `mint` plays the mint once: drop in, rim draws, a sheen sweeps, the token wobbles. Reduced motion: a
 * 220 ms fade. Poster-safe: no <img>, no external assets.
 */
import type { LandmarkGlyph, RendererId } from "@learncroc/core";
import { useReducedMotion } from "@learncroc/ui";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { mix, worldColors } from "./lib/color";
import { finalGate } from "./lib/graph";
import { DEFAULT_LANDMARK, LandmarkArt, TokenArt } from "./renderers/glyphs";
import type { MapBadgeProps } from "./types";

const C = 120;
/** Radius of the world-name arc (inside every rim shape). */
const ARC_R = 76;

function shapePath(renderer: RendererId): string {
  switch (renderer) {
    case "circuit":
      return "M38 26H202Q214 26 214 38V202Q214 214 202 214H38Q26 214 26 202V38Q26 26 38 26Z";
    case "atlas": {
      // Scalloped wax seal: 18 bumps.
      let d = "";
      const n = 18;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? 100 : 92;
        const x = C + Math.cos(a) * r;
        const y = C + Math.sin(a) * r;
        d +=
          i === 0
            ? `M${x.toFixed(1)} ${y.toFixed(1)}`
            : `Q${(C + Math.cos(a - Math.PI / n) * 108).toFixed(1)} ${(C + Math.sin(a - Math.PI / n) * 108).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      return `${d}Z`;
    }
    case "sketchbook":
      // A circle with the top-right corner peeled back (a straight cut).
      return "M190 70A96 96 0 1 1 168 36L190 70Z";
    default:
      return `M${C} 22A98 98 0 1 1 ${C - 0.01} 22Z`;
  }
}

function frameArt(renderer: RendererId, ink: string, ground: string, accent: string): ReactNode {
  switch (renderer) {
    case "circuit": {
      const pins: string[] = [];
      for (let i = 0; i < 7; i++) {
        const t = 46 + i * 24.7;
        pins.push(`M${t} 26V12M${t} 214V228M26 ${t}H12M214 ${t}H228`);
      }
      return (
        <>
          <path d={pins.join("")} stroke={ink} strokeWidth={5} strokeLinecap="round" />
          <rect
            x={58}
            y={58}
            width={124}
            height={124}
            rx={10}
            fill="none"
            stroke={ink}
            strokeWidth={2}
            strokeDasharray="4 4"
            opacity={0.5}
          />
        </>
      );
    }
    case "metro":
      return null;
    case "atlas": {
      const rays: string[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r1 = i % 2 === 0 ? 74 : 66;
        rays.push(`M${C + Math.cos(a) * 58} ${C + Math.sin(a) * 58}L${C + Math.cos(a) * r1} ${C + Math.sin(a) * r1}`);
      }
      return <path d={rays.join("")} stroke={accent} strokeWidth={3} strokeLinecap="round" opacity={0.8} />;
    }
    case "sketchbook":
      return (
        <>
          <path d="M190 70L168 36Q186 44 190 70Z" fill={mix(ground, ink, 0.18)} stroke={ink} strokeWidth={1.5} />
          <rect
            x={-40}
            y={-11}
            width={80}
            height={22}
            transform="translate(56 40) rotate(-32)"
            fill={ink}
            opacity={0.12}
          />
        </>
      );
  }
}

const fmtDate = (at: number) =>
  new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function MapBadge({ pack, cards, finishedAt, size = 96, className, mint }: MapBadgeProps) {
  const theme = pack.manifest.theme;
  const colors = worldColors(theme);
  const renderer = theme.renderer;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduced = useReducedMotion();
  const title = pack.manifest.title;
  const when = finishedAt ? fmtDate(finishedAt) : "";
  const label = `${title}: finished. ${cards} cards lit${when ? `, ${when}` : ""}.`;
  const fullMap = "map" in pack ? (pack as { map?: Parameters<typeof finalGate>[0] }).map : undefined;
  const lastGate = fullMap ? finalGate(fullMap) : undefined;
  const landmark: LandmarkGlyph =
    (lastGate ? theme.landmarks?.[lastGate]?.glyph : undefined) ?? DEFAULT_LANDMARK[renderer];
  const shape = shapePath(renderer);
  const accent = colors.lines[0];
  const plate = mix(colors.ground, colors.ink, colors.mode === "dark" ? 0.1 : 0.06);
  const world = theme.world.toUpperCase();
  // Fit the name on the upper half-arc (π·r long): shrink long names, never below 9 px.
  const arcFont = Math.max(9, Math.min(15, (Math.PI * ARC_R * 0.92) / Math.max(1, world.length * 0.78)));

  const root = useRef<SVGGElement | null>(null);
  const rim = useRef<SVGPathElement | null>(null);
  const sheen = useRef<SVGRectElement | null>(null);
  const token = useRef<SVGGElement | null>(null);
  useEffect(() => {
    if (!mint) return;
    const can = (el: Element | null): el is Element & { animate: Element["animate"] } =>
      !!el && typeof (el as Element & { animate?: unknown }).animate === "function";
    if (reduced) {
      if (can(root.current)) root.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
      return;
    }
    if (can(root.current))
      root.current.animate(
        [
          { opacity: 0, transform: "translateY(-24px) scale(0.8)" },
          { opacity: 1, transform: "translateY(3px) scale(1.02)", offset: 0.7 },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ],
        { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
      );
    if (can(rim.current))
      rim.current.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: 900,
        easing: "cubic-bezier(.2,.8,.2,1)",
        fill: "backwards",
      });
    if (can(sheen.current))
      sheen.current.animate(
        [
          { transform: "translateX(-300px)", opacity: 1 },
          { transform: "translateX(300px)", opacity: 1 },
        ],
        { duration: 700, delay: 900, easing: "cubic-bezier(.65,0,.35,1)", fill: "both" },
      );
    if (can(token.current))
      token.current.animate(
        [
          { transform: "rotate(0deg)" },
          { transform: "rotate(6deg)" },
          { transform: "rotate(-4deg)" },
          { transform: "rotate(0deg)" },
        ],
        { duration: 700, delay: 1300, easing: "ease-out" },
      );
  }, [mint, reduced]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      role="img"
      aria-label={label}
      className={className}
      data-badge={pack.manifest.id}
      data-renderer={renderer}
      fontFamily="'Recursive Variable', Recursive, ui-sans-serif, system-ui, sans-serif"
    >
      <title>{label}</title>
      <defs>
        <clipPath id={`${uid}-clip`}>
          <path d={shape} />
        </clipPath>
        <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <path id={`${uid}-arc`} d={`M${C - ARC_R} ${C + 6}A${ARC_R} ${ARC_R} 0 0 1 ${C + ARC_R} ${C + 6}`} />
      </defs>
      <g ref={root} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        {frameArt(renderer, colors.ink, colors.ground, accent)}
        <path d={shape} fill={colors.ground} />
        <g clipPath={`url(#${uid}-clip)`}>
          <rect width={240} height={240} fill={colors.ground} />
          <circle cx={C} cy={C + 4} r={58} fill={plate} />
          <g transform={`translate(${C} ${C - 18}) scale(1.6)`} opacity={0.45}>
            <LandmarkArt kind={landmark} ink={colors.ink2} accent={plate} ground={colors.ground} />
          </g>
          {renderer === "metro" ? (
            <>
              <rect x={14} y={C + 16} width={212} height={34} fill={accent} />
              <text
                x={C}
                y={C + 39}
                textAnchor="middle"
                fontSize={16}
                fontWeight={700}
                letterSpacing={1.5}
                fill={colors.ground}
              >
                {world}
              </text>
            </>
          ) : (
            <text fontSize={arcFont} fontWeight={700} letterSpacing={arcFont * 0.14} fill={colors.ink}>
              <textPath href={`#${uid}-arc`} startOffset="50%" textAnchor="middle">
                {world}
              </textPath>
            </text>
          )}
          <g ref={token} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
            <g transform={`translate(${C} ${renderer === "metro" ? C - 14 : C + 4}) scale(2.2)`}>
              <TokenArt kind={theme.token} ink={colors.ink} accent={accent} ground={colors.ground} />
            </g>
          </g>
          <text
            x={C}
            y={renderer === "metro" ? C + 72 : C + 66}
            textAnchor="middle"
            fontSize={15}
            fontWeight={700}
            fill={colors.ink}
          >
            {cards} cards
          </text>
          {when ? (
            <text
              x={C}
              y={renderer === "metro" ? C + 90 : C + 84}
              textAnchor="middle"
              fontSize={12}
              fill={colors.ink2}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {when}
            </text>
          ) : null}
          <rect
            ref={sheen}
            x={-60}
            y={-20}
            width={120}
            height={280}
            transform="rotate(20 120 120)"
            fill={`url(#${uid}-sheen)`}
            opacity={mint && !reduced ? 1 : 0}
          />
        </g>
        {/* The rim: the badge's one Lumen, with a hairline inside. */}
        <path
          ref={rim}
          d={shape}
          fill="none"
          stroke="var(--lumen)"
          strokeWidth={8}
          pathLength={1}
          strokeDasharray="1 1"
        />
        <path
          d={shape}
          fill="none"
          stroke="var(--lumen-text)"
          strokeWidth={1.2}
          transform="translate(120 120) scale(0.95) translate(-120 -120)"
        />
      </g>
    </svg>
  );
}
