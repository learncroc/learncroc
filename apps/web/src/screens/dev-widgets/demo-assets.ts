/**
 * Small SVGs the gallery serves for widget examples that reference pack assets (hotspot circuit,
 * ab-compare charts). They follow the illustration contract: theme variables only, 2 px round
 * strokes, real text labels, <title> and <desc>. Anything else resolves against the fixture pack.
 */
import { assetUrl } from "../../api/client";

const CIRCUIT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">
<title>A simple circuit</title><desc>A battery on the left, a bulb at the top, a switch at the bottom right, joined by wires.</desc>
<g fill="none" stroke="var(--w-ink-2, #4a4870)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M60 65 V30 H174 M226 30 H290 V150 H290 M234 150 H90 V135"/>
<path d="M60 135 V170 H90"/>
<rect x="34" y="65" width="52" height="70" rx="6"/><path d="M50 82 h20 M60 72 v20 M50 118 h20"/>
<circle cx="200" cy="44" r="22"/><path d="M188 52 q12 -26 24 0"/>
<circle cx="236" cy="150" r="4" fill="var(--w-ink-2, #4a4870)"/><circle cx="288" cy="150" r="4" fill="var(--w-ink-2, #4a4870)"/><path d="M236 150 L282 132"/>
</g></svg>`;

function chart(fromZero: boolean): string {
  const [b0, b1] = fromZero ? ([118, 122] as const) : ([40, 140] as const);
  const label = fromZero ? "0" : "90";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">
<title>${fromZero ? "Axis from zero" : "Cropped axis"}</title><desc>Two bars for 2023 and 2024; the y axis starts at ${label}.</desc>
<g font-family="sans-serif" font-size="14" fill="var(--w-ink-2, #4a4870)">
<line x1="50" y1="20" x2="50" y2="170" stroke="var(--w-ink-2, #4a4870)" stroke-width="2"/><line x1="50" y1="170" x2="300" y2="170" stroke="var(--w-ink-2, #4a4870)" stroke-width="2"/>
<text x="40" y="174" text-anchor="end">${label}</text><text x="40" y="28" text-anchor="end">100</text>
<rect x="90" y="${170 - b0}" width="60" height="${b0}" rx="3" fill="var(--w-1, #7fb2ff)"/>
<rect x="190" y="${170 - b1}" width="60" height="${b1}" rx="3" fill="var(--w-2, #c792f2)"/>
<text x="120" y="190" text-anchor="middle">2023</text><text x="220" y="190" text-anchor="middle">2024</text>
</g></svg>`;
}

const DEMO: Record<string, string> = {
  "assets/img/circuit.svg": CIRCUIT,
  "assets/img/axis-cropped.svg": chart(false),
  "assets/img/axis-zero.svg": chart(true),
};

const dataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Resolve an example's asset path: a bundled demo SVG, else the fixture pack's asset route. */
export function galleryAssetUrl(path: string): string {
  const svg = DEMO[path];
  return svg ? dataUrl(svg) : assetUrl("mini-pack", path);
}
