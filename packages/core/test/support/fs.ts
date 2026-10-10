import * as fsp from "node:fs/promises";
import { join } from "node:path";
import { diskFs, type PackFs } from "../../src/compile/index";

export const MINI_PACK_DIR = join(import.meta.dir, "../../fixtures/mini-pack");

/** A disk-backed PackFs for a fixture directory. */
export function fixtureFs(dir = MINI_PACK_DIR): PackFs {
  return diskFs(fsp as unknown as Parameters<typeof diskFs>[0], dir);
}
