/**
 * bun test preload for DOM packages (ui, widgets, maps, web): a happy-dom window, jest-dom matchers
 * and Testing Library cleanup between tests. Wired through each package's bunfig.toml.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:5173/" });

const { afterEach, expect } = await import("bun:test");
const matchers = await import("@testing-library/jest-dom/matchers");
const { cleanup } = await import("@testing-library/react");

expect.extend(matchers as unknown as Parameters<typeof expect.extend>[0]);
afterEach(() => cleanup());
