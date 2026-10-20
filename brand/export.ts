/**
 * Brand asset export: renders brand/croc.js in headless Chromium and writes every logo, icon and banner file.
 *
 *   bun brand/export.ts
 *
 * Writes brand/assets/* (logos, icons, avatars, README banners) and the web app's icons in apps/web/public/.
 * Re-run it after changing the drawing in croc.js; the outputs are committed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = join(import.meta.dir, "..");
const ASSETS = join(ROOT, "brand/assets");
const PUBLIC = join(ROOT, "apps/web/public");
const FONT = join(ROOT, "node_modules/@fontsource-variable/recursive/files/recursive-latin-full-normal.woff2");

mkdirSync(ASSETS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>`);
await page.addScriptTag({ path: join(import.meta.dir, "croc.js") });

type Spec = { kind: "lockup" | "square" | "croc"; opts: Record<string, unknown> };
const svgOf = (spec: Spec) =>
  page.evaluate(({ kind, opts }) => {
    const LC = (window as unknown as { LC: Record<string, (o: unknown) => string> }).LC;
    if (kind === "lockup") return LC.lockupSVG({ standalone: true, ...opts });
    if (kind === "square") return LC.squareSVG({ standalone: true, ...opts });
    return LC.crocSVG({ standalone: true, ...opts });
  }, spec);

const write = (path: string, data: string | Buffer) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`  ${path.replace(`${ROOT}/`, "")}`);
};

/** Rasterise an SVG (or a full HTML document) at an exact pixel size. */
async function png(markup: string, w: number, h: number, html = false): Promise<Buffer> {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const body = html
    ? markup
    : `<!doctype html><html><body style="margin:0;background:transparent">${markup.replace(
        /<svg /,
        `<svg style="display:block;width:${w}px;height:${h}px" `,
      )}</body></html>`;
  await p.setContent(body, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const buf = await p.screenshot({ omitBackground: !html, clip: { x: 0, y: 0, width: w, height: h } });
  await p.close();
  return buf;
}

/** An SVG with its root width/height replaced (the viewBox keeps the drawing). */
const sized = (svg: string, w: number, h: number) =>
  svg.replace(/<svg([^>]*?) width="[\d.]+" height="[\d.]+"/, `<svg$1 width="${w}" height="${h}"`);

console.log("Logos");
const lockups = {
  "logo.svg": { kind: "row", tone: "light", pad: 0.25 },
  "logo-dark.svg": { kind: "row", tone: "dark", pad: 0.25 },
  "logo-stack.svg": { kind: "stack", tone: "light", pad: 0.25 },
  "logo-stack-dark.svg": { kind: "stack", tone: "dark", pad: 0.25 },
  "logo-peek.svg": { kind: "peek", tone: "light", pad: 0.25 },
  "wordmark.svg": { kind: "wordmark", tone: "light", pad: 0.1 },
  "wordmark-dark.svg": { kind: "wordmark", tone: "dark", pad: 0.1 },
  "mark.svg": { kind: "mark", pad: 0.05 },
};
for (const [file, opts] of Object.entries(lockups)) write(join(ASSETS, file), await svgOf({ kind: "lockup", opts }));
write(join(ASSETS, "logo.png"), await png(await svgOf({ kind: "lockup", opts: lockups["logo.svg"] }), 1200, 320));
write(
  join(ASSETS, "logo-dark.png"),
  await png(await svgOf({ kind: "lockup", opts: lockups["logo-dark.svg"] }), 1200, 320),
);

console.log("Croc");
for (const [file, opts] of Object.entries({
  "croc.svg": { pose: "full", expr: "hello", label: "The Learncroc croc" },
  "croc-head.svg": { pose: "head", expr: "hello", label: "The Learncroc croc" },
  "croc-happy.svg": { pose: "full", expr: "happy", label: "The Learncroc croc, happy" },
  "croc-thinking.svg": { pose: "full", expr: "thinking", label: "The Learncroc croc, thinking" },
  "croc-proud-gold.svg": { pose: "full", expr: "proud", color: "gold", label: "The gold croc: a stop just lit" },
})) {
  const svg = await svgOf({ kind: "croc", opts });
  write(join(ASSETS, file), svg);
}
write(join(ASSETS, "croc.png"), await png(await svgOf({ kind: "croc", opts: { pose: "full" } }), 960, 984));

console.log("Icons and avatars");
const icon = (opts: Record<string, unknown>) => svgOf({ kind: "square", opts });
write(join(ASSETS, "icon.svg"), await icon({ kind: "icon" }));
write(join(ASSETS, "icon-light.svg"), await icon({ kind: "icon-light" }));
write(join(ASSETS, "favicon.svg"), await icon({ kind: "favicon", radius: 0.22, size: 64 }));
write(join(ASSETS, "avatar.png"), await png(await icon({ kind: "avatar", radius: 0 }), 512, 512));
write(join(ASSETS, "avatar-dark.png"), await png(await icon({ kind: "avatar-dark", radius: 0 }), 512, 512));
write(join(ASSETS, "avatar-full.png"), await png(await icon({ kind: "avatar-full", radius: 0 }), 512, 512));
write(join(ASSETS, "icon-512.png"), await png(await icon({ kind: "icon" }), 512, 512));

console.log("Web app icons");
// Favicon: the eyes over the water, the one shape that reads at 16 px.
write(join(PUBLIC, "icon.svg"), sized(await icon({ kind: "favicon", radius: 0.22, size: 64 }), 64, 64));
// Install icons: the night tile with the flat head. Platforms round the corners themselves.
const tile = await icon({ kind: "icon", radius: 0 });
write(join(PUBLIC, "icon-192.png"), await png(tile, 192, 192));
write(join(PUBLIC, "icon-512.png"), await png(tile, 512, 512));
write(join(PUBLIC, "apple-touch-icon.png"), await png(tile, 180, 180));
// Maskable: the same tile with the head inside the 80 % safe circle.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="512" height="512"><title>Learncroc</title><rect width="1000" height="1000" fill="#1c1a3d"/>${tile
  .replace(/^<svg[^>]*>/, '<svg x="170" y="170" width="660" height="660" viewBox="0 0 1000 1000">')
  .replace(/<title>[^<]*<\/title>/, "")}</svg>`;
write(join(PUBLIC, "icon-maskable.svg"), maskable);
write(join(PUBLIC, "icon-maskable-512.png"), await png(maskable, 512, 512));

console.log("README banners");
const fontUrl = `data:font/woff2;base64,${Buffer.from(await Bun.file(FONT).arrayBuffer()).toString("base64")}`;
const bannerCroc = await svgOf({ kind: "croc", opts: { pose: "full", expr: "hello", label: "The croc" } });
const lockupLight = await svgOf({ kind: "lockup", opts: { kind: "row", tone: "light" } });
const lockupDark = await svgOf({ kind: "lockup", opts: { kind: "row", tone: "dark" } });

/** A short trail of stops: two lit (gold), one in progress (sea), two later (dashed). */
function trail(dark: boolean) {
  const line = dark ? "#33326a" : "#d7dae6";
  const later = dark ? "#4a4990" : "#b9bdd0";
  const surface = dark ? "#1d1c3d" : "#ffffff";
  const sea = dark ? "#4fd1bf" : "#12877a";
  const lumen = dark ? "#ffcb57" : "#ffc23d";
  const stops = [
    { x: 60, y: 592, s: "lit" },
    { x: 190, y: 562, s: "lit" },
    { x: 330, y: 590, s: "now" },
    { x: 470, y: 556, s: "later" },
    { x: 600, y: 584, s: "later" },
  ];
  const path = "M60 592C110 590 140 562 190 562S280 592 330 590S420 556 470 556S560 586 600 584";
  const dots = stops
    .map((p) => {
      if (p.s === "lit")
        return `<circle cx="${p.x}" cy="${p.y}" r="26" fill="${lumen}" opacity=".28"/><circle cx="${p.x}" cy="${p.y}" r="15" fill="${lumen}"/>`;
      if (p.s === "now")
        return `<circle cx="${p.x}" cy="${p.y}" r="17" fill="${surface}" stroke="${sea}" stroke-width="5"/><circle cx="${p.x}" cy="${p.y}" r="6" fill="${sea}"/>`;
      return `<circle cx="${p.x}" cy="${p.y}" r="13" fill="${surface}" stroke="${later}" stroke-width="3" stroke-dasharray="5 5"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 680 640" width="680" height="640" style="position:absolute;right:0;top:0" aria-hidden="true">
    <path d="${path}" fill="none" stroke="${line}" stroke-width="10" stroke-linecap="round"/>
    <path d="M60 592C110 590 140 562 190 562S280 592 330 590" fill="none" stroke="${lumen}" stroke-width="10" stroke-linecap="round" opacity=".55"/>
    ${dots}</svg>`;
}

function banner(dark: boolean) {
  const bg = dark ? "#14132e" : "#edeff5";
  const ink2 = dark ? "#b6b4da" : "#4a4870";
  const ink3 = dark ? "#8f8dba" : "#66648b";
  const stage = dark ? "#232249" : "#f3fae9";
  const lockup = (dark ? lockupDark : lockupLight).replace(
    /<svg /,
    '<svg style="display:block;height:112px;width:auto" ',
  );
  const croc = bannerCroc.replace(
    /<svg([^>]*?) width="[\d.]+" height="[\d.]+"/,
    '<svg$1 style="width:330px;height:auto;display:block"',
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: "Recursive"; src: url(${fontUrl}) format("woff2"); font-weight: 300 1000; }
    html, body { margin: 0; }
    .b { position: relative; width: 1280px; height: 640px; overflow: hidden; background: ${bg}; font-family: "Recursive", sans-serif; }
    .copy { position: absolute; left: 96px; top: 168px; }
    .tag { margin: 40px 0 0; font-size: 44px; line-height: 52px; font-weight: 720; letter-spacing: -0.02em;
           font-variation-settings: "CASL" 0.6; color: ${ink2}; max-width: 15ch; }
    .meta { margin: 26px 0 0; font-size: 22px; line-height: 30px; font-weight: 480; color: ${ink3}; }
    .stage { position: absolute; right: 120px; top: 70px; width: 420px; height: 420px; border-radius: 50%;
             background: ${stage}; display: grid; place-items: center; }
    .stage > svg { transform: translateY(8px); }
  </style></head><body><div class="b">
    <div class="stage">${croc}</div>
    ${trail(dark)}
    <div class="copy">${lockup}
      <p class="tag">Learn anything by playing its map.</p>
      <p class="meta">Open source · local-first · AI optional</p>
    </div>
  </div></body></html>`;
}
write(join(ASSETS, "readme-banner.png"), await png(banner(false), 1280, 640, true));
write(join(ASSETS, "readme-banner-dark.png"), await png(banner(true), 1280, 640, true));

await browser.close();
