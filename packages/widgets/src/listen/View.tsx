/**
 * listen view: big play keys per speed; then pick, type, or shadow (record in memory, compare, self-rate).
 * When nothing can play (no file, no voice for the language) the transcript appears instead.
 */
import { AnswerKey, Button } from "@learncroc/ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PlaybackResult } from "../audio/play";
import { useRecorder } from "../audio/recorder";
import { usePhrase } from "../audio/usePhrase";
import { useAnswer } from "../light-clock/view-kit";
import { KeyButton, WidgetShell, withReveal } from "../shared/ui";
import type { WidgetViewProps } from "../types";
import { type ListenAnswer, type ListenGoal, type ListenProps, listenKind, listenSpec } from "./spec";

type Props = WidgetViewProps<ListenProps, ListenGoal, ListenAnswer>;
type Rating = NonNullable<ListenAnswer["selfRating"]>;

const RATINGS: { value: Rating; label: string }[] = [
  { value: "got-it", label: "Close match" },
  { value: "partly", label: "Partly there" },
  { value: "missed", label: "Not yet" },
];

function speedLabel(s: number): string {
  if (Math.abs(s - 1) < 1e-9) return "Natural speed";
  return s < 1 ? `Slow (${s}×)` : `Fast (${s}×)`;
}

export default function ListenView(p: Props) {
  const props = useMemo(() => withReveal(p.props, p.revealProps), [p.props, p.revealProps]);
  const readOnly = p.mode === "review";
  const kind = listenKind(props);
  const [answer, setAnswer] = useAnswer(p.value, () => listenSpec.initialAnswer(props), p.onChange);
  const phrase = usePhrase();
  const [playingSpeed, setPlayingSpeed] = useState<number | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const lang = props.tts?.lang;
  const inputId = useId();

  const playModel = async (rate: number, onEnd?: () => void) => {
    setPlayingSpeed(rate);
    const r = await phrase.play({
      src: props.src,
      tts: props.tts,
      rate,
      assetUrl: p.assetUrl,
      onEnd: () => {
        setPlayingSpeed(null);
        onEnd?.();
      },
    });
    if (r.kind === "none") {
      setPlayingSpeed(null);
      p.announce(`Audio isn't available here. The phrase is: ${props.transcript}`);
    }
    return r;
  };

  const unavailable = phrase.status === "unavailable";
  const answered =
    kind === "choice"
      ? answer.choice !== undefined
      : kind === "type"
        ? Boolean(answer.text)
        : answer.selfRating !== undefined;
  const showTranscript =
    readOnly ||
    unavailable ||
    (props.showTranscript === "toggle" && transcriptOpen) ||
    (p.mode === "explore" && answered);

  return (
    <WidgetShell id="listen" mode={p.mode} label={listenSpec.title}>
      <div className="flex flex-wrap items-center gap-3 rounded-stage bg-surface-2 p-4">
        {props.speeds.map((s) => (
          <KeyButton
            key={s}
            onClick={() => void playModel(s)}
            aria-label={`Play the phrase, ${speedLabel(s).toLowerCase()}`}
            className="h-14 px-5 text-lead"
          >
            <PlayGlyph playing={playingSpeed === s && phrase.status === "playing"} reducedMotion={p.reducedMotion} />
            {speedLabel(s)}
          </KeyButton>
        ))}
        {props.showTranscript === "toggle" && !readOnly && !unavailable ? (
          <Button size="sm" variant="ghost" aria-pressed={transcriptOpen} onClick={() => setTranscriptOpen((o) => !o)}>
            {transcriptOpen ? "Hide transcript" : "Show transcript"}
          </Button>
        ) : null}
      </div>

      {unavailable ? (
        <p className="text-small text-ink-2">
          Audio can't play in this browser{lang ? ` (no ${lang} voice installed)` : ""}, so here is the phrase in
          writing.
        </p>
      ) : null}
      {showTranscript ? (
        <div className="rounded-md border border-line bg-surface px-4 py-3" data-transcript>
          <p className="voice-casual text-lead text-ink" lang={lang}>
            {props.transcript}
          </p>
          {props.translation ? <p className="text-small text-ink-2">{props.translation}</p> : null}
        </div>
      ) : null}

      {kind === "choice" && p.mode !== "explore" ? (
        // biome-ignore lint/a11y/useSemanticElements: a labelled group of answer keys.
        <div role="group" aria-label="What did you hear?" className="flex flex-col gap-2">
          {(props.options ?? []).map((o, i) => (
            <AnswerKey
              key={o}
              n={i + 1}
              disabled={readOnly}
              state={answer.choice === o ? (readOnly ? "down" : "selected") : readOnly ? "dimmed" : "rest"}
              onPress={() => {
                setAnswer({ choice: o });
                p.announce(`Picked: ${o}`);
              }}
            >
              <span lang={lang}>{o}</span>
              {readOnly && p.solution?.choice === o ? (
                <span className="ml-2 text-small text-sea-text">(what was said)</span>
              ) : null}
            </AnswerKey>
          ))}
        </div>
      ) : null}

      {kind === "type" && p.mode !== "explore" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="text-small text-ink-2">
            Type what you heard
          </label>
          <input
            id={inputId}
            value={answer.text ?? ""}
            disabled={readOnly}
            lang={lang}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setAnswer({ text: e.currentTarget.value })}
            className="h-12 rounded-sm border-[1.5px] border-line-strong bg-surface px-3 text-body text-ink"
          />
          <p className="text-small text-ink-3">Accents are optional.</p>
        </div>
      ) : null}

      {kind === "shadow" ? (
        <Shadow
          readOnly={readOnly}
          rating={answer.selfRating}
          onRate={(r, label) => {
            setAnswer({ selfRating: r });
            p.announce(`Rated: ${label}.`);
          }}
          playModel={(onEnd) => playModel(props.speeds.includes(1) ? 1 : (props.speeds[0] ?? 1), onEnd)}
          announce={p.announce}
        />
      ) : null}
    </WidgetShell>
  );
}

