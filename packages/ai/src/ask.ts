/**
 * Ask: the always-reachable tutor. Mode comes from the Socratic gate; the reply is
 * guarded (word cap, action ending, answer leak) before the learner sees it.
 *
 * Socratic replies are generated whole, checked, then streamed out, because a leak can't be
 * un-shown. Full replies stream live, one complete sentence at a time, and stop at the word cap.
 */

import type { AskEvent, AskRequest, AttemptRow, ChatTurn, CompiledPack, Usage, WidgetRef } from "@learncroc/core";
import { CROC_NAME } from "@learncroc/core";
import { widgetSpecRegistry } from "@learncroc/widgets/spec";
import type { AiClient } from "./client";
import { buildAskContext } from "./context";
import { AiError, toAiError } from "./errors";
import type { GateDecision } from "./gate";
import { ASK_MAX_WORDS, answerLeak, endsInAction, enforceCap, overCap, SOCRATIC_MAX_WORDS, tidyVoice } from "./guards";
import type { CrocInput } from "./inputs";
import { inputBlock, type PromptId, prompt, render, tag } from "./prompts";
import { sentences, words } from "./text";

/** Moss's voice, for prompts. */
export const CROC_VOICE =
  "A well-read friend who got to the material first and carries a lantern for the dark bits. Dry, warm, a little wry. Short sentences, first person. Never in a hurry, never keeping score.";

export interface Thread {
  id: string;
  packId: string;
  nodeId?: string;
  turns: ChatTurn[];
  messages: number;
}

/** Folded Ask threads, in memory (the last 2 turns are sent when a thread continues). */
export class ThreadStore {
  private readonly threads = new Map<string, Thread>();
  private seq = 0;
  constructor(private readonly max = 200) {}
  get(id: string | undefined, packId: string, nodeId?: string): Thread {
    const existing = id ? this.threads.get(id) : undefined;
    if (existing && existing.packId === packId) return existing;
    const t: Thread = {
      id: `t${Date.now().toString(36)}${(++this.seq).toString(36)}`,
      packId,
      ...(nodeId ? { nodeId } : {}),
      turns: [],
      messages: 0,
    };
    this.threads.set(t.id, t);
    if (this.threads.size > this.max) {
      const oldest = this.threads.keys().next().value;
      if (oldest) this.threads.delete(oldest);
    }
    return t;
  }
}

