/**
 * A run session over the API: start (or resume) a run, send attempts, hints, advance and finish, and
 * keep the server-reduced RunState. The client never advances the cursor; it renders `run` as the
 * server returns it. Widget scratch is the only client-written state (debounced PATCH).
 *
 * The RunState lives in the query cache under `runQueryKey(run.id)`, so anything else that changes the
 * run on the server (Moss taking a checkpoint hint) can invalidate it and every view re-renders from the
 * fresh state.
 */
import type {
  AttemptInput,
  AttemptResult,
  CompiledPack,
  Millis,
  RunState,
  RunSummary,
  StartRunBody,
} from "@learncroc/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "../api/errors";
import { startRunOnce, useRunApi } from "./api";
import { runQueryKey } from "./queries";

export type SessionStatus = "idle" | "starting" | "ready" | "error";

export interface RunSession {
  status: SessionStatus;
  error?: string;
  run?: RunState;
  now?: Millis;
  /** The server returned an open run (a reload or a reopen mid-card). */
  resumed: boolean;
  tryPack?: CompiledPack;
  attempt(input: AttemptInput): Promise<AttemptResult>;
  hint(
    interactionId: string,
    answer?: AttemptInput["answer"],
  ): Promise<{ hint: string; level: 1 | 2 | 3; source: "authored" | "ai" }>;
  /** Past a read-only beat (`screen` must equal the cursor's beat). */
  advance(screen: number): Promise<RunState>;
  /** Past a read-only typed card (`card` must equal the cursor's card). */
  advanceCard(card: number): Promise<RunState>;
  finish(): Promise<RunSummary>;
  abandon(): Promise<void>;
  /** Replace the run (a fresh checkpoint attempt, "Guess again", "Restart this card"). */
  restart(body: StartRunBody): Promise<RunState>;
  /** Re-read the run from the server. */
  refresh(): Promise<void>;
  /** Merge scratch for the current interaction(s); persisted with a debounce. */
  saveScratch(scratch: Record<string, unknown>): void;
  /** Start over after a failed start. */
  retry(): void;
}

const SCRATCH_DEBOUNCE_MS = 600;

export function errorText(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.code === "not_found") return "This card isn't in your library any more.";
    if (e.code === "not_implemented") return "The local app doesn't do this yet.";
    return e.message;
  }
  if (e instanceof TypeError) return "Learncroc isn't answering. Your place is saved up to the last answer.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