function PlayGlyph({ playing, reducedMotion }: { playing: boolean; reducedMotion: boolean }) {
  if (playing) {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        {[3, 8, 13].map((x, i) => (
          <rect key={x} x={x} y={4} width={3} height={10} rx={1.5} fill="var(--sea)">
            {reducedMotion ? null : (
              <animate attributeName="height" values="10;4;10" dur={`${0.6 + i * 0.15}s`} repeatCount="indefinite" />
            )}
          </rect>
        ))}
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M5 3 L15 9 L5 15 Z" fill="currentColor" />
    </svg>
  );
}

/** Shadowing: hear the model, record yourself (kept in this tab), play both, rate yourself. */
function Shadow(props: {
  readOnly: boolean;
  rating?: Rating;
  onRate: (r: Rating, label: string) => void;
  playModel: (onEnd?: () => void) => Promise<PlaybackResult>;
  announce: (s: string) => void;
}) {
  const rec = useRecorder(15);
  const mine = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => mine.current?.pause(), []);
  const prev = useRef(rec.state);
  useEffect(() => {
    if (prev.current === rec.state) return;
    prev.current = rec.state;
    const say: Partial<Record<typeof rec.state, string>> = {
      recording: "Recording. Say the phrase, then stop.",
      recorded: "Recorded. Play yours next to hers.",
      denied: "The microphone is blocked. You can still say it out loud and rate yourself.",
      "no-device": "No microphone found. You can still say it out loud and rate yourself.",
      error: "Recording didn't work this time. You can still say it out loud and rate yourself.",
    };
    const text = say[rec.state];
    if (text) props.announce(text);
  }, [rec.state, props.announce]);

  const playMine = () => {
    if (!rec.url) return;
    mine.current?.pause();
    const a = new Audio(rec.url);
    mine.current = a;
    void a.play().catch(() => props.announce("Your recording couldn't play."));
  };

  const blocked =
    rec.state === "denied" || rec.state === "no-device" || rec.state === "unsupported" || rec.state === "error";
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <ol className="flex flex-col gap-3">
        <li className="flex list-none flex-wrap items-center gap-3">
          <StepNum n={1} />
          <span className="text-body text-ink">Play the phrase, then say it out loud along with it.</span>
        </li>
        <li className="flex list-none flex-wrap items-center gap-3">
          <StepNum n={2} />
          {rec.state === "recording" ? (
            <Button variant="primary" onClick={rec.stop}>
              <RecDot /> Stop ({rec.seconds}s)
            </Button>
          ) : rec.state === "requesting" ? (
            <span className="text-small text-ink-2">Waiting for microphone permission…</span>
          ) : blocked ? (
            <span className="text-small text-ink-2">
              {rec.state === "denied"
                ? "The microphone is blocked, so say it out loud and rate yourself."
                : rec.state === "no-device"
                  ? "No microphone found, so say it out loud and rate yourself."
                  : rec.state === "unsupported"
                    ? "This browser can't record, so say it out loud and rate yourself."
                    : "Recording didn't work this time. Say it out loud and rate yourself."}
            </span>
          ) : (
            <Button onClick={() => void rec.start()} disabled={props.readOnly}>
              <RecDot /> {rec.state === "recorded" ? "Record again" : "Record yourself"}
            </Button>
          )}
          {rec.state === "recorded" ? (
            <>
              <Button size="sm" onClick={playMine}>
                Play mine
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  // When the original can't play (no file, no voice), go straight to the recording.
                  void props.playModel(playMine).then((r) => {
                    if (r.kind === "none") playMine();
                  })
                }
              >
                The original, then mine
              </Button>
            </>
          ) : null}
        </li>
        <li className="flex list-none flex-col gap-2">
          <span className="flex items-center gap-3">
            <StepNum n={3} />
            <span className="text-body text-ink">How close was it?</span>
          </span>
          {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of answer keys. */}
          <div role="group" aria-label="Rate your shadowing" className="grid gap-2 @md:grid-cols-3">
            {RATINGS.map((r, i) => (
              <AnswerKey
                key={r.value}
                n={i + 1}
                disabled={props.readOnly}
                state={props.rating === r.value ? (props.readOnly ? "down" : "selected") : "rest"}
                onPress={() => props.onRate(r.value, r.label)}
              >
                {r.label}
              </AnswerKey>
            ))}
          </div>
        </li>
      </ol>
      <p className="text-small text-ink-3">
        Your recording stays in this tab and is never uploaded. Shadowing isn't scored.
      </p>
    </div>
  );
}

function StepNum({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 place-items-center rounded-xs border border-line-strong text-micro tabular text-ink-2"
    >
      {n}
    </span>
  );
}

function RecDot() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="4" fill="var(--ember)" />
    </svg>
  );
}
