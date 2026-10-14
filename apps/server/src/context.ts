/**
 * What every router receives. Built once by createApp().
 */
import type { AiPorts, Clock, PackSource } from "@learncroc/core";
import type { FrameStore } from "./sandbox/listener";

export interface ServerContext {
  /** LEARNCROC_HOME (default ~/.learncroc). */
  home: string;
  /** Main port (default 4747); the sandbox origin listens on port + 1. */
  port: number;
  /** --dev: also accept the Vite dev server's Host (localhost:5173 / 127.0.0.1:5173). */
  dev: boolean;
  /** LEARNCROC_TEST=1: enables POST /api/_test/clock. */
  test: boolean;
  ai: AiPorts;
  packs: PackSource;
  clock: Clock;
  /** The sandbox origin's one-time documents (POST /api/frames registers, the listener serves). */
  frames?: FrameStore;
}
