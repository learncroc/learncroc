import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import {
  type AudioEnv,
  type AudioLike,
  canSpeak,
  pickVoice,
  play,
  playPhrase,
  type RecorderEnv,
  type UtteranceLike,
  useRecorder,
  type VoiceLike,
} from "../src/audio";

const assetUrl = (p: string) => `/packs/spanish/${p}`;

function fakeAudio(behaviour: "plays" | "rejects" | "errors") {
  const made: { url: string; rate: number; preservesPitch?: boolean }[] = [];
  const env: AudioEnv = {
    createAudio: (url) => {
      const listeners: Record<string, (() => void)[]> = {};
      const a: AudioLike & { rateSeen?: number } = {
        playbackRate: 1,
        preload: "",
        play: async () => {
          made.push({ url, rate: a.playbackRate, preservesPitch: a.preservesPitch });
          if (behaviour === "rejects") throw Object.assign(new Error("blocked"), { name: "NotSupportedError" });
          if (behaviour === "errors") {
            for (const fn of listeners.error ?? []) fn();
            return new Promise(() => {});
          }
        },
        pause: () => {},
        addEventListener: (type, fn) => {
          listeners[type] = [...(listeners[type] ?? []), fn];
        },
      };
      return a;
    },
    timeouts: { audioStart: 50, voices: 20, speechStart: 50 },
  };
  return { env, made };
}

