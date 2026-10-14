/**
 * Search and data: export (version 2, attachment, with the local numbers), import (versions 1 and 2;
 * a version-1 file goes through core's migrateExportFile first; one zod schema per allowlisted table,
 * parameterised writes; unknown tables rejected; kv keys revision 3 dropped are deleted), and per-pack
 * reset.
 */
import {
  type CompiledPack,
  DEFAULT_SETTINGS,
  ExportFile,
  ExportTables,
  type LocalNumbers,
  migrateExportFile,
  type RouteRes,
} from "@learncroc/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { ServerContext } from "../context";
import { EXPORT_TABLES } from "../db/sqlite-repo";
import { invalid, packParam, readBody, router } from "../http";
import { search } from "../learner/search";
import { getServices } from "../services";

const ResetBody = z.object({ confirm: z.string() });

/** The envelope of an export file of either version; tables and settings are checked after migration. */
const ImportEnvelope = z.object({
  format: z.literal("learncroc-export"),
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string().optional(),
  tables: z.record(z.string(), z.array(z.unknown())),
  settings: z.unknown(),
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Defaults under the imported values, so a version-1 file (no croc, no sound.offered) still parses. */
function withDefaults(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = withDefaults(base[k], v);
  return out;
}

const { keySource: _ks, keyMasked: _km, ...DEFAULT_STORED_AI } = DEFAULT_SETTINGS.ai;
const DEFAULT_STORED = { ...DEFAULT_SETTINGS, ai: DEFAULT_STORED_AI };

export function systemRoutes(ctx: ServerContext): Hono {
  const svc = getServices(ctx);
  const r = router();

  r.get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").slice(0, 200);
    const packs: CompiledPack[] = [];
    for (const s of await svc.packs.list()) {
      if (s.status === "invalid") continue;
      try {
        packs.push(await svc.packs.get(s.id, s.version));
      } catch {
        /* skip packs that vanished mid-request */
      }
    }
    const body: RouteRes<"GET /search"> = await search(q, packs, svc.repo);
    return c.json(body);
  });

  r.get("/export", async (c) => {
    const now = new Date(svc.clock.now());
    let numbers: LocalNumbers | undefined;
    try {
      numbers = await svc.learn.numbers();
    } catch {
      /* the numbers are a courtesy; an export never fails on them */
    }
    const body: RouteRes<"GET /export"> = {
      format: "learncroc-export",
      version: 2,
      exportedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
      tables: await svc.repo.exportTables(),
      settings: svc.settings.stored(),
      ...(numbers ? { numbers } : {}),
    };
    c.header("Content-Disposition", `attachment; filename="learncroc-export-${now.toISOString().slice(0, 10)}.json"`);
    return c.json(body);
  });

  r.post("/import", async (c) => {
    const raw = await readBody(c, z.unknown());
    const env = ImportEnvelope.safeParse(raw);
    if (!env.success) {
      const iss = env.error.issues[0];
      throw invalid(`${iss?.path.length ? `${iss.path.join(".")}: ` : ""}${iss?.message ?? "not an export file"}`);
    }
    const unknownTable = Object.keys(env.data.tables).find((t) => !(EXPORT_TABLES as readonly string[]).includes(t));
    if (unknownTable) throw invalid(`tables.${unknownTable}: unknown table`);
    const envelope = migrateExportFile(raw) as { tables: unknown; settings: unknown };
    const parsedTables = ExportTables.partial().safeParse(envelope.tables);
    if (!parsedTables.success) {
      const iss = parsedTables.error.issues[0];
      throw invalid(`tables.${iss?.path.join(".") ?? ""}: ${iss?.message ?? "invalid rows"}`);
    }
    const parsedSettings = ExportFile.shape.settings.safeParse(withDefaults(DEFAULT_STORED, envelope.settings));
    if (!parsedSettings.success) {
      const iss = parsedSettings.error.issues[0];
      throw invalid(`settings.${iss?.path.join(".") ?? ""}: ${iss?.message ?? "invalid settings"}`);
    }
    const file = { tables: parsedTables.data, settings: parsedSettings.data };
    const tables: ExportTables = {
      node_progress: [],
      card: [],
      review_log: [],
      attempt: [],
      field_note: [],
      generated_item: [],
      run: [],
    };
    for (const t of EXPORT_TABLES) {
      const rows = file.tables[t];
      if (rows) (tables as Record<string, unknown[]>)[t] = rows;
    }
    const counts = await svc.repo.tx(async (repo) => repo.importTables(tables));
    svc.repo.dropLegacyKv();
    try {
      svc.settings.replace(file.settings);
    } catch (e) {
      throw invalid(`settings: ${(e as Error).message}`);
    }
    const body: RouteRes<"POST /import"> = { ok: true, counts };
    return c.json(body);
  });

  r.post("/reset/:packId", async (c) => {
    const packId = packParam(c, "packId");
    const { confirm } = await readBody(c, ResetBody);
    if (confirm !== packId) throw invalid("confirm must equal the pack id");
    await svc.repo.resetPack(packId);
    const body: RouteRes<"POST /reset/:packId"> = { ok: true };
    return c.json(body);
  });

  return r;
}
