/**
 * Ground textures. Decorative, aria-hidden, seeded per pack so they never shift between
 * renders. Repeating detail uses <pattern>s to keep the DOM small; one-off features (contours,
 * continents, veins) are generated once per pack and memoised.
 */
import type { TextureId } from "@learncroc/core";
import { memo, type ReactNode, useMemo } from "react";
import { BackdropLayer, resolveBackdrop } from "../backdrops/index";
import { mix, withAlpha } from "../lib/color";
import { type Pt, smoothPath } from "../lib/geometry";
import { glyphSize, placeLabels } from "../lib/labels";
import { between, rng } from "../lib/random";
import { type DrawModel, groundBounds } from "./kit";

interface TextureProps {
  texture: TextureId;
  uid: string;
  seed: string;
  ground: string;
  ink: string;
  grid: string;
  lines: readonly string[];
  bounds: { x: number; y: number; w: number; h: number };
  mode: "light" | "dark";
}

/** Ground fill, the world's backdrop illustration (masked clear of the track), then the texture. */
export function Ground({ m }: { m: DrawModel }) {
  const b = groundBounds(m);
  const theme = m.props.theme;
  const backdrop = resolveBackdrop(theme, m.renderer);
  const map = m.props.pack.map;
  const { scene, colors, uid, seed, renderer } = m;
  const layer = useMemo(() => {
    if (!backdrop) return null;
    const bounds = { x: -480, y: -480, w: scene.width + 960, h: scene.height + 960 };
    const labels = placeLabels(map, renderer);
    const circles = scene.nodes.map((n) => {
      const s = glyphSize(renderer, n.gate ? (n.final ? "final" : "gate") : "card", scene.direction);
      return { x: n.x, y: n.y, r: Math.max(s.w, s.h) / 2 + 28 };
    });
    return (
      <BackdropLayer
        id={backdrop}
        uid={`${uid}-bd`}
        seed={seed}
        width={scene.width}
        height={scene.height}
        bounds={bounds}
        colors={{
          ground: colors.ground,
          ink2: colors.ink2,
          grid: colors.grid,
          lines: colors.lines,
          mode: colors.mode,
        }}
        clear={{ paths: scene.edges.map((e) => e.d), circles, boxes: [...labels.values()].map((l) => l.box) }}
      />
    );
  }, [backdrop, scene, colors, uid, seed, map, renderer]);
  return (
    <g aria-hidden data-layer="ground" data-texture={theme.texture} data-backdrop={backdrop ?? "none"}>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={m.colors.ground} />
      {layer}
      <g opacity={backdrop ? 0.7 : 1}>
        <TextureArt
          texture={theme.texture}
          uid={m.uid}
          seed={m.seed}
          ground={m.colors.ground}
          ink={m.colors.ink}
          grid={m.colors.grid}
          lines={m.colors.lines}
          bounds={b}
          mode={m.colors.mode}
        />
      </g>
    </g>
  );
}

const TextureArt = memo(function TextureArt(p: TextureProps) {
  switch (p.texture) {
    case "none":
      return null;
    case "grid-fine":
      return <GridFine {...p} />;
    case "spacetime":
      return <Spacetime {...p} />;
    case "world":
      return <World {...p} />;
    case "ice":
      return <Ice {...p} />;
    case "pcb":
      return <Pcb {...p} />;
    case "blueprint":
      return <Blueprint {...p} />;
    case "topo":
      return <Topo {...p} />;
    case "marble":
      return <Marble {...p} />;
    case "snow":
      return <Snow {...p} />;
    case "night-fair":
      return <NightFair {...p} />;
    case "paper":
      return <Paper {...p} />;
    case "corkboard":
      return <Corkboard {...p} />;
    case "watercolour":
      return <Watercolour {...p} />;
    case "meadow":
      return <Meadow {...p} />;
  }
});

function Fill({
  p,
  id,
  children,
  opacity = 1,
}: {
  p: TextureProps;
  id: string;
  children: ReactNode;
  opacity?: number;
}) {
  const { bounds: b } = p;
  return (
    <>
      <defs>{children}</defs>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={`url(#${id})`} opacity={opacity} />
    </>
  );
}

