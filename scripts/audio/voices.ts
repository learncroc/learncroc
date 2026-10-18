/**
 * Piper voices used to pre-render pack audio, keyed by BCP-47 language tag.
 *
 * Voice models are open (rhasspy/piper-voices on Hugging Face) and live only on the maintainer's machine;
 * they are never a runtime dependency. Changing a voice (model, speaker or tuning) changes its `id`,
 * which renames every file, so the next render replaces the old audio cleanly.
 */

export interface VoiceConfig {
  /** Stable id hashed into every file name. Bump the suffix when tuning changes the sound. */
  id: string;
  /** Piper model name; the files are <model>.onnx and <model>.onnx.json in the voices directory. */
  model: string;
  /** Speaker name (looked up in the model's speaker_id_map) or numeric id, for multi-speaker models. */
  speaker?: string | number;
  /** > 1 is slower. Learners get 0.7x playback in the widgets, so render at natural speed. */
  lengthScale?: number;
  /** Seconds of silence between sentences. */
  sentenceSilence?: number;
  /** Where a maintainer downloads the model and its config. */
  source: { onnx: string; config: string; license: string };
}

const HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

/** Castilian Spanish, female speaker: Lola's voice and the default for every es-ES phrase. */
const ES_ES: VoiceConfig = {
  id: "piper-es_ES-sharvard-medium-F-v1",
  model: "es_ES-sharvard-medium",
  speaker: "F",
  lengthScale: 1,
  sentenceSilence: 0.25,
  source: {
    onnx: `${HF}/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx`,
    config: `${HF}/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json`,
    license: "See MODEL_CARD in the voice folder (rhasspy/piper-voices)",
  },
};

export const VOICES: Readonly<Record<string, VoiceConfig>> = {
  "es-ES": ES_ES,
};

/**
 * The voice for a language tag: exact match first ("es-ES"), then the first voice whose primary subtag
 * matches ("es" → "es-ES"). Languages without a voice keep the browser's speech fallback.
 */
export function voiceFor(lang: string): VoiceConfig | undefined {
  const exact = Object.entries(VOICES).find(([tag]) => tag.toLowerCase() === lang.toLowerCase());
  if (exact) return exact[1];
  const primary = lang.split("-")[0]?.toLowerCase();
  return Object.entries(VOICES).find(([tag]) => tag.split("-")[0]?.toLowerCase() === primary)?.[1];
}

/**
 * Resolve a speaker name to Piper's numeric id using the model config's speaker_id_map.
 * Returns undefined for single-speaker models (no map) when no speaker is configured.
 */
export function resolveSpeaker(voice: VoiceConfig, modelConfig: unknown): number | undefined {
  if (voice.speaker === undefined) return undefined;
  if (typeof voice.speaker === "number") return voice.speaker;
  const map =
    modelConfig && typeof modelConfig === "object" && "speaker_id_map" in modelConfig
      ? (modelConfig as { speaker_id_map?: Record<string, number> }).speaker_id_map
      : undefined;
  const id = map?.[voice.speaker];
  if (id === undefined) {
    const known = map ? Object.keys(map).join(", ") : "none (single-speaker model)";
    throw new Error(`voice ${voice.model}: speaker "${voice.speaker}" not in speaker_id_map (known: ${known})`);
  }
  return id;
}
