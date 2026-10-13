/**
 * The learner's token (11 kinds) and landmark glyphs (17 kinds), drawn as small flat SVG at the origin.
 * 2 px round strokes, flat fills, light from the top left (PLAN §6.5). Never Lumen: gold is for mastery.
 */
import type { LandmarkGlyph, TokenGlyph } from "@learncroc/core";

interface GlyphProps {
  /** Main ink. */
  ink: string;
  /** Accent (a line colour). */
  accent: string;
  /** Ground colour, for cut-outs. */
  ground: string;
}

/** Token art in a ~24 px box centred on the origin. */
export function TokenArt({ kind, ink, accent, ground }: GlyphProps & { kind: TokenGlyph }) {
  const s = { stroke: ink, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "train":
      // A little carriage with a clock in its window.
      return (
        <g>
          <rect x={-13} y={-8} width={26} height={14} rx={5} fill={accent} {...s} />
          <circle cx={-3} cy={-1} r={4} fill={ground} stroke={ink} strokeWidth={1.5} />
          <path d="M-3 -3V-1H-1" fill="none" stroke={ink} strokeWidth={1.2} strokeLinecap="round" />
          <rect x={4} y={-4} width={6} height={5} rx={1} fill={ground} stroke={ink} strokeWidth={1.2} />
          <circle cx={-7} cy={8} r={2} fill={ink} />
          <circle cx={7} cy={8} r={2} fill={ink} />
        </g>
      );
    case "comet":
      return (
        <g>
          <path
            d="M-14 -8L2 -2M-15 0L1 0M-12 8L2 2"
            fill="none"
            stroke={accent}
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.75}
          />
          <circle cx={6} cy={0} r={6} fill={accent} {...s} />
        </g>
      );
    case "packet":
      return (
        <g>
          <rect x={-11} y={-8} width={22} height={16} rx={2} fill={accent} {...s} />
          <path d="M-11 -8L0 1L11 -8" fill="none" {...s} />
        </g>
      );
    case "note":
      return (
        <g>
          <ellipse cx={-4} cy={7} rx={5} ry={4} fill={accent} {...s} transform="rotate(-20 -4 7)" />
          <path d="M1 6V-11L10 -8V-3L1 -6" fill="none" {...s} />
        </g>
      );
    case "electron":
      // Tok: a glowing charge with an orbit ring.
      return (
        <g>
          <ellipse rx={13} ry={5} fill="none" stroke={accent} strokeWidth={1.5} transform="rotate(-25)" opacity={0.8} />
          <circle r={6.5} fill={accent} stroke={ink} strokeWidth={2} />
          <circle cx={-2} cy={-2} r={2} fill={ground} opacity={0.7} />
        </g>
      );
    case "scooter":
      return (
        <g>
          <circle cx={-9} cy={7} r={4} fill={ground} {...s} />
          <circle cx={9} cy={7} r={4} fill={ground} {...s} />
          <path d="M-9 7H3L7 -9H11M3 7C3 1 -4 -1 -10 0" fill="none" {...s} />
          <rect x={-12} y={-6} width={9} height={6} rx={2} fill={accent} {...s} />
        </g>
      );
    case "scroll":
      return (
        <g>
          <rect x={-9} y={-10} width={18} height={20} rx={2} fill={accent} {...s} />
          <path d="M-12 -10H12M-12 10H12M-5 -4H5M-5 1H5M-5 5H2" fill="none" {...s} strokeWidth={1.6} />
        </g>
      );
    case "hiker":
      return (
        <g>
          <circle cx={1} cy={-10} r={3.5} fill={accent} {...s} />
          <path d="M1 -6L0 4L-5 12M0 4L6 12M0 -3L7 2M-1 -4L-7 0" fill="none" {...s} />
          <rect x={-9} y={-6} width={6} height={9} rx={2} fill={accent} {...s} />
        </g>
      );
    case "lantern":
      return (
        <g>
          <path d="M-4 -12H4M0 -12V-9" fill="none" {...s} />
          <rect x={-7} y={-9} width={14} height={18} rx={4} fill={accent} {...s} />
          <path d="M-7 -2H7M-7 4H7" stroke={ink} strokeWidth={1.2} opacity={0.6} />
        </g>
      );
    case "paper-plane":
      return (
        <g>
          <path d="M-13 1L13 -10L4 11L0 3Z" fill={accent} {...s} />
          <path d="M0 3L13 -10" fill="none" {...s} strokeWidth={1.5} />
        </g>
      );
    case "pin":
      return (
        <g>
          <circle cx={0} cy={-5} r={7} fill={accent} {...s} />
          <path d="M0 2V12" fill="none" {...s} />
          <circle cx={-2} cy={-7} r={2} fill={ground} opacity={0.6} />
        </g>
      );
  }
}