function gridPattern(id: string, minor: number, major: number, color: string, minorAlpha: number, majorAlpha: number) {
  const n = major / minor;
  const minorLines: ReactNode[] = [];
  for (let i = 1; i < n; i++) {
    minorLines.push(
      <path
        key={i}
        d={`M${i * minor} 0V${major}M0 ${i * minor}H${major}`}
        stroke={color}
        strokeOpacity={minorAlpha}
        strokeWidth={1}
      />,
    );
  }
  return (
    <pattern id={id} width={major} height={major} patternUnits="userSpaceOnUse" x={0} y={0}>
      {minorLines}
      <path d={`M0 0V${major}M0 0H${major}`} stroke={color} strokeOpacity={majorAlpha} strokeWidth={1} />
    </pattern>
  );
}

// ── metro

function GridFine(p: TextureProps) {
  const id = `${p.uid}-tx`;
  return (
    <Fill p={p} id={id}>
      {gridPattern(id, 14, 56, p.ink, 0.05, 0.11)}
    </Fill>
  );
}

/** Minkowski paper: a fine grid, 45° light cones and labelled axes (time up, space across). */
function Spacetime(p: TextureProps) {
  const id = `${p.uid}-tx`;
  const cone = `${p.uid}-cone`;
  const { bounds: b } = p;
  return (
    <>
      <Fill p={p} id={id}>
        {gridPattern(id, 28, 112, p.ink, 0.045, 0.1)}
      </Fill>
      <defs>
        <pattern id={cone} width={224} height={224} patternUnits="userSpaceOnUse">
          <path
            d="M0 224L224 0M0 0L224 224"
            stroke={p.lines[0]}
            strokeOpacity={0.09}
            strokeWidth={1.2}
            strokeDasharray="2 6"
          />
        </pattern>
      </defs>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={`url(#${cone})`} />
      <g stroke={p.ink} strokeOpacity={0.26} strokeWidth={1.2} fill="none">
        <path d={`M24 ${b.y + b.h - 40}V${b.y + 40}`} />
        <path d={`M${b.x + 40} ${b.y + b.h - 24}H${b.x + b.w - 40}`} />
      </g>
      <g fill={p.ink} fillOpacity={0.4} fontSize={11} fontStyle="italic">
        <text x={30} y={b.y + 56}>
          time
        </text>
        <text x={b.x + b.w - 90} y={b.y + b.h - 32}>
          space
        </text>
      </g>
    </>
  );
}

/** A stylised world: seeded continents, graticule and undersea cable arcs. */
function World(p: TextureProps) {
  const { bounds: b } = p;
  const r = rng(`${p.seed}:world`);
  const land: string[] = [];
  const count = Math.max(4, Math.round((b.w * b.h) / 260_000));
  for (let i = 0; i < count; i++) {
    const cx = between(r, b.x, b.x + b.w);
    const cy = between(r, b.y, b.y + b.h);
    const rad = between(r, 70, 190);
    const pts: Pt[] = [];
    const k = 9;
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2;
      const rr = rad * between(r, 0.55, 1.15);
      pts.push([cx + Math.cos(a) * rr * 1.3, cy + Math.sin(a) * rr * 0.8]);
    }
    pts.push(pts[0] as Pt, pts[1] as Pt);
    land.push(smoothPath(pts, 0.8));
  }
  const graticule: string[] = [];
  for (let x = Math.ceil(b.x / 160) * 160; x < b.x + b.w; x += 160)
    graticule.push(`M${x} ${b.y}Q${x + 40} ${b.y + b.h / 2} ${x} ${b.y + b.h}`);
  for (let y = Math.ceil(b.y / 140) * 140; y < b.y + b.h; y += 140) graticule.push(`M${b.x} ${y}H${b.x + b.w}`);
  return (
    <g>
      <g
        fill={mix(p.ground, p.ink, p.mode === "dark" ? 0.07 : 0.06)}
        stroke={p.ink}
        strokeOpacity={0.1}
        strokeWidth={1}
      >
        {land.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <path d={graticule.join("")} fill="none" stroke={p.ink} strokeOpacity={0.06} strokeWidth={1} />
    </g>
  );
}

