/**
 * Source-pack discovery for dev mode and first-run seeding.
 *
 * Seeding is directory-driven: every folder under packs/ that has a pack.yaml is a bundled pack
 * (full packs and samplers alike), plus every folder under packs/_pocket/ (the article-map gallery).
 * Nothing here hard-codes pack ids, so adding a pack folder is enough to ship it.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface SourcePackDir {
  /** Folder name (the pack id by convention). */
  name: string;
  dir: string;
  kind: "pack" | "pocket";
}

/** The repo's packs/ folder (dev and bundled builds). */
export const REPO_PACKS_DIR = resolve(import.meta.dir, "../../../../packs");

export function discoverSourcePacks(packsDir: string = REPO_PACKS_DIR): SourcePackDir[] {
  if (!existsSync(packsDir)) return [];
  const out: SourcePackDir[] = [];
  for (const name of readdirSync(packsDir).sort()) {
    const dir = join(packsDir, name);
    if (!statSync(dir).isDirectory()) continue;
    if (name === "_pocket") {
      for (const sub of readdirSync(dir).sort()) {
        const d = join(dir, sub);
        if (statSync(d).isDirectory() && existsSync(join(d, "pack.yaml")))
          out.push({ name: sub, dir: d, kind: "pocket" });
      }
      continue;
    }
    if (name.startsWith(".") || name.startsWith("_")) continue;
    if (existsSync(join(dir, "pack.yaml"))) out.push({ name, dir, kind: "pack" });
  }
  return out;
}
