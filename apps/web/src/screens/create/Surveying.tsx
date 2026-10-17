/**
 * /create/pocket/:job: building an article map (03 §4.8.2, PD14). The map draws itself on paper as
 * the plan arrives; the panel on the right lists the real steps (Read, Plan, Write the cards,
 * Pictures, Checkpoint questions, Save) with a row per card: its word count once written and a note
 * whenever a check acted. As soon as card 1 is ready the bar says so, and "Start card 1 ⏎" opens it
 * on the map while the rest keeps building. The article itself is one click away.
 */

import type { JobEvent, NodeId } from "@learncroc/core";
import { Button, buttonClass, Croc, cn, useReducedMotion } from "@learncroc/ui";
import { BookOpenText, CheckCircle, CircleDashed, PencilSimple, Spinner } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { qk } from "../../app/queries";
import { isTypingTarget } from "../../lib/keys";
import { INTAKE_HANDOFF } from "./Intake";
import { type ArticleParas, fetchArticle, recallJob, rememberJob, useJobEvents } from "./jobs";
import { ReaderPane } from "./ReaderPane";
import { SurveyMap } from "./SurveyMap";
import { cardsInOrder, firstPlayable, type StageLine, type SurveyState, stageLines, surveyLayout } from "./survey";

interface Failure {
  copy: string;
  action?: { label: string; to: "paste" | "settings" | "intake" };
}

/** Failure copy (03 §4.8.2), by the job's error code. */
export function failureCopy(code: string, message: string): Failure {
  switch (code) {
    case "too_short":
    case "fetch_failed":
      return {
        copy: "Couldn't read enough of this page (it may need a login). Paste the text instead?",
        action: { label: "Paste the text", to: "paste" },
      };
    case "too_long":
      return {
        copy: "This article is too long for one map. Paste the part you care about.",
        action: { label: "Paste a section", to: "paste" },
      };
    case "ai_not_configured":
      return { copy: "Article maps need an AI key or a local model.", action: { label: "Set up AI", to: "settings" } };
    case "cap_reached":
      return {
        copy: "This would go over this month's AI budget. Raise it in Settings, or try a shorter map.",
        action: { label: "Settings", to: "settings" },
      };
    default:
      return {
        copy: `The build stopped: ${message.replace(/\.$/, "")}.`,
        action: { label: "Try again", to: "intake" },
      };
  }
}