/** The ice core: a translucent cylinder of strata with trapped bubbles, read bottom to top. */
function Ice(p: TextureProps) {
  const { bounds: b } = p;
  const r = rng(`${p.seed}:ice`);
  const strata: ReactNode[] = [];
  let y = b.y;
  let i = 0;
  while (y < b.y + b.h) {
    const hgt = between(r, 14, 46);
    strata.push(
      <rect
        key={i++}
        x={b.x}
        y={y}
        width={b.w}
        height={hgt}
        fill={p.lines[i % 5] ?? p.ink}
        opacity={between(r, 0.015, 0.06)}
      />,
    );
    y += hgt;
  }
  const bubbles: ReactNode[] = [];
  const nb = Math.round((b.w * b.h) / 9000);
  for (let j = 0; j < nb; j++) {
    bubbles.push(
      <circle
        key={j}
        cx={between(r, b.x, b.x + b.w)}
        cy={between(r, b.y, b.y + b.h)}
        r={between(r, 1, 3.4)}
        fill="none"
        stroke={p.ink}
        strokeOpacity={between(r, 0.08, 0.2)}
      />,
    );
  }
  // The cylinder wraps the layout (bounds = layout + 480 px margin on every side).
  const x0 = b.x + 480 + 12;
  const w0 = Math.max(120, b.w - 960 - 24);
  return (
    <g>
      {strata}
      {bubbles}
      <rect
        x={x0}
        y={b.y}
        width={w0}
        height={b.h}
        rx={60}
        fill={p.ink}
        fillOpacity={0.025}
        stroke={p.ink}
        strokeOpacity={0.14}
        strokeWidth={2}
      />
    </g>
  );
}

// ── circuit

/** A PCB from above: solder mask, via grid, copper pours and silkscreen marks. */
function Pcb(p: TextureProps) {
  const id = `${p.uid}-tx`;
  const { bounds: b } = p;
  const r = rng(`${p.seed}:pcb`);
  const marks: ReactNode[] = [];
  const n = Math.round((b.w * b.h) / 70_000);
  const refs = ["R", "C", "U", "L", "Q", "D", "J"];
  for (let i = 0; i < n; i++) {
    const x = Math.round(between(r, b.x, b.x + b.w) / 14) * 14;
    const y = Math.round(between(r, b.y, b.y + b.h) / 14) * 14;
    const kind = r();
    if (kind < 0.5) {
      marks.push(
        <text key={i} x={x} y={y} fontSize={9} fill={p.ink} fillOpacity={0.16} fontFamily="var(--font-code)">
          {`${refs[Math.floor(r() * refs.length)]}${Math.floor(between(r, 1, 99))}`}
        </text>,
      );
    } else if (kind < 0.8) {
      const w = between(r, 14, 28);
      marks.push(
        <g key={i} opacity={0.18}>
          <rect x={x} y={y} width={w} height={8} rx={1} fill="none" stroke={p.ink} />
          <rect x={x - 3} y={y + 1} width={3} height={6} fill={p.ink} />
          <rect x={x + w} y={y + 1} width={3} height={6} fill={p.ink} />
        </g>,
      );
    } else {
      marks.push(
        <circle key={i} cx={x} cy={y} r={5} fill="none" stroke={p.ink} strokeOpacity={0.16} strokeWidth={2} />,
      );
    }
  }
  const pours: ReactNode[] = [];
  for (let i = 0; i < Math.max(2, n / 6); i++) {
    pours.push(
      <rect
        key={i}
        x={between(r, b.x, b.x + b.w)}
        y={between(r, b.y, b.y + b.h)}
        width={between(r, 140, 380)}
        height={between(r, 90, 220)}
        rx={18}
        fill={p.lines[i % 5] ?? p.ink}
        opacity={0.035}
      />,
    );
  }
  return (
    <>
      {pours}
      <Fill p={p} id={id}>
        <pattern id={id} width={28} height={28} patternUnits="userSpaceOnUse">
          <circle cx={14} cy={14} r={1.1} fill={p.ink} fillOpacity={0.14} />
        </pattern>
      </Fill>
      {marks}
    </>
  );
}

