/**
 * The map page's Design menu: every map design, plus "Original" for authored worlds, each with a small
 * swatch of its ground and path. Picking one redraws this map (saved per map in settings).
 */
import {
  MAP_DESIGNS,
  type MapDesignChoice,
  type MapDesignLook,
  mapDesign,
  ownMapDesign,
  type PackId,
  type PackTheme,
} from "@learncroc/core";
import { Menu, MenuItem } from "@learncroc/ui";
import { Check, Palette } from "@phosphor-icons/react";
import { useMapDesignChoice, useSetMapDesign } from "../../app/mapDesign";

/** Ground, a curve of path in the first line colour, and a stop. */
function Swatch({ look }: { look: Pick<MapDesignLook, "ground" | "lines" | "mode"> }) {
  const edge = look.mode === "dark" ? "#ffffff33" : "#1c1a3d22";
  return (
    <svg width={34} height={22} viewBox="0 0 34 22" aria-hidden className="shrink-0">
      <rect x={0.5} y={0.5} width={33} height={21} rx={5} fill={look.ground} stroke={edge} />
      <path
        d="M4 16C11 16 12 7 19 7S26 13 30 11"
        fill="none"
        stroke={look.lines[0]}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <circle cx={19} cy={7} r={2.6} fill={look.ground} stroke={look.lines[1]} strokeWidth={1.6} />
    </svg>
  );
}

export interface DesignMenuProps {
  packId: PackId;
  /** The map's own theme, before any pick. */
  theme: PackTheme;
}

export function DesignMenu({ packId, theme }: DesignMenuProps) {
  const choice = useMapDesignChoice(packId);
  const setDesign = useSetMapDesign();
  const own = ownMapDesign(theme);
  // What the map wears now: the pick, else its own design (or its authored world).
  const current: MapDesignChoice = choice && choice !== "original" ? choice : (own ?? "original");
  const pick = (c: MapDesignChoice) => setDesign(packId, c === own ? "original" : c);
  const currentName = current === "original" ? "Original" : mapDesign(current).name;
  return (
    <Menu
      label={`Map design: ${currentName}`}
      triggerClassName="w-auto gap-1.5 px-3 text-small font-medium"
      trigger={
        <span className="flex items-center gap-1.5">
          <Palette size={16} aria-hidden />
          Design
        </span>
      }
    >
      {own ? null : (
        <DesignItem
          name="Original"
          blurb={theme.world}
          look={theme}
          current={current === "original"}
          onSelect={() => pick("original")}
        />
      )}
      {MAP_DESIGNS.map((d) => (
        <DesignItem
          key={d.id}
          name={own === d.id ? `${d.name} (original)` : d.name}
          blurb={d.blurb}
          look={d.look}
          current={current === d.id}
          onSelect={() => pick(d.id)}
        />
      ))}
    </Menu>
  );
}

function DesignItem({
  name,
  blurb,
  look,
  current,
  onSelect,
}: {
  name: string;
  blurb: string;
  look: Pick<MapDesignLook, "ground" | "lines" | "mode">;
  current: boolean;
  onSelect: () => void;
}) {
  return (
    <MenuItem icon={<Swatch look={look} />} onSelect={onSelect}>
      <span className="flex items-center gap-2">
        <span className="flex-1">
          <span className="block font-medium">{name}</span>
          <span className="block text-micro text-ink-3">{blurb}</span>
        </span>
        {current ? (
          <>
            <Check size={16} weight="bold" aria-hidden className="text-sea-text" />
            <span className="sr-only">(current)</span>
          </>
        ) : null}
      </span>
    </MenuItem>
  );
}
