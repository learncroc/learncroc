/**
 * Server-sent events (CONTRACTS §12). Wire format: `event: <type>\ndata: <JSON>\n\n`.
 * The `type` inside the JSON equals the SSE event name. Streams end with a terminal event
 * (`done` or `error`), then the server closes the connection.
 *
 * POST streams are read with fetch + parseSseStream(). GET /jobs/:id/events also works with EventSource.
 */
import type { ZodType } from "zod";
import type { AskEvent, InstallEvent, JobEvent } from "./schema/index";

export type { AskEvent, InstallEvent, JobEvent };

/** The SSE streams in the API, keyed by the "sse:<Name>" response marker in ApiRoutes. */
export interface SseStreams {
  InstallEvent: InstallEvent;
  AskEvent: AskEvent;
  JobEvent: JobEvent;
}

export interface SseEvent {
  type: string;
}

/** True for the events that end a stream. */
export function isTerminalEvent(e: SseEvent): boolean {
  return e.type === "done" || e.type === "error";
}

/** Encode one event as an SSE frame. */
export function encodeSse(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse an SSE byte stream into events. Each frame's `data:` lines are joined and JSON-parsed;
 * frames without data (comments, keep-alives) are skipped. With a schema, every event is validated
 * and an invalid one throws. The iterator ends after a terminal event or when the stream ends.
 */
export async function* parseSseStream<T extends SseEvent = SseEvent>(
  stream: ReadableStream<Uint8Array>,
  schema?: ZodType<T>,
): AsyncGenerator<T, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) buffer += decoder.decode();
      buffer = buffer.replace(/\r\n?/g, "\n");
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseFrame<T>(frame, schema);
        if (event) {
          yield event;
          if (isTerminalEvent(event)) return;
        }
        sep = buffer.indexOf("\n\n");
      }
      if (done) {
        const event = buffer.trim() ? parseFrame<T>(buffer, schema) : undefined;
        if (event) yield event;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame<T extends SseEvent>(frame: string, schema?: ZodType<T>): T | undefined {
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
  }
  if (data.length === 0) return undefined;
  const json: unknown = JSON.parse(data.join("\n"));
  return schema ? schema.parse(json) : (json as T);
}
