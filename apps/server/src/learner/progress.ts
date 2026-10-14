/**
 * Library summaries: the pack store's InstalledPackSummary filled with the learner's done/lit/fading
 * counts, finished state, last opened time and suggested next card, from core's packProgress.
 */
import type { InstalledPackSummary } from "@learncroc/core";
import type { Services } from "../services";

export async function enrichSummaries(svc: Services, list: InstalledPackSummary[]): Promise<InstalledPackSummary[]> {
  const out: InstalledPackSummary[] = [];
  for (const s of list) {
    if (s.status === "invalid") {
      out.push(s);
      continue;
    }
    try {
      const p = await svc.learn.packProgress(s.id);
      const views = Object.values(p.views);
      const suggested = views.find((v) => v.suggested)?.id;
      const pack = await svc.packs.get(s.id);
      const isCard = (id: string) => pack.map.nodes[id]?.kind !== "checkpoint";
      out.push({
        ...s,
        done: views.filter((v) => v.state === "done" && isCard(v.id)).length,
        lit: views.filter((v) => v.state === "lit" && isCard(v.id)).length,
        fading: views.filter((v) => v.state === "fading").length,
        finished: p.finished,
        ...(p.finishedAt !== undefined ? { finishedAt: p.finishedAt } : {}),
        ...(p.lastOpenedAt !== undefined ? { lastOpenedAt: p.lastOpenedAt } : {}),
        ...(suggested ? { next: { nodeId: suggested, title: pack.map.nodes[suggested]?.title ?? suggested } } : {}),
      });
    } catch {
      out.push(s);
    }
  }
  return out;
}
