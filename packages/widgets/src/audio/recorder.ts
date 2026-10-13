/**
 * In-memory voice recorder for listen's shadow task. MediaRecorder + getUserMedia; the recording lives in a
 * blob URL in this tab only. Nothing is uploaded, stored or sent anywhere, and the URL is revoked on reset
 * and unmount. Permission problems end in a calm state the view can explain.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState =
  | "idle"
  | "requesting"
  | "recording"
  | "recorded"
  | "denied"
  | "no-device"
  | "unsupported"
  | "error";

interface RecorderLike {
  state: string;
  start(): void;
  stop(): void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror?: (() => void) | null;
  mimeType?: string;
}

interface StreamLike {
  getTracks(): { stop(): void }[];
}

export interface RecorderEnv {
  getUserMedia?: (constraints: { audio: boolean }) => Promise<StreamLike>;
  createRecorder?: (stream: StreamLike) => RecorderLike;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

function browserRecorderEnv(): RecorderEnv {
  const g = globalThis as unknown as {
    navigator?: { mediaDevices?: { getUserMedia?: (c: { audio: boolean }) => Promise<StreamLike> } };
    MediaRecorder?: new (s: StreamLike) => RecorderLike;
    URL?: { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
  };
  const md = g.navigator?.mediaDevices;
  const MR = g.MediaRecorder;
  return {
    getUserMedia: md?.getUserMedia
      ? (c) => (md.getUserMedia as (c: { audio: boolean }) => Promise<StreamLike>).call(md, c)
      : undefined,
    createRecorder: MR ? (s) => new MR(s) : undefined,
    createObjectURL: g.URL?.createObjectURL?.bind(g.URL),
    revokeObjectURL: g.URL?.revokeObjectURL?.bind(g.URL),
  };
}

/** Does this browser offer microphone recording at all? */
export function recorderSupported(env: RecorderEnv = browserRecorderEnv()): boolean {
  return Boolean(env.getUserMedia && env.createRecorder && env.createObjectURL);
}

function classify(err: unknown): RecorderState {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError")
    return "no-device";
  return "error";
}

export interface UseRecorder {
  state: RecorderState;
  /** Blob URL of the last recording (in memory only). */
  url: string | null;
  /** Seconds recorded so far (while recording) or in total. */
  seconds: number;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

/** React hook around one in-memory recording; auto-stops after `maxSeconds`. */
export function useRecorder(maxSeconds = 15, env?: RecorderEnv): UseRecorder {
  const envRef = useRef(env ?? browserRecorderEnv());
  const [state, setState] = useState<RecorderState>(() => (recorderSupported(envRef.current) ? "idle" : "unsupported"));
  const [url, setUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<RecorderLike | null>(null);
  const streamRef = useRef<StreamLike | null>(null);
  const urlRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  const releaseStream = useCallback(() => {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const revoke = useCallback(() => {
    if (urlRef.current) envRef.current.revokeObjectURL?.(urlRef.current);
    urlRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    const e = envRef.current;
    if (!recorderSupported(e)) {
      setState("unsupported");
      return;
    }
    setState("requesting");
    let stream: StreamLike;
    try {
      stream = await (e.getUserMedia as NonNullable<RecorderEnv["getUserMedia"]>)({ audio: true });
    } catch (err) {
      setState(classify(err));
      return;
    }
    streamRef.current = stream;
    let rec: RecorderLike;
    try {
      rec = (e.createRecorder as NonNullable<RecorderEnv["createRecorder"]>)(stream);
    } catch {
      releaseStream();
      setState("error");
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };
    rec.onstop = () => {
      releaseStream();
      revoke();
      if (chunks.length === 0) {
        setState("error");
        return;
      }
      const blob = new Blob(chunks, { type: rec.mimeType || chunks[0]?.type || "audio/webm" });
      const u = (e.createObjectURL as NonNullable<RecorderEnv["createObjectURL"]>)(blob);
      urlRef.current = u;
      setUrl(u);
      setSeconds(Math.round((Date.now() - startedAt.current) / 100) / 10);
      setState("recorded");
    };
    rec.onerror = () => {
      releaseStream();
      setState("error");
    };
    recRef.current = rec;
    startedAt.current = Date.now();
    setSeconds(0);
    rec.start();
    setState("recording");
    timerRef.current = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setSeconds(Math.floor(s));
      if (s >= maxSeconds) stop();
    }, 250);
  }, [maxSeconds, releaseStream, revoke, stop]);

  const reset = useCallback(() => {
    stop();
    releaseStream();
    revoke();
    setUrl(null);
    setSeconds(0);
    setState(recorderSupported(envRef.current) ? "idle" : "unsupported");
  }, [releaseStream, revoke, stop]);

  // Never leave the microphone on or a blob behind.
  useEffect(
    () => () => {
      const rec = recRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        rec.stop();
      }
      releaseStream();
      revoke();
    },
    [releaseStream, revoke],
  );

  return { state, url, seconds, start, stop, reset };
}
