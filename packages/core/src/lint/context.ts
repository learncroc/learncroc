/**
 * Shared lint plumbing: the context every rule receives, and walkers over a card's interactions
 * and widget references (with their JSON paths).
 */
import type { PackFs } from "../compile/fs";
import type { PackSources } from "../compile/load";
import type { WidgetSpecRegistry } from "../ports";
import type {
  CompiledPack,
  FallbackInteraction,
  HookInteraction,
  Interaction,
  Item,
  LintIssue,
  LintProfile,
  MapFile,
  PackManifest,
  PackNode,
  Screen,
  VisualState,
  WidgetRef,
} from "../schema/index";
import { type ProfileRules, RULES, type RuleId } from "./rules";

export interface LintContext {
  sources: PackSources;
  /** The compiled pack, when the sources compiled (generated flashcards and audio filled). */
  pack?: CompiledPack;
  manifest: PackManifest;
  map: MapFile;
  profile: LintProfile;
  rules: ProfileRules;
  lang: string;
  widgets?: WidgetSpecRegistry;
  fs: PackFs;
  sanitizeSvg?: (svg: string) => string;
  issues: LintIssue[];
}

export type Path = readonly (string | number)[] | string;

const toPointer = (p: Path) =>
  typeof p === "string"
    ? p
    : p.length
      ? `/${p.map((k) => String(k).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`
      : "";

/** Record an issue (severity null = the rule is off for this profile). */
export function emit(
  ctx: Pick<LintContext, "issues">,
  rule: RuleId,
  severity: "error" | "warn" | null,
  file: string,
  path: Path,
  message: string,
  opts: { fixable?: boolean; example?: string } = {},
): void {
  if (!severity) return;
  const info = RULES[rule];
  ctx.issues.push({
    rule,
    severity,
    file,
    path: toPointer(path),
    message,
    why: info.why,
    example: opts.example ?? info.example,
    fixable: opts.fixable ?? false,
  });
}

export type AnyInteraction = Interaction | FallbackInteraction | HookInteraction | Item;

export interface InteractionRef {
  ix: AnyInteraction;
  path: (string | number)[];
  where: "hook" | "screen" | "item" | "fallback" | "offline";
  screen?: Screen;
  item?: Item;
}

/** Every interaction in a card (the hook, beat actions, items, nested fallbacks). Read-only beats have none. */
export function nodeInteractions(node: PackNode): InteractionRef[] {
  const out: InteractionRef[] = [];
  const add = (r: InteractionRef) => {
    out.push(r);
    const ix = r.ix;
    if (ix.kind === "widget" || ix.kind === "html")
      out.push({
        ix: ix.fallback,
        path: [...r.path, "fallback"],
        where: "fallback",
        ...(r.screen ? { screen: r.screen } : {}),
      });
    if (ix.kind === "explain")
      out.push({
        ix: ix.offline,
        path: [...r.path, "offline"],
        where: "offline",
        ...(r.screen ? { screen: r.screen } : {}),
      });
  };
  add({ ix: node.hook.interaction, path: ["hook", "interaction"], where: "hook" });
  node.screens.forEach((s, i) => {
    if (s.interaction) add({ ix: s.interaction, path: ["screens", i, "interaction"], where: "screen", screen: s });
  });
  node.items.forEach((item, i) => {
    add({ ix: item, path: ["items", i], where: "item", item });
  });
  return out;
}

export interface WidgetUse {
  ref: WidgetRef;
  path: (string | number)[];
  /** Graded uses need a goal and a solution that grades correct. */
  graded: boolean;
  solution?: unknown;
  /** VisualStates merged into this canvas (reveal, choice options). */
  states: { state: VisualState; path: (string | number)[] }[];
}

/** The widget canvas of a beat: its widget interaction, its own widget visual, or the card's. */
export function screenCanvas(node: PackNode, s: Screen): { ref: WidgetRef; path: (string | number)[] } | undefined {
  const i = node.screens.indexOf(s);
  if (s.interaction?.kind === "widget")
    return { ref: s.interaction.widget, path: ["screens", i, "interaction", "widget"] };
  if (s.interaction?.kind === "html") return undefined;
  if (s.visual?.kind === "widget") return { ref: s.visual.widget, path: ["screens", i, "visual", "widget"] };
  if (!s.visual && node.visual?.kind === "widget") return { ref: node.visual.widget, path: ["visual", "widget"] };
  return undefined;
}

/** Every widget reference in a node, with the visual states that act on it. */
export function nodeWidgets(node: PackNode): WidgetUse[] {
  const out: WidgetUse[] = [];
  const byPath = new Map<string, WidgetUse>();
  const add = (u: WidgetUse) => {
    const key = u.path.join("/");
    const prev = byPath.get(key);
    if (prev) {
      prev.states.push(...u.states);
      return;
    }
    byPath.set(key, u);
    out.push(u);
  };
  if (node.visual?.kind === "widget")
    add({ ref: node.visual.widget, path: ["visual", "widget"], graded: false, states: [] });
  const h = node.hook;
  if (h.visual?.kind === "widget")
    add({ ref: h.visual.widget, path: ["hook", "visual", "widget"], graded: false, states: [] });
  if (h.interaction.kind === "widget")
    add({
      ref: h.interaction.widget,
      path: ["hook", "interaction", "widget"],
      graded: true,
      solution: h.interaction.solution,
      states: [],
    });
  node.screens.forEach((s, i) => {
    if (s.visual?.kind === "widget")
      add({ ref: s.visual.widget, path: ["screens", i, "visual", "widget"], graded: false, states: [] });
    if (s.interaction?.kind === "widget")
      add({
        ref: s.interaction.widget,
        path: ["screens", i, "interaction", "widget"],
        graded: true,
        solution: s.interaction.solution,
        states: [],
      });
    const canvas = screenCanvas(node, s);
    if (!canvas) return;
    const states: WidgetUse["states"] = [];
    if (s.reveal?.visualState)
      states.push({ state: s.reveal.visualState, path: ["screens", i, "reveal", "visualState"] });
    if (s.interaction?.kind === "choice")
      s.interaction.options.forEach((o, j) => {
        if (o.visualState)
          states.push({ state: o.visualState, path: ["screens", i, "interaction", "options", j, "visualState"] });
      });
    add({
      ref: canvas.ref,
      path: canvas.path,
      graded: canvas.ref === (s.interaction as { widget?: unknown } | undefined)?.widget,
      states,
    });
  });
  node.items.forEach((item, i) => {
    if (item.kind === "widget")
      add({ ref: item.widget, path: ["items", i, "widget"], graded: true, solution: item.solution, states: [] });
  });
  if (node.toy) add({ ref: node.toy.widget, path: ["toy", "widget"], graded: false, states: [] });
  return out;
}
