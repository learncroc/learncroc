#!/usr/bin/env bun
/**
 * Dev and `bun run start` entry: bun src/main.ts [--dev] [--port 4747] [--home DIR]
 */
import { resolveConfig } from "./config";
import { startServer } from "./serve";

const config = resolveConfig();
const server = await startServer({
  home: config.home,
  port: config.port,
  dev: config.dev,
  test: config.test,
  bind: config.bind,
  log: (m) => console.log(m),
});
console.log(`learncroc server on ${server.url} (sandbox ${server.sandboxUrl})${config.dev ? " [dev]" : ""}`);
console.log(`home: ${config.home}`);

const shutdown = () => {
  server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
