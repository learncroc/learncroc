/**
 * Following a create job: the SSE stream (reconnects replay every event, so state is rebuilt from
 * scratch) and the article paragraphs for the reader pane.
 */
import type { JobEvent } from "@learncroc/core";
import { useEffect, useReducer, useRef, useState } from "react";
import { API_BASE, api } from "../../api/client";
import { ApiClientError } from "../../api/errors";
import { initialSurvey, type SurveyState, surveyReducer } from "./survey";

type Action = { type: "reset" } | { type: "event"; event: JobEvent };

function reducer(s: SurveyState, a: Action): SurveyState {
  return a.type === "reset" ? initialSurvey() : surveyReducer(s, a.event);
}

export interface JobFollow {
  state: SurveyState;
  /** The job no longer exists on the server (restarted, or finished long ago). */
  gone: boolean;
  connected: boolean;
}

export function useJobEvents(jobId: string, onEvent?: (e: JobEvent) => void): JobFollow {
  const [state, dispatch] = useReducer(reducer, undefined, initialSurvey);
  const [gone, setGone] = useState(false);
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    const ctl = new AbortController();
    let attempt = 0;
    let finished = false;
    const loop = async () => {
      while (!ctl.signal.aborted && !finished) {
        dispatch({ type: "reset" });
        try {
          setConnected(true);
          for await (const e of api.jobEvents({ jobId }, { signal: ctl.signal })) {
            attempt = 0;
            dispatch({ type: "event", event: e });
            cb.current?.(e);
            if (e.type === "done" || e.type === "error") finished = true;
          }
          if (finished) return;
        } catch (e) {
          if (ctl.signal.aborted) return;
          if (e instanceof ApiClientError && e.status === 404) {
            setGone(true);
            return;
          }
        } finally {
          setConnected(false);
        }
        attempt++;
        await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt)));
      }
    };
    void loop();
    return () => ctl.abort();
  }, [jobId]);

  return { state, gone, connected };
}

export interface ArticleParas {
  /** The article map being built (lets a fresh tab follow the job). */
  packId?: string;
  title: string;
  site?: string;
  paragraphs: { id: string; text: string; heading?: string }[];
}

/** The extracted paragraphs, kept on the server only while the job runs. */
export async function fetchArticle(jobId: string, signal?: AbortSignal): Promise<ArticleParas | null> {
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/article`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) return null;
  return (await res.json()) as ArticleParas;
}

/** packId per job, so the building view can link to cards before the job is done. */
export function rememberJob(jobId: string, packId: string): void {
  try {
    sessionStorage.setItem(`lm:job:${jobId}`, packId);
  } catch {
    /* private mode */
  }
}
export function recallJob(jobId: string): string | undefined {
  try {
    return sessionStorage.getItem(`lm:job:${jobId}`) ?? undefined;
  } catch {
    return undefined;
  }
}
