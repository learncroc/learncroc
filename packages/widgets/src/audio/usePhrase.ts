/**
 * React hook over the audio helper: play a phrase, track whether it is playing, and remember when nothing
 * could play so the view can show the transcript instead.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { type AudioEnv, type PlaybackResult, type PlayPhraseOptions, play, stopPhrase } from "./play";

export type PhraseStatus = "idle" | "loading" | "playing" | "unavailable";

export function usePhrase(env?: AudioEnv) {
  const [status, setStatus] = useState<PhraseStatus>("idle");
  const [last, setLast] = useState<PlaybackResult | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopPhrase();
    };
  }, []);

  const playIt = useCallback(
    async (opts: PlayPhraseOptions): Promise<PlaybackResult> => {
      const id = ++seq.current;
      setStatus("loading");
      const result = await play(
        {
          ...opts,
          onEnd: () => {
            if (alive.current && seq.current === id) setStatus("idle");
            opts.onEnd?.();
          },
        },
        env,
      );
      if (alive.current && seq.current === id) {
        setLast(result);
        setStatus(result.kind === "none" ? "unavailable" : "playing");
      }
      return result;
    },
    [env],
  );

  const stop = useCallback(() => {
    seq.current++;
    stopPhrase();
    setStatus((s) => (s === "unavailable" ? s : "idle"));
  }, []);

  return { status, last, play: playIt, stop };
}
