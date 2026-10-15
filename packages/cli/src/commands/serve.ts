import { resolveConfig, startServer } from "@learncroc/server";
import open from "open";
import pc from "picocolors";
import { parseArgs } from "../lib/args";
import { cliEnv, runningServer } from "../lib/context";

/**
 * learncroc serve [--port N] [--home DIR] [--dev] [--no-open] — start the local app (the default
 * command): seeds the bundled packs on first run, serves the built web app and opens the browser.
 */
export async function serve(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["port", "home"]);
  const env = cliEnv(argv);
  const bind = resolveConfig(argv).bind;
  const existing = await runningServer(env.home);
  if (existing) {
    console.log(`learncroc is already running at ${pc.cyan(existing.base)}`);
    if (!args.flags.has("no-open")) await open(existing.base).catch(() => {});
    return 0;
  }
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({
      home: env.home,
      port: env.port,
      dev: env.dev,
      test: process.env.LEARNCROC_TEST === "1",
      bind,
      log: (m) => console.log(pc.dim(m)),
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (/EADDRINUSE|in use/i.test(msg)) {
      console.error(`Port ${env.port} (or ${env.port + 1}) is busy. Try: learncroc serve --port ${env.port + 2}`);
      return 1;
    }
    throw e;
  }
  console.log(`learncroc is running at ${pc.cyan(server.url)}  ${pc.dim("(Ctrl+C to stop)")}`);
  if (!args.flags.has("no-open") && !process.env.CI) await open(server.url).catch(() => {});
  await new Promise<void>((resolve) => {
    const stop = () => {
      server.stop();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
