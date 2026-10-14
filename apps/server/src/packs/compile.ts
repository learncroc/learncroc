/**
 * Compile a pack source folder (pack.yaml, map.yaml, nodes/, data/) into a
 * CompiledPack with core's compiler over a disk PackFs. Used by first-run seeding, dev packs,
 * `learncroc build-pack`, `registry build` and the builtin registry.
 */
import { promises as fsp } from "node:fs";
import { resolve, sep } from "node:path";
import type { CompiledPack, IsoDate } from "@learncroc/core";
import { compilePack, diskFs, type LoadIssue, type PackFs } from "@learncroc/core/compile/index";

export class PackCompileError extends Error {
  constructor(
    readonly dir: string,
    readonly issues: string[],
    readonly details: LoadIssue[] = [],
  ) {
    super(`pack at ${dir} does not compile:\n  ${issues.slice(0, 12).join("\n  ")}`);
    this.name = "PackCompileError";
  }
}

export interface CompileOptions {
  /** compiledWith.at (ISO 8601) for reproducible builds; default now. */
  at?: IsoDate;
}

export const formatIssue = (i: LoadIssue): string =>
  `${i.file}${i.line !== undefined ? `:${i.line}` : ""}: ${i.path ? `${i.path}: ` : ""}${i.message}`;

/** A disk PackFs rooted at a pack folder. */
export function packFs(dir: string): PackFs {
  return diskFs(fsp, resolve(dir), sep);
}

/** Load, validate and compile a pack source folder. Throws PackCompileError listing every error. */
export async function compilePackDir(dir: string, opts: CompileOptions = {}): Promise<CompiledPack> {
  let result: Awaited<ReturnType<typeof compilePack>>;
  try {
    result = await compilePack(packFs(dir), opts.at ? { at: opts.at } : {});
  } catch (e) {
    throw new PackCompileError(dir, [(e as Error).message]);
  }
  const errors = result.issues.filter((i) => i.severity === "error");
  if (!result.pack || errors.length) {
    const list: LoadIssue[] = errors.length
      ? errors
      : [{ severity: "error", file: "pack.yaml", path: "", message: "does not compile" }];
    throw new PackCompileError(dir, list.map(formatIssue), list);
  }
  return result.pack;
}
