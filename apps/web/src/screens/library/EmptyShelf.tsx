import { buttonClass } from "@learncroc/ui";
import { PlusCircle, Storefront } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

/** A map outline that draws itself once (not looping) behind the empty-shelf invitation. */
function GhostMap() {
  const lines = [
    { d: "M40 150 H170 L210 110 H330 L370 150 H520", delay: 0 },
    { d: "M90 220 H200 L240 180 H300 L330 150", delay: 350 },
    { d: "M330 150 L370 190 H460 L500 230 H600", delay: 650 },
  ];
  const stops = [
    [40, 150],
    [170, 150],
    [330, 150],
    [520, 150],
    [90, 220],
    [240, 180],
    [460, 190],
    [600, 230],
  ] as const;
  return (
    <svg viewBox="0 0 640 280" className="h-auto w-full max-w-2xl" aria-hidden>
      {lines.map((l) => (
        <path
          key={l.d}
          d={l.d}
          fill="none"
          stroke="var(--line-strong)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="lm-draw"
          style={{
            ["--lm-len" as string]: 700,
            ["--lm-draw-dur" as string]: "1400ms",
            ["--lm-draw-delay" as string]: `${l.delay}ms`,
          }}
        />
      ))}
      {stops.map(([x, y]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r={9}
          fill="var(--bg)"
          stroke="var(--ink-3)"
          strokeWidth={2.5}
          strokeDasharray="2 3.2"
        />
      ))}
    </svg>
  );
}

/** Library empty state (03 §4.2): nothing installed. */
export function EmptyShelf() {
  return (
    <section
      aria-labelledby="empty-shelf"
      className="grid place-items-center gap-8 rounded-stage border border-dashed border-line-strong bg-surface-2 px-8 py-14 text-center"
    >
      <GhostMap />
      <div className="grid max-w-lg gap-3">
        <h2 id="empty-shelf" className="t-title">
          Nothing on the shelf yet
        </h2>
        <p className="text-lead text-ink-2">Paste a link above, or find a subject in the Marketplace.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/market" className={buttonClass({ variant: "primary", size: "lg" })}>
          <Storefront size={18} aria-hidden />
          Browse the Marketplace
        </Link>
        <Link to="/create/pocket" className={buttonClass({ variant: "secondary", size: "lg" })}>
          <PlusCircle size={18} aria-hidden />
          Map an article
        </Link>
      </div>
    </section>
  );
}