export function useRunSession(body: StartRunBody | null): RunSession {
  const client = useRunApi();
  const qc = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>(body ? "starting" : "idle");
  const [error, setError] = useState<string>();
  const [runId, setRunId] = useState<string>();
  const [now, setNow] = useState<Millis>();
  const [resumed, setResumed] = useState(false);
  const [tryPack, setTryPack] = useState<CompiledPack>();
  const [attemptNo, setAttemptNo] = useState(0);
  const scratchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScratch = useRef<Record<string, unknown> | null>(null);
  const bodyKey = body ? JSON.stringify(body) : "";

  const q = useQuery({
    queryKey: runQueryKey(runId ?? ""),
    queryFn: async () => (await client.getRun({ runId: runId ?? "" })).run,
    enabled: Boolean(runId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const run = runId ? q.data : undefined;
  const runRef = useRef<RunState | undefined>(undefined);
  runRef.current = run;

  const put = useCallback(
    (r: RunState) => {
      qc.setQueryData(runQueryKey(r.id), r);
      runRef.current = r;
      setRunId(r.id);
    },
    [qc],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: restart only when the start body changes (or on retry)
  useEffect(() => {
    if (!body) return;
    let alive = true;
    setStatus("starting");
    setError(undefined);
    startRunOnce(client, body)
      .then((res) => {
        if (!alive) return;
        put(res.run);
        setNow(res.now);
        setResumed(res.resumed);
        if (res.tryPack) setTryPack(res.tryPack);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(errorText(e));
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [client, bodyKey, attemptNo]);

  const flushScratch = useCallback(() => {
    const r = runRef.current;
    const s = pendingScratch.current;
    if (scratchTimer.current) clearTimeout(scratchTimer.current);
    scratchTimer.current = null;
    pendingScratch.current = null;
    if (!r || !s || r.finishedAt !== undefined) return;
    client.patchRunScratch({ runId: r.id }, { scratch: s }).catch(() => undefined);
  }, [client]);

  useEffect(() => () => flushScratch(), [flushScratch]);

  const saveScratch = useCallback(
    (scratch: Record<string, unknown>) => {
      const r = runRef.current;
      if (!r) return;
      const merged = { ...(r.cursor.scratch ?? {}), ...scratch };
      // Optimistic: scratch is the only client-writable field.
      put({ ...r, cursor: { ...r.cursor, scratch: merged } });
      pendingScratch.current = merged;
      if (scratchTimer.current) clearTimeout(scratchTimer.current);
      scratchTimer.current = setTimeout(flushScratch, SCRATCH_DEBOUNCE_MS);
    },
    [flushScratch, put],
  );

  const requireRun = useCallback((): RunState => {
    const r = runRef.current;
    if (!r) throw new Error("The run hasn't started yet.");
    return r;
  }, []);

  const attempt = useCallback(
    async (input: AttemptInput) => {
      const r = requireRun();
      flushScratch();
      const res = await client.submitAttempt({ runId: r.id }, input);
      put(res.run);
      setNow(res.now);
      return res;
    },
    [client, flushScratch, requireRun, put],
  );

  const hint = useCallback(
    async (interactionId: string, answer?: AttemptInput["answer"]) => {
      const r = requireRun();
      const res = await client.requestHint({ runId: r.id }, { interactionId, ...(answer ? { answer } : {}) });
      put(res.run);
      return { hint: res.hint, level: res.level, source: res.source };
    },
    [client, requireRun, put],
  );

  const advance = useCallback(
    async (screen: number) => {
      const r = requireRun();
      flushScratch();
      const res = await client.advance({ runId: r.id }, { screen });
      put(res.run);
      setNow(res.now);
      return res.run;
    },
    [client, flushScratch, requireRun, put],
  );

  const advanceCard = useCallback(
    async (card: number) => {
      const r = requireRun();
      flushScratch();
      const res = await client.advance({ runId: r.id }, { card });
      put(res.run);
      setNow(res.now);
      return res.run;
    },
    [client, flushScratch, requireRun, put],
  );

  const finish = useCallback(async () => {
    const r = requireRun();
    flushScratch();
    const summary = await client.finishRun({ runId: r.id });
    setNow(summary.now);
    const latest = runRef.current ?? r;
    put({ ...latest, cursor: { ...latest.cursor, phase: "done" }, finishedAt: summary.now });
    return summary;
  }, [client, flushScratch, requireRun, put]);

  const abandon = useCallback(async () => {
    const r = runRef.current;
    if (!r || r.finishedAt !== undefined) return;
    flushScratch();
    await client.abandonRun({ runId: r.id }).catch(() => undefined);
  }, [client, flushScratch]);

  const restart = useCallback(
    async (next: StartRunBody) => {
      const res = await client.startRun(next);
      put(res.run);
      setNow(res.now);
      setResumed(res.resumed);
      if (res.tryPack) setTryPack(res.tryPack);
      setStatus("ready");
      return res.run;
    },
    [client, put],
  );

  const refresh = useCallback(async () => {
    const r = runRef.current;
    if (!r) return;
    const res = await client.getRun({ runId: r.id });
    put(res.run);
    setNow(res.now);
  }, [client, put]);

  const retry = useCallback(() => setAttemptNo((n) => n + 1), []);

  return {
    status,
    ...(error ? { error } : {}),
    ...(run ? { run } : {}),
    ...(now !== undefined ? { now } : {}),
    resumed,
    ...(tryPack ? { tryPack } : {}),
    attempt,
    hint,
    advance,
    advanceCard,
    finish,
    abandon,
    restart,
    refresh,
    saveScratch,
    retry,
  };
}