export interface AskRun {
  client: AiClient;
  /** Settings → Ask uses (default smart). */
  tier?: "fast" | "smart";
  pack: CompiledPack;
  request: AskRequest;
  decision: GateDecision;
  attempts: AttemptRow[];
  prereqStates: Record<string, string>;
  threads: ThreadStore;
  /** Socratic reply streaming pace (ms per word); 0 in tests. */
  paceMs?: number;
  /** Called when full mode is used on an unanswered interaction (gate off): marks it assisted. */
  onAssist?(interactionId: string): Promise<void>;
  signal?: AbortSignal;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Parse "CHECK: q | a | b | c | answer=2" (1-based in the prompt, 0-based in the event). */
export function parseCheck(line: string): Extract<AskEvent, { type: "check" }> | undefined {
  const m = /^CHECK:\s*(.+)$/i.exec(line.trim());
  if (!m) return undefined;
  const parts = (m[1] as string).split("|").map((p) => p.trim());
  const ans = parts.pop();
  const a = /^answer\s*=\s*(\d+)$/i.exec(ans ?? "");
  const [q, ...options] = parts;
  if (!a || !q || options.length < 2 || options.length > 4) return undefined;
  const answer = Number(a[1]) - 1;
  if (answer < 0 || answer >= options.length) return undefined;
  return { type: "check", prompt: q, options, answer };
}

/** Parse "SHOW: plot {…}" into a validated widget (explore mode, no goal). */
export function parseShow(line: string): Extract<AskEvent, { type: "widget" }> | undefined {
  const m = /^SHOW:\s*(plot)\s+(\{[\s\S]*\})\s*$/i.exec(line.trim());
  if (!m) return undefined;
  const spec = widgetSpecRegistry.get("plot");
  if (!spec) return undefined;
  let props: unknown;
  try {
    props = JSON.parse(m[2] as string);
  } catch {
    return undefined;
  }
  const parsed = spec.props.safeParse(props);
  if (!parsed.success) return undefined;
  if (spec.validate(parsed.data).length > 0) return undefined;
  const widget: WidgetRef = { id: "plot", v: 1, props: parsed.data as Record<string, unknown> };
  return { type: "widget", widget, prompt: "Play with it" };
}

function moveFor(d: GateDecision): string {
  return d.interaction
    ? `back to the task: ${d.interaction.prompt}`
    : "try the current task, then tell me what you noticed.";
}

/** A safe Socratic reply when the model's reply leaks twice (last resort). */
function fallbackSocratic(d: GateDecision): string {
  const hint = d.interactionId && d.node ? Object.values(d.node.misconceptions)[0]?.hint : undefined;
  if (d.hintLevel >= 1 && hint) return enforceCap(`${hint} What would you try first?`, SOCRATIC_MAX_WORDS);
  return "Before I say anything: what do you expect, and why? Make your guess on the screen first.";
}

export async function* runAsk(r: AskRun): AsyncGenerator<AskEvent> {
  const { decision: d, pack } = r;
  const promptId: PromptId = d.mode === "hint" ? "ask-socratic" : "ask";
  const promptText = render(prompt(promptId).body, {
    guide: CROC_NAME,
    crocName: CROC_NAME,
    guideVoice: `Voice: ${CROC_VOICE}`,
    packTitle: pack.manifest.title,
    hintLevel: d.hintLevel,
  });
  const ctx = buildAskContext({ pack, decision: d, attempts: r.attempts, prereqStates: r.prereqStates, promptText });
  yield {
    type: "sent",
    mode: d.mode,
    source: "ai",
    ...(d.mode === "hint" && d.checkpoint ? { hintLevel: Math.min(2, d.hintLevel) as 0 | 1 | 2 } : {}),
    payloadSummary: ctx.summary,
  };

  const thread = r.threads.get(r.request.threadId, r.request.packId, r.request.nodeId);
  const input: CrocInput = {
    kind: "croc",
    mode: d.mode,
    intent: d.mode === "hint" ? "hint" : (r.request.intent ?? "ask"),
    question: r.request.question,
    crocName: CROC_NAME,
    hintLevel: d.hintLevel,
    ...(d.node
      ? {
          card: {
            title: d.node.title,
            bigIdea: d.node.bigIdea,
            ideas: d.node.screens.flatMap((s) => (s.newIdea ? [s.newIdea] : [])),
          },
        }
      : {}),
    ...(d.interaction ? { task: { prompt: d.interaction.prompt } } : {}),
  };
  const user = `${ctx.context}\n\n${tag("learner", r.request.question)}\n\n${inputBlock(input)}`;
  const messages: ChatTurn[] = [...thread.turns.slice(-2), { role: "user", content: user }];
  const call = {
    feature: "ask" as const,
    promptId,
    ...(r.tier ? { tier: r.tier } : {}),
    system: ctx.system,
    messages,
    ...(r.signal ? { signal: r.signal } : {}),
  };

  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let cost = 0;
  const add = (u: { usage: Usage; usd: number }) => {
    usage = {
      inputTokens: usage.inputTokens + u.usage.inputTokens,
      outputTokens: usage.outputTokens + u.usage.outputTokens,
      ...(u.usage.cacheReadTokens || usage.cacheReadTokens
        ? { cacheReadTokens: (usage.cacheReadTokens ?? 0) + (u.usage.cacheReadTokens ?? 0) }
        : {}),
    };
    cost += u.usd;
  };

  let shown = "";
  try {
    if (d.mode === "hint") {
      yield { type: "thinking" };
      let reply = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await r.client.textAll(
          attempt === 0
            ? call
            : {
                ...call,
                messages: [
                  ...messages,
                  { role: "assistant", content: reply },
                  {
                    role: "user",
                    content:
                      "That reply gave too much away or was too long. One short question back, no answer, at most 40 words.",
                  },
                ],
              },
        );
        add(res);
        reply = tidyVoice(
          res.text
            .split("\n")
            .filter((l) => !/^(CHECK|SHOW):/i.test(l.trim()))
            .join(" "),
        );
        const leak = d.interaction ? answerLeak(reply, d.interaction, d.vars).leak : false;
        if (!leak && !overCap(reply, SOCRATIC_MAX_WORDS)) break;
        if (attempt === 1) reply = leak ? fallbackSocratic(d) : enforceCap(reply, SOCRATIC_MAX_WORDS);
      }
      if (!/\?\s*$/.test(reply) && !endsInAction(reply)) reply = `${reply} What do you think?`;
      for (const part of reply.match(/\S+\s*/g) ?? []) {
        shown += part;
        yield { type: "delta", text: part };
        await sleep(r.paceMs ?? 22);
      }
    } else {
      if (!d.answered && d.interactionId) await r.onAssist?.(d.interactionId);
      let buf = "";
      let used = 0;
      let stopped = false;
      let check: Extract<AskEvent, { type: "check" }> | undefined;
      let widget: Extract<AskEvent, { type: "widget" }> | undefined;
      let thinkingSent = false;
      const flush = function* (final: boolean): Generator<AskEvent> {
        // Emit complete lines; within a line, complete sentences. After the cap, only CHECK/SHOW lines matter.
        while (true) {
          const nl = buf.indexOf("\n");
          const line = nl >= 0 ? buf.slice(0, nl) : final ? buf : undefined;
          if (line !== undefined) {
            buf = nl >= 0 ? buf.slice(nl + 1) : "";
            const t = line.trim();
            if (/^CHECK:/i.test(t)) check ??= parseCheck(t);
            else if (/^SHOW:/i.test(t)) widget ??= parseShow(t);
            else if (t) yield* emit(`${t}\n`);
            if (nl < 0) return;
            continue;
          }
          if (stopped || /^\s*(CHECK|SHOW)/i.test(buf) || /^\s*(C|CH|CHE|CHEC|S|SH|SHO)$/i.test(buf)) return;
          const ss = sentences(buf);
          if (ss.length < 2) return;
          const done = ss.slice(0, -1).join(" ");
          const idx = buf.lastIndexOf(ss.at(-1) as string);
          buf = idx >= 0 ? buf.slice(idx) : "";
          yield* emit(`${done} `);
          return;
        }
      };
      const emit = function* (text: string): Generator<AskEvent> {
        if (stopped) return;
        const clean = tidyVoice(text) + (text.endsWith("\n") ? "\n" : " ");
        const w = words(clean);
        if (used + w > ASK_MAX_WORDS) {
          stopped = true;
          return;
        }
        used += w;
        shown += clean;
        yield { type: "delta", text: clean };
      };
      const it = r.client.text(call);
      while (true) {
        const next = await it.next();
        if (next.done) {
          add(next.value);
          break;
        }
        if ("thinking" in next.value) {
          if (!thinkingSent && shown.length === 0) {
            thinkingSent = true;
            yield { type: "thinking" };
          }
          continue;
        }
        buf += next.value.text;
        yield* flush(false);
      }
      yield* flush(true);
      if (!endsInAction(shown)) {
        const tail = `Your move: ${moveFor(d)}`;
        shown += `\n${tail}`;
        yield { type: "delta", text: `\n${tail}` };
      }
      if (widget) yield widget;
      if (check) yield check;
    }
  } catch (e) {
    const err = toAiError(e);
    yield {
      type: "error",
      code: err.code,
      message: err.message,
      fallback: err instanceof AiError && err.fallback ? err.fallback : "authored-faq",
    };
    return;
  }

  thread.turns.push({ role: "user", content: r.request.question }, { role: "assistant", content: shown.trim() });
  thread.messages += 1;
  yield {
    type: "done",
    threadId: thread.id,
    messageId: thread.messages,
    words: words(shown),
    usage,
    costUsd: Math.round(cost * 1e6) / 1e6,
  };
}
