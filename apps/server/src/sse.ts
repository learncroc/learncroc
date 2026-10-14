/**
 * SSE responses (CONTRACTS §12): `event: <type>\ndata: <JSON>\n\n`, ending with a terminal event
 * (`done` or `error`), after which the stream closes.
 */
import { encodeSse, isTerminalEvent, type SseEvent } from "@learncroc/core";

export interface SseWriter<E extends SseEvent> {
  send(event: E): void;
  /** Resolves when the client disconnects. */
  readonly closed: Promise<void>;
}

/**
 * Build an SSE Response. `run` sends events; the stream closes after a terminal event or when `run`
 * returns. An exception becomes a terminal `{ type: "error" }` event built by `onError`.
 */
export function sseResponse<E extends SseEvent>(
  run: (w: SseWriter<E>) => Promise<void>,
  onError: (err: unknown) => E,
  init: { signal?: AbortSignal; keepAliveMs?: number } = {},
): Response {
  const encoder = new TextEncoder();
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((r) => {
    resolveClosed = r;
  });
  let done = false;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = () => {
        if (done) return;
        done = true;
        if (keepAlive) clearInterval(keepAlive);
        controller.close();
        resolveClosed();
      };
      const writer: SseWriter<E> = {
        send(event) {
          if (done) return;
          controller.enqueue(encoder.encode(encodeSse(event)));
          if (isTerminalEvent(event)) finish();
        },
        closed,
      };
      keepAlive = setInterval(() => {
        if (!done) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, init.keepAliveMs ?? 15_000);
      init.signal?.addEventListener("abort", finish);
      run(writer)
        .catch((err: unknown) => writer.send(onError(err)))
        .finally(finish);
    },
    cancel() {
      done = true;
      if (keepAlive) clearInterval(keepAlive);
      resolveClosed();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
