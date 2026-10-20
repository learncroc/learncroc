import { cn } from "../cn";
import { Croc } from "../croc/Croc";
import { WORDMARK_ADVANCE, WORDMARK_PATH } from "./wordmark";

/** The product's name as set in the logo. Prose writes "Learncroc". */
export const WORDMARK = "learncroc";

/** The head drawing's aspect (228 × 134). */
const MARK_ASPECT = 228 / 134;

export interface WordmarkProps {
  /** Cap-ish size: the em size in px. Default 26. */
  size?: number;
  /** Default `var(--ink)`. */
  fill?: string;
  className?: string;
}

/** "learncroc" as outlines, so it renders the same everywhere (share posters included). Decorative. */
export function Wordmark({ size = 26, fill = "var(--ink)", className }: WordmarkProps) {
  return (
    <svg
      aria-hidden
      width={(size * WORDMARK_ADVANCE) / 1000}
      height={size * 1.03}
      viewBox={`0 -800 ${WORDMARK_ADVANCE} 1030`}
      className={cn("shrink-0", className)}
    >
      <path d={WORDMARK_PATH} fill={fill} />
    </svg>
  );
}

export interface LogoProps {
  /** Em size of the wordmark in px; the croc scales with it. Default 26. */
  size?: number;
  /** "row" (default): croc beside the wordmark. "stack": croc above, for square spaces. "mark": the croc alone. */
  layout?: "row" | "stack" | "mark";
  className?: string;
}

/**
 * The Learncroc logo: the croc's head (the mascot drawing, flat and still) and the lowercase wordmark in ink.
 * One accessible name, "Learncroc"; the parts are hidden from assistive tech.
 */
export function Logo({ size = 26, layout = "row", className }: LogoProps) {
  const markH = layout === "stack" ? size * 2.1 : size * 1.15;
  const mark = <Croc pose="head" still decorative size={markH * MARK_ASPECT} />;
  return (
    <span
      role="img"
      aria-label="Learncroc"
      className={cn("inline-flex items-center", layout === "stack" && "flex-col", className)}
      style={{ gap: layout === "stack" ? size * 0.12 : size * 0.28 }}
    >
      {mark}
      {layout === "mark" ? null : <Wordmark size={size} />}
    </span>
  );
}
