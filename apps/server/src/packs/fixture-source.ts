/**
 * A read-only PackSource serving the hand-compiled fixture pack (tests and the web mock).
 * The running server uses PackStore; see services.ts.
 */
import {
  type CompiledPack,
  CompiledPack as CompiledPackSchema,
  type InstalledPackSummary,
  type PackSource,
} from "@learncroc/core";
import fixture from "@learncroc/core/fixtures/mini-pack/pack.json";
import { PackNotFoundError } from "./store";

export { PackNotFoundError };

export class FixturePackSource implements PackSource {
  private readonly pack: CompiledPack = CompiledPackSchema.parse(fixture);

  async list(): Promise<InstalledPackSummary[]> {
    const { manifest, map, stats } = this.pack;
    const start = manifest.entry.suggestedStart ?? map.topo[0];
    return [
      {
        id: manifest.id,
        version: manifest.version,
        title: manifest.title,
        ...(manifest.subtitle ? { subtitle: manifest.subtitle } : {}),
        category: manifest.category,
        theme: manifest.theme,
        tier: "official",
        kind: manifest.private ? "pocket" : "pack",
        profile: manifest.profile,
        review: manifest.status,
        customInteractives: false,
        nodes: stats.nodes,
        playable: stats.playable - stats.checkpoints,
        checkpoints: stats.checkpoints,
        done: 0,
        lit: 0,
        fading: 0,
        finished: false,
        ...(start ? { next: { nodeId: start, title: map.nodes[start]?.title ?? start } } : {}),
        status: "ok",
      },
    ];
  }

  async get(id: string): Promise<CompiledPack> {
    if (id !== this.pack.manifest.id) throw new PackNotFoundError(id);
    return this.pack;
  }
}