/** A blueprint sheet: grid, dimension lines, a title block. */
function Blueprint(p: TextureProps) {
  const id = `${p.uid}-tx`;
  const { bounds: b } = p;
  const r = rng(`${p.seed}:blueprint`);
  const dims: ReactNode[] = [];
  for (let i = 0; i < Math.round((b.w * b.h) / 160_000); i++) {
    const x = between(r, b.x, b.x + b.w);
    const y = between(r, b.y, b.y + b.h);
    const w = between(r, 80, 220);
    dims.push(
      <g key={i} stroke={p.ink} strokeOpacity={0.16} fill="none">
        <path d={`M${x} ${y}H${x + w}M${x} ${y - 5}V${y + 5}M${x + w} ${y - 5}V${y + 5}`} />
        <text x={x + w / 2} y={y - 4} fontSize={9} textAnchor="middle" fill={p.ink} fillOpacity={0.3} stroke="none">
          {Math.round(w / 4)}
        </text>
      </g>,
    );
  }
  return (
    <>
      <Fill p={p} id={id}>
        {gridPattern(id, 16, 80, p.lines[0] ?? p.ink, 0.08, 0.16)}
      </Fill>
      {dims}
    </>
  );
}

// ── atlas

/** Topographic contours around seeded peaks, plus a compass rose. */
function Topo(p: TextureProps) {
  const { bounds: b } = p;
  const r = rng(`${p.seed}:topo`);
  const paths: ReactNode[] = [];
  const peaks = Math.max(3, Math.round((b.w * b.h) / 300_000));
  for (let i = 0; i < peaks; i++) {
    const cx = between(r, b.x, b.x + b.w);
    const cy = between(r, b.y, b.y + b.h);
    const base: number[] = [];
    const k = 10;
    for (let j = 0; j < k; j++) base.push(between(r, 0.7, 1.3));
    for (let ring = 1; ring <= 7; ring++) {
      const rad = ring * between(r, 20, 30);
      const pts: Pt[] = base.map((m, j) => {
        const a = (j / k) * Math.PI * 2;
        return [cx + Math.cos(a) * rad * m * 1.25, cy + Math.sin(a) * rad * m * 0.85];
      });
      pts.push(pts[0] as Pt, pts[1] as Pt);
      paths.push(
        <path
          key={`${i}-${ring}`}
          d={smoothPath(pts, 0.9)}
          fill="none"
          stroke={p.ink}
          strokeOpacity={ring % 5 === 0 ? 0.13 : 0.07}
          strokeWidth={ring % 5 === 0 ? 1.4 : 1}
        />,
      );
    }
  }
  return (
    <g>
      {paths}
      <Compass x={b.x + b.w - 560} y={b.y + 560} ink={p.ink} />
    </g>
  );
}

function Compass({ x, y, ink }: { x: number; y: number; ink: string }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity={0.3} fill="none" stroke={ink}>
      <circle r={26} />
      <circle r={20} strokeDasharray="2 3" />
      <path d="M0 -34L5 0L0 34L-5 0Z" fill={ink} fillOpacity={0.35} />
      <path d="M-34 0L0 4L34 0L0 -4Z" />
      <text y={-38} textAnchor="middle" fontSize={10} fill={ink} stroke="none">
        N
      </text>
    </g>
  );
}

/** Marble: soft veins and a meander band, for the Agora. */
function Marble(p: TextureProps) {
  const { bounds: b } = p;
  const r = rng(`${p.seed}:marble`);
  const veins: ReactNode[] = [];
  const n = Math.max(6, Math.round((b.w * b.h) / 110_000));
  for (let i = 0; i < n; i++) {
    const pts: Pt[] = [];
    let x = between(r, b.x, b.x + b.w);
    let y = between(r, b.y, b.y + b.h);
    const ang = between(r, -0.7, 0.7);
    for (let j = 0; j < 6; j++) {
      pts.push([x, y]);
      x += Math.cos(ang) * between(r, 60, 140);
      y += Math.sin(ang) * between(r, 60, 140) + between(r, -30, 30);
    }
    veins.push(
      <path
        key={i}
        d={smoothPath(pts)}
        fill="none"
        stroke={p.ink}
        strokeOpacity={between(r, 0.04, 0.1)}
        strokeWidth={between(r, 0.8, 2.2)}
      />,
    );
  }
  const id = `${p.uid}-meander`;
  return (
    <>
      {veins}
      <defs>
        <pattern id={id} width={32} height={24} patternUnits="userSpaceOnUse">
          <path d="M0 20H24V4H8V14H16V10" fill="none" stroke={p.ink} strokeOpacity={0.14} strokeWidth={1.5} />
        </pattern>
      </defs>
      <rect x={b.x} y={-36} width={b.w} height={24} fill={`url(#${id})`} />
    </>
  );
}

