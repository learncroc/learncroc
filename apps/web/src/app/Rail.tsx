/**
 * The 64 px left rail (01 §3.2): the Learncroc logo (Moss), Library, Current map, Relight (an ember
 * dot when anything is fading, never a number), Create, Logbook, Flashcards; then the command
 * palette, the AI status dot and Settings. Tooltips show the label and shortcut on hover (after
 * 400 ms) and on focus.
 */
import { Croc, cn, Kbd } from "@learncroc/ui";
import {
  Books,
  Cards,
  CircleHalf,
  GearSix,
  type Icon,
  MagnifyingGlass,
  MapTrifold,
  Notebook,
  PlusCircle,
} from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { modKey } from "../lib/keys";
import { useAiStatus, useProgressAll } from "./queries";
import { useShell } from "./store";

function Tip({ label, keys }: { label: string; keys?: string[] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-1/2 left-full z-30 ml-3 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-sm bg-ink px-2.5 py-1.5 text-small text-bg opacity-0 shadow-2",
        "transition-opacity duration-quick group-hover:opacity-100 group-hover:delay-[400ms] group-focus-visible:opacity-100 group-focus-visible:delay-0",
      )}
    >
      {label}
      {keys ? <span className="text-micro opacity-75">{keys.join(" ")}</span> : null}
    </span>
  );
}

const ITEM =
  "group relative grid size-11 place-items-center rounded-key text-ink-2 transition-colors duration-quick hover:bg-surface-2 hover:text-ink";
const ACTIVE =
  "bg-surface-2 text-ink before:absolute before:top-2.5 before:bottom-2.5 before:-left-[10px] before:w-[3px] before:rounded-pill before:bg-ink";

interface RailLinkProps {
  to: string;
  label: string;
  keys?: string[];
  icon: Icon;
  active: boolean;
  badge?: ReactNode;
  ariaLabel?: string;
}

function RailLink({ to, label, keys, icon: IconCmp, active, badge, ariaLabel }: RailLinkProps) {
  return (
    <li>
      <Link
        to={to}
        aria-label={ariaLabel ?? label}
        aria-current={active ? "page" : undefined}
        aria-keyshortcuts={keys ? keys.join(" ") : undefined}
        className={cn(ITEM, active && ACTIVE)}
      >
        <IconCmp size={22} weight={active ? "fill" : "regular"} aria-hidden />
        {badge}
        <Tip label={label} {...(keys ? { keys } : {})} />
      </Link>
    </li>
  );
}

export function Rail({ currentMap }: { currentMap: { href: string; title: string } | null }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const openLayer = useShell((s) => s.open);
  const { data: progress } = useProgressAll();
  const { data: ai } = useAiStatus();
  const anyFading = Object.values(progress?.packs ?? {}).some((p) => p.fading > 0);
  const aiState = !ai?.configured ? "off" : ai.capReached ? "problem" : "on";
  const aiLabel = {
    off: "AI is off. Add a key in Settings to turn on AI features.",
    on: `AI is on (${ai?.provider ?? "provider"}).`,
    problem: "AI paused: this month's spending cap is reached. Change it in Settings.",
  }[aiState];
  const is = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 flex h-dvh w-16 shrink-0 flex-col items-center border-r border-line bg-surface py-3 dark:bg-surface-sunk"
    >
      <Link
        to="/library"
        aria-label="Learncroc, go to the Library"
        className="group relative mb-3 grid size-11 place-items-center rounded-key"
      >
        <Croc size={38} decorative />
        <Tip label="Learncroc" />
      </Link>
      <ul className="flex flex-col items-center gap-1.5">
        <RailLink
          to="/library"
          label="Library"
          keys={["G", "L"]}
          icon={Books}
          active={is("/library") || is("/market")}
        />
        {currentMap ? (
          <RailLink
            to={currentMap.href}
            label={`Current map: ${currentMap.title}`}
            keys={["G", "M"]}
            icon={MapTrifold}
            active={pathname.startsWith(currentMap.href)}
          />
        ) : null}
        <RailLink
          to="/relight"
          label={anyFading ? "Relight: some cards are fading" : "Relight"}
          keys={["G", "R"]}
          icon={CircleHalf}
          active={is("/relight")}
          badge={
            anyFading ? (
              <span
                aria-hidden
                data-testid="relight-dot"
                className="absolute top-2 right-2 size-2.5 rounded-pill border-2 border-surface bg-ember"
              />
            ) : null
          }
        />
        <RailLink to="/create" label="Create" keys={["G", "C"]} icon={PlusCircle} active={is("/create")} />
        <RailLink to="/logbook" label="Logbook" keys={["G", "J"]} icon={Notebook} active={is("/logbook")} />
        <RailLink
          to="/flashcards"
          label="Flashcards"
          keys={["G", "F"]}
          icon={Cards}
          active={is("/flashcards") || is("/cards")}
        />
      </ul>
      <div className="mt-auto flex flex-col items-center gap-1.5">
        <button
          type="button"
          aria-label="Command palette"
          aria-keyshortcuts={`${modKey() === "⌘" ? "Meta" : "Control"}+K`}
          className={ITEM}
          onClick={() => openLayer("palette")}
        >
          <MagnifyingGlass size={22} aria-hidden />
          <Tip label="Search and commands" keys={[modKey(), "K"]} />
        </button>
        <Link to="/settings/$section" params={{ section: "ai" }} aria-label={aiLabel} className={ITEM}>
          <span
            aria-hidden
            data-ai={aiState}
            className={cn(
              "size-3 rounded-pill border-2",
              aiState === "off" && "border-ink-3 bg-transparent",
              aiState === "on" && "border-iris bg-iris",
              aiState === "problem" && "border-ember-text bg-ember",
            )}
          />
          <Tip label={aiState === "off" ? "AI off: add a key in Settings" : aiState === "on" ? "AI on" : "AI paused"} />
        </Link>
        <ul>
          <RailLink to="/settings/ai" label="Settings" keys={["G", "S"]} icon={GearSix} active={is("/settings")} />
        </ul>
      </div>
    </nav>
  );
}

/** Small "⌘K" search trigger for screen headers. */
export function SearchTrigger({ label = "Search maps and cards" }: { label?: string }) {
  const openLayer = useShell((s) => s.open);
  return (
    <button
      type="button"
      onClick={() => openLayer("palette")}
      className="inline-flex h-10 w-72 items-center gap-2.5 rounded-sm border border-line-strong bg-surface px-3 text-small text-ink-2 transition-colors duration-quick hover:border-ink-3 hover:text-ink"
    >
      <MagnifyingGlass size={16} aria-hidden />
      <span className="flex-1 text-left">{label}</span>
      <Kbd keys={[modKey(), "K"]} />
    </button>
  );
}
