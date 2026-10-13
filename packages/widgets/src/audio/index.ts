/**
 * Audio helper for listen, dialogue and tile-builder: pack audio first, speechSynthesis fallback with voice
 * selection by language, rate control, a graceful "nothing could play" result (show the transcript), and an
 * in-memory recorder for shadowing.
 */
export * from "./play";
export { type RecorderEnv, type RecorderState, recorderSupported, type UseRecorder, useRecorder } from "./recorder";
export { type PhraseStatus, usePhrase } from "./usePhrase";
