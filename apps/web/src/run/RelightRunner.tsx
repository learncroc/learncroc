/**
 * Relight: about five minutes of mixed questions that bring fading cards back, across every map by
 * default (or one, with ?pack=). A header strip of card glyphs turns from ember to Lumen as each card
 * is relit, and the pips turn Lumen the moment an answer lands right: mastery being refreshed. One
 * answer per question; the server grades and schedules. Moss sits beside it in hint mode.
 */
import type { CompiledPack, ItemRef, NodeId, PackId, RunSummary } from "@learncroc/core";
import { Button, cn, type PipState, StopGlyph } from "@learncroc/ui";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CrocPane } from "../slots";
import { type RunApi, useRunApi } from "./api";
import { itemTask } from "./content";
import { useKeys } from "./keys";
import { Md } from "./Markdown";
import { RunLoading, RunProblem } from "./PackGate";
import { useReducedMotion } from "./prefs";
import { runQueryKeys, useAiConfigured, useInvalidateProgress } from "./queries";
import { RunFrame } from "./RunFrame";
import { useWide } from "./shell";
import { useRunSounds } from "./sound";
import { TaskView } from "./TaskView";
import { errorText } from "./useRunSession";
import { worldTint } from "./world";

type RelightRes = Awaited<ReturnType<RunApi["startRelight"]>>;
type RelightItem = RelightRes["items"][number];

const refKey = (r: Pick<ItemRef, "packId" | "nodeId" | "itemId">) => `${r.packId}/${r.nodeId}/${r.itemId}`;
const stopKey = (packId: string, nodeId: string) => `${packId}/${nodeId}`;

function daysUntil(at: number | undefined, now: number): number | undefined {
  if (at === undefined) return undefined;
  return Math.max(1, Math.round((at - now) / 86_400_000));
}

