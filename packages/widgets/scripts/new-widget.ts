/**
 * Scaffold a widget.
 *
 *   bun run new:widget <id>                       a core widget: src/<id>/{spec.ts,View.tsx} + test
 *   bun run new:widget --html <name> [--pack dir] a sandboxed pack interactive with the bridge wired up
 *
 * The core scaffold is a small working widget (a dial with a target) that type-checks, grades and
 * passes its own keyboard test, so you start from green and reshape it. The html scaffold passes the
 * sandbox pre-scan. The bar a core widget clears: a keyboard path (plus "Use buttons instead" for
 * drags), aria-live announcements, a reduced-motion path, theme variables only, host-side grading,
 * the three modes (explore, answer, review) and at least two examples.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { WIDGET_IDS } from "@learncroc/core";
import { FRAME_HTML_MAX_BYTES, scanFrameHtml } from "../src/sandbox/bridge";

export const WIDGET_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const camel = (id: string) => id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (id: string) => {
  const c = camel(id);
  return c.charAt(0).toUpperCase() + c.slice(1);
};
const title = (id: string) => {
  const words = id.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export interface ScaffoldFile {
  path: string;
  content: string;
}

export function validateWidgetId(id: string): string | null {
  if (!WIDGET_ID_RE.test(id))
    return `"${id}" isn't a valid widget id (lowercase words joined by hyphens, e.g. "number-line")`;
  if ((WIDGET_IDS as readonly string[]).includes(id)) return `"${id}" already exists`;
  return null;
}

/** Files for a new core widget, relative to packages/widgets. */
export function scaffoldWidget(id: string): ScaffoldFile[] {
  const err = validateWidgetId(id);
  if (err) throw new Error(err);
  const C = camel(id);
  const P = pascal(id);
  const T = title(id);
  const spec = `/**
 * ${id}: describe in one line what the learner does with their hands.
 */
import type { GradeResult } from "@learncroc/core";
import { near } from "../shared/math";
import { graded } from "../shared/spec-helpers";
import { type WidgetSpec, z } from "../shared/zod";

export const ${P}Props = z.strictObject({
  /** What the dial measures, e.g. "temperature". */
  label: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
  /** Starting value. */
  value: z.number(),
  unit: z.string().optional(),
});

export const ${P}Goal = z.strictObject({ kind: z.literal("target"), target: z.number(), tolerance: z.number() });
export const ${P}Answer = z.object({ value: z.number() });

export type ${P}Props = z.infer<typeof ${P}Props>;
export type ${P}Goal = z.infer<typeof ${P}Goal>;
export type ${P}Answer = z.infer<typeof ${P}Answer>;

function validate(props: ${P}Props, goal?: ${P}Goal): string[] {
  const errors: string[] = [];
  if (!(props.min < props.max)) errors.push("min must be less than max");
  if (!(props.step > 0)) errors.push("step must be positive");
  if (props.value < props.min || props.value > props.max) errors.push("value must sit between min and max");
  if (goal && (goal.target < props.min || goal.target > props.max)) errors.push("goal target is out of range");
  if (goal && goal.tolerance < 0) errors.push("tolerance must be ≥ 0");
  return errors;
}

function grade({ goal, answer }: { props: ${P}Props; goal: ${P}Goal; answer: ${P}Answer }): GradeResult {
  return graded(near(answer.value, goal.target, goal.tolerance), undefined, {
    solution: { value: goal.target } satisfies ${P}Answer,
  });
}

export const ${C}Spec: WidgetSpec<${P}Props, ${P}Goal, ${P}Answer> = {
  // Register the id in WIDGET_IDS (packages/core, via a contract request) before shipping.
  id: "${id}" as WidgetSpec<${P}Props, ${P}Goal, ${P}Answer>["id"],
  version: 1,
  title: "${T}",
  family: "generic",
  description: "A dial the learner turns to hit a target value.",
  llmDoc: {
    useWhen: "One quantity should be tuned to hit a target.",
    notFor: "Anything with more than one moving part (use plot).",
    learnerDoes: "Turns the dial (drag or arrow keys) until the readout hits the target, then checks.",
    reports: "{ value: number }",
  },
  props: ${P}Props,
  goal: ${P}Goal,
  answer: ${P}Answer,
  validate,
  grade,
  initialAnswer: (p) => ({ value: p.value }),
  textAlternative: (p) => \`A dial for \${p.label} from \${p.min} to \${p.max}\${p.unit ? \` \${p.unit}\` : ""}.\`,
  toText: (p, a) => \`\${p.label}: \${a?.value ?? p.value}\${p.unit ? \` \${p.unit}\` : ""}\`,
  examples: [
    {
      note: "Hit 21 degrees",
      props: { label: "temperature", min: 0, max: 40, step: 1, value: 10, unit: "°C" },
      goal: { kind: "target", target: 21, tolerance: 0 },
      correctAnswer: { value: 21 },
      wrongAnswer: { value: 30 },
    },
    {
      note: "Within half a unit",
      props: { label: "speed", min: 0, max: 10, step: 0.5, value: 0 },
      goal: { kind: "target", target: 4, tolerance: 0.5 },
      correctAnswer: { value: 4.5 },
      wrongAnswer: { value: 2 },
    },
  ],
};
`;
  const view = `/**
 * ${id} view: replace the dial with the manipulation that makes the idea click.
 * Keyboard path, aria-live announcements, reduced motion and theme variables are required.
 */
import { Slider } from "../shared/Slider";
import { WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import type { ${P}Answer, ${P}Goal, ${P}Props } from "./spec";

export default function ${P}View(p: WidgetViewProps<${P}Props, ${P}Goal, ${P}Answer>) {
  const props = withReveal(p.props, p.revealProps);
  const value = p.value?.value ?? props.value;
  const unit = props.unit ? \` \${props.unit}\` : "";
  return (
    <WidgetShell id="${id}" mode={p.mode} label={props.label}>
      <Slider
        label={props.label}
        ariaLabel={props.label}
        value={value}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={p.mode === "review" || !p.onChange}
        format={(v) => \`\${v}\${unit}\`}
        band={p.mode === "review" && p.goal ? [p.goal.target - p.goal.tolerance, p.goal.target + p.goal.tolerance] : undefined}
        onChange={(v) => {
          p.onChange?.({ value: v });
          p.announce(\`\${props.label} \${v}\${unit}.\`);
        }}
      />
    </WidgetShell>
  );
}
`;
  const test = `import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ${C}Spec as spec } from "../src/${id}/spec";
import View from "../src/${id}/View";
import { expectAxeClean, gradeLast, renderView } from "./widget-harness";

describe("${id}", () => {
  test("examples grade right and wrong", () => {
    expect(spec.examples.length).toBeGreaterThanOrEqual(2);
    for (const e of spec.examples) {
      expect(spec.validate(e.props, e.goal)).toEqual([]);
      expect(spec.grade({ props: e.props, goal: e.goal, answer: e.correctAnswer }).correct).toBe(true);
      expect(spec.grade({ props: e.props, goal: e.goal, answer: e.wrongAnswer }).correct).toBe(false);
    }
  });

  test("validate catches bad props", () => {
    const e = spec.examples[0];
    if (!e) throw new Error("missing example");
    expect(spec.validate({ ...e.props, min: 50 }).length).toBeGreaterThan(0);
  });

  test("keyboard reaches a correct answer", async () => {
    const user = userEvent.setup();
    const e = spec.examples[0];
    if (!e) throw new Error("missing example");
    const r = renderView(View, { props: e.props, goal: e.goal });
    screen.getByRole("slider").focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}{ArrowRight}");
    expect(gradeLast(spec, e.props, e.goal, r.last()).correct).toBe(true);
    await expectAxeClean(r.container);
  });
});
`;
  return [
    { path: `src/${id}/spec.ts`, content: spec },
    { path: `src/${id}/View.tsx`, content: view },
    { path: `test/${id}.test.tsx`, content: test },
  ];
}

