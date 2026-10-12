/**
 * Test harness for widget views: renders a view with a controlled value (like the run player does),
 * records every onChange and announcement, and runs axe on the result.
 */
import { expect } from "bun:test";
import type { WidgetSpec } from "@learncroc/core";
import { act, render } from "@testing-library/react";
import axe from "axe-core";
import { type ComponentType, useState } from "react";
import type { WidgetViewProps } from "../src/types";

export interface Rendered<A> extends ReturnType<typeof render> {
  changes: A[];
  announcements: string[];
  last: () => A | undefined;
}

export function renderView<P, G, A>(
  View: ComponentType<WidgetViewProps<P, G, A>>,
  opts: {
    props: P;
    goal?: NoInfer<G>;
    mode?: "explore" | "answer" | "review";
    value?: NoInfer<A>;
    solution?: NoInfer<A>;
    revealProps?: Partial<NoInfer<P>>;
    theme?: "light" | "dark";
    reducedMotion?: boolean;
  },
): Rendered<A> {
  const changes: A[] = [];
  const announcements: string[] = [];
  function Harness() {
    const [v, setV] = useState<A | undefined>(opts.value);
    return (
      <View
        props={opts.props}
        goal={opts.goal}
        mode={opts.mode ?? "answer"}
        value={v}
        solution={opts.solution}
        revealProps={opts.revealProps}
        onChange={(x) => {
          changes.push(x);
          setV(x);
        }}
        announce={(t) => announcements.push(t)}
        reducedMotion={opts.reducedMotion ?? true}
        theme={opts.theme ?? "light"}
        assetUrl={(p) => `/test-assets/${p}`}
      />
    );
  }
  const utils = render(<Harness />);
  return { ...utils, changes, announcements, last: () => changes.at(-1) };
}

/** Grade the last value with the spec. */
export function gradeLast<P, G, A>(spec: WidgetSpec<P, G, A>, props: P, goal: G, value: A | undefined) {
  if (value === undefined) throw new Error("the widget never reported a value");
  return spec.grade({ props: spec.props.parse(props), goal, answer: spec.answer.parse(value) });
}

/** No serious or critical axe violations (colour contrast needs real layout, so it is checked in the browser). */
export async function expectAxeClean(container: Element): Promise<void> {
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    resultTypes: ["violations"],
  });
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  if (serious.length) {
    const detail = serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`).join("\n");
    throw new Error(`axe violations:\n${detail}`);
  }
  expect(serious).toEqual([]);
}

/** Flush pending state updates and animation frames. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