/** A chip with the idea's title flies from the paragraph to its card (craft; skipped in reduced motion). */
function flyIdea(from: Element, to: Element, title: string): void {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (a.width === 0 || b.width === 0) return;
  const chip = document.createElement("div");
  chip.textContent = title;
  chip.setAttribute("aria-hidden", "true");
  chip.className =
    "pointer-events-none fixed z-50 rounded-sm border border-line-strong bg-surface px-2.5 py-1 text-small font-[650] text-ink shadow-2 voice-casual";
  chip.style.left = `${a.left + 16}px`;
  chip.style.top = `${a.top + 8}px`;
  document.body.appendChild(chip);
  if (typeof chip.animate !== "function") {
    chip.remove();
    return;
  }
  const dx = b.left + b.width / 2 - (a.left + 16) - chip.offsetWidth / 2;
  const dy = b.top + b.height / 2 - (a.top + 8) - chip.offsetHeight / 2;
  const anim = chip.animate(
    [
      { transform: "translate(0,0) rotate(-2deg) scale(1)", opacity: 0 },
      { transform: "translate(0,-14px) rotate(-4deg) scale(1.04)", opacity: 1, offset: 0.18 },
      { transform: `translate(${dx}px, ${dy}px) rotate(3deg) scale(.55)`, opacity: 0.15 },
    ],
    { duration: 950, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  anim.onfinish = () => chip.remove();
  anim.oncancel = () => chip.remove();
}

function StepIcon({ status }: { status: StageLine["status"] }) {
  return status === "done" ? (
    <CheckCircle size={16} weight="fill" className="shrink-0 text-sea" aria-hidden />
  ) : status === "active" ? (
    <Spinner size={16} className="shrink-0 text-ink-2 motion-safe:animate-spin" aria-hidden />
  ) : (
    <CircleDashed size={16} className="shrink-0 text-ink-3" aria-hidden />
  );
}

function CardRows({ state, packId }: { state: SurveyState; packId?: string }) {
  const cards = cardsInOrder(state);
  if (!cards.length) return null;
  return (
    <ol className="mt-2 ml-6 grid list-none gap-1.5 p-0" aria-label="Cards">
      {cards.map((c, i) => (
        <li key={c.id} className="grid gap-0.5" title={c.message}>
          <div className="flex items-center gap-2 text-small">
            {c.status === "ready" ? (
              <CheckCircle size={14} weight="fill" className="shrink-0 text-sea" aria-hidden />
            ) : c.status === "failed" ? (
              <CircleDashed size={14} className="shrink-0 text-ink-3" aria-hidden />
            ) : (
              <PencilSimple size={14} className="shrink-0 text-ink-3" aria-hidden />
            )}
            <span className="tabular w-4 shrink-0 text-ink-3">{i + 1}</span>
            {c.status === "ready" && packId ? (
              <Link
                to="/p/$pack"
                params={{ pack: packId }}
                search={{ card: c.id }}
                className="min-w-0 flex-1 truncate text-ink hover:underline"
              >
                {c.title}
              </Link>
            ) : (
              <span className={cn("min-w-0 flex-1 truncate", c.status === "found" ? "text-ink-2" : "text-ink-3")}>
                {c.title}
              </span>
            )}
            <span className="tabular shrink-0 text-micro text-ink-3">
              {c.status === "ready" && c.words ? `${c.words} w` : c.status === "found" ? "Writing…" : ""}
            </span>
          </div>
          {c.status === "failed" ? (
            <p className="m-0 ml-[38px] text-micro text-ink-2">
              Left out: {readableMessage(c.message) ?? "it didn't pass its checks"}.
            </p>
          ) : null}
          {c.notes.map((n) => (
            <p key={n} className="m-0 ml-[38px] text-micro text-ink-2">
              {n}
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** A pipeline message fit for the row, or undefined when it is a raw validation error (shown as a title). */
function readableMessage(m: string | undefined): string | undefined {
  if (!m || m.length > 90 || /[:{}[\]]/.test(m)) return undefined;
  return m.replace(/\.$/, "");
}

function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Surveying() {
  const { job } = useParams({ strict: false }) as { job?: string };
  const jobId = job ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const reduced = useReducedMotion();
  const [packId, setPackId] = useState<string | undefined>(() => recallJob(jobId));
  const [article, setArticle] = useState<ArticleParas | null>(null);
  const [reading, setReading] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const announcedReady = useRef(false);
  const mapBox = useRef<HTMLDivElement>(null);
  const readerBox = useRef<HTMLDivElement>(null);
  const pendingFlights = useRef<{ para: string; nodeId: NodeId; title: string }[]>([]);

  const onEvent = useCallback(
    (e: JobEvent) => {
      if (e.type === "meta" && !article)
        void fetchArticle(jobId).then((a) => {
          if (!a) return;
          setArticle(a);
          if (a.packId) {
            setPackId((p) => p ?? a.packId);
            rememberJob(jobId, a.packId);
          }
        });
      if (e.type === "plan-node") {
        const para = e.node.paras[0];
        if (para) pendingFlights.current.push({ para, nodeId: e.node.id, title: e.node.title });
      }
      if (e.type === "card-ready") {
        if (!announcedReady.current) {
          announcedReady.current = true;
          setAnnounce("Card 1 is ready to play.");
        }
        if (packId) void qc.invalidateQueries({ queryKey: qk.pack(packId) });
      }
      if (e.type === "done") {
        setPackId(e.packId);
        setAnnounce("Map finished building.");
        void qc.invalidateQueries({ queryKey: qk.packs });
        void qc.invalidateQueries({ queryKey: qk.pack(e.packId) });
      }
      if (e.type === "error") setAnnounce("The build stopped.");
    },
    [jobId, packId, article, qc],
  );
  const { state, gone } = useJobEvents(jobId, onEvent);
  const lay = surveyLayout(state);
  const done = !!state.done;
  const stopped = !!state.error || gone;

  useEffect(() => {
    if (done || stopped) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [done, stopped]);

  // Fly idea chips once their card exists on the map (only while the article is open).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a card is added to the map
  useEffect(() => {
    if (pendingFlights.current.length === 0) return;
    const flights = pendingFlights.current.splice(0);
    if (reduced || !reading) return;
    requestAnimationFrame(() => {
      for (const f of flights) {
        const from = readerBox.current?.querySelector(`[data-para="${f.para}"]`);
        const to = mapBox.current?.querySelector(`[data-stop="${f.nodeId}"]`);
        if (from && to) flyIdea(from, to, f.title);
      }
    });
  }, [state.stops.length, reduced, reading]);

  const first = firstPlayable(state);
  const ordered = cardsInOrder(state);
  const firstNo = first ? ordered.indexOf(first) + 1 : 1;
  const ready = state.stops.filter((s) => s.status === "ready").length;
  const pid = state.done?.packId ?? packId;

  const startFirst = useCallback(() => {
    if (pid && first) void navigate({ to: "/p/$pack", params: { pack: pid }, search: { card: first.id } });
  }, [pid, first, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (e.key === "Enter" && (e.target === document.body || e.target === null) && first && pid) {
        e.preventDefault();
        startFirst();
      }
      if (e.key === "Escape" && !done && !stopped) setConfirmStop(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startFirst, done, stopped, first, pid]);

  const cancel = async () => {
    try {
      await api.cancelJob({ jobId });
    } finally {
      void navigate({ to: "/create" });
    }
  };

  const failure = state.error ? failureCopy(state.error.code, state.error.message) : undefined;
  const cps = state.checkpoints.length;
  const title = state.meta?.title ?? article?.title ?? "Your article map";
  const lines = stageLines(state);

  const pasteLink = (label: string) => (
    <Link
      to="/create/pocket"
      onClick={() => {
        try {
          sessionStorage.setItem(INTAKE_HANDOFF, "text");
        } catch {
          /* private mode */
        }
      }}
      className={buttonClass({ variant: "primary" })}
    >
      {label}
    </Link>
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-bg" aria-labelledby="build-title">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-8 pt-6 pb-4">
        <div className="min-w-0">
          <h1 id="build-title" className="m-0 truncate t-title text-ink">
            {title}
          </h1>
          <p className="m-0 mt-1 text-small text-ink-2 tabular">
            {done
              ? `Your map is ready · ${Math.round((state.done?.ms ?? 0) / 1000)} s`
              : stopped
                ? "The build stopped"
                : `Writing your map · ${elapsedText(now - started)}`}
            {state.meta?.site ? ` · ${state.meta.site}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!done && !stopped ? (
            <Button variant="ghost" onClick={() => setConfirmStop(true)} kbd="Esc">
              Stop building
            </Button>
          ) : null}
          <Button
            variant="secondary"
            icon={<BookOpenText size={16} />}
            aria-pressed={reading}
            onClick={() => setReading((r) => !r)}
          >
            {reading ? "Hide the article" : "Read the article"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {reading ? (
          <section
            ref={readerBox}
            className="min-h-0 w-[min(440px,36vw)] shrink-0 border-r border-line bg-surface"
            aria-label="Article"
          >
            <ReaderPane article={article} state={state} lineIndex={lay.lineIndex} />
          </section>
        ) : null}
        <section className="relative min-h-0 min-w-0 flex-1 p-6" aria-label="Map">
          <div ref={mapBox} className="relative h-full overflow-hidden rounded-stage border border-line shadow-2">
            <SurveyMap
              state={state}
              {...(pid ? { packId: pid } : {})}
              onSelect={(id) => pid && void navigate({ to: "/p/$pack", params: { pack: pid }, search: { card: id } })}
              className="absolute inset-0"
            />
            <DataStops state={state} />
          </div>
        </section>
        <aside
          className="min-h-0 w-80 shrink-0 overflow-y-auto border-l border-line bg-surface px-5 py-6"
          aria-labelledby="building-head"
        >
          <h2 id="building-head" className="m-0 mb-3 text-micro tracking-[0.08em] text-ink-3 uppercase">
            {done ? "Built" : "Building"}
          </h2>
          <ol className="m-0 grid list-none gap-3 p-0" aria-label="Progress">
            {lines.map((l) => (
              <li key={l.key} className="grid">
                <div
                  className={cn("flex items-center gap-2 text-small", l.status === "idle" ? "text-ink-3" : "text-ink")}
                >
                  <StepIcon status={l.status} />
                  <span>{l.label}</span>
                  <span className="sr-only">
                    {l.status === "done" ? "(done)" : l.status === "active" ? "(in progress)" : ""}
                  </span>
                </div>
                {l.detail ? <p className="m-0 ml-6 text-micro text-ink-2">{l.detail}</p> : null}
                {l.key === "cards" ? <CardRows state={state} {...(pid ? { packId: pid } : {})} /> : null}
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center gap-4 border-t border-line bg-surface px-8 py-4">
        <Croc
          size={44}
          state={done ? "happy" : first ? "curious" : stopped ? "idle" : "thinking"}
          decorative
          className="shrink-0"
        />
        {confirmStop && !done && !stopped ? (
          <>
            <p className="m-0 flex-1 text-body text-ink">
              Stop building? The cards written so far are removed with it.
            </p>
            <Button variant="secondary" onClick={() => void cancel()}>
              Stop
            </Button>
            <Button variant="primary" onClick={() => setConfirmStop(false)} autoFocus>
              Keep building
            </Button>
          </>
        ) : failure && ready === 0 ? (
          <>
            <p className="m-0 flex-1 text-body text-ink" role="alert">
              {failure.copy}
            </p>
            {failure.action?.to === "paste" ? (
              pasteLink(failure.action.label)
            ) : failure.action?.to === "settings" ? (
              <Link to="/settings/$section" params={{ section: "ai" }} className={buttonClass({ variant: "primary" })}>
                {failure.action.label}
              </Link>
            ) : (
              <Link to="/create/pocket" className={buttonClass({ variant: "primary" })}>
                {failure.action?.label ?? "Try again"}
              </Link>
            )}
          </>
        ) : stopped && !done ? (
          <>
            <p className="m-0 flex-1 text-body text-ink">
              {ready > 0
                ? `The build stopped after ${ready} ${ready === 1 ? "card" : "cards"}. ${ready === 1 ? "That one is" : `Those ${ready} are`} yours to play.`
                : "This build isn't running any more (the app was restarted). Try it again from the link."}
            </p>
            {ready > 0 && pid ? (
              <Link to="/p/$pack" params={{ pack: pid }} className={buttonClass({ variant: "primary", size: "lg" })}>
                Open the map
              </Link>
            ) : (
              <Link to="/create/pocket" className={buttonClass({ variant: "primary" })}>
                Try again
              </Link>
            )}
          </>
        ) : done ? (
          <>
            <p className="m-0 flex-1 text-body text-ink">
              Your map is ready. {state.done?.cards ?? ready} {(state.done?.cards ?? ready) === 1 ? "card" : "cards"}
              {cps ? `, ${cps} ${cps === 1 ? "checkpoint" : "checkpoints"}` : ""}.
              {state.done && state.done.costUsd > 0 ? (
                <span className="text-small text-ink-2"> About ${state.done.costUsd.toFixed(2)}.</span>
              ) : null}
            </p>
            {pid ? (
              <Link to="/p/$pack" params={{ pack: pid }} className={buttonClass({ variant: "secondary" })}>
                Open the map
              </Link>
            ) : null}
            {first && pid ? (
              <Button variant="primary" size="lg" kbd="⏎" onClick={startFirst}>
                Start card {firstNo}
              </Button>
            ) : null}
          </>
        ) : first && pid ? (
          <>
            <p className="m-0 flex-1 text-body text-ink">
              Card {firstNo} is ready: <span className="font-semibold">{first.title}</span>. Start it while the rest
              builds.
            </p>
            <Button variant="primary" size="lg" kbd="⏎" onClick={startFirst}>
              Start card {firstNo}
            </Button>
          </>
        ) : (
          <p className="m-0 flex-1 text-body text-ink-2">
            {state.stops.length
              ? `Planned ${state.stops.length} cards. The first one is being written; it's usually ready in about 20 seconds.`
              : state.meta
                ? "Reading done. Planning the cards…"
                : "Reading the article…"}
          </p>
        )}
      </footer>
    </main>
  );
}

/** Invisible anchors over each card, so idea chips know where to land. */
function DataStops({ state }: { state: SurveyState }) {
  const lay = surveyLayout(state);
  const PAD = 40;
  const vw = lay.width + PAD * 2;
  const vh = lay.height + PAD * 2 + 30;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`${-PAD} ${-PAD} ${vw} ${vh}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {state.stops.map((s) => {
        const p = lay.nodes[s.id];
        return p ? <circle key={s.id} data-stop={s.id} cx={p.x} cy={p.y} r={22} fill="none" /> : null;
      })}
    </svg>
  );
}