/** A sandboxed pack interactive with the bridge wired up (≤ 64 KB, no network, keyboard first). */
export function scaffoldHtml(name: string): ScaffoldFile {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    throw new Error(`"${name}" isn't a valid file name (lowercase, digits, hyphens)`);
  const content = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title(name)}</title>
<style>
  /* Theme variables arrive from the app: --lm-bg, --lm-ink, --lm-ink-2, --lm-muted, --lm-line,
     --lm-accent, --lm-accent-2, --lm-focus, --lm-font, --lm-radius (plus --ink, --w-1 … --w-5). */
  body { font-family: var(--lm-font); color: var(--lm-ink); }
  .stage { display: flex; flex-direction: column; gap: 12px; }
  .row { display: flex; align-items: center; gap: 12px; }
  .bar { height: 16px; border-radius: var(--lm-radius, 12px); background: var(--lm-accent); transition: width 220ms; }
  [data-mode="review"] input { pointer-events: none; }
</style>
</head>
<body>
<div class="stage">
  <div class="row">
    <label for="amount">Amount</label>
    <input id="amount" type="range" min="0" max="10" step="1" value="3">
    <output id="readout" for="amount">3</output>
  </div>
  <div class="bar" id="bar" style="width: 30%"></div>
</div>
<script>
  // The bridge is injected before this script: use lm.* only (no network, no storage, no parent).
  var amount = document.getElementById("amount");
  var readout = document.getElementById("readout");
  var bar = document.getElementById("bar");

  function render(v) {
    readout.textContent = String(v);
    bar.style.width = v * 10 + "%";
  }

  amount.addEventListener("input", function () {
    var v = Number(amount.value);
    render(v);
    lm.report(v);              // the host grades this value; never decide right or wrong here
    lm.announce("Amount " + v);
  });

  lm.onInit(function (state) {
    if (typeof state.value === "number") { amount.value = String(state.value); render(state.value); }
    amount.disabled = state.mode === "review";
  });

  lm.onTest(function (v) { amount.value = String(v); render(v); lm.report(v); });

  lm.ready();
