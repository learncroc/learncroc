/**
 * Setup blocks in the coach column (CONTRACTS §5): story, maths, code, audio, quote and callout.
 * Stories speak in the casual voice; everything else is the product talking. Audio blocks without a
 * rendered file read their words with the device voice (`speechSynthesis`) and say so.
 */
import type { AudioBlock, Block, CodeBlock } from "@learncroc/core";
import { Info, Pause, Play, Quotes, Warning } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { assetUrl } from "../api/client";
import { Md } from "./Markdown";
import { MathTex } from "./Math";

export interface BlocksProps {
  blocks: Block[];
  packId: string;
  /** Default speaker for story blocks. */
  speaker?: string;
  /** BCP-47 for text-to-speech fallback. */
  lang?: string;
}

export function Blocks({ blocks, packId, speaker, lang }: BlocksProps) {
  if (blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-blocks>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are authored in a fixed order
        <BlockView key={i} block={b} packId={packId} speaker={speaker} lang={lang} />
      ))}
    </div>
  );
}

/** One block. The card thread renders story and quote blocks itself (Moss and the article) and uses this for the rest. */
export function BlockView({ block, packId, speaker, lang }: { block: Block } & Omit<BlocksProps, "blocks">) {
  switch (block.type) {
    case "say":
      return (
        <p className="voice-casual text-lead text-ink" data-block="say">
          <Md text={block.text} packId={packId} />
        </p>
      );
    case "story": {
      const who = block.speaker ?? speaker;
      return (
        <p className="voice-casual text-lead text-ink" data-block="story">
          {who ? <span className="sr-only">{who}: </span> : null}
          <Md text={block.text} packId={packId} />
        </p>
      );
    }
    case "math":
      return (
        <figure className="rounded-md bg-surface-2 px-4 py-3 text-ink" data-block="math">
          <MathTex tex={block.tex} display />
          {block.caption ? <figcaption className="mt-1 text-small text-ink-3">{block.caption}</figcaption> : null}
        </figure>
      );
    case "code":
      return <CodeView block={block} />;
    case "audio":
      return <AudioView block={block} packId={packId} lang={lang} />;
    case "quote":
      return (
        <blockquote className="border-l-2 border-line-strong pl-3 text-body text-ink-2" data-block="quote">
          <Quotes size={16} aria-hidden className="mb-1 text-ink-3" />
          <p className="voice-casual">{block.text}</p>
          <footer className="mt-1 text-small text-ink-3">
            {block.cite.url ? (
              <a href={block.cite.url} target="_blank" rel="noreferrer noopener" className="underline">
                {block.cite.title}
              </a>
            ) : (
              block.cite.title
            )}
            {block.cite.para ? ` · ${block.cite.para}` : null}
          </footer>
        </blockquote>
      );
    case "callout": {
      const Icon = block.tone === "caution" ? Warning : Info;
      return (
        <aside
          className={`flex gap-2 rounded-sm border px-3 py-2 text-small ${
            block.tone === "caution"
              ? "border-ember bg-ember-soft text-ember-text"
              : "border-line bg-surface-2 text-ink-2"
          }`}
          data-block="callout"
          data-tone={block.tone}
        >
          <Icon size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {block.tone === "illustrative" ? <span className="font-semibold">Illustrative. </span> : null}
            <Md text={block.text} packId={packId} />
          </span>
        </aside>
      );
    }
  }
}

function CodeView({ block }: { block: CodeBlock }) {
  const lines = block.source.replace(/\n$/, "").split("\n");
  const hl = new Set(block.highlight ?? []);
  return (
    <pre
      className="voice-mono overflow-x-auto rounded-md bg-surface-sunk px-0 py-2 text-code text-ink"
      data-block="code"
      data-lang={block.lang}
    >
      <code>
        {lines.map((line, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: code lines are positional
            key={i}
            className={`block px-3 ${hl.has(i + 1) ? "bg-sea-soft/60" : ""}`}
            data-highlight={hl.has(i + 1) || undefined}
          >
            <span aria-hidden className="mr-3 inline-block w-5 text-right text-ink-3 tabular">
              {i + 1}
            </span>
            {line || " "}
          </span>
        ))}
      </code>
    </pre>
  );
}

function AudioView({ block, packId, lang }: { block: AudioBlock; packId: string; lang?: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  const [slow, setSlow] = useState(false);
  const src = block.src ? assetUrl(packId, block.src) : undefined;

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = slow ? 0.75 : 1;
  }, [slow]);

  const [fileFailed, setFileFailed] = useState(false);
  // No rendered file (or it failed): the device's own voice reads the words, and says so.
  const deviceVoice = !src || fileFailed;
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  const speak = () => {
    const tts = block.tts;
    const text = tts?.text ?? block.transcript;
    if (!text || !canSpeak) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = tts?.lang || lang || "en";
    u.rate = (tts?.rate ?? 1) * (slow ? 0.75 : 1);
    u.onend = () => setPlaying(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setPlaying(true);
  };

  const toggle = () => {
    const el = ref.current;
    if (el && src && !fileFailed) {
      if (el.paused)
        void el.play().catch(() => {
          setFileFailed(true);
          speak();
        });
      else el.pause();
      return;
    }
    if (playing && canSpeak) {
      window.speechSynthesis.cancel();
      setPlaying(false);
      return;
    }
    speak();
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface px-3 py-2" data-block="audio">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="grid size-10 place-items-center rounded-pill border-[1.5px] border-ink bg-surface shadow-key-rest active:translate-y-0.5 active:shadow-key-down"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
        </button>
        <button
          type="button"
          className={`rounded-pill border px-2 text-small ${slow ? "border-ink bg-ink text-surface" : "border-line text-ink-2"}`}
          aria-pressed={slow}
          onClick={() => setSlow((s) => !s)}
        >
          Slower
        </button>
        {deviceVoice ? (
          <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-micro text-ink-3" data-device-voice>
            {canSpeak ? "Device voice" : "No voice on this device"}
          </span>
        ) : null}
        <button
          type="button"
          className="ml-auto text-small text-ink-2 underline underline-offset-2"
          aria-expanded={showText}
          onClick={() => setShowText((s) => !s)}
        >
          {showText ? "Hide words" : "Show words"}
        </button>
      </div>
      {src ? (
        // biome-ignore lint/a11y/useMediaCaption: the transcript is shown beside the player.
        <audio
          ref={ref}
          src={src}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => {
            setPlaying(false);
            setFileFailed(true);
          }}
        />
      ) : null}
      {showText ? (
        <p className="voice-casual text-body text-ink" lang={block.tts?.lang}>
          {block.transcript}
        </p>
      ) : null}
    </div>
  );
}
