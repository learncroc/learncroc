/**
 * Runtime configuration from the environment and CLI flags.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_PORT = 4747;

export interface ServerConfig {
  home: string;
  port: number;
  dev: boolean;
  test: boolean;
  fakeAi: boolean;
  /** Listen address; 127.0.0.1 unless LEARNCROC_BIND is set (containers publish it to the host's loopback). */
  bind: string;
}

export function resolveConfig(
  argv: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const port = Number(value("port") ?? env.LEARNCROC_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65534) throw new Error(`invalid port: ${String(port)}`);
  return {
    home: resolve(value("home") ?? env.LEARNCROC_HOME ?? join(homedir(), ".learncroc")),
    port,
    dev: flag("dev"),
    test: env.LEARNCROC_TEST === "1",
    fakeAi: env.LEARNCROC_FAKE_AI === "1",
    bind: env.LEARNCROC_BIND?.trim() || "127.0.0.1",
  };
}
