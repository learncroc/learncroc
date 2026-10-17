/**
 * The one-time sound offer (C13: after the first gate opens). Sound stays off by default; this asks once,
 * inline, and remembers the answer in `settings.sound.offered`. Renders nothing once offered.
 */
import { Button } from "@learncroc/ui";
import { SpeakerHigh } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRunApi } from "./api";
import { runQueryKeys, useSettingsQuery } from "./queries";

export interface SoundOfferProps {
  /** Called after either answer. */
  onDone?(enabled: boolean): void;
  className?: string;
}

export function SoundOffer({ onDone, className }: SoundOfferProps) {
  const client = useRunApi();
  const qc = useQueryClient();
  const settings = useSettingsQuery().data;
  const [answered, setAnswered] = useState(false);
  if (!settings || answered || settings.sound.offered || settings.sound.enabled) return null;

  const answer = (enabled: boolean) => {
    setAnswered(true);
    void client
      .patchSettings({ sound: { enabled, offered: true } })
      .then(() => qc.invalidateQueries({ queryKey: runQueryKeys.settings }))
      .catch(() => undefined);
    onDone?.(enabled);
  };

  return (
    <aside
      className={`lm-pop-in flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-2 ${className ?? ""}`}
      aria-label="Sound"
      data-sound-offer
    >
      <SpeakerHigh size={18} aria-hidden className="text-ink-2" />
      <span className="text-small text-ink">Want soft sounds for guesses and gates?</span>
      <span className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => answer(true)}>
          Turn on
        </Button>
        <Button size="sm" variant="ghost" onClick={() => answer(false)}>
          No thanks
        </Button>
      </span>
    </aside>
  );
}
