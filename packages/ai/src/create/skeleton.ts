/**
 * Incremental parsing of the streamed skeleton (PLAN §15.5 step 2): each element of nodes[] and
 * edges[] is validated and emitted as soon as it closes, so stops appear on the map while the model
 * is still writing. Ids are normalised, requirements only point at stops already emitted, and any
 * edge that would make a cycle is dropped.
 */
import { HEX_RE, type MinimapSkeleton, NODE_ID_RE } from "@learncroc/core";
import { Allow, parse } from "partial-json";
import { tidyVoice } from "../guards";
import { wouldCycle } from "../layout";
import { SkeletonNodeDraft } from "../schemas";
import { clip, slug } from "../text";

export type SkeletonNode = MinimapSkeleton["nodes"][number];

export type SkeletonUpdate =
  | { kind: "meta"; title: string; gist: string }
  | { kind: "node"; node: SkeletonNode }
  | { kind: "edge"; from: string; to: string };

export class SkeletonStream {
  private emittedNodes = 0;
  private emittedEdges = 0;
  private metaSent = false;
  private readonly idMap = new Map<string, string>();
  private readonly requires = new Map<string, string[]>();
  readonly nodes: SkeletonNode[] = [];
  private title = "";
  private gist = "";
  private palette: string[] = [];
  private readonly edgeKeys = new Set<string>();

  constructor(
    private readonly paraIds: string[],
    private readonly maxNodes: number,
  ) {}

  /** Feed the accumulated JSON text; returns what completed since the last call. */
  push(text: string, final = false): SkeletonUpdate[] {
    let doc: unknown;
    try {
      doc = parse(text, Allow.ALL);
    } catch {
      return [];
    }
    if (!doc || typeof doc !== "object") return [];
    const d = doc as { title?: unknown; gist?: unknown; palette?: unknown; nodes?: unknown; edges?: unknown };
    const out: SkeletonUpdate[] = [];
    const nodesArr = Array.isArray(d.nodes) ? d.nodes : [];
    const nodesClosed = final || "edges" in d;
    if (!this.metaSent && typeof d.title === "string" && typeof d.gist === "string" && (nodesArr.length > 0 || final)) {
      this.title = clip(tidyVoice(d.title), 8).replace(/…$/, "");
      this.gist = clip(tidyVoice(d.gist), 25);
      this.metaSent = true;
      out.push({ kind: "meta", title: this.title, gist: this.gist });
    }
    if (Array.isArray(d.palette)) this.palette = d.palette.filter((c): c is string => typeof c === "string");
    const completeNodes = nodesClosed ? nodesArr.length : Math.max(0, nodesArr.length - 1);
    while (this.emittedNodes < completeNodes) {
      const raw = nodesArr[this.emittedNodes];
      this.emittedNodes++;
      const node = this.acceptNode(raw);
      if (node) {
        out.push({ kind: "node", node });
        for (const r of node.requires) out.push({ kind: "edge", from: r, to: node.id });
      }
    }
    const edgesArr = Array.isArray(d.edges) ? d.edges : [];
    const completeEdges = final ? edgesArr.length : Math.max(0, edgesArr.length - 1);
    while (this.emittedEdges < completeEdges) {
      const e = edgesArr[this.emittedEdges] as { from?: unknown; to?: unknown } | undefined;
      this.emittedEdges++;
      const edge = this.acceptEdge(e?.from, e?.to);
      if (edge) out.push({ kind: "edge", ...edge });
    }
    return out;
  }

  private acceptNode(raw: unknown): SkeletonNode | undefined {
    if (this.nodes.length >= this.maxNodes) return undefined;
    // Providers without strict structured output may leave out the nullable keys.
    const parsed = SkeletonNodeDraft.safeParse(
      raw && typeof raw === "object" ? { hookStyle: null, caution: null, ...raw } : raw,
    );
    if (!parsed.success) return undefined;
    const n = parsed.data;
    let id = slug(n.id || n.title, 32);
    if (!NODE_ID_RE.test(id)) id = `stop-${this.nodes.length + 1}`;
    // cp-<k> is reserved for the checkpoints the pipeline places between sections.
    // "cp-<k>" names checkpoints and "intro" the map's first card.
    if (/^cp-\d+$/.test(id) || id === "intro") id = `${id}-card`;
    for (let i = 2; this.requires.has(id); i++) id = `${slug(n.id || n.title, 28)}-${i}`;
    this.idMap.set(n.id, id);
    const requires = [
      ...new Set(
        n.requires.map((r) => this.idMap.get(r)).filter((r): r is string => !!r && r !== id && this.requires.has(r)),
      ),
    ].slice(0, 4);
    this.requires.set(id, requires);
    const paras = n.paras.filter((p) => this.paraIds.includes(p));
    const misconceptions = n.misconceptions
      .filter((m) => m.label.trim())
      .slice(0, 2)
      .map((m, i) => ({ id: slug(m.id || `m${i + 1}`, 30) || `m${i + 1}`, label: tidyVoice(m.label) }));
    const node: SkeletonNode = {
      id,
      title: clip(tidyVoice(n.title), 4).replace(/…$/, ""),
      ...(n.landmark ? { landmark: clip(tidyVoice(n.landmark), 3).replace(/…$/, "") } : {}),
      objective: tidyVoice(n.objective),
      keyPoints: n.keyPoints.map(tidyVoice).filter(Boolean).slice(0, 3),
      paras: paras.length > 0 ? paras : this.paraIds.slice(0, 1),
      hookIdea: tidyVoice(n.hookIdea),
      ...(n.hookStyle ? { hookStyle: n.hookStyle } : {}),
      misconceptions:
        misconceptions.length > 0 ? misconceptions : [{ id: "m1", label: "It works the other way round" }],
      caution: n.caution ? tidyVoice(n.caution) : null,
      requires,
    };
    if (node.keyPoints.length === 0) node.keyPoints = [node.objective];
    for (const r of requires) this.edgeKeys.add(`${r}>${id}`);
    this.nodes.push(node);
    return node;
  }

  private acceptEdge(fromRaw: unknown, toRaw: unknown): { from: string; to: string } | undefined {
    if (typeof fromRaw !== "string" || typeof toRaw !== "string") return undefined;
    const from = this.idMap.get(fromRaw) ?? (this.requires.has(fromRaw) ? fromRaw : undefined);
    const to = this.idMap.get(toRaw) ?? (this.requires.has(toRaw) ? toRaw : undefined);
    if (!from || !to || from === to) return undefined;
    const key = `${from}>${to}`;
    if (this.edgeKeys.has(key)) return undefined;
    const reqTo = this.requires.get(to) ?? [];
    if (reqTo.length >= 4) return undefined;
    // to requires from: a cycle exists if `from` already (transitively) requires `to`.
    if (wouldCycle(this.requires, from, to)) return undefined;
    this.requires.set(to, [...reqTo, from]);
    const node = this.nodes.find((n) => n.id === to);
    if (node) node.requires = [...node.requires, from];
    this.edgeKeys.add(key);
    return { from, to };
  }

  result(): MinimapSkeleton {
    const palette = this.palette.filter((c) => HEX_RE.test(c)).slice(0, 5);
    return {
      title: this.title || "Article map",
      gist: this.gist,
      renderer: "sketchbook",
      ...(palette.length === 5 ? { palette } : {}),
      nodes: this.nodes,
      edges: this.nodes.flatMap((n) => n.requires.map((r) => ({ from: r, to: n.id }))),
    };
  }
}