function fakeSpeech(voices: VoiceLike[], fires: "start" | "error" | "nothing" = "start") {
  const spoken: UtteranceLike[] = [];
  return {
    spoken,
    env: {
      speech: {
        getVoices: () => voices,
        speak: (u: UtteranceLike) => {
          spoken.push(u);
          setTimeout(() => {
            if (fires === "start") u.onstart?.();
            if (fires === "error") u.onerror?.({ error: "synthesis-failed" });
          }, 0);
        },
        cancel: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      createUtterance: (text: string): UtteranceLike => ({
        text,
        lang: "",
        rate: 1,
        voice: null,
        onstart: null,
        onend: null,
        onerror: null,
      }),
      timeouts: { audioStart: 50, voices: 20, speechStart: 50 },
    } satisfies AudioEnv,
  };
}

describe("voice selection", () => {
  const voices: VoiceLike[] = [
    { lang: "en-US", name: "Samantha", default: true, localService: true },
    { lang: "es-MX", name: "Paulina", localService: true },
    { lang: "es_ES", name: "Mónica", localService: false },
    { lang: "es-ES", name: "Jorge", localService: true },
  ];
  test("exact language first, local preferred; then the same base language", () => {
    expect(pickVoice(voices, "es-ES")?.name).toBe("Jorge");
    expect(pickVoice(voices, "es-AR")?.name).toBe("Paulina");
    expect(pickVoice(voices, "es")?.name).toBe("Paulina");
    expect(pickVoice(voices, "fr-FR")).toBeUndefined();
    expect(pickVoice([], "es-ES")).toBeUndefined();
  });
});

describe("playback fallbacks", () => {
  test("pack audio plays first, at the chosen rate with pitch kept", async () => {
    const { env, made } = fakeAudio("plays");
    const r = await play(
      { src: "assets/audio/hola.ogg", tts: { text: "Hola", lang: "es-ES" }, rate: 0.7, assetUrl },
      env,
    );
    expect(r.kind).toBe("audio");
    expect(made[0]).toEqual({ url: "/packs/spanish/assets/audio/hola.ogg", rate: 0.7, preservesPitch: true });
  });

  test("Spanish pack audio plays even when the browser has no speech voices", async () => {
    const audio = fakeAudio("plays");
    const speech = fakeSpeech([]);
    const env = { ...speech.env, createAudio: audio.env.createAudio };
    expect(
      await playPhrase({ src: "assets/audio/hola.ogg", tts: { text: "Hola", lang: "es-ES" }, assetUrl }, env),
    ).toBe(true);
    expect(speech.spoken).toHaveLength(0);
  });

  test("a broken or unsupported file falls back to speech in the right voice and rate", async () => {
    for (const behaviour of ["rejects", "errors"] as const) {
      const audio = fakeAudio(behaviour);
      const speech = fakeSpeech([
        { lang: "en-GB", name: "Daniel", default: true },
        { lang: "es-ES", name: "Jorge" },
      ]);
      const r = await play(
        { src: "assets/audio/x.ogg", tts: { text: "¿Más despacio?", lang: "es-ES" }, rate: 0.7, assetUrl },
        { ...speech.env, createAudio: audio.env.createAudio },
      );
      expect(r.kind).toBe("speech");
      expect(speech.spoken[0]?.voice?.name).toBe("Jorge");
      expect(speech.spoken[0]?.rate).toBe(0.7);
      expect(speech.spoken[0]?.lang).toBe("es-ES");
    }
  });

  test("no voice for the language: nothing plays and the caller shows the transcript", async () => {
    const speech = fakeSpeech([{ lang: "en-US", name: "Samantha", default: true }]);
    const r = await play({ tts: { text: "Hola", lang: "es-ES" }, assetUrl }, speech.env);
    expect(r).toEqual({ kind: "none", reason: "no-voice" });
    expect(speech.spoken).toHaveLength(0);
    expect(await canSpeak("es-ES", speech.env)).toBe(false);
    expect(await canSpeak("en", speech.env)).toBe(true);
  });

  test("an engine error or silence counts as not played", async () => {
    for (const fires of ["error", "nothing"] as const) {
      const speech = fakeSpeech([{ lang: "es-ES", name: "Jorge" }], fires);
      expect((await play({ tts: { text: "Hola", lang: "es-ES" }, assetUrl }, speech.env)).kind).toBe("none");
    }
  });

  test("no source, or no speech API at all", async () => {
    expect((await play({ assetUrl }, {})).reason).toBe("no-source");
    expect((await play({ tts: { text: "Hola", lang: "es" }, assetUrl }, {})).reason).toBe("unsupported");
  });
});

describe("recorder", () => {
  function fakeRecorderEnv(getUserMedia: RecorderEnv["getUserMedia"]) {
    const stopped: string[] = [];
    const revoked: string[] = [];
    const env: RecorderEnv = {
      getUserMedia,
      createRecorder: () => {
        const r = {
          state: "inactive",
          mimeType: "audio/webm",
          ondataavailable: null as ((e: { data: Blob }) => void) | null,
          onstop: null as (() => void) | null,
          start() {
            r.state = "recording";
          },
          stop() {
            r.state = "inactive";
            r.ondataavailable?.({ data: new Blob(["voice"], { type: "audio/webm" }) });
            r.onstop?.();
          },
        };
        return r;
      },
      createObjectURL: () => "blob:local-1",
      revokeObjectURL: (u) => revoked.push(u),
    };
    return { env, stopped, revoked };
  }

  test("records into memory, stops the microphone, revokes the blob on reset", async () => {
    const tracks: string[] = [];
    const { env, revoked } = fakeRecorderEnv(async () => ({
      getTracks: () => [{ stop: () => tracks.push("stopped") }],
    }));
    const { result } = renderHook(() => useRecorder(15, env));
    expect(result.current.state).toBe("idle");
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("recording");
    act(() => result.current.stop());
    expect(result.current.state).toBe("recorded");
    expect(result.current.url).toBe("blob:local-1");
    expect(tracks).toEqual(["stopped"]);
    act(() => result.current.reset());
    expect(revoked).toEqual(["blob:local-1"]);
    expect(result.current.url).toBeNull();
  });

  test("permission denied and missing microphone end in calm states", async () => {
    const denied = fakeRecorderEnv(async () => {
      throw Object.assign(new Error("no"), { name: "NotAllowedError" });
    });
    const a = renderHook(() => useRecorder(15, denied.env));
    await act(async () => {
      await a.result.current.start();
    });
    expect(a.result.current.state).toBe("denied");
    const missing = fakeRecorderEnv(async () => {
      throw Object.assign(new Error("no"), { name: "NotFoundError" });
    });
    const b = renderHook(() => useRecorder(15, missing.env));
    await act(async () => {
      await b.result.current.start();
    });
    expect(b.result.current.state).toBe("no-device");
    const c = renderHook(() => useRecorder(15, {}));
    expect(c.result.current.state).toBe("unsupported");
  });
});
