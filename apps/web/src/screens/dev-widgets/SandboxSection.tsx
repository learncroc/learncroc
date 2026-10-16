/**
 * Sandboxed pack interactives in the gallery: a well-behaved one graded on the host from its last
 * report, and a hostile one the pre-scan refuses (and, if you run it anyway, the sandbox contains).
 * Previews run inline in an opaque-origin sandbox (needs the dev server's relaxed CSP); real packs
 * load from the sandbox origin through POST /api/frames.
 */
import { Button, cn } from "@learncroc/ui";
import { type FrameReportValue, SandboxFrame, scanFrameHtml, wrapFrameDocument } from "@learncroc/widgets";
import {
  DEMO_INTERACTIVE_GOAL,
  DEMO_INTERACTIVE_HTML,
  HOSTILE_INTERACTIVE_HTML,
} from "@learncroc/widgets/sandbox/demo";
import { useMemo, useState } from "react";

type Mode = "explore" | "answer" | "review";

export function SandboxSection(p: { theme: "light" | "dark"; reducedMotion: boolean; mode: Mode }) {
  const demoDoc = useMemo(() => wrapFrameDocument(DEMO_INTERACTIVE_HTML, { title: "Balance the seesaw" }), []);
  const hostileDoc = useMemo(() => wrapFrameDocument(HOSTILE_INTERACTIVE_HTML), []);
  const hostileIssues = useMemo(() => scanFrameHtml(HOSTILE_INTERACTIVE_HTML), []);
  const [report, setReport] = useState<FrameReportValue | null>(null);
  const [status, setStatus] = useState("waiting for ready");
  const [runHostile, setRunHostile] = useState(false);
  const [hostileLog, setHostileLog] = useState<string[]>([]);
  const graded = report !== null && report === DEMO_INTERACTIVE_GOAL.value;

  return (
    <section id="sandboxed" aria-labelledby="sandboxed-title" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 id="sandboxed-title" className="t-title text-ink">
          Sandboxed pack interactives
        </h2>
        <p className="max-w-[70ch] text-body text-ink-2">
          Packs can ship an HTML file that runs in a sandbox with no network, no storage and no way into the app. It
          reports a value; the host grades it.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <article
          className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5 shadow-1"
          data-sandbox-demo
        >
          <h3 className="text-body font-semibold text-ink">Balance the seesaw (goal: equals 6)</h3>
          <div className="rounded-stage bg-w-ground p-4">
            <SandboxFrame
              url=""
              srcDoc={demoDoc}
              title="Balance the seesaw"
              height={160}
              mode={p.mode}
              theme={p.theme}
              reducedMotion={p.reducedMotion}
              onReady={() => setStatus("ready")}
              onReport={setReport}
              onFail={(reason) => setStatus(`dropped: ${reason}`)}
            />
          </div>
          <p className="text-small text-ink-2" data-sandbox-status>
            Frame {status}. Last report:{" "}
            <strong className="tabular text-ink">{report === null ? "none" : String(report)}</strong>
            {report !== null ? (
              <span className={cn("ml-2", graded ? "font-semibold text-sea-text" : "text-ink-2")}>
                Host grade: {graded ? "correct" : "not yet"}
              </span>
            ) : null}
          </p>
        </article>
        <article
          className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5 shadow-1"
          data-sandbox-hostile
        >
          <h3 className="text-body font-semibold text-ink">A hostile interactive</h3>
          <p className="text-small text-ink-2">
            It tries to fetch, reach the parent, use storage, eval, and grade itself. The pre-scan refuses it:
          </p>
          <ul className="flex flex-col gap-1 text-small text-ember-text" data-scan-issues>
            {hostileIssues.map((i) => (
              <li key={`${i.rule}-${i.message}`}>
                {i.rule}: {i.message}
                {i.line ? ` (line ${i.line})` : ""}
              </li>
            ))}
          </ul>
          <div>
            <Button size="sm" onClick={() => setRunHostile((v) => !v)} aria-pressed={runHostile}>
              {runHostile ? "Stop it" : "Run it in the sandbox anyway"}
            </Button>
          </div>
          {runHostile ? (
            <div className="flex flex-col gap-2">
              <div className="rounded-stage bg-w-ground p-4">
                <SandboxFrame
                  url=""
                  srcDoc={hostileDoc}
                  title="Hostile interactive"
                  height={140}
                  mode="answer"
                  theme={p.theme}
                  reducedMotion={p.reducedMotion}
                  onReady={() => setHostileLog((l) => [...l, "ready (accepted)"])}
                  onReport={(v) =>
                    setHostileLog((l) => [...l, `report ${JSON.stringify(v)}: a value only, graded by the host`])
                  }
                  onFail={(r) => setHostileLog((l) => [...l, `dropped: ${r}`])}
                />
              </div>
              <ul className="text-small text-ink-2" aria-live="polite">
                {hostileLog.map((l, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log.
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
