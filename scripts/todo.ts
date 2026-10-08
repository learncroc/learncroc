#!/usr/bin/env bun
/**
 * Placeholder for root scripts whose implementation hasn't landed yet. Prints what the script will
 * do and exits 1 so CI never mistakes a placeholder for a pass.
 */
const PLANNED: Record<string, string> = {
  "build:static": "Build the keyless static demo (web app + in-browser API adapter + bundled packs) for GitHub Pages.",
  "lint:packs": "Run `learncroc lint` on every pack under packs/ with its profile.",
  "packs:build": "Compile every pack under packs/ into dist/<id>-<version>.lmpack.",
  "packs:audio": "Render every Spanish phrase to .ogg with Piper (maintainer machines only).",
  "registry:build": "Compile every pack, write .lmpack files, sha256 and registry/index.json.",
  "tokens:check": "Verify the contrast of every design-token pair in packages/ui/src/tokens.css.",
  "new:widget": "Scaffold a core widget (spec, view, tests, gallery entry) or a sandboxed --html interactive.",
  "eval:local": "Run the local-model eval suite against a chosen AI provider.",
  release: "Version with changesets and publish binaries, the npm package, Docker and Pages.",
};
const name = process.argv[2] ?? "(unknown)";
console.error(`"${name}" is not implemented yet. ${PLANNED[name] ?? ""}`.trim());
process.exit(1);
