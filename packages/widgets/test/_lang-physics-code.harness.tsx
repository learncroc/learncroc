/**
 * Test harness for the physics, language and code widget views: renders a view with host-like props,
 * records onChange/onCommit/announce, and runs axe-core on the result.
 */
import { expect } from "bun:test";
import { act, render } from "@testing-library/react";
import axe from "axe-core";
import type { ComponentType } from "react";
import type { WidgetViewProps } from "../src/types";

export interface Harness<A> {
  changes: A[];
  commits: A[];
  announcements: string[];
  last: () => A | undefined;
  container: HTMLElement;
  rerender: (over: Partial<WidgetViewProps<unknown, unknown, A>>) => void;
}

export function renderWidget<P, G, A>(
  View: ComponentType<WidgetViewProps<P, G, A>>,
  init: Partial<WidgetViewProps<NoInfer<P>, NoInfer<G>, NoInfer<A>>> & { props: NoInfer<P> },
): Harness<A> {
  const changes: A[] = [];
  const commits: A[] = [];
  const announcements: string[] = [];
  const base: WidgetViewProps<P, G, A> = {
    mode: "answer",
    reducedMotion: true,
    theme: "light",
    announce: (t) => announcements.push(t),
    assetUrl: (path) => `/packs/test/${path}`,
    onChange: (a) => changes.push(a),
    onCommit: (a) => commits.push(a),
    ...init,
  };
  const r = render(<View {...base} />);
  return {
    changes,
    commits,
    announcements,
    last: () => changes[changes.length - 1],
    container: r.container,
    rerender: (over) => r.rerender(<View {...base} {...(over as Partial<WidgetViewProps<P, G, A>>)} />),
  };
}

/** Run axe on a container; fails the test with readable violations. Colour contrast needs real CSS, so it's off. */
export async function expectAxeClean(container: HTMLElement): Promise<void> {
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  const problems = result.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
  expect(problems).toEqual([]);
}

/** Flush pending timers/effects inside act. */
export async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
