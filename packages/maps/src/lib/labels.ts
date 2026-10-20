/**
 * Label placement for stop names. Deterministic and greedy: termini first, then reading order; each
 * label tries below, above, right and left of its glyph and takes the first spot that clears every
 * glyph and every label already placed. StopLayer (HTML) and MapPoster (SVG) use the same boxes.
 */
import type { CompiledMap, NodeId, RendererId } from "@learncroc/core";
import { type Box, boxesOverlap } from "./geometry";
import { finalGate, gateSize, readingOrder } from "./graph";

/** Label metrics in layout px (the map scales as a whole, so labels scale with it). */
export const LABEL = { font: 13, lineHeight: 16, maxWidth: 136, maxLines: 2, gap: 6, charWidth: 0.56 } as const;

/** What a glyph stands for: a card, a gate (checkpoint, 1.5×) or the map's final gate (1.8×). */
export type GlyphKind = "card" | "gate" | "final";

const CARD_GLYPH: Record<RendererId, { w: number; h: number }> = {
  metro: { w: 28, h: 28 },
  circuit: { w: 40, h: 30 },
  atlas: { w: 30, h: 36 },
  sketchbook: { w: 32, h: 32 },
  trail: { w: 28, h: 28 },
};

/**
 * Glyph footprint per renderer (layout px). Gates are drawn across the track: 1.5× a card along the
 * crossing axis (1.8× for the final gate), so on bottom-to-top maps the box turns a quarter.
 * `true` / `false` are accepted for gate / card.
 */
export function glyphSize(
  renderer: RendererId,
  kind: GlyphKind | boolean,
  direction: "lr" | "bt" = "lr",
): { w: number; h: number } {
  const k: GlyphKind = kind === true ? "gate" : kind === false ? "card" : kind;
  const card = CARD_GLYPH[renderer];
  if (k === "card") return card;
  const f = k === "final" ? 1.8 : 1.5;
  const across = Math.round(Math.max(card.w, card.h) * f);
  const along = Math.round(Math.min(card.w, card.h) * f * 0.95);
  return direction === "bt" ? { w: across, h: along } : { w: along, h: across };
}

/** "4 questions · Power check": the second line of a gate's label. */
export function gateLine(map: CompiledMap, id: NodeId): string {
  const n = map.nodes[id];
  const size = gateSize(map, id);
  return `${size} questions · ${n?.title ?? "Checkpoint"}`;
}

/** Estimated text width (Recursive at 13 px averages ~0.56 em per character). */
export function textWidth(text: string, font: number = LABEL.font, weight = 1): number {
  let w = 0;
  for (const ch of text)
    w += /[iljtf.,'’:;! ]/.test(ch) ? 0.34 : /[mwMW@]/.test(ch) ? 0.86 : /[A-Z]/.test(ch) ? 0.66 : LABEL.charWidth;
  return w * font * weight;
}

/** Greedy word wrap into at most `maxLines` lines (the last line gets an ellipsis if it overflows). */
export function wrapLabel(
  text: string,
  maxWidth: number = LABEL.maxWidth,
  maxLines: number = LABEL.maxLines,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next) <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
  while (textWidth(`${last}…`) > maxWidth && last.length > 1) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

/** Gate sub-line ("4 questions · Power check"): smaller, secondary ink, one line. */
export const GATE_SUB_FONT = 11;
const GATE_LABEL_WIDTH = 210;

export type LabelSide = "below" | "above" | "right" | "left";

export interface PlacedLabel {
  id: NodeId;
  lines: string[];
  side: LabelSide;
  /** Text box in layout px. */
  box: Box;
  /** Glyph box in layout px. */
  glyph: Box;
  /** Gate labels: line 1 is "Checkpoint", the rest is "{n} questions · {name}" in secondary ink. */
  gate?: boolean;
}

const placeCache = new WeakMap<CompiledMap, Map<RendererId, Map<NodeId, PlacedLabel>>>();

export function placeLabels(map: CompiledMap, renderer: RendererId): Map<NodeId, PlacedLabel> {
  let perMap = placeCache.get(map);
  if (!perMap) {
    perMap = new Map();
    placeCache.set(map, perMap);
  }
  const hit = perMap.get(renderer);
  if (hit) return hit;

  const glyphs = new Map<NodeId, Box>();
  const last = finalGate(map);
  for (const [id, p] of Object.entries(map.layout.nodes)) {
    const kind: GlyphKind = map.nodes[id]?.kind !== "checkpoint" ? "card" : id === last ? "final" : "gate";
    const s = glyphSize(renderer, kind, map.layout.direction);
    glyphs.set(id, { x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h });
  }
  const order = readingOrder(map);
  order.sort((a, b) => Number(map.nodes[b]?.kind === "checkpoint") - Number(map.nodes[a]?.kind === "checkpoint"));
  const placed: PlacedLabel[] = [];
  const out = new Map<NodeId, PlacedLabel>();
  for (const id of order) {
    const glyph = glyphs.get(id);
    const node = map.nodes[id];
    if (!glyph || !node) continue;
    const gate = node.kind === "checkpoint" && node.status !== "planned";
    const lines = gate ? ["Checkpoint", ...wrapLabel(gateLine(map, id), GATE_LABEL_WIDTH, 1)] : wrapLabel(node.title);
    const w = Math.ceil(Math.max(...lines.map((l, i) => textWidth(l, gate && i > 0 ? GATE_SUB_FONT : LABEL.font)))) + 4;
    const h = lines.length * LABEL.lineHeight;
    const cx = glyph.x + glyph.w / 2;
    const cy = glyph.y + glyph.h / 2;
    const g = LABEL.gap;
    // Centred labels slide sideways to stay inside the layout (wide gate labels at the map's edge).
    const inside = (x: number) => (w >= map.layout.width ? x : Math.max(0, Math.min(map.layout.width - w, x)));
    const candidates: [LabelSide, Box][] = [
      ["below", { x: inside(cx - w / 2), y: glyph.y + glyph.h + g, w, h }],
      ["above", { x: inside(cx - w / 2), y: glyph.y - g - h, w, h }],
      ["right", { x: glyph.x + glyph.w + g, y: cy - h / 2, w, h }],
      ["left", { x: glyph.x - g - w, y: cy - h / 2, w, h }],
    ];
    const free = (b: Box) =>
      ![...glyphs.entries()].some(([other, gb]) => other !== id && boxesOverlap(b, gb, 2)) &&
      !placed.some((p) => boxesOverlap(b, p.box, 2));
    const pick = candidates.find(([, b]) => free(b)) ?? candidates[0];
    if (!pick) continue;
    const label: PlacedLabel = { id, lines, side: pick[0], box: pick[1], glyph, ...(gate ? { gate: true } : {}) };
    placed.push(label);
    out.set(id, label);
  }
  perMap.set(renderer, out);
  return out;
}

/** Every overlap between glyphs and labels (empty = readable). Used by tests and /dev/maps. */
export function labelCollisions(map: CompiledMap, renderer: RendererId): string[] {
  const labels = [...placeLabels(map, renderer).values()];
  const issues: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i] as PlacedLabel;
    for (let j = i + 1; j < labels.length; j++) {
      const b = labels[j] as PlacedLabel;
      if (boxesOverlap(a.glyph, b.glyph)) issues.push(`glyph ${a.id} overlaps glyph ${b.id}`);
      if (boxesOverlap(a.box, b.box)) issues.push(`label ${a.id} overlaps label ${b.id}`);
      if (boxesOverlap(a.box, b.glyph)) issues.push(`label ${a.id} overlaps glyph ${b.id}`);
      if (boxesOverlap(b.box, a.glyph)) issues.push(`label ${b.id} overlaps glyph ${a.id}`);
    }
  }
  return issues;
}

