/**
 * dialogue view: a chat with a character. Lines can be played (pack audio, else speech in the character's
 * language at the current speed), translations toggle on and off, replies are chosen or typed. Reaching an
 * ending commits the answer.
 */
import { AnswerKey, Button } from "@learncroc/ui";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePhrase } from "../audio/usePhrase";
import { useAnswer } from "../light-clock/view-kit";
import { WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import {
  type DialogueAnswer,
  type DialogueGoal,
  type DialogueNode,
  type DialogueProps,
  dialogueSpec,
  isTerminal,
} from "./spec";
import { matchText, TYPED_DEFAULT } from "./text";

type Props = WidgetViewProps<DialogueProps, DialogueGoal, DialogueAnswer>;
type Choice = NonNullable<DialogueNode["choices"]>[number];
type Turn =
  | { kind: "them"; node: DialogueNode; key: string }
  | { kind: "me"; text: string; note?: string; nearly?: string; key: string };

/** Rebuild the transcript and state from the answer's path (choices are matched by their target). */
export function replayDialogue(props: DialogueProps, answer: DialogueAnswer) {
  const byId = new Map(props.nodes.map((n) => [n.id, n]));
  const state: Record<string, string | number> = { ...(props.state ?? {}) };
  const turns: Turn[] = [];
  answer.path.forEach((id, i) => {
    const node = byId.get(id);
    if (!node) return;
    turns.push({ kind: "them", node, key: `${i}-${id}` });
    const next = answer.path[i + 1];
    let choice: Choice | undefined;
    if (next !== undefined) {
      choice = node.choices?.find((c) => c.next === next);
      if (!choice && node.reply) {
        const typed = answer.typed?.[id] ?? "";
        const m = matchText(typed, node.reply.accept, node.reply.normalize ?? TYPED_DEFAULT);
        turns.push({
          kind: "me",
          text: typed || "…",
          nearly: m.matched && m.accentSlip ? m.accepted : undefined,
          key: `${i}-${id}-reply`,
        });
      }
    } else if (answer.endedAt === id) {
      choice = node.choices?.find((c) => c.next === null);
    }
    if (choice) {
      turns.push({ kind: "me", text: choice.text, note: choice.note, key: `${i}-${id}-choice` });
      Object.assign(state, choice.set ?? {});
    }
  });
  const lastId = answer.path[answer.path.length - 1];
  const current = answer.endedAt === null && lastId !== undefined ? byId.get(lastId) : undefined;
  return { turns, state, current };
}

export default function DialogueView(p: Props) {
  const props = useMemo(() => withReveal(p.props, p.revealProps), [p.props, p.revealProps]);
  const readOnly = p.mode === "review";
  const [answer, setAnswer] = useAnswer(p.value, () => dialogueSpec.initialAnswer(props), p.onChange);
  const [showTranslation, setShowTranslation] = useState(false);
  const [draft, setDraft] = useState("");
  const [ticked, setTicked] = useState<Record<number, boolean>>({});
  const byId = useMemo(() => new Map(props.nodes.map((n) => [n.id, n])), [props.nodes]);
  const { turns, state, current } = useMemo(() => replayDialogue(props, answer), [props, answer]);
  const speed = typeof state.speed === "number" ? state.speed : 1;
  const name = props.character.name;
  const phrase = usePhrase();
  const replyId = useId();

  const playLine = (node: DialogueNode, rate = speed) => {
    void phrase.play({
      src: node.audio,
      tts: props.character.lang ? { text: node.line, lang: props.character.lang } : undefined,
      rate,
      assetUrl: p.assetUrl,
    });
  };

  const advance = (next: DialogueAnswer, newNode?: DialogueNode, rate = speed) => {
    setAnswer(next);
    const ended = next.endedAt !== null;
    if (newNode) {
      p.announce(`${name}: ${newNode.line}${ended ? " The conversation ends here." : ""}`);
      if (props.character.speak) playLine(newNode, rate);
    } else if (ended) {
      p.announce("The conversation ends here.");
    }
    if (ended && p.mode === "answer") p.onCommit?.(next);
  };

  const choose = (c: Choice) => {
    if (readOnly || !current) return;
    const good = answer.goodCount + (c.good ? 1 : 0);
    const nextSpeed = typeof c.set?.speed === "number" ? c.set.speed : speed;
    if (nextSpeed !== speed) p.announce(nextSpeed < speed ? `${name} slows down.` : `${name} speeds up.`);
    if (c.next === null) {
      advance({ ...answer, endedAt: current.id, goodCount: good });
      return;
    }
    const node = byId.get(c.next);
    if (!node) return;
    advance(
      { ...answer, path: [...answer.path, node.id], goodCount: good, endedAt: isTerminal(node) ? node.id : null },
      node,
      nextSpeed,
    );
  };

  const submitReply = (e: FormEvent) => {
    e.preventDefault();
    if (readOnly || !current?.reply || draft.trim() === "") return;
    const m = matchText(draft, current.reply.accept, current.reply.normalize ?? TYPED_DEFAULT);
    const node = byId.get(m.matched ? current.reply.next : current.reply.else);
    if (!node) return;
    const typed = { ...(answer.typed ?? {}), [current.id]: draft.trim() };
    setDraft("");
    advance({ ...answer, path: [...answer.path, node.id], typed, endedAt: isTerminal(node) ? node.id : null }, node);
  };

  const restart = () => {
    setDraft("");
    setAnswer(dialogueSpec.initialAnswer(props));
    p.announce("Starting the conversation again.");
  };

  // Keep the newest line in view.
  const endRef = useRef<HTMLLIElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the transcript grows.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest", behavior: p.reducedMotion ? "auto" : "smooth" });
  }, [turns.length, p.reducedMotion]);

  const ended = answer.endedAt !== null;

  return (
    <WidgetShell
      id="dialogue"
      mode={p.mode}
      label={dialogueSpec.title}
      toolbar={
        <label className="inline-flex cursor-pointer items-center gap-2 text-small text-ink-2">
          <input
            type="checkbox"
            checked={showTranslation}
            onChange={(e) => setShowTranslation(e.currentTarget.checked)}
            className="accent-[var(--sea)]"
          />
          Show translations
        </label>
      }
    >
      <header className="flex flex-wrap items-center gap-3">
        <Avatar props={props} assetUrl={p.assetUrl} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{name}</p>
          <p className="text-small text-ink-2">{props.setting}</p>
        </div>
        {typeof state.speed === "number" ? <SpeedDial name={name} speed={speed} /> : null}
      </header>

      {props.goals?.length ? (
        <fieldset className="rounded-md border border-line px-3 py-2">
          <legend className="px-1 text-small text-ink-2">Your goals</legend>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {props.goals.map((g, i) => (
              <li key={g} className="list-none">
                <label className="inline-flex cursor-pointer items-center gap-2 text-small text-ink">
                  <input
                    type="checkbox"
                    checked={ticked[i] ?? false}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setTicked((t) => ({ ...t, [i]: on }));
                    }}
                    className="accent-[var(--sea)]"
                  />
                  {g}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      <ol
        aria-label={`Conversation with ${name}`}
        className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto rounded-stage bg-surface-2 p-3"
      >
        {turns.map((t, i) =>
          t.kind === "them" ? (
            <li
              key={t.key}
              className="flex max-w-[85%] list-none flex-col items-start gap-1 self-start"
              ref={i === turns.length - 1 ? endRef : undefined}
            >
              <div className="rounded-md rounded-tl-xs border border-line bg-surface px-3 py-2 shadow-1">
                <p className="voice-casual text-lead text-ink" lang={props.character.lang}>
                  {t.node.line}
                </p>
                {showTranslation && t.node.translation ? (
                  <p className="mt-1 text-small text-ink-2">{t.node.translation}</p>
                ) : null}
              </div>
              {t.node.audio || props.character.lang ? (
                <button
                  type="button"
                  onClick={() => playLine(t.node)}
                  className="inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-small text-ink-2 hover:bg-surface hover:text-ink"
                  aria-label={`Play ${name}'s line: ${t.node.line}`}
                >
                  <SpeakerIcon /> Play
                </button>
              ) : null}
            </li>
          ) : (
            <li
              key={t.key}
              className="flex max-w-[85%] list-none flex-col items-end gap-1 self-end"
              ref={i === turns.length - 1 ? endRef : undefined}
            >
              <p
                className="rounded-md rounded-tr-xs bg-sea-soft px-3 py-2 text-body text-ink"
                lang={props.character.lang}
              >
                <span className="sr-only">You: </span>
                {t.text}
              </p>
              {t.nearly ? (
                <p className="text-small text-ink-2">
                  Understood. Written with accents: <span lang={props.character.lang}>{t.nearly}</span>
                </p>
              ) : null}
              {t.note ? <p className="voice-casual text-small text-ink-2">{t.note}</p> : null}
            </li>
          ),
        )}
        {ended ? (
          <li className="list-none self-center py-1 text-small text-ink-3" ref={endRef}>
            The conversation ends here.
          </li>
        ) : null}
      </ol>

      {phrase.status === "unavailable" ? (
        <p className="text-small text-ink-2">Audio isn't available in this browser, so the line is written above.</p>
      ) : null}

      {!readOnly && current?.choices?.length ? (
        // biome-ignore lint/a11y/useSemanticElements: a labelled group of answer keys.
        <div role="group" aria-label="Your reply" className="flex flex-col gap-2">
          {current.choices.map((c, i) => (
            <AnswerKey key={`${current.id}-${c.text}`} n={i + 1} onPress={() => choose(c)}>
              <span lang={props.character.lang}>{c.text}</span>
            </AnswerKey>
          ))}
        </div>
      ) : null}

      {!readOnly && current?.reply ? (
        <form onSubmit={submitReply} className="flex flex-wrap items-end gap-2">
          <label htmlFor={replyId} className="flex min-w-60 flex-1 flex-col gap-1 text-small text-ink-2">
            Type your reply{props.character.lang ? ` (${langName(props.character.lang)})` : ""}
            <input
              id={replyId}
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              lang={props.character.lang}
              autoComplete="off"
              spellCheck={false}
              className="h-12 rounded-sm border-[1.5px] border-line-strong bg-surface px-3 text-body text-ink"
            />
          </label>
          <Button type="submit" variant="primary" size="lg" disabled={draft.trim() === ""}>
            Say it
          </Button>
        </form>
      ) : null}

      {!readOnly && (ended || answer.path.length > 1) ? (
        <div>
          <Button size="sm" variant="ghost" onClick={restart}>
            Start over
          </Button>
        </div>
      ) : null}
    </WidgetShell>
  );
}

function langName(lang: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(lang.split("-")[0] ?? lang) ?? lang;
  } catch {
    return lang;
  }
}

function Avatar({ props, assetUrl }: { props: DialogueProps; assetUrl: Props["assetUrl"] }) {
  if (props.character.avatar) {
    return (
      <img
        src={assetUrl(props.character.avatar)}
        alt=""
        className="size-12 rounded-pill border border-line object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-12 place-items-center rounded-pill border-[1.5px] border-ink bg-iris-soft text-heading font-bold text-ink voice-casual"
    >
      {props.character.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Lola's speed dial: a three-notch gauge plus the number. */
function SpeedDial({ name, speed }: { name: string; speed: number }) {
  const notch = speed < 0.95 ? 0 : speed <= 1.05 ? 1 : 2;
  const words = ["slow", "natural", "fast"];
  return (
    <div className="flex items-center gap-2 text-small text-ink-2" data-speed={speed}>
      <svg width="44" height="26" viewBox="0 0 44 26" aria-hidden="true">
        <path
          d="M4 24 A18 18 0 0 1 40 24"
          fill="none"
          stroke="var(--line-strong)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line
          x1="22"
          y1="24"
          x2={22 + 15 * Math.cos(Math.PI - (Math.PI * (notch + 0.5)) / 3)}
          y2={24 - 15 * Math.sin(Math.PI - (Math.PI * (notch + 0.5)) / 3)}
          stroke="var(--ink)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="22" cy="24" r="2.5" fill="var(--ink)" />
      </svg>
      <span className="tabular">
        {name.split(/[ ,]/)[0]}'s pace: {words[notch]} ({speed.toFixed(1)}×)
      </span>
    </div>
  );
}

function SpeakerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
      <path
        d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
