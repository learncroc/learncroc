/**
 * The Spanish pack graded by the real graders: core `gradeInteraction` for built-in kinds and the
 * widget specs for listen and dialogue. Checks the promises the pack makes to learners:
 *
 * - typed Spanish without accents is accepted everywhere, and core-graded answers add a gentle
 *   "Mind the accents" note (core accepts accent slips only when `accents` is not normalised away);
 * - every authored onWrong key is one the grader actually consults, and routes to its misconception.
 */
import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { type AnswerValue, type Gradable, gradeInteraction, type PackNode, stripAccents } from "@learncroc/core";
import { matchText, TYPED_DEFAULT } from "@learncroc/widgets/dialogue/text";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import { loadPack } from "./pack-rules";

const root = resolve(import.meta.dir, "..", "..", "..");
const ctx = { widgets: widgetSpecRegistry, lang: "es-ES" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

interface Found {
  where: string;
  ix: Gradable;
}

/** Every gradable interaction in a card: hook, beat actions, items, plus fallbacks and offline forms. */
function interactionsOf(id: string, node: PackNode): Found[] {
  const out: Found[] = [];
  const add = (where: string, ix: Gradable | undefined) => {
    if (!ix) return;
    out.push({ where, ix });
    if (ix.kind === "widget" || ix.kind === "html") add(`${where} fallback`, ix.fallback as Gradable);
    if (ix.kind === "explain") add(`${where} offline`, ix.offline as Gradable);
  };
  add(`${id} hook`, node.hook.interaction as Gradable);
  for (const s of node.screens) add(`${id} ${s.id}`, s.interaction as Gradable | undefined);
  for (const it of node.items) add(`${id} ${it.id}`, it as Gradable);
  return out;
}

/** Widget refs anywhere in the pack (beats, items, toys). */
function widgetRefs(spanish: ReturnType<typeof loadPack>): { where: string; id: string; props: Obj; goal?: Obj }[] {
  const out: { where: string; id: string; props: Obj; goal?: Obj }[] = [];
  const walk = (v: unknown, where: string) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        walk(x, `${where}/${i}`);
      });
      return;
    }
    if (!isObj(v)) return;
    if (typeof v.id === "string" && isObj(v.props) && "v" in v)
      out.push({ where, id: v.id, props: v.props, ...(isObj(v.goal) ? { goal: v.goal } : {}) });
    for (const [k, x] of Object.entries(v)) walk(x, `${where}/${k}`);
  };
  for (const [id, n] of spanish.nodes) walk(n, id);
  return out;
}

// Restored by the content-spanish-tapas-bar package once the pack is converted to cards (its beats parse).
describe.skip("spanish-tapas-bar grading", () => {
  const spanish = loadPack(join(root, "packs", "spanish-tapas-bar"));
  const all: Found[] = [...spanish.nodes].flatMap(([id, n]) => interactionsOf(id, n));

  describe("spanish-tapas-bar: accent-tolerant production", () => {
    const typed = all.filter(
      (f) => (f.ix.kind === "text" && (f.ix.lang ?? "es-ES") === "es-ES") || f.ix.kind === "cloze",
    );

    test("there are typed Spanish answers to check", () => {
      expect(typed.length).toBeGreaterThan(60);
    });

    test("typing without accents is accepted, with a gentle note when an accent was dropped", () => {
      const problems: string[] = [];
      for (const { where, ix } of typed) {
        let answer: AnswerValue;
        let slipped = false;
        if (ix.kind === "text") {
          const want = ix.accept[0] ?? "";
          slipped = stripAccents(want) !== want;
          answer = { kind: "text", value: stripAccents(want) };
        } else if (ix.kind === "cloze") {
          const values: Record<string, string> = {};
          for (const [k, b] of Object.entries(ix.blanks)) {
            const want = b.accept[0] ?? "";
            if (stripAccents(want) !== want) slipped = true;
            values[k] = stripAccents(want);
          }
          answer = { kind: "cloze", values };
        } else continue;
        const r = gradeInteraction(ix, answer, ctx);
        if (!r.correct) problems.push(`${where}: accent-free answer rejected`);
        else if (slipped && !/accents/i.test(r.feedback ?? "")) problems.push(`${where}: no accent note`);
      }
      expect(problems).toEqual([]);
    });

    test("listen and dialogue typing accept accent-free answers", () => {
      const problems: string[] = [];
      const listen = widgetSpecRegistry.get("listen");
      for (const ref of widgetRefs(spanish)) {
        if (ref.id === "listen" && ref.goal?.kind === "type") {
          const want = (ref.goal.accept as string[])[0] ?? "";
          const r = listen?.grade({ props: ref.props, goal: ref.goal, answer: { text: stripAccents(want) } });
          if (!r?.correct) problems.push(`${ref.where}: listen rejects "${stripAccents(want)}"`);
        }
        if (ref.id === "dialogue") {
          for (const n of ref.props.nodes as Obj[]) {
            const reply = n.reply as { accept: string[]; normalize?: (typeof TYPED_DEFAULT)[number][] } | undefined;
            if (!reply) continue;
            const want = reply.accept[0] ?? "";
            const m = matchText(stripAccents(want), reply.accept, reply.normalize ?? TYPED_DEFAULT);
            if (!m.matched) problems.push(`${ref.where} ${String(n.id)}: reply rejects "${stripAccents(want)}"`);
          }
        }
      }
      expect(problems).toEqual([]);
    });
  });

  describe("spanish-tapas-bar: misconception routing through the real grader", () => {
    test("text onWrong keys route to their misconception, typed with or without accents", () => {
      const problems: string[] = [];
      for (const { where, ix } of all) {
        if (ix.kind !== "text") continue;
        for (const [key, ow] of Object.entries(ix.onWrong ?? {})) {
          if (key === "default") continue;
          const r = gradeInteraction(ix, { kind: "text", value: key }, ctx);
          if (r.correct) problems.push(`${where}: onWrong "${key}" grades correct`);
          else if (ow.misconception && r.misconception !== ow.misconception)
            problems.push(`${where}: "${key}" routed to ${r.misconception ?? "nothing"}, not ${ow.misconception}`);
          const bare = gradeInteraction(ix, { kind: "text", value: stripAccents(key) }, ctx);
          if (ow.misconception && bare.misconception !== ow.misconception)
            problems.push(`${where}: "${stripAccents(key)}" (no accents) isn't routed to ${ow.misconception}`);
        }
      }
      expect(problems).toEqual([]);
    });

    test("cloze, match and widget interactions only use the default onWrong key (the only one graded)", () => {
      const problems: string[] = [];
      for (const { where, ix } of all) {
        if (ix.kind !== "cloze" && ix.kind !== "match" && ix.kind !== "widget") continue;
        const keys = Object.keys(ix.onWrong ?? {}).filter((k) => k !== "default");
        if (keys.length) problems.push(`${where}: unreachable onWrong keys ${keys.join(", ")}`);
      }
      expect(problems).toEqual([]);
    });
  });
});