export interface PlacedLineTitle {
  line: string;
  title: string;
  box: Box;
  anchor: "start" | "end" | "middle";
  /** Text baseline position. */
  x: number;
  y: number;
}

const lineTitleCache = new WeakMap<CompiledMap, Map<RendererId, PlacedLineTitle[]>>();
/** Line titles are 12 px semibold. */
const LINE_TITLE_FONT = 12;

/**
 * Line titles ("Inside the Machine") sit by the first stop of each line: to its left when there is
 * room, else above it (clear of the Suggested tag), else under its label. Never over a glyph or a label.
 */
export function placeLineTitles(map: CompiledMap, renderer: RendererId): PlacedLineTitle[] {
  let perMap = lineTitleCache.get(map);
  if (!perMap) {
    perMap = new Map();
    lineTitleCache.set(map, perMap);
  }
  const hit = perMap.get(renderer);
  if (hit) return hit;
  const labels = placeLabels(map, renderer);
  const taken: Box[] = [];
  for (const l of labels.values()) {
    taken.push(l.glyph, l.box);
    // The Suggested tag can appear above any stop.
    taken.push({ x: l.glyph.x + l.glyph.w / 2 - 34, y: l.glyph.y - 22, w: 68, h: 18 });
  }
  const out: PlacedLineTitle[] = [];
  for (const line of map.lines) {
    const first = (map.layout.lines[line.id] ?? [])[0];
    const label = first ? labels.get(first) : undefined;
    if (!label) continue;
    const w = Math.ceil(textWidth(line.title, LINE_TITLE_FONT, 1.06)) + 4;
    const h = 16;
    const g = label.glyph;
    const cy = g.y + g.h / 2;
    const candidates: Omit<PlacedLineTitle, "line" | "title">[] = [
      { box: { x: g.x - 10 - w, y: cy - h / 2, w, h }, anchor: "end", x: g.x - 10, y: cy + 4 },
      { box: { x: g.x - 4, y: g.y - 24 - h, w, h }, anchor: "start", x: g.x - 4, y: g.y - 28 },
      {
        box: { x: label.box.x + label.box.w / 2 - w / 2, y: label.box.y + label.box.h + 2, w, h },
        anchor: "middle",
        x: label.box.x + label.box.w / 2,
        y: label.box.y + label.box.h + 14,
      },
      { box: { x: g.x + g.w + 10, y: cy - h / 2, w, h }, anchor: "start", x: g.x + g.w + 10, y: cy + 4 },
    ];
    const free = (b: Box) => !taken.some((t) => boxesOverlap(b, t, 2)) && b.x >= -40;
    const pick = candidates.find((c) => free(c.box)) ?? (candidates[1] as Omit<PlacedLineTitle, "line" | "title">);
    taken.push(pick.box);
    out.push({ line: line.id, title: line.title, ...pick });
  }
  perMap.set(renderer, out);
  return out;
}