/** Snow: ridgelines, drifting flakes and a faint piste. */
function Snow(p: TextureProps) {
  const { bounds: b } = p;
  const r = rng(`${p.seed}:snow`);
  const ridges: ReactNode[] = [];
  for (let band = 0; band < 3; band++) {
    let x = b.x;
    const baseY = b.y + b.h * (0.3 + band * 0.25);
    let d = `M${x} ${baseY}`;
    while (x < b.x + b.w) {
      const w = between(r, 80, 200);
      const h = between(r, 40, 130);
      d += `L${x + w / 2} ${baseY - h}L${x + w} ${baseY}`;
      x += w;
    }
    ridges.push(
      <path key={band} d={d} fill="none" stroke={p.ink} strokeOpacity={0.07 + band * 0.02} strokeWidth={1.2} />,
    );
  }
  const id = `${p.uid}-tx`;
  return (
    <>
      {ridges}
      <Fill p={p} id={id}>
        <pattern id={id} width={90} height={90} patternUnits="userSpaceOnUse">
          {[
            [12, 18, 1.6],
            [56, 8, 1.1],
            [40, 52, 2],
            [78, 66, 1.3],
            [20, 74, 1],
          ].map(([x, y, s]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={s} fill={p.lines[0] ?? p.ink} fillOpacity={0.22} />
          ))}
        </pattern>
      </Fill>
    </>
  );
}

/** Night fair: strings of bulbs, a starry sky and tent stripes along the bottom. */
function NightFair(p: TextureProps) {
  const { bounds: b } = p;
  const r = rng(`${p.seed}:fair`);
  const strings: ReactNode[] = [];
  const n = Math.max(3, Math.round(b.h / 260));
  for (let i = 0; i < n; i++) {
    const y = b.y + (i + 0.5) * (b.h / n);
    let x = b.x;
    while (x < b.x + b.w) {
      const w = between(r, 220, 420);
      const sag = between(r, 18, 46);
      const d = `M${x} ${y}Q${x + w / 2} ${y + sag * 2} ${x + w} ${y}`;
      const bulbs: ReactNode[] = [];
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const bx = x + w * t;
        const by = y + 2 * sag * 2 * t * (1 - t);
        bulbs.push(<circle key={k} cx={bx} cy={by + 4} r={2.6} fill={p.lines[k % 5] ?? p.ink} fillOpacity={0.35} />);
      }
      strings.push(
        <g key={`${i}-${x}`}>
          <path d={d} fill="none" stroke={p.ink} strokeOpacity={0.12} />
          {bulbs}
        </g>,
      );
      x += w;
    }
  }
  const id = `${p.uid}-tx`;
  return (
    <>
      <Fill p={p} id={id}>
        <pattern id={id} width={120} height={120} patternUnits="userSpaceOnUse">
          {[
            [10, 14],
            [70, 40],
            [100, 96],
            [36, 84],
            [88, 8],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={0.9} fill={p.ink} fillOpacity={0.4} />
          ))}
        </pattern>
      </Fill>
      {strings}
    </>
  );
}

// ── sketchbook

function grain(id: string, ink: string, alpha: number) {
  return (
    <pattern id={id} width={7} height={7} patternUnits="userSpaceOnUse">
      <circle cx={1} cy={2} r={0.5} fill={ink} fillOpacity={alpha} />
      <circle cx={5} cy={5.5} r={0.4} fill={ink} fillOpacity={alpha * 0.8} />
    </pattern>
  );
}