/** Landmark art in a ~36 px box centred on the origin (the final gate, named cards and the badge). */
export function LandmarkArt({ kind, ink, accent, ground }: GlyphProps & { kind: LandmarkGlyph }) {
  const s = { stroke: ink, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "chip":
      return (
        <g>
          <rect x={-12} y={-12} width={24} height={24} rx={3} fill={accent} {...s} />
          <path
            d="M-6 -16V-12M0 -16V-12M6 -16V-12M-6 12V16M0 12V16M6 12V16M-16 -6H-12M-16 0H-12M-16 6H-12M12 -6H16M12 0H16M12 6H16"
            {...s}
          />
        </g>
      );
    case "core":
      return (
        <g>
          <rect x={-14} y={-14} width={28} height={28} rx={4} fill={accent} {...s} />
          <rect x={-7} y={-7} width={14} height={14} rx={2} fill={ground} {...s} />
          <circle r={2.5} fill={ink} />
        </g>
      );
    case "furnace":
      return (
        <g>
          <path d="M-12 14V-4L0 -14L12 -4V14Z" fill={accent} {...s} />
          <path d="M-5 14V4A5 5 0 0 1 5 4V14" fill={ground} {...s} />
          <path d="M6 -10V-16H10V-6" fill="none" {...s} />
        </g>
      );
    case "station":
      return (
        <g>
          <path d="M-15 -4L0 -14L15 -4Z" fill={accent} {...s} />
          <rect x={-12} y={-4} width={24} height={16} fill={ground} {...s} />
          <path d="M-6 12V4H6V12" fill="none" {...s} />
        </g>
      );
    case "clock":
      return (
        <g>
          <circle r={13} fill={accent} {...s} />
          <circle r={9} fill={ground} {...s} strokeWidth={1.5} />
          <path d="M0 -6V0L4 3" fill="none" {...s} />
        </g>
      );
    case "tunnel":
      return (
        <g>
          <path d="M-16 12C-16 -12 16 -12 16 12Z" fill={accent} {...s} />
          <path d="M-8 12C-8 -2 8 -2 8 12" fill={ground} {...s} />
        </g>
      );
    case "town":
      return (
        <g>
          <path d="M-14 12V-2L-7 -8L0 -2V12Z" fill={accent} {...s} />
          <path d="M0 12V-6L7 -12L14 -6V12Z" fill={ground} {...s} />
          <path d="M-14 12H14" {...s} />
        </g>
      );
    case "plaza":
      return (
        <g>
          <rect x={-14} y={-6} width={28} height={18} rx={2} fill={accent} {...s} />
          <path d="M-8 12V2M0 12V2M8 12V2M-16 -6H16L0 -15Z" fill={ground} {...s} />
        </g>
      );
    case "temple":
      return (
        <g>
          <path d="M-16 -5L0 -15L16 -5Z" fill={accent} {...s} />
          <path d="M-11 -5V11M-4 -5V11M4 -5V11M11 -5V11M-15 13H15" fill="none" {...s} />
        </g>
      );
    case "theatre":
      return (
        <g>
          <path d="M-14 12V-8C-7 -14 7 -14 14 -8V12Z" fill={accent} {...s} />
          <path d="M-9 12V-2C-9 -6 -3 -6 -3 -2M9 12V-2C9 -6 3 -6 3 -2" fill="none" {...s} />
        </g>
      );
    case "lodge":
      return (
        <g>
          <path d="M-16 0L0 -13L16 0" fill="none" {...s} />
          <rect x={-11} y={-1} width={22} height={13} fill={accent} {...s} />
          <rect x={-3} y={4} width={6} height={8} fill={ground} {...s} />
          <path d="M7 -10V-5" {...s} />
        </g>
      );
    case "venue":
      return (
        <g>
          <rect x={-14} y={-10} width={28} height={22} rx={2} fill={accent} {...s} />
          <path d="M-14 -4H14" {...s} />
          <path d="M-6 12V5H6V12" fill={ground} {...s} />
          <path d="M-8 -14L-4 -10M8 -14L4 -10" {...s} />
        </g>
      );
    case "tower":
      return (
        <g>
          <path d="M-6 14L-3 -10H3L6 14Z" fill={accent} {...s} />
          <path d="M-8 -10H8L0 -17Z" fill={ground} {...s} />
        </g>
      );
    case "lighthouse":
      return (
        <g>
          <path d="M-6 14L-4 -6H4L6 14Z" fill={accent} {...s} />
          <rect x={-5} y={-12} width={10} height={6} fill={ground} {...s} />
          <path d="M-7 -12H7L0 -17Z" fill={accent} {...s} />
        </g>
      );
    case "star":
      return (
        <path
          d="M0 -15L4.4 -5.5L14.5 -4.6L6.8 2.2L9 12.3L0 7L-9 12.3L-6.8 2.2L-14.5 -4.6L-4.4 -5.5Z"
          fill={accent}
          {...s}
        />
      );
    case "box":
      return (
        <g>
          <path d="M-13 -5L0 -12L13 -5V9L0 15L-13 9Z" fill={accent} {...s} />
          <path d="M-13 -5L0 2L13 -5M0 2V15" fill="none" {...s} />
        </g>
      );
    case "tent":
      return (
        <g>
          <path d="M-15 12L0 -14L15 12Z" fill={accent} {...s} />
          <path d="M0 -14V12M-5 12L0 2L5 12" fill={ground} {...s} />
          <path d="M0 -14V-19L6 -17L0 -15" fill={accent} {...s} strokeWidth={1.5} />
        </g>
      );
  }
}

/** Default landmark per renderer when the final gate names none. */
export const DEFAULT_LANDMARK: Record<"metro" | "circuit" | "atlas" | "sketchbook", LandmarkGlyph> = {
  metro: "station",
  circuit: "core",
  atlas: "town",
  sketchbook: "star",
};
