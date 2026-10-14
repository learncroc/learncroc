/**
 * The learner's home directory (~/.learncroc):
 *
 *   config.json        settings + AI key (0600)
 *   installed.json     install records (atomic writes)
 *   learncroc.db       SQLite (WAL), all learner data
 *   packs/<id>@<ver>/  installed compiled packs: pack.json, assets/, MANIFEST.sha256, LICENSE, README.md
 *   packs/local/<id>@<ver>/  pocket maps
 *   cache/registry/    last fetched registry indexes
 *   cache/downloads/   verified .lmpack files
 *   .staging/          extraction staging (renamed into packs/ when valid)
 *   .session           the running server's session token (0600; lets the CLI talk to it)
 *   .lock              one-writer lock when no server runs
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function homePaths(home: string) {
  return {
    root: home,
    config: join(home, "config.json"),
    installed: join(home, "installed.json"),
    packs: join(home, "packs"),
    localPacks: join(home, "packs", "local"),
    db: join(home, "learncroc.db"),
    lock: join(home, ".lock"),
    session: join(home, ".session"),
    staging: join(home, ".staging"),
    cache: join(home, "cache"),
    registryCache: join(home, "cache", "registry"),
    downloads: join(home, "cache", "downloads"),
  };
}

/** Create the home directory layout if missing. */
export function ensureHome(home: string): ReturnType<typeof homePaths> {
  const p = homePaths(home);
  mkdirSync(p.packs, { recursive: true });
  mkdirSync(p.localPacks, { recursive: true });
  mkdirSync(p.staging, { recursive: true });
  mkdirSync(p.registryCache, { recursive: true });
  mkdirSync(p.downloads, { recursive: true });
  return p;
}