export function RelightRunner({ packId }: { packId?: PackId }) {
  const client = useRunApi();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const aiConfigured = useAiConfigured();
  const sounds = useRunSounds();
  const invalidate = useInvalidateProgress();
  const [session, setSession] = useState<RelightRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Record<string, boolean[]>>({});
  const [carry, setCarry] = useState<{ correct: boolean; text?: string } | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [feel, setFeel] = useState<1 | 3 | undefined>();
  const [pips, setPips] = useState<PipState[]>([]);
  const wide = useWide();
  const started = useRef<string | null>(null);

  const begin = useCallback(async () => {
    setError(null);
    setSummary(null);
    setAnswered({});
    setCarry(null);
    setPips([]);
    try {
      const res = await client.startRelight(packId ? { packId } : {});
      setSession(res);
      sounds.resetRun();
    } catch (e) {
      setError(errorText(e));
    }
  }, [client, packId, sounds]);

  useEffect(() => {
    const key = packId ?? "*";
    if (started.current === key) return;
    started.current = key;
    void begin();
  }, [begin, packId]);

  // Packs for world tint, assets and widgets (cached by the pack query key).
  const packIds = useMemo(() => [...new Set((session?.items ?? []).map((i) => i.ref.packId))], [session]);
  const packQs = useQueries({
    queries: packIds.map((id) => ({
      queryKey: runQueryKeys.pack(id),
      queryFn: () => client.getPack({ id }),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const packs = useMemo(() => {
    const m = new Map<string, CompiledPack>();
    packQs.forEach((q, i) => {
      const id = packIds[i];
      if (q.data && id) m.set(id, q.data);
    });
    return m;
  }, [packQs, packIds]);

  const stops = useMemo(() => {
    const seen = new Map<string, { packId: string; nodeId: NodeId; title: string; packTitle: string }>();
    for (const it of session?.items ?? []) {
      const k = stopKey(it.ref.packId, it.ref.nodeId);
      if (!seen.has(k))
        seen.set(k, { packId: it.ref.packId, nodeId: it.ref.nodeId, title: it.nodeTitle, packTitle: it.packTitle });
    }
    return [...seen.entries()];
  }, [session]);

  const run = session?.run;
  const current: RelightItem | undefined = useMemo(() => {
    if (!run?.current || !session) return undefined;
    const k = refKey(run.current.ref);
    return session.items.find((i) => refKey(i.ref) === k);
  }, [run, session]);

  const finish = useCallback(async () => {
    if (!run) return;
    try {
      const s = await client.finishRun({ runId: run.id }, {});
      setSummary(s);
      invalidate();
    } catch (e) {
      setError(errorText(e));
    }
  }, [client, run, invalidate]);

  // When the server has no next item, the session is over.
  useEffect(() => {
    if (run && !run.current && run.finishedAt === undefined && !summary && !session?.nothingDue) void finish();
  }, [run, summary, session?.nothingDue, finish]);

  useKeys(
    (e) => {
      if (e.metaKey || e.ctrlKey) return false;
      const k = e.key.toLowerCase();
      if (k === "s") {
        setFeel((f) => (f === 1 ? undefined : 1));
        return true;
      }
      if (k === "d") {
        setFeel((f) => (f === 3 ? undefined : 3));
        return true;
      }
      return false;
    },
    { enabled: Boolean(current) },
  );

  const exit = () => void navigate(packId ? { to: "/p/$pack", params: { pack: packId } } : { to: "/library" });

  if (error && !session)
    return (
      <RunProblem
        title="Relight didn't start"
        body={error}
        action={
          <Button variant="primary" onClick={() => void begin()}>
            Try again
          </Button>
        }
      />
    );
  if (!session) return <RunLoading label="Gathering what's fading…" />;

  const relit = (summary?.relit ?? []).filter((r) => r.grade >= 2);
  const again = (summary?.relit ?? []).filter((r) => r.grade < 2);
  const total = session.items.length;
  const asked = (run?.cursor.item ?? 0) + (current ? 1 : 0);
  const pipStates: PipState[] = Array.from({ length: total }, (_, i) => pips[i] ?? "pending");

  let body: ReactNode;
  if (session.nothingDue) {
    const days = daysUntil(session.nextDueAt, session.now);
    body = (
      <section className="mx-auto flex max-w-lg flex-col items-center gap-4 text-center" data-relight="nothing-due">
        <StopGlyph state="lit" size={40} />
        <h2 className="t-title">Nothing is fading.</h2>
        <p className="text-body text-ink-2">
          {days ? `Your next Relight is in about ${days} ${days === 1 ? "day" : "days"}.` : "Your maps are bright."}
        </p>
        <Button variant="primary" onClick={exit}>
          {packId ? "Back to map" : "Back to library"}
        </Button>
      </section>
    );
  } else if (summary) {
    const days = daysUntil(summary.nextFadeAt, summary.now);
    body = (
      <section
        className="mx-auto flex max-w-lg flex-col items-center gap-4 text-center"
        data-relight="done"
        aria-labelledby="relit-title"
      >
        <h2 id="relit-title" className="t-title">
          {relit.length > 0 ? "Back to bright." : "Not quite bright yet."}
        </h2>
        <p className="text-body text-ink-2">
          {relit.length} {relit.length === 1 ? "card" : "cards"} relit.
        </p>
        <ul className="flex flex-col gap-1 text-left" aria-label="Relit cards">
          {(summary.relit ?? []).map((r) => {
            const s = stops.find(([k]) => k === stopKey(r.packId, r.nodeId))?.[1];
            return (
              <li key={stopKey(r.packId, r.nodeId)} className="flex items-center gap-2 text-body">
                <StopGlyph state={r.grade >= 2 ? "lit" : "fading"} size={18} />
                {s?.title ?? r.nodeId}
                <span className="text-small text-ink-3">
                  {r.grade >= 3 ? "bright" : r.grade === 2 ? "brighter" : "still fading"}
                </span>
              </li>
            );
          })}
        </ul>
        {again.map((r) => {
          const s = stops.find(([k]) => k === stopKey(r.packId, r.nodeId))?.[1];
          return (
            <p key={`again-${stopKey(r.packId, r.nodeId)}`} className="text-small text-ink-2">
              {s?.title ?? r.nodeId} needs another pass. It'll come back sooner.
            </p>
          );
        })}
        {days ? (
          <p className="text-body text-ink-2">
            Next ones fade in about {days} {days === 1 ? "day" : "days"}.
          </p>
        ) : null}
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={exit}>{packId ? "Back to map" : "Back to library"}</Button>
          <Button variant="ghost" onClick={() => void begin()}>
            Keep going
          </Button>
        </div>
      </section>
    );
  } else if (current && run) {
    const pack = packs.get(current.ref.packId);
    const task = itemTask(
      current.ref.packId,
      current.ref.nodeId,
      current.interaction,
      "relight",
      current.vars,
      `:${run.id}:${asked}`,
    );
    body = pack ? (
      <div className="flex flex-col gap-4">
        <div className="rounded-stage px-6 py-6" style={worldTint(pack.manifest.theme, 14)} data-relight-item>
          <TaskView
            key={task.key}
            task={task}
            pack={pack}
            layout="stack"
            coachTop={
              <>
                {carry ? (
                  <p className="border-l-2 border-line-strong pl-3 text-body text-ink-2" data-previous>
                    {carry.correct ? "That one's back." : "That one needs another pass."}
                    {carry.text ? (
                      <>
                        {" "}
                        <Md text={carry.text} packId={pack.manifest.id} />
                      </>
                    ) : null}
                  </p>
                ) : null}
                <p className="t-micro text-ink-3 uppercase tracking-wide">
                  From: {current.nodeTitle} · {current.packTitle}
                </p>
              </>
            }
            extra={
              <fieldset className="flex items-center gap-2 text-small text-ink-2" data-feel>
                <legend className="sr-only">How did that feel? (optional)</legend>
                <span aria-hidden>How did that feel? (optional)</span>
                {(
                  [
                    [1, "shaky", "S"],
                    [3, "solid", "D"],
                  ] as const
                ).map(([v, label, key]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={feel === v}
                    onClick={() => setFeel(feel === v ? undefined : v)}
                    className={cn(
                      "rounded-pill border px-3 py-0.5",
                      feel === v ? "border-ink bg-ink text-surface" : "border-line",
                    )}
                  >
                    {label} <kbd className="text-micro opacity-70">{key}</kbd>
                  </button>
                ))}
              </fieldset>
            }
            submit={async ({ answer, confidence, ms }) => {
              const res = await client.submitAttempt(
                { runId: run.id },
                {
                  packId: current.ref.packId,
                  nodeId: current.ref.nodeId,
                  interactionId: current.ref.itemId,
                  phase: "relight",
                  answer,
                  ...((confidence ?? feel) ? { confidence: confidence ?? feel } : {}),
                  ms,
                },
              );
              const k = stopKey(current.ref.packId, current.ref.nodeId);
              setAnswered((a) => ({ ...a, [k]: [...(a[k] ?? []), res.correct] }));
              const at = run.cursor.item ?? 0;
              setPips((ps) => {
                const next = [...ps];
                next[at] = res.correct ? "right" : "missed";
                return next;
              });
              const why = res.correct
                ? (current.interaction.feedbackRight ?? current.interaction.why)
                : (res.feedback ?? current.interaction.why);
              setCarry({ correct: res.correct, ...(why ? { text: why } : {}) });
              setFeel(undefined);
              setSession((s) => (s ? { ...s, run: res.run } : s));
              return { correct: res.correct, score: res.score, attempts: res.attemptsOnInteraction, stay: false };
            }}
            aiConfigured={aiConfigured}
            reducedMotion={reducedMotion}
            keysActive
          />
        </div>
      </div>
    ) : (
      <RunLoading />
    );
  } else {
    body = <RunLoading label="Wrapping up…" />;
  }

  // Scope switch: every map by default, or one (?pack=). Offered before the first answer.
  const scopePacks = [...new Map(stops.map(([, s]) => [s.packId, s.packTitle])).entries()];
  const scopeTitle = packId ? (scopePacks.find(([id]) => id === packId)?.[1] ?? packId) : undefined;
  const scope =
    !summary && !carry && (packId || scopePacks.length > 1) ? (
      <nav aria-label="Relight scope" className="mb-4 flex flex-wrap items-center gap-2 text-small" data-relight-scope>
        <span className="text-ink-3">Relighting</span>
        <button
          type="button"
          aria-current={packId ? undefined : "true"}
          className={cn("rounded-pill border px-3 py-0.5", packId ? "border-line text-ink-2" : "border-ink text-ink")}
          onClick={() => void navigate({ to: "/relight", search: {} })}
        >
          All maps
        </button>
        {(packId ? [[packId, scopeTitle ?? packId] as const] : scopePacks).map(([id, title]) => (
          <button
            key={id}
            type="button"
            aria-current={packId === id ? "true" : undefined}
            className={cn(
              "rounded-pill border px-3 py-0.5",
              packId === id ? "border-ink text-ink" : "border-line text-ink-2",
            )}
            onClick={() => void navigate({ to: "/relight", search: { pack: id } })}
          >
            {title}
          </button>
        ))}
      </nav>
    ) : null;

  const strip = (
    <ul className="flex items-center gap-3" aria-label="Cards in this Relight">
      {stops.slice(0, 6).map(([k, s]) => {
        const results = answered[k] ?? [];
        const relit = summary
          ? (summary.relit ?? []).some((r) => stopKey(r.packId, r.nodeId) === k && r.grade >= 2)
          : results.length > 0 && results.filter(Boolean).length * 2 >= results.length;
        return (
          <li
            key={k}
            className="flex items-center gap-1.5 text-small text-ink-2"
            data-stop-glyph={relit ? "lit" : "fading"}
          >
            <motion.span
              key={relit ? "lit" : "fading"}
              initial={reducedMotion ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reducedMotion ? { duration: 0.12 } : { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
              className="inline-flex"
            >
              <StopGlyph
                state={relit ? "lit" : "fading"}
                size={18}
                title={`${s.title}: ${relit ? "relit" : "fading"}`}
              />
            </motion.span>
            <span className="hidden max-w-[12ch] truncate min-[1100px]:inline">{s.title}</span>
          </li>
        );
      })}
      {stops.length > 6 ? <li className="text-small text-ink-3">+ {stops.length - 6}</li> : null}
    </ul>
  );

  return (
    <RunFrame
      title="Relight"
      subtitle={
        !summary && !session.nothingDue && total
          ? `${total} questions · about ${Math.max(2, Math.round(total * 0.6))} minutes`
          : undefined
      }
      backLabel={packId ? "Map" : "Library"}
      onBack={summary || session.nothingDue ? exit : () => void finish().then(exit)}
      actions={!session.nothingDue ? strip : null}
      report={{ screen: "Relight", ...(packId ? { packId } : {}) }}
    >
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-sm border border-ember bg-ember-soft px-3 py-2 text-small text-ember-text"
        >
          {error}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-6">
        <div className="mx-auto flex w-full max-w-[880px] min-w-0 flex-1 flex-col">
          {!session.nothingDue && total > 0 && !summary ? (
            <div className="mb-4 flex items-center gap-3">
              <RelightPips
                results={pipStates}
                {...(current ? { current: Math.min(asked - 1, total - 1) } : {})}
                label={`Question ${Math.min(asked, total)} of ${total}`}
              />
              <span className="text-micro text-ink-3 tabular">
                {Math.min(asked, total)} of {total}
              </span>
            </div>
          ) : null}
          {scope}
          {body}
          {!wide && current && run ? (
            <div className="mt-6 overflow-hidden rounded-md border border-line">
              <CrocPane
                packId={current.ref.packId}
                nodeId={current.ref.nodeId}
                runId={run.id}
                context="relight"
                collapsed
              />
            </div>
          ) : null}
        </div>
        {wide && current && run ? (
          <div className="sticky top-6 h-[min(640px,calc(100dvh-140px))] overflow-hidden rounded-md border border-line">
            <CrocPane packId={current.ref.packId} nodeId={current.ref.nodeId} runId={run.id} context="relight" />
          </div>
        ) : null}
      </div>
    </RunFrame>
  );
}

/**
 * Relight pips: the checkpoint grammar, except a right answer turns Lumen at once (mastery being
 * refreshed). A miss is a dashed ring; ahead is hollow; the current one has a Sea ring.
 */
function RelightPips({ results, current, label }: { results: PipState[]; current?: number; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex items-center gap-2" data-relight-pips>
      {results.map((r, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: pips are positional
          key={i}
          data-pip={r}
          className={cn(
            "size-3.5 rounded-pill transition-[background-color,box-shadow,border-color] duration-base ease-out",
            r === "right" || r === "hinted"
              ? "bg-lumen shadow-[0_0_0_1.5px_var(--lumen-text)]"
              : r === "missed"
                ? "border-[1.5px] border-dashed border-ink-3 bg-surface-sunk"
                : "border-[1.5px] border-ink-3 bg-surface",
            i === current && "shadow-[0_0_0_2px_var(--sea)]",
          )}
        />
      ))}
    </div>
  );
}
