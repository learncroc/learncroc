#!/usr/bin/env bun
/** `bun run tokens:check`: verify the contrast of every design-token pair in src/tokens.css. Exits 1 on a failure. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkTokens } from "../src/tokens-check";

const css = readFileSync(join(import.meta.dir, "../src/tokens.css"), "utf8");
const results = checkTokens(css);
const failed = results.filter((r) => !r.ok);
const verbose = process.argv.includes("--verbose");
for (const r of verbose ? results : failed) {
  const mark = r.ok ? "ok  " : "FAIL";
  console.log(
    `${mark} ${r.theme.padEnd(5)} --${r.fg} on --${r.bg}: ${r.ratio.toFixed(2)}:1 (needs ${r.min}:1, ${r.kind}: ${r.use})`,
  );
}
console.log(`${results.length - failed.length}/${results.length} token pairs pass.`);
process.exit(failed.length ? 1 : 0);
