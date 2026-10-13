/**
 * Classifies a traced photon path (pointer stroke or keyboard pen) as straight, diagonal or curve.
 * Points are in clock units: x to the right, y up, starting at the bottom mirror.
 */
export type TraceShape = "straight" | "diagonal" | "curve";

/** Perpendicular distance from p to the line through a and b. */
function distanceToLine(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/**
 * - straight: the stroke barely moves sideways (less than a quarter of a mirror gap) and stays close to its chord
 * - diagonal: it moves sideways and stays within 15% of its chord length of a straight line
 * - curve: anything that bows away from its chord
 * Returns null for strokes too short to judge (under a third of the mirror gap).
 */
export function classifyTrace(points: readonly (readonly [number, number])[], gap = 4): TraceShape | null {
  if (points.length < 2) return null;
  const first = points[0] as readonly [number, number];
  const last = points[points.length - 1] as readonly [number, number];
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (chord < gap / 3) return null;
  let maxDev = 0;
  for (const p of points) maxDev = Math.max(maxDev, distanceToLine(p, first, last));
  const bowed = maxDev / chord > 0.15;
  if (bowed) return "curve";
  return Math.abs(last[0] - first[0]) < gap / 4 ? "straight" : "diagonal";
}
