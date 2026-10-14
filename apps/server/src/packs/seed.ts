/**
 * First-run seeding (and app-upgrade refresh): every bundled source pack (packs/<id>/ and
 * packs/_pocket/<slug>/) is compiled and installed as `builtin`. Directory-driven: no list of packs.
 *
 * A bundled pack is (re)installed when it is missing, or when the installed copy came from the
 * bundle and the bundle now carries a newer version or different content. Copies installed from a
 * registry or a file are never overwritten by an older bundle. One broken pack never blocks the rest.
 */
import { compare as semverCompare } from "semver";
import { compilePackDir } from "./compile";
import { discoverSourcePacks, REPO_PACKS_DIR, type SourcePackDir } from "./discover";
import { PackStore } from "./store";

export interface SeedReport {
  installed: string[];
  unchanged: string[];
  errors: { dir: string; message: string }[];
}

export async function seedPacks(
  store: PackStore,
  dirs: SourcePackDir[] = discoverSourcePacks(REPO_PACKS_DIR),
): Promise<SeedReport> {
  const report: SeedReport = { installed: [], unchanged: [], errors: [] };
  for (const d of dirs) {
    try {
      const pack = await compilePackDir(d.dir);
      const { id, version } = pack.manifest;
      const current = store.readInstalled().packs[id];
      const rec = current?.versions[current.active];
      if (current && rec) {
        const cmp = semverCompare(version, current.active);
        if (cmp < 0 || (rec.source !== "builtin" && cmp === 0)) {
          report.unchanged.push(id);
          continue;
        }
        if (cmp === 0 && rec.sha256 === pack.contentHash) {
          report.unchanged.push(id);
          continue;
        }
      }
      store.install(PackStore.filesFromSource(pack, d.dir), {
        source: "builtin",
        registry: "builtin",
        tier: pack.manifest.publisher === "learncroc" ? "official" : "community",
        sha256: pack.contentHash,
      });
      report.installed.push(`${id}@${version}`);
    } catch (e) {
      report.errors.push({ dir: d.dir, message: (e as Error).message });
    }
  }
  return report;
}
