import { expect, test } from "bun:test";
import { type AskEvent, AskEvent as AskEventSchema, parseSseStream } from "@learncroc/core";
import { sseResponse } from "../src/sse";

test("sseResponse streams events and ends after the terminal event", async () => {
  const res = sseResponse<AskEvent>(
    async (w) => {
      w.send({ type: "thinking" });
      w.send({ type: "delta", text: "Hi" });
      w.send({ type: "done", threadId: "t", messageId: 1, words: 1 });
      w.send({ type: "delta", text: "ignored after done" });
    },
    (err) => ({ type: "error", code: "provider_error", message: String(err) }),
  );
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const events: AskEvent[] = [];
  if (!res.body) throw new Error("no body");
  for await (const e of parseSseStream(res.body, AskEventSchema)) events.push(e);
  expect(events.map((e) => e.type)).toEqual(["thinking", "delta", "done"]);
});

test("an exception becomes a terminal error event", async () => {
  const res = sseResponse<AskEvent>(
    async () => {
      throw new Error("boom");
    },
    (err) => ({ type: "error", code: "provider_error", message: (err as Error).message }),
  );
  if (!res.body) throw new Error("no body");
  const events: AskEvent[] = [];
  for await (const e of parseSseStream(res.body, AskEventSchema)) events.push(e);
  expect(events).toEqual([{ type: "error", code: "provider_error", message: "boom" }]);
});
