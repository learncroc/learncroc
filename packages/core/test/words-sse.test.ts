import { describe, expect, test } from "bun:test";
import { AskEvent } from "../src/schema/index";
import { encodeSse, parseSseStream } from "../src/sse";
import { words } from "../src/words";

describe("words", () => {
  test("counts words, skips code, counts inline maths as one", () => {
    expect(words("Same light, longer road.")).toBe(4);
    expect(words("Use `a + b` here")).toBe(2);
    expect(words("So $E = mc^2$ holds")).toBe(3);
    expect(words("```\nlots of code\n```\nok")).toBe(1);
    expect(words("¿Más despacio, por favor?", "es")).toBe(4);
  });
});

describe("sse", () => {
  test("encode then parse round-trips and stops at the terminal event", async () => {
    const events: AskEvent[] = [
      { type: "thinking" },
      { type: "delta", text: "Hello\nworld" },
      { type: "done", threadId: "t1", messageId: 1, words: 2 },
      { type: "delta", text: "never read" },
    ];
    const bytes = new TextEncoder().encode(`: keep-alive\n\n${events.map(encodeSse).join("")}`);
    // deliver in awkward chunks
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    const out: AskEvent[] = [];
    for await (const e of parseSseStream(stream, AskEvent)) out.push(e);
    expect(out).toEqual(events.slice(0, 3));
  });
});
