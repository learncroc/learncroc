/**
 * MapPoster: a static SVG snapshot of a map in its world (library posters, marketplace, share card),
 * and the client-side PNG export for the share card.
 *
 * The default poster draws the pack's renderer (with its backdrop) with motion and fog off, fits the
 * layout under a title band, labels the cards that matter at poster scale, captions "N of M cards lit"
 * and (on share cards) signs it "Learncroc".
 *
 * `layout="finished"` is the finished-map share poster (02 §9.3), 1200×630 or 1080×1350: the whole map
 * lit on its backdrop beside a panel with the badge, the world name, "11 cards · 4 sections", "I can now
 * explain:" with two line outcomes, Moss cheering and the Learncroc wordmark. It carries no learner data:
 * no names, scores, times or dates.
 */
import type { CompiledMap, NodeId, NodeView } from "@learncroc/core";
import { Croc } from "@learncroc/ui";
import { useId } from "react";
import { mix, worldColors, worldStyle } from "./lib/color";
import { everythingLit, isLitLike, sectionsOf, viewFor } from "./lib/graph";
import { GATE_SUB_FONT, LABEL, placeLabels, textWidth } from "./lib/labels";
import { MapBadge } from "./MapBadge";
import { RENDERERS, resolveRenderer } from "./renderers/index";
import type { MapPosterPngOptions, MapPosterProps } from "./types";

export interface MapPosterExtraProps {
  /** Sign the poster with the "Learncroc" wordmark (share cards). */
  brand?: boolean;
}

/** "6 of 11 cards lit" (+ " · 3 fading"). Cards only; gates are counted separately. */
export function litSummary(pack: MapPosterProps["pack"], views: MapPosterProps["views"]): string {
  const playable = Object.values(pack.map.nodes).filter((n) => n.status === "playable" && n.kind !== "checkpoint");
  const lit = playable.filter((n) => views[n.id]?.state === "lit").length;
  const fading = playable.filter((n) => views[n.id]?.state === "fading").length;
  return `${lit} of ${playable.length} cards lit${fading ? ` · ${fading} fading` : ""}`;
}

/** Every playable card and gate lit: the finished map, independent of anyone's progress. */
export function allLitViews(map: CompiledMap): Record<NodeId, NodeView> {
  const out: Record<NodeId, NodeView> = {};
  for (const n of Object.values(map.nodes)) {
    const state = n.status === "planned" ? "planned" : n.status === "building" ? "building" : "lit";
    out[n.id] = {
      id: n.id,
      state,
      brightness: state === "lit" ? 1 : 0,
      durable: false,
      suggested: false,
      missing: [],
      fadingPrereqs: [],
    };
  }
  return out;
}

/** Truncate to `max` characters with an ellipsis. */
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

export function MapPoster(props: MapPosterProps & MapPosterExtraProps) {
  if (props.layout === "finished") return <FinishedPoster {...props} />;
  return <DefaultPoster {...props} />;
}

