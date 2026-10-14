/**
 * The learner services read the server's current AI ports on every call, so the full server can
 * hand them its AI runtime (explain grading, hint rewrites, Nib replies) after they are built.
 */
import { expect, test } from "bun:test";
import { type AiPorts, offlineAiPorts } from "@learncroc/core";
import { liveAiPorts } from "../src/learner/core";
import { getServices } from "../src/services";
import { testApp } from "./helpers";

test("liveAiPorts follows ctx.ai when it is swapped after the services are built", async () => {
  const t = await testApp();
  getServices(t.ctx);
  const ports = liveAiPorts(t.ctx);
  expect(await ports.configured()).toBe(false);
  const calls: string[] = [];
  const swapped: AiPorts = {
    ...offlineAiPorts,
    configured: async () => true,
    rewriteHint: async (a) => {
      calls.push(a.runId);
      return "Look at the units first.";
    },
  };
  t.ctx.ai = swapped;
  expect(await ports.configured()).toBe(true);
  const pack = await getServices(t.ctx).packs.get("mini-pack");
  const hint = await ports.rewriteHint({
    pack,
    nodeId: "units",
    interactionId: "x",
    answer: { kind: "choice", selected: "a" },
    authoredHint: "Units.",
    level: 1,
    runId: "r1",
  });
  expect(hint).toBe("Look at the units first.");
  expect(calls).toEqual(["r1"]);
});
