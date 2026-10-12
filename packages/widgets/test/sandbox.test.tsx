/**
 * The sandbox bridge: message validation, the pre-scan, the document wrapper and CSP, the bridge
 * script's behaviour, and SandboxFrame's containment (source and origin checks, ready deadline,
 * self-test, reports only after ready, host-side grading only).
 */
import { describe, expect, mock, test } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import {
  BRIDGE_SCRIPT,
  clampFrameHeight,
  FRAME_META_CSP,
  frameCsp,
  parseFrameMessage,
  REPORT_MAX_BYTES,
  scanFrameHtml,
  wrapFrameDocument,
} from "../src/sandbox/bridge";
import { DEMO_INTERACTIVE_HTML, HOSTILE_INTERACTIVE_HTML } from "../src/sandbox/demo";
import { expectedFrameOrigin, SandboxFrame } from "../src/sandbox/SandboxFrame";

describe("parseFrameMessage", () => {
  test("accepts the five contract messages", () => {
    expect(parseFrameMessage({ type: "ready", v: 1 })).toEqual({ type: "ready", v: 1 });
    expect(parseFrameMessage({ type: "report", value: ["a", "b"] })).toEqual({ type: "report", value: ["a", "b"] });
    expect(parseFrameMessage({ type: "resize", height: 300 })).toEqual({ type: "resize", height: 300 });
    expect(parseFrameMessage({ type: "announce", text: "Balanced." })).toEqual({ type: "announce", text: "Balanced." });
    expect(parseFrameMessage({ type: "selftest", ok: true })).toEqual({ type: "selftest", ok: true });
  });
  test("a frame can't grade itself: unknown types are refused and extra fields are dropped", () => {
    expect(parseFrameMessage({ type: "grade", correct: true })).toBeNull();
    expect(parseFrameMessage({ type: "report", value: 10, correct: true, score: 1 })).toEqual({
      type: "report",
      value: 10,
    });
    expect(parseFrameMessage({ type: "report", value: { correct: true } })).toBeNull();
  });
  test("caps and junk", () => {
    expect(parseFrameMessage({ type: "report", value: "x".repeat(REPORT_MAX_BYTES + 1) })).toBeNull();
    expect(parseFrameMessage({ type: "announce", text: "y".repeat(121) })).toBeNull();
    expect(parseFrameMessage({ type: "report", value: Number.NaN })).toBeNull();
    expect(parseFrameMessage({ type: "resize", height: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseFrameMessage("ready")).toBeNull();
    expect(parseFrameMessage(null)).toBeNull();
    expect(clampFrameHeight(5)).toBe(120);
    expect(clampFrameHeight(5000)).toBe(900);
  });
});

describe("scanFrameHtml", () => {
  test("the hostile fixture is refused for every trick it tries", () => {
    const rules = new Set(scanFrameHtml(HOSTILE_INTERACTIVE_HTML).map((i) => i.rule));
    for (const r of ["network", "external-url", "parent", "storage", "eval"]) expect(rules.has(r)).toBe(true);
  });
  test("the demo interactive passes", () => {
    expect(scanFrameHtml(DEMO_INTERACTIVE_HTML)).toEqual([]);
  });
  test("size cap and the missing lm.ready()", () => {
    const big = `<p>${"a".repeat(70 * 1024)}</p><script>lm.ready()</script>`;
    expect(scanFrameHtml(big).some((i) => i.rule === "size")).toBe(true);
    expect(scanFrameHtml("<p>hi</p>").some((i) => i.rule === "bridge")).toBe(true);
  });
  test("prose about the top of the page is not a false positive", () => {
    expect(scanFrameHtml("<p>Drag it to the top. Then the parent node.</p><script>lm.ready()</script>")).toEqual([]);
  });
});

describe("wrapFrameDocument and CSP", () => {
  test("bridge and CSP go first in <head>", () => {
    const out = wrapFrameDocument("<!doctype html><html><head><script>evil()</script></head><body></body></html>");
    const head = out.indexOf("<head>");
    expect(out.indexOf("Content-Security-Policy")).toBeGreaterThan(head);
    expect(out.indexOf(BRIDGE_SCRIPT)).toBeLessThan(out.indexOf("evil()"));
  });
  test("fragments get a full document", () => {
    const out = wrapFrameDocument("<button>go</button>", { title: "A <b>title</b>" });
    expect(out.startsWith("<!doctype html><html><head>")).toBe(true);
    expect(out).toContain("<body><button>go</button></body>");
    expect(out).toContain("<title>A &#60;b&#62;title&#60;/b&#62;</title>");
  });
  test("no network, and only the app may frame it", () => {
    const csp = frameCsp(4747);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors http://127.0.0.1:4747 http://localhost:4747");
    expect(FRAME_META_CSP).toContain("connect-src 'none'");
  });
});

/** Run the bridge script against a fake frame window whose parent records posts. */
function bootBridge() {
  const posted: unknown[] = [];
  const listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const parent = { postMessage: (m: unknown) => posted.push(m) };
  const win: Record<string, unknown> = {
    parent,
    addEventListener: (type: string, fn: (e: { source: unknown; data: unknown }) => void) => {
      if (type === "message") listeners.push(fn);
    },
    requestAnimationFrame: (f: () => void) => setTimeout(f, 0),
  };
  new Function("window", "document", BRIDGE_SCRIPT)(win, document);
  const lm = win.lm as {
    ready: () => void;
    report: (v: unknown) => void;
    announce: (t: string) => void;
    onInit: (fn: (s: { mode: string; value: unknown }) => void) => void;
    onReveal: (fn: (s: unknown) => void) => void;
    mode: string;
  };
  const send = (data: unknown, source: unknown = parent) => {
    for (const l of listeners) l({ source, data });
  };
  return { lm, posted, send, win };
}

describe("bridge script", () => {
  test("ready, report and announce post contract messages", () => {
    const { lm, posted } = bootBridge();
    lm.ready();
    lm.ready();
    lm.report(4);
    lm.report({ correct: true });
    lm.announce("z".repeat(200));
    expect(posted.filter((m) => (m as { type: string }).type === "ready")).toHaveLength(1);
    expect(posted).toContainEqual({ type: "report", value: 4 });
    expect(posted.some((m) => JSON.stringify(m).includes("correct"))).toBe(false);
    expect(posted).toContainEqual({ type: "announce", text: "z".repeat(120) });
  });

  test("init from the parent sets mode, theme tokens and restores the value; other sources are ignored", () => {
    const { lm, send } = bootBridge();
    const seen: unknown[] = [];
    lm.onInit((s) => seen.push(s));
    send(
      { type: "init", mode: "review", theme: "dark", reducedMotion: true, tokens: { "--ink": "#fff" }, value: 3 },
      { other: true },
    );
    expect(seen).toHaveLength(0);
    send({
      type: "init",
      mode: "review",
      theme: "dark",
      reducedMotion: true,
      tokens: { "--ink": "#ecebfa", "--w-ground": "#14132e", "--evil": "red;}body{display:none" },
      value: 3,
    });
    expect(seen).toEqual([{ mode: "review", theme: "dark", reducedMotion: true, value: 3, solution: undefined }]);
    expect(lm.mode).toBe("review");
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--ink")).toBe("#ecebfa");
    expect(root.style.getPropertyValue("--lm-bg")).toBe("var(--w-ground)");
    expect(root.style.getPropertyValue("--evil")).toBe("");
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.hasAttribute("data-reduced-motion")).toBe(true);
    root.removeAttribute("style");
    root.removeAttribute("data-theme");
    root.removeAttribute("data-mode");
    root.removeAttribute("data-reduced-motion");
  });

  test("window.lm is frozen and can't be replaced", () => {
    const { win, lm } = bootBridge();
    expect(Object.isFrozen(lm)).toBe(true);
    expect(() => {
      (win as { lm: unknown }).lm = {};
    }).toThrow();
  });

  test("selftest fires the first control and reports whether the page reacted", async () => {
    document.body.innerHTML = `<button id="b">go</button>`;
    const b = document.getElementById("b") as HTMLButtonElement;
    b.addEventListener("click", () => {
      b.textContent = "went";
    });
    const { send, posted } = bootBridge();
    send({ type: "selftest" });
    await new Promise((r) => setTimeout(r, 200));
    expect(posted).toContainEqual({ type: "selftest", ok: true });
    document.body.innerHTML = `<button id="dead">nothing happens</button>`;
    const second = bootBridge();
    second.send({ type: "selftest" });
    await new Promise((r) => setTimeout(r, 200));
    expect(second.posted).toContainEqual({ type: "selftest", ok: false });
    document.body.innerHTML = "";
  });
});

describe("SandboxFrame", () => {
  function setup(extra: Partial<Parameters<typeof SandboxFrame>[0]> = {}) {
    const onReady = mock(() => {});
    const onReport = mock((_v: unknown) => {});
    const onFail = mock((_r: string) => {});
    const onAnnounce = mock((_t: string) => {});
    const utils = render(
      <SandboxFrame
        url=""
        srcDoc={wrapFrameDocument(DEMO_INTERACTIVE_HTML)}
        title="Balance the seesaw"
        height={200}
        mode="answer"
        theme="light"
        reducedMotion
        onReady={onReady}
        onReport={onReport}
        onFail={onFail}
        onAnnounce={onAnnounce}
        readyTimeoutMs={150}
        {...extra}
      />,
    );
    const iframe = utils.container.querySelector("iframe") as HTMLIFrameElement;
    const frameWin = iframe.contentWindow as Window;
    const post = (data: unknown, source: unknown = frameWin, origin = "null") =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, source: source as Window, origin }));
      });
    return { ...utils, iframe, frameWin, post, onReady, onReport, onFail, onAnnounce };
  }

  test("the iframe can run scripts but can't reach the parent", () => {
    const { iframe } = setup();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("allow")).toBe("");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(screen.getByText("custom interactive")).toBeInTheDocument();
  });

  test("ready → init; reports reach the host only after ready and only from this frame", async () => {
    const { frameWin, post, onReady, onReport, onAnnounce } = setup();
    const sent: unknown[] = [];
    frameWin.postMessage = ((m: unknown) => sent.push(m)) as typeof frameWin.postMessage;
    await post({ type: "report", value: 6 });
    expect(onReport).not.toHaveBeenCalled();
    await post({ type: "ready", v: 1 });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect((sent[0] as { type: string }).type).toBe("init");
    await post({ type: "report", value: 6, correct: true });
    expect(onReport).toHaveBeenCalledWith(6);
    await post({ type: "grade", correct: true });
    expect(onReport).toHaveBeenCalledTimes(1);
    await post({ type: "announce", text: "Balanced." });
    expect(onAnnounce).toHaveBeenCalledWith("Balanced.");
    expect(document.querySelector("[data-sandbox-live]")?.textContent).toBe("Balanced.");
  });

  test("another frame can't post as this one; a wrong origin is ignored", async () => {
    const { post, onReady, onReport } = setup();
    const other = document.createElement("iframe");
    other.srcdoc = "<p>another frame</p>";
    document.body.appendChild(other);
    await post({ type: "ready", v: 1 }, other.contentWindow);
    await post({ type: "ready", v: 1 }, window);
    await post({ type: "ready", v: 1 }, undefined, "http://evil.example");
    expect(onReady).not.toHaveBeenCalled();
    await post({ type: "ready", v: 1 });
    await post({ type: "report", value: 1 }, other.contentWindow);
    expect(onReport).not.toHaveBeenCalled();
    other.remove();
  });

  test("resize is clamped", async () => {
    const { post, iframe } = setup();
    await post({ type: "ready", v: 1 });
    await post({ type: "resize", height: 5000 });
    expect(iframe.style.height).toBe("900px");
    await post({ type: "resize", height: 10 });
    expect(iframe.style.height).toBe("120px");
  });

  test("a frame that never says ready is dropped", async () => {
    const { onFail } = setup();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(onFail).toHaveBeenCalledWith("not-ready");
    expect(screen.getByText(/didn't load/)).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });

  test("self-test: a frame that doesn't react is dropped", async () => {
    const onSelfTest = mock((_ok: boolean) => {});
    const { post, frameWin, onFail } = setup({ selfTest: true, onSelfTest });
    const sent: unknown[] = [];
    frameWin.postMessage = ((m: unknown) => sent.push(m)) as typeof frameWin.postMessage;
    await post({ type: "ready", v: 1 });
    expect(sent.some((m) => (m as { type: string }).type === "selftest")).toBe(true);
    await post({ type: "selftest", ok: false });
    expect(onSelfTest).toHaveBeenCalledWith(false);
    expect(onFail).toHaveBeenCalledWith("selftest-failed");
  });

  test("URL frames only accept their own origin", async () => {
    expect(expectedFrameOrigin("http://127.0.0.1:4748/frame/abc")).toBe("http://127.0.0.1:4748");
    expect(expectedFrameOrigin("http://127.0.0.1:4748/frame/abc", "<p>x</p>")).toBe("null");
    expect(expectedFrameOrigin("http://[bad")).toBeNull();
    const onReady = mock(() => {});
    const { container } = render(
      <SandboxFrame
        url="http://127.0.0.1:4748/frame/abc"
        srcDoc="<p>x</p>"
        title="t"
        height={200}
        mode="explore"
        theme="dark"
        reducedMotion={false}
        onReady={onReady}
      />,
    );
    const win = (container.querySelector("iframe") as HTMLIFrameElement).contentWindow as Window;
    await act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "ready", v: 1 }, source: win, origin: "http://127.0.0.1:4748" }),
      );
    });
    expect(onReady).not.toHaveBeenCalled();
    await act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "ready", v: 1 }, source: win, origin: "null" }));
    });
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