function DefaultPoster({
  pack,
  views,
  width,
  height,
  caption,
  showTitle = true,
  brand = false,
  layout: posterLayout = "default",
}: MapPosterProps & MapPosterExtraProps) {
  const finished = posterLayout === "finished";
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { layout } = pack.map;
  const theme = pack.manifest.theme;
  const colors = worldColors(theme);
  const renderer = resolveRenderer(theme.renderer, pack.map);
  const Renderer = RENDERERS[renderer];
  const band = showTitle ? Math.max(56, Math.min(110, height * 0.16)) : 0;
  const foot = brand ? Math.max(28, height * 0.06) : 0;
  const pad = Math.max(12, Math.min(width, height) * 0.05);
  const availW = width - pad * 2;
  const availH = height - band - foot - pad * 2;
  const scale = Math.max(0.05, Math.min(availW / layout.width, availH / layout.height, 1.4));
  const ox = (width - layout.width * scale) / 2;
  const oy = band + pad + (availH - layout.height * scale) / 2;
  const labels = placeLabels(pack.map, renderer);
  const showAllLabels = finished || scale >= 0.62;
  const title = pack.manifest.title;
  const cardCount = Object.values(pack.map.nodes).filter(
    (n) => n.status === "playable" && n.kind !== "checkpoint",
  ).length;
  const summary = caption ?? (finished ? `Finished · all ${cardCount} cards lit` : litSummary(pack, views));
  const titleSize = Math.max(16, Math.min(40, band * 0.36));
  const label = `${title} poster. ${theme.world}. ${litSummary(pack, views)}.`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      data-poster={pack.manifest.id}
      data-layout={posterLayout}
      data-theme={theme.mode}
      style={worldStyle(theme)}
      fontFamily="'Recursive Variable', Recursive, ui-sans-serif, system-ui, sans-serif"
    >
      <title>{label}</title>
      <defs>
        <clipPath id={`${uid}-clip`}>
          <rect width={width} height={height} rx={Math.min(28, width * 0.03)} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        <rect width={width} height={height} fill={theme.ground} />
        <g transform={`translate(${ox} ${oy}) scale(${scale})`}>
          <Renderer pack={pack} views={views} theme={theme} fog={false} zoom={1} reducedMotion />
          <g data-layer="poster-labels">
            {[...labels.values()].map((l) => {
              const node = pack.map.nodes[l.id];
              const view = viewFor(pack.map, views, l.id);
              const keep = showAllLabels || node?.kind === "checkpoint" || (scale >= 0.4 && isLitLike(view.state));
              if (!node || !keep) return null;
              const anchor = l.side === "right" ? "start" : l.side === "left" ? "end" : "middle";
              const x = anchor === "start" ? l.box.x : anchor === "end" ? l.box.x + l.box.w : l.box.x + l.box.w / 2;
              return (
                <text
                  key={l.id}
                  x={x}
                  y={l.box.y + LABEL.lineHeight - 4}
                  textAnchor={anchor}
                  fontSize={LABEL.font}
                  fontWeight={node.kind === "checkpoint" ? 700 : view.state === "lit" ? 600 : 500}
                  fill={view.state === "locked" || view.state === "planned" ? colors.ink2 : colors.ink}
                  stroke={colors.ground}
                  strokeWidth={4}
                  strokeLinejoin="round"
                  style={{ paintOrder: "stroke" }}
                >
                  {l.lines.map((line, i) => (
                    <tspan
                      key={line}
                      x={x}
                      dy={i === 0 ? 0 : LABEL.lineHeight}
                      {...(l.gate && i > 0 ? { fontSize: GATE_SUB_FONT, fontWeight: 500, fill: colors.ink2 } : {})}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              );
            })}
          </g>
        </g>
        {showTitle ? (
          <g data-layer="poster-title">
            <text x={pad} y={pad + titleSize} fontSize={titleSize} fontWeight={760} fill={colors.ink}>
              {title}
            </text>
            <text
              x={pad}
              y={pad + titleSize + Math.max(14, titleSize * 0.5) + 4}
              fontSize={Math.max(11, titleSize * 0.42)}
              fill={colors.ink2}
            >
              {`${theme.world} · ${summary}`}
            </text>
            {finished || everythingLit(pack.map, views) ? (
              <circle cx={width - pad - 8} cy={pad + 8} r={6} fill="var(--lumen)" />
            ) : null}
          </g>
        ) : null}
        {brand ? (
          <g transform={`translate(${width - pad} ${height - pad * 0.6 - 4})`}>
            <Wordmark size={foot * 0.55} ink={colors.ink} />
          </g>
        ) : null}
      </g>
    </svg>
  );
}

const textWidthApprox = (s: string, size: number) => s.length * size * 0.56;

/** The Learncroc wordmark with its Lumen dot (the logo's lit stop), right-aligned at the origin. */
function Wordmark({ size, ink }: { size: number; ink: string }) {
  return (
    <g data-layer="poster-brand">
      <circle
        cx={-textWidthApprox("Learncroc", size) - size * 0.55}
        cy={-size * 0.34}
        r={size * 0.3}
        fill="var(--lumen)"
      />
      <text textAnchor="end" fontSize={size} fontWeight={700} fill={ink}>
        Learncroc
      </text>
    </g>
  );
}

/** Wrap text into lines of at most `width` px at `font`. */
function wrap(text: string, width: number, font: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, font) <= width || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = clip(
    `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`,
    Math.floor(width / (font * 0.56)),
  );
  return kept;
}

/**
 * The finished-map share poster: map on the left (landscape) or on top (portrait), the panel beside it.
 * Built for 1200×630 and 1080×1350, scales to any size.
 */
function FinishedPoster({ pack, width, height, showTitle = true }: MapPosterProps & MapPosterExtraProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const map = pack.map;
  const theme = pack.manifest.theme;
  const colors = worldColors(theme);
  const renderer = resolveRenderer(theme.renderer, map);
  const Renderer = RENDERERS[renderer];
  const views = allLitViews(map);
  const portrait = height > width;
  // Unit: 1 at 1200×630 (landscape) or 1080×1350 (portrait).
  const u = portrait ? width / 1080 : height / 630;
  // Portrait: the map takes the height its width-fit needs (40–60% of the poster); the panel the rest.
  const fitH = width * (map.layout.height / Math.max(1, map.layout.width)) + 72 * u;
  const mapBox = portrait
    ? { x: 0, y: 0, w: width, h: Math.min(height * 0.6, Math.max(height * 0.4, fitH)) }
    : { x: 0, y: 0, w: width * 0.62, h: height };
  const panel = portrait
    ? { x: 0, y: mapBox.h, w: width, h: height - mapBox.h }
    : { x: mapBox.w, y: 0, w: width - mapBox.w, h: height };
  const pad = 36 * u;
  const scale = Math.max(
    0.05,
    Math.min((mapBox.w - pad * 2) / map.layout.width, (mapBox.h - pad * 2) / map.layout.height, 1.4),
  );
  const ox = mapBox.x + (mapBox.w - map.layout.width * scale) / 2;
  const oy = mapBox.y + (mapBox.h - map.layout.height * scale) / 2;
  const labels = placeLabels(map, renderer);
  const cards = Object.values(map.nodes).filter((n) => n.status === "playable" && n.kind !== "checkpoint").length;
  const sections = sectionsOf(map).length;
  const outcomes = map.lines
    .map((l) => l.outcome.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((o) => clip(o, 60));
  const panelFill = mix(colors.ground, colors.ink, colors.mode === "dark" ? 0.06 : 0.04);
  const badge = (portrait ? 220 : 160) * u;
  const tx = panel.x + pad;
  const textW = panel.w - pad * 2 - (portrait ? badge + 24 * u : 0);
  const worldSize = (portrait ? 52 : 40) * u;
  const f = portrait ? 1.3 : 1;
  const worldLines = wrap(theme.world, textW, worldSize, 2);
  const crocSize = (portrait ? 160 : 96) * u;
  const label = `${pack.manifest.title}: finished. ${theme.world}. ${cards} cards lit.`;
  // Text column (landscape: under the badge; portrait: beside it).
  let y = portrait ? panel.y + pad + 34 * u : panel.y + pad + badge + 40 * u;
  const tcol = portrait ? tx + badge + 24 * u : tx;

  const lines: { text: string; size: number; weight: number; fill: string; gap: number; italic?: boolean }[] = [];
  for (const w of worldLines)
    lines.push({ text: w, size: worldSize, weight: 760, fill: colors.ink, gap: worldSize * 1.08 });
  lines.push({
    text: `${cards} cards${sections ? ` · ${sections} section${sections === 1 ? "" : "s"}` : ""}`,
    size: 20 * u * f,
    weight: 500,
    fill: colors.ink2,
    gap: 34 * u * f,
  });
  if (outcomes.length) {
    lines.push({ text: "I can now explain:", size: 20 * u * f, weight: 700, fill: colors.ink, gap: 40 * u * f });
    for (const o of outcomes)
      for (const [i, l] of wrap(o, textW - 18 * u, 18 * u * f, 2).entries())
        lines.push({
          text: i === 0 ? `· ${l}` : `  ${l}`,
          size: 18 * u * f,
          weight: 450,
          fill: colors.ink,
          gap: 26 * u * f,
        });
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      data-poster={pack.manifest.id}
      data-layout="finished"
      data-orientation={portrait ? "portrait" : "landscape"}
      data-theme={theme.mode}
      style={worldStyle(theme)}
      fontFamily="'Recursive Variable', Recursive, ui-sans-serif, system-ui, sans-serif"
    >
      <title>{label}</title>
      <defs>
        <clipPath id={`${uid}-clip`}>
          <rect width={width} height={height} rx={Math.min(28, width * 0.02)} />
        </clipPath>
        <clipPath id={`${uid}-map`}>
          <rect x={mapBox.x} y={mapBox.y} width={mapBox.w} height={mapBox.h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        <rect width={width} height={height} fill={theme.ground} />
        <g clipPath={`url(#${uid}-map)`}>
          <g transform={`translate(${ox} ${oy}) scale(${scale})`}>
            <Renderer pack={pack} views={views} theme={theme} fog={false} zoom={1} reducedMotion />
            {scale >= 0.34 ? (
              <g data-layer="poster-labels">
                {[...labels.values()].map((l) => {
                  const node = map.nodes[l.id];
                  if (!node) return null;
                  const anchor = l.side === "right" ? "start" : l.side === "left" ? "end" : "middle";
                  const x = anchor === "start" ? l.box.x : anchor === "end" ? l.box.x + l.box.w : l.box.x + l.box.w / 2;
                  return (
                    <text
                      key={l.id}
                      x={x}
                      y={l.box.y + LABEL.lineHeight - 4}
                      textAnchor={anchor}
                      fontSize={LABEL.font}
                      fontWeight={node.kind === "checkpoint" ? 700 : 600}
                      fill={node.status === "planned" ? colors.ink2 : colors.ink}
                      stroke={colors.ground}
                      strokeWidth={4}
                      strokeLinejoin="round"
                      style={{ paintOrder: "stroke" }}
                    >
                      {l.lines.map((line, i) => (
                        <tspan
                          key={line}
                          x={x}
                          dy={i === 0 ? 0 : LABEL.lineHeight}
                          {...(l.gate && i > 0 ? { fontSize: GATE_SUB_FONT, fontWeight: 500, fill: colors.ink2 } : {})}
                        >
                          {line}
                        </tspan>
                      ))}
                    </text>
                  );
                })}
              </g>
            ) : null}
          </g>
        </g>
        <g data-layer="poster-panel">
          <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} fill={panelFill} />
          <path
            d={portrait ? `M0 ${panel.y}H${width}` : `M${panel.x} 0V${height}`}
            stroke={colors.ink2}
            strokeOpacity={0.25}
            strokeWidth={1.5}
          />
          <g transform={`translate(${tx} ${panel.y + pad})`}>
            <MapBadge pack={pack} cards={cards} size={badge} />
          </g>
          {showTitle ? (
            <text
              x={tcol}
              y={y - (portrait ? 0 : 8 * u)}
              fontSize={15 * u}
              fontWeight={600}
              fill={colors.ink2}
              letterSpacing={1}
            >
              {clip(pack.manifest.title.toUpperCase(), 40)}
            </text>
          ) : null}
          {lines.map((l, i) => {
            y += l.gap;
            return (
              <text
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list per render
                key={i}
                x={tcol}
                y={y}
                fontSize={l.size}
                fontWeight={l.weight}
                fill={l.fill}
                xmlSpace="preserve"
              >
                {l.text}
              </text>
            );
          })}
          <g
            transform={`translate(${panel.x + panel.w - pad - crocSize} ${panel.y + panel.h - pad - crocSize - 28 * u})`}
          >
            <Croc state="cheering" size={crocSize} lumen decorative />
          </g>
          <g transform={`translate(${panel.x + panel.w - pad} ${panel.y + panel.h - pad * 0.55})`}>
            <Wordmark size={22 * u} ink={colors.ink} />
          </g>
          {portrait ? null : (
            <text x={tx} y={panel.y + panel.h - pad * 0.55} fontSize={14 * u} fill={colors.ink2}>
              Finished
            </text>
          )}
        </g>
      </g>
    </svg>
  );
}

// ── export

/** Fallback token values (light / dark) for exports rendered where no stylesheet is loaded. */
const TOKEN_FALLBACK: Record<"light" | "dark", Record<string, string>> = {
  light: {
    "--lumen": "#ffc23d",
    "--lumen-soft": "#ffe9b0",
    "--lumen-text": "#8a5a00",
    "--ember": "#e5793f",
    "--sea": "#12877a",
    "--focus": "#12877a",
    "--ink": "#1c1a3d",
    "--sea-text": "#0d6b61",
    "--surface": "#ffffff",
    "--surface-2": "#f6f7fb",
    "--ember-soft": "#fbdcc8",
    "--croc": "#5c9a4b",
    "--croc-belly": "#dcedc5",
    "--croc-ink": "#11250d",
    "--croc-eye": "#ffffff",
    "--font-code": "ui-monospace, Menlo, monospace",
  },
  dark: {
    "--lumen": "#ffcb57",
    "--lumen-soft": "#4a3a12",
    "--lumen-text": "#ffd67a",
    "--ember": "#f08a50",
    "--sea": "#4fd1bf",
    "--focus": "#7fe3d5",
    "--ink": "#ecebfa",
    "--sea-text": "#7fe3d5",
    "--surface": "#1d1c3d",
    "--surface-2": "#232249",
    "--ember-soft": "#4a2a1c",
    "--croc": "#79bf62",
    "--croc-belly": "#b5dfa0",
    "--croc-ink": "#0f220c",
    "--croc-eye": "#f4f9ee",
    "--font-code": "ui-monospace, Menlo, monospace",
  },
};

function tokenResolver(mode: "light" | "dark", world: Record<string, string>): (name: string) => string | undefined {
  let probe: CSSStyleDeclaration | undefined;
  let host: HTMLElement | undefined;
  if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
    host = document.createElement("div");
    host.setAttribute("data-theme", mode);
    host.style.display = "none";
    document.body.appendChild(host);
    probe = getComputedStyle(host);
  }
  const cache = new Map<string, string | undefined>();
  const resolve = (name: string) => {
    if (cache.has(name)) return cache.get(name);
    const v = world[name] ?? (probe?.getPropertyValue(name).trim() || undefined) ?? TOKEN_FALLBACK[mode][name];
    cache.set(name, v);
    return v;
  };
  // Read everything we might need now, then drop the probe element.
  for (const k of Object.keys(TOKEN_FALLBACK[mode])) resolve(k);
  host?.remove();
  probe = undefined;
  return resolve;
}

/** Replace every var(--x[, fallback]) with its resolved value so the SVG renders standalone (in <img>). */
export function inlineCssVars(svg: string, resolve: (name: string) => string | undefined): string {
  let out = svg;
  for (let i = 0; i < 4 && out.includes("var(--"); i++) {
    out = out.replace(/var\((--[a-zA-Z0-9-]+)(?:\s*,\s*([^()]*))?\)/g, (_m, name: string, fallback?: string) => {
      // Values land inside double-quoted attributes: font stacks carry quotes, so swap them for single ones.
      return (resolve(name) ?? fallback?.trim() ?? "currentColor").replace(/"/g, "'").replace(/[<>]/g, "");
    });
  }
  return out;
}

/** The share-card SVG as a standalone string (CSS variables inlined, wordmark on). */
export async function renderMapPosterSvg(poster: MapPosterProps, options: MapPosterPngOptions): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const markup = renderToStaticMarkup(
    <MapPoster
      {...poster}
      width={options.width}
      height={options.height}
      {...(options.caption !== undefined || poster.caption !== undefined
        ? { caption: (options.caption ?? poster.caption) as string }
        : {})}
      showTitle={poster.showTitle ?? true}
      brand
    />,
  );
  const theme = poster.pack.manifest.theme;
  const resolve = tokenResolver(theme.mode, worldStyle(theme));
  return inlineCssVars(markup, resolve);
}

/** Render a poster to PNG for the share card (client-side, no server). */
export async function exportMapPosterPng(poster: MapPosterProps, options: MapPosterPngOptions): Promise<Blob> {
  const svg = await renderMapPosterSvg(poster, options);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(options.width * options.scale);
    canvas.height = Math.round(options.height * options.scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available in this browser.");
    ctx.scale(options.scale, options.scale);
    ctx.drawImage(img, 0, 0, options.width, options.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the PNG."))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not draw the poster."));
    img.src = src;
  });
}

/** File name for a share card: "how-llms-work-map.png". */
export const posterFileName = (packId: NodeId) => `${packId}-map.png`;
