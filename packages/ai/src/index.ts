/**
 * @learncroc/ai — providers and presets, prompts, guards, pipelines, the spend meter, the fake
 * provider and the AiPorts implementation handed to createServer.
 *
 * Server: `createServer({ home, port, ai: createAiRuntime({ home }) })`. The runtime implements
 * AiPorts and also serves the /api/ai/*, /api/create and /api/jobs routes.
 */
import { PROVIDER_PRESETS } from "@learncroc/core";

export { parseCheck, parseShow, runAsk, ThreadStore } from "./ask";
export { type BuildFs, type BuildOptions, type BuildResult, buildPack, planToMap } from "./build/author";
export { AiClient, type AiClientEnv, type CallOptions, type SentRecord } from "./client";
export { type AiConfigSource, FileAiConfig, maskKey, StaticAiConfig } from "./config";
export { buildAskContext, findInteraction, interactionText } from "./context";
export { assembleCard, assembleStop, type CardContext, learnerWords, setTeaser } from "./create/card";
export { type Article, extractFromHtml, extractFromText, MAX_ARTICLE_WORDS, MIN_ARTICLE_WORDS } from "./create/extract";
export { FetchRefused, fetchArticle, guardUrl, isPrivateAddress } from "./create/fetch";
export { checkFigure } from "./create/figure";
export { type Job, JobManager } from "./create/jobs";
export { buildPocketPack, newPocketId, placeCheckpoints, pocketDir, pocketLines } from "./create/pack";
export { type CreateJobDeps, runCreateJob } from "./create/pipeline";
export { SkeletonStream } from "./create/skeleton";
export { checkToyStatic, type ToyValidation, ToyValidator } from "./create/toy";
export { AiError, isAiError, redact, toAiError } from "./errors";
export { type AskMode, decideAskMode, type GateDecision } from "./gate";
export * from "./guards";
export { CELL, layoutMap, topoOrder } from "./layout";
export {
  capApplies,
  DEFAULT_OLLAMA_URL,
  modelFor,
  presetModels,
  RECOMMENDED_LOCAL,
  suggestLocalModels,
} from "./models";
export { aiPortsFor, createAiPorts } from "./ports";
export { isPromptId, PROMPT_IDS, type PromptFile, type PromptId, printablePrompt, prompt, render } from "./prompts";
export * from "./providers/index";
export { type AiRequestDeps, AiRuntime, type AiRuntimeOptions, createAiRuntime, isAiRuntime } from "./runtime";
export type { AIProvider, ObjectRequest, TextRequest } from "./types";
export { monthOf, priceUsage, UsageMeter } from "./usage";
export { PROVIDER_PRESETS };

/** True when LEARNCROC_FAKE_AI=1 (tests and e2e use the deterministic fake provider). */
export function fakeAiEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LEARNCROC_FAKE_AI === "1";
}
