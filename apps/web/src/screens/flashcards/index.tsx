/**
 * /flashcards: your flashcards (never "cards" in the UI: a card is the map unit). Filter by map and
 * kind, edit your own, pause or delete, add one, export CSV or Markdown. A card's own schedule (its
 * lit memory) stays out of the list; cards come back through Relight.
 */
import type { CardState, Markdown, PackId } from "@learncroc/core";
import { Button, cn, Dialog, Segmented, toast } from "@learncroc/ui";
import { DownloadSimple, PauseCircle, PencilSimple, PlayCircle, Plus, Trash } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import MarkdownIt from "markdown-it";
import { useId, useMemo, useState } from "react";
import { api } from "../../api/client";
import { downloadFile, fileDate } from "../../app/download";
import { errorText } from "../../app/errors";
import { useScreenKeys } from "../../app/keys";
import { useCards, useCardsDue, usePacks } from "../../app/queries";
import { SearchTrigger } from "../../app/Rail";
import { Page, ScreenHeader } from "../../app/ScreenHeader";
import { useScreenShortcuts } from "../../app/store";

type CardWithText = CardState & { front: Markdown; back: Markdown };
type KindFilter = "all" | "user" | "flashcard";

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

/** Inline Markdown (bold, italic, code) with raw HTML escaped. */
export function InlineMarkdown({ text, className }: { text: string; className?: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it with html:false escapes raw HTML
  return <span className={className} dangerouslySetInnerHTML={{ __html: md.renderInline(text) }} />;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** "Due now", "Due tomorrow", "Due Oct 23" — relative to the server's now. */
export function dueLabel(due: number, now: number | undefined): string {
  if (now === undefined) return `Due ${dayFmt.format(due)}`;
  if (due <= now) return "Due now";
  const days = Math.ceil((due - now) / 86_400_000);
  if (days <= 1) return "Due tomorrow";
  if (days < 7) return `Due in ${days} days`;
  return `Due ${dayFmt.format(due)}`;
}

export function FlashcardsScreen() {
  const qc = useQueryClient();
  const [packId, setPackId] = useState<PackId | "">("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [editing, setEditing] = useState<CardWithText | "new" | null>(null);
  const [deleting, setDeleting] = useState<CardWithText | null>(null);
  const packs = usePacks();
  const cardsQ = useCards(packId || undefined);
  const due = useCardsDue();
  const now = due.data?.now;
  const titleOf = useMemo(() => new Map((packs.data ?? []).map((p) => [p.id, p.title])), [packs.data]);

  const all = (cardsQ.data ?? []).filter((c) => c.kind !== "node");
  const shown = all.filter((c) => kind === "all" || c.kind === kind).sort((a, b) => a.due - b.due);
  const dueNow = now === undefined ? 0 : all.filter((c) => !c.suspended && c.due <= now).length;

  const refresh = () => qc.invalidateQueries({ queryKey: ["cards"] });

  const exportAs = async (format: "csv" | "md") => {
    try {
      const text = await api.exportCards({ format, ...(packId ? { packId } : {}) });
      downloadFile(
        `learncroc-flashcards-${packId || "all"}-${fileDate(now ?? Date.now())}.${format}`,
        text,
        format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8",
      );
    } catch (err) {
      toast({ tone: "ember", message: `Couldn't export flashcards: ${errorText(err)}` });
    }
  };

  const toggleSuspend = async (c: CardWithText) => {
    try {
      await api.updateCard({ id: c.id }, { suspended: !c.suspended });
      toast({
        tone: "done",
        message: c.suspended
          ? "Flashcard resumed. It comes back in Relight."
          : "Flashcard paused. It won't come up until you resume it.",
      });
    } catch (err) {
      toast({ tone: "ember", message: `Couldn't update the flashcard: ${errorText(err)}` });
    }
    await refresh();
  };

  const remove = async (c: CardWithText) => {
    setDeleting(null);
    try {
      await api.deleteCard({ id: c.id });
      toast({ tone: "done", message: "Flashcard deleted." });
    } catch (err) {
      toast({ tone: "ember", message: `Couldn't delete the flashcard: ${errorText(err)}` });
    }
    await refresh();
  };

  useScreenKeys({
    n: (e) => {
      e.preventDefault();
      setEditing("new");
    },
  });
  useScreenShortcuts("flashcards", { title: "Flashcards", items: [{ keys: "N", label: "New flashcard" }] });

  return (
    <Page>
      <ScreenHeader
        title="Flashcards"
        lead={
          <>
            Your flashcards come from cards you've lit and highlights you've saved.{" "}
            {now === undefined
              ? "They come back in Relight, mixed with your cards."
              : dueNow
                ? `${dueNow} ${dueNow === 1 ? "is" : "are"} due; they come back in Relight, mixed with your cards.`
                : "Nothing is due. They come back in Relight, mixed with your cards."}
          </>
        }
        actions={<SearchTrigger />}
      />

      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-small text-ink-2">
          Map
          <select
            value={packId}
            onChange={(e) => setPackId(e.currentTarget.value)}
            className="h-9 w-48 rounded-sm border border-line-strong bg-surface px-2 text-small text-ink"
          >
            <option value="">All maps</option>
            {(packs.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <Segmented<KindFilter>
          label="Kind of flashcard"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All" },
            { value: "user", label: "Yours" },
            { value: "flashcard", label: "From maps" },
          ]}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<DownloadSimple size={16} />} onClick={() => void exportAs("csv")}>
            Export CSV
          </Button>
          <Button size="sm" variant="ghost" icon={<DownloadSimple size={16} />} onClick={() => void exportAs("md")}>
            Export Markdown
          </Button>
          <Button size="sm" variant="primary" kbd="N" icon={<Plus size={16} />} onClick={() => setEditing("new")}>
            New flashcard
          </Button>
        </div>
      </div>

      {cardsQ.isError ? (
        <p role="alert" className="text-body text-ember-text">
          Couldn't load your flashcards ({errorText(cardsQ.error)}).{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => void cardsQ.refetch()}>
            Try again
          </button>
        </p>
      ) : cardsQ.data && shown.length === 0 ? (
        <section className="rounded-stage border border-dashed border-line-strong bg-surface-2 px-8 py-12">
          <h2 className="text-heading">{all.length ? "No flashcards of this kind" : "No flashcards yet"}</h2>
          <p className="mt-2 max-w-[60ch] text-body text-ink-2">
            Your flashcards come from cards you've lit and highlights you've saved, and you can add your own. Each one
            comes back in Relight just before you'd forget it.
          </p>
          <div className="mt-5 flex gap-2">
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing("new")}>
              New flashcard
            </Button>
            <Link to="/library" className="inline-flex h-10 items-center px-3 text-body text-ink-2 hover:text-ink">
              Back to the Library
            </Link>
          </div>
        </section>
      ) : (
        <ul aria-label="Flashcards" className="grid gap-3">
          {shown.map((c) => (
            <li
              key={c.id}
              className={cn(
                "grid grid-cols-12 items-start gap-x-6 gap-y-2 rounded-md border border-line bg-surface px-5 py-4 shadow-1 dark:shadow-[var(--inset-dark)]",
                c.suspended && "opacity-60",
              )}
            >
              <div className="col-span-12 md:col-span-5">
                <p className="text-micro text-ink-3">Front</p>
                <InlineMarkdown text={c.front} className="mt-0.5 block text-body text-ink" />
              </div>
              <div className="col-span-12 md:col-span-4">
                <p className="text-micro text-ink-3">Back</p>
                <InlineMarkdown text={c.back} className="mt-0.5 block text-body text-ink-2" />
              </div>
              <div className="col-span-12 flex flex-wrap items-center justify-between gap-2 md:col-span-3 md:flex-col md:items-end">
                <p className="text-right text-small text-ink-2">
                  <span className="block">{titleOf.get(c.packId) ?? c.packId}</span>
                  <span className="block tabular text-ink-3">
                    {c.suspended ? "Paused" : dueLabel(c.due, now)}
                    {c.kind === "user" ? ", yours" : ""}
                  </span>
                </p>
                <div className="flex gap-1">
                  {c.kind === "user" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<PencilSimple size={16} />}
                      onClick={() => setEditing(c)}
                      aria-label={`Edit flashcard: ${c.front}`}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={c.suspended ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
                    onClick={() => void toggleSuspend(c)}
                    aria-label={`${c.suspended ? "Resume" : "Pause"} flashcard: ${c.front}`}
                  >
                    {c.suspended ? "Resume" : "Pause"}
                  </Button>
                  {c.kind === "user" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash size={16} />}
                      onClick={() => setDeleting(c)}
                      aria-label={`Delete flashcard: ${c.front}`}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <CardEditor
          card={editing === "new" ? null : editing}
          packs={(packs.data ?? []).map((p) => ({ id: p.id, title: p.title }))}
          defaultPack={packId || packs.data?.[0]?.id || ""}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        role="alertdialog"
        title="Delete this flashcard?"
        description="Its review history goes too. This can't be undone."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button variant="primary" onClick={() => deleting && void remove(deleting)}>
              Delete
            </Button>
          </>
        }
      />
    </Page>
  );
}

function CardEditor({
  card,
  packs,
  defaultPack,
  onClose,
  onSaved,
}: {
  card: CardWithText | null;
  packs: { id: string; title: string }[];
  defaultPack: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  const [packId, setPackId] = useState(card?.packId ?? defaultPack);
  const [saving, setSaving] = useState(false);
  const ids = { front: useId(), back: useId(), pack: useId() };
  const valid = front.trim().length > 0 && back.trim().length > 0 && (card !== null || packId !== "");

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (card) await api.updateCard({ id: card.id }, { front: front.trim(), back: back.trim() });
      else await api.createCard({ packId, front: front.trim(), back: back.trim(), source: "manual" });
      toast({ tone: "done", message: card ? "Flashcard saved." : "Flashcard added. It joins your next Relight." });
      onSaved();
    } catch (err) {
      toast({ tone: "ember", message: `Couldn't save the flashcard: ${errorText(err)}` });
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-3";
  return (
    <Dialog
      open
      onClose={onClose}
      title={card ? "Edit flashcard" : "New flashcard"}
      description="Make the front a question you have to answer, not a word to define."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || saving} onClick={() => void save()}>
            {card ? "Save" : "Add flashcard"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {card ? null : (
          <div className="grid gap-1.5">
            <label htmlFor={ids.pack} className="text-small text-ink-2">
              Map
            </label>
            <select id={ids.pack} value={packId} onChange={(e) => setPackId(e.currentTarget.value)} className={field}>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-1.5">
          <label htmlFor={ids.front} className="text-small text-ink-2">
            Front
          </label>
          <textarea
            id={ids.front}
            rows={2}
            value={front}
            onChange={(e) => setFront(e.currentTarget.value)}
            className={field}
            placeholder="Why does a high temperature make odd words more likely?"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={ids.back} className="text-small text-ink-2">
            Back
          </label>
          <textarea
            id={ids.back}
            rows={3}
            value={back}
            onChange={(e) => setBack(e.currentTarget.value)}
            className={field}
            placeholder="It flattens the probabilities, so unlikely words get picked more often."
          />
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
