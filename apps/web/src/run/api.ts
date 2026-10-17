/**
 * The slice of the HTTP client the player uses, behind a React context so tests (and the
 * marketplace try-run) can swap the transport. The default is the real typed client.
 */
import type { StartRunBody } from "@learncroc/core";
import { createContext, useContext } from "react";
import { api } from "../api/client";

export type RunApi = Pick<
  typeof api,
  | "getPack"
  | "getPackProgress"
  | "getSettings"
  | "patchSettings"
  | "getAiStatus"
  | "listPacks"
  | "startRun"
  | "getRun"
  | "patchRunScratch"
  | "submitAttempt"
  | "requestHint"
  | "advance"
  | "finishRun"
  | "abandonRun"
  | "startRelight"
  | "registerFrame"
>;

export const RunApiContext = createContext<RunApi>(api);

export function useRunApi(): RunApi {
  return useContext(RunApiContext);
}

type StartRes = Awaited<ReturnType<RunApi["startRun"]>>;

/**
 * POST /runs, de-duplicated while in flight. StrictMode mounts effects twice and the server resumes an
 * open run of the same kind and target anyway, but one request is kinder to the server and the logs.
 */
const inflight = new WeakMap<RunApi, Map<string, Promise<StartRes>>>();

export function startRunOnce(client: RunApi, body: StartRunBody): Promise<StartRes> {
  let byKey = inflight.get(client);
  if (!byKey) {
    byKey = new Map();
    inflight.set(client, byKey);
  }
  const key = JSON.stringify(body);
  const existing = byKey.get(key);
  if (existing) return existing;
  const map = byKey;
  const p = client.startRun(body).finally(() => {
    // Keep the settled promise briefly so the StrictMode re-mount reuses it.
    setTimeout(() => map.delete(key), 0);
  });
  map.set(key, p);
  return p;
}