/** Paper: grain, faint rules and a margin line. */
function Paper(p: TextureProps) {
  const id = `${p.uid}-tx`;
  const rules = `${p.uid}-rules`;
  const { bounds: b } = p;
  return (
    <>
      <Fill p={p} id={id}>
        {grain(id, p.ink, 0.12)}
      </Fill>
      <defs>
        <pattern id={rules} width={40} height={28} patternUnits="userSpaceOnUse">
          <path d="M0 27.5H40" stroke={p.lines[0] ?? p.ink} strokeOpacity={0.12} />
        </pattern>
      </defs>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={`url(#${rules})`} />
      <path d={`M24 ${b.y}V${b.y + b.h}`} stroke={p.lines[1] ?? p.ink} strokeOpacity={0.22} />
      <circle
        cx={b.x + b.w - 560}
        cy={b.y + b.h - 540}
        r={46}
        fill="none"
        stroke={p.ink}
        strokeOpacity={0.05}
        strokeWidth={7}
      />
    </>
  );
}

/** Corkboard: two-tone cork speckle in a wooden frame (the detective's office at night). */
function Corkboard(p: TextureProps) {
  const id = `${p.uid}-tx`;
  const lamp = `${p.uid}-lamp`;
  const light = mix(p.ground, p.ink, 0.24);
  const dark = mix(p.ground, "#000000", 0.45);
  const { bounds: b } = p;
  // The desk lamp: a warm pool of light over the middle of the board (never Lumen gold).
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return (
    <>
      <defs>
        <radialGradient id={lamp} cx={cx} cy={cy} r={Math.max(b.w, b.h) / 2.6} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={mix(p.ground, "#E9C9A0", 0.22)} />
          <stop offset="100%" stopColor={p.ground} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={`url(#${lamp})`} />
      <CorkSpeckle p={p} id={id} light={light} dark={dark} />
    </>
  );
}

function CorkSpeckle({ p, id, light, dark }: { p: TextureProps; id: string; light: string; dark: string }) {
  return (
    <Fill p={p} id={id}>
      <pattern id={id} width={24} height={24} patternUnits="userSpaceOnUse">
        <ellipse cx={4} cy={5} rx={2} ry={1.2} fill={light} fillOpacity={0.55} />
        <ellipse cx={15} cy={3} rx={1.4} ry={1} fill={dark} fillOpacity={0.7} />
        <ellipse cx={19} cy={14} rx={2.2} ry={1.3} fill={light} fillOpacity={0.4} />
        <ellipse cx={8} cy={18} rx={1.6} ry={1.1} fill={dark} fillOpacity={0.6} />
        <ellipse cx={12} cy={11} rx={1} ry={0.8} fill={light} fillOpacity={0.5} />
        <ellipse cx={22} cy={22} rx={1.3} ry={0.9} fill={dark} fillOpacity={0.5} />
      </pattern>
    </Fill>
  );
}

/** Watercolour: soft washes of the world's line colours on grained paper. */
function Watercolour(p: TextureProps) {
  const { bounds: b } = p;
  const r = rng(`${p.seed}:wash`);
  const blobs: ReactNode[] = [];
  const n = Math.max(5, Math.round((b.w * b.h) / 120_000));
  for (let i = 0; i < n; i++) {
    blobs.push(
      <ellipse
        key={i}
        cx={between(r, b.x, b.x + b.w)}
        cy={between(r, b.y, b.y + b.h)}
        rx={between(r, 90, 220)}
        ry={between(r, 60, 150)}
        fill={withAlpha(p.lines[i % 5] ?? p.ink, between(r, 0.08, 0.16))}
      />,
    );
  }
  const id = `${p.uid}-tx`;
  return (
    <>
      <g filter={`url(#${p.uid}-soft)`}>{blobs}</g>
      <Fill p={p} id={id}>
        {grain(id, p.ink, 0.1)}
      </Fill>
    </>
  );
}

// ── trail

/** Meadow: a garden planner's dot grid on grass. */
function Meadow(p: TextureProps) {
  const id = `${p.uid}-tx`;
  const dot = mix(p.ground, p.lines[3] ?? p.ink, 0.6);
  return (
    <Fill p={p} id={id}>
      <pattern id={id} width={22} height={22} patternUnits="userSpaceOnUse">
        <circle cx={11} cy={11} r={1.5} fill={dot} fillOpacity={0.6} />
      </pattern>
    </Fill>
  );
}
