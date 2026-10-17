/**
 * /create: the Create hub. Map an article (the paste bar, with the full intake one click away),
 * your own article maps, and the example article maps that play offline with no key.
 */
import type { InstalledPackSummary } from "@learncroc/core";
import { buttonClass, Kbd, Panel } from "@learncroc/ui";
import { ArrowRight } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { useScreenKeys } from "../../app/keys";
import { usePackPosters, usePacks } from "../../app/queries";
import { useScreenShortcuts } from "../../app/store";
import { isStarted } from "../library/index";
import { Poster } from "../library/ShelfPoster";
import { PasteBar, type PasteBarHandle } from "./PasteBar";

function Shelf({
  title,
  lead,
  items,
  empty,
}: {
  title: string;
  lead?: string;
  items: InstalledPackSummary[];
  empty?: string;
}) {
  const posters = usePackPosters(items.map((p) => p.id));
  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <div>
        <h2 className="m-0 t-heading text-ink">{title}</h2>
        {lead ? <p className="m-0 mt-1 text-small text-ink-2">{lead}</p> : null}
      </div>
      {items.length === 0 ? (
        empty ? (
          <p className="m-0 text-small text-ink-2">{empty}</p>
        ) : null
      ) : (
        <div className="grid grid-cols-12 gap-5">
          {items.map((s, i) => {
            const d = posters[i];
            return (
              <Poster
                key={s.id}
                summary={s}
                size="pocket"
                {...(d?.pack ? { pack: d.pack } : {})}
                {...(d?.progress ? { progress: d.progress } : {})}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Hub() {
  const packs = usePacks();
  const navigate = useNavigate();
  const paste = useRef<PasteBarHandle>(null);
  const pocket = (packs.data ?? []).filter((p) => p.kind === "pocket" && p.status !== "invalid");
  // Opened ones first (tiers can't tell a built map from a bundled one under --dev).
  const mine = pocket.filter(isStarted);
  const examples = pocket.filter((p) => !isStarted(p));

  useScreenKeys({
    n: (e) => {
      e.preventDefault();
      paste.current?.focus();
    },
    o: (e) => {
      e.preventDefault();
      void navigate({ to: "/create/pocket" });
    },
  });
  useScreenShortcuts("create", {
    title: "Create",
    items: [
      { keys: "N", label: "Paste a link or some text" },
      { keys: "O", label: "Map an article with all the options" },
    ],
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-8 py-12" aria-labelledby="create-title">
      <header className="flex flex-col gap-2">
        <h1 id="create-title" className="m-0 t-title text-ink">
          Create
        </h1>
        <p className="m-0 t-lead text-ink-2">Make a small map of something you're reading.</p>
      </header>
      <Panel tone="surface" padding="lg" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="m-0 t-heading text-ink">Map an article</h2>
            <p className="m-0 mt-1 max-w-[62ch] text-body text-ink-2">
              Paste a link and watch it become a short map of cards, each with a question to guess, a few beats to play
              and a close that answers it, with checkpoints between sections. Card 1 is playable before the rest are
              written.
            </p>
          </div>
          <Link to="/create/pocket" className={buttonClass({ variant: "secondary" })}>
            All the options <ArrowRight size={16} aria-hidden /> <Kbd keys="O" />
          </Link>
        </div>
        <PasteBar ref={paste} focusKey="N" />
      </Panel>
      {mine.length > 0 ? <Shelf title="Article maps you've opened" items={mine} /> : null}
      <Shelf
        title="Example article maps"
        lead="Small maps from one article, 3 to 12 cards. They play offline, no key needed."
        items={examples}
        empty="The example maps arrive with the next update of the bundled maps."
      />
    </main>
  );
}