</script>
</body>
</html>
`;
  return { path: `assets/interactive/${name}.html`, content };
}

function main(argv: string[]): number {
  const htmlAt = argv.indexOf("--html");
  const packAt = argv.indexOf("--pack");
  if (htmlAt >= 0) {
    const name = argv[htmlAt + 1];
    if (!name) {
      console.error("usage: bun run new:widget --html <name> [--pack packs/<id>]");
      return 2;
    }
    const pack = packAt >= 0 ? argv[packAt + 1] : undefined;
    const file = scaffoldHtml(name);
    const out = resolve(pack ?? ".", file.path);
    if (existsSync(out)) {
      console.error(`${out} already exists`);
      return 1;
    }
    const issues = scanFrameHtml(file.content);
    if (issues.length || file.content.length > FRAME_HTML_MAX_BYTES) {
      console.error("scaffold failed the sandbox pre-scan:", issues);
      return 1;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, file.content);
    console.log(`wrote ${out}
Use it from a node:
  visual:      { kind: html, asset: ${file.path}, height: 240, alt: "…" }
  interaction: { kind: html, asset: ${file.path}, height: 240, alt: "…", goal: { kind: equals, value: 7 }, solution: 7, fallback: … }`);
    return 0;
  }
  const id = argv.find((a) => !a.startsWith("-"));
  if (!id) {
    console.error("usage: bun run new:widget <id>   |   bun run new:widget --html <name> [--pack packs/<id>]");
    return 2;
  }
  const err = validateWidgetId(id);
  if (err) {
    console.error(err);
    return 1;
  }
  const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const files = scaffoldWidget(id);
  for (const f of files) {
    if (existsSync(join(root, f.path))) {
      console.error(`${f.path} already exists`);
      return 1;
    }
  }
  for (const f of files) {
    mkdirSync(dirname(join(root, f.path)), { recursive: true });
    writeFileSync(join(root, f.path), f.content);
    console.log(`wrote packages/widgets/${f.path}`);
  }
  const C = camel(id);
  console.log(`
Next:
  1. Add "${id}" to WIDGET_IDS in packages/core/src/schema/primitives.ts (frozen: file a contract request).
  2. Register it: WIDGET_VIEW_LOADERS and WIDGET_SPEC_LOADERS in packages/widgets/src/registry.ts,
     WIDGET_SPECS in packages/widgets/src/host/specs.ts (${C}Spec), and export it from src/spec.ts.
  3. Regenerate the AI catalogue: bun packages/widgets/scripts/gen-catalog.ts
  4. cd packages/widgets && bun test test/${id}.test.tsx
  It shows up in /dev/widgets once registered.`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
