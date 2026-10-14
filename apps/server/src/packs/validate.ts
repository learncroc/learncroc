/**
 * Validation of a compiled pack's file set before it is installed (PLAN §17): pack.json against the
 * schema, id/version regexes, the engine range, every SVG through the safety check, html
 * interactives through the network pre-scan and size caps, and the asset allowlist.
 */
import {
  ASSET_PATH_RE,
  type CompiledPack,
  CompiledPack as CompiledPackSchema,
  LEARNCROC_VERSION,
  PACK_ID_RE,
  SEMVER_RE,
} from "@learncroc/core";
import { scanFrameHtml } from "@learncroc/widgets/sandbox/bridge";
import { satisfies, validRange } from "semver";
import { checkSvg } from "../security/svg";

export type InstallErrorCode = "engine" | "unsafe_asset" | "invalid_pack" | "unsafe_archive";

export class PackValidationError extends Error {
  constructor(
    readonly code: InstallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PackValidationError";
  }
}

export const ASSET_MAX_BYTES = 2 * 1024 * 1024;
export const AUDIO_MAX_TOTAL_BYTES = 10 * 1024 * 1024;

/** Static pre-scan of a pack html interactive (L020), shared with lint and the host. Returns the problems found. */
export function scanHtml(html: Uint8Array | string): string[] {
  const text = typeof html === "string" ? html : new TextDecoder().decode(html);
  return scanFrameHtml(text).map((i) => i.message);
}

export function engineOk(range: string, version = LEARNCROC_VERSION): boolean {
  return validRange(range) !== null && satisfies(version, range, { includePrerelease: true });
}

/** True when any node uses a pack html interactive (the "custom interactive" badge). */
export function usesCustomInteractives(pack: CompiledPack): boolean {
  return JSON.stringify(pack.nodes).includes('"kind":"html"');
}

/**
 * Validate an installable file set (from an .lmpack or a compiled source folder).
 * Returns the parsed pack.
 */
export function validatePackFiles(files: Map<string, Uint8Array>, opts: { expectId?: string } = {}): CompiledPack {
  const raw = files.get("pack.json");
  if (!raw) throw new PackValidationError("invalid_pack", "pack.json missing");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new PackValidationError("invalid_pack", "pack.json is not valid JSON");
  }
  const parsed = CompiledPackSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new PackValidationError("invalid_pack", `pack.json: /${first?.path.join("/") ?? ""} ${first?.message ?? ""}`);
  }
  const pack = parsed.data;
  const { id, version, engine } = pack.manifest;
  if (!PACK_ID_RE.test(id) || !SEMVER_RE.test(version))
    throw new PackValidationError("invalid_pack", "bad id or version");
  if (opts.expectId && id !== opts.expectId)
    throw new PackValidationError("invalid_pack", `archive contains pack "${id}", expected "${opts.expectId}"`);
  if (!engineOk(engine))
    throw new PackValidationError(
      "engine",
      `pack ${id}@${version} needs learncroc ${engine} (this is ${LEARNCROC_VERSION})`,
    );
  let audio = 0;
  for (const [path, data] of files) {
    if (path === "pack.json" || path === "MANIFEST.sha256" || path === "LICENSE" || path === "README.md") continue;
    if (!ASSET_PATH_RE.test(path) || path.split("/").includes(".."))
      throw new PackValidationError("unsafe_archive", `unexpected file ${path}`);
    if (data.byteLength > ASSET_MAX_BYTES) throw new PackValidationError("unsafe_asset", `${path} is larger than 2 MB`);
    if (path.endsWith(".svg")) {
      const v = checkSvg(data);
      if (!v.ok) throw new PackValidationError("unsafe_asset", `${path}: ${v.problems.slice(0, 3).join("; ")}`);
    } else if (path.endsWith(".html")) {
      if (!path.startsWith("assets/interactive/"))
        throw new PackValidationError("unsafe_asset", `${path}: html lives under assets/interactive/`);
      const problems = scanHtml(data);
      if (problems.length) throw new PackValidationError("unsafe_asset", `${path}: ${problems.join("; ")}`);
    } else if (path.endsWith(".mp3") || path.endsWith(".ogg")) {
      audio += data.byteLength;
    }
  }
  if (audio > AUDIO_MAX_TOTAL_BYTES)
    throw new PackValidationError("unsafe_asset", "audio assets exceed 10 MB in total");
  return pack;
}
