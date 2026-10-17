/**
 * The one-time sound offer (C13): after the first gate ever opens, a small card asks whether to turn
 * sound on. Either answer sets `settings.sound.offered`, so it never asks again.
 */
import { Button, Croc } from "@learncroc/ui";
import { SpeakerHigh } from "@phosphor-icons/react";
import { usePatchSettings } from "../../app/queries";
import { useRunSounds } from "../../run/sound";

export function SoundOffer({ onDone }: { onDone(): void }) {
  const patch = usePatchSettings();
  const sounds = useRunSounds();
  const answer = (enabled: boolean) => {
    patch.mutate(
      { sound: { offered: true, ...(enabled ? { enabled: true } : {}) } },
      {
        onSuccess: () => {
          // The engine follows the settings on the next render; play the gate chord once it's on.
          if (enabled) setTimeout(() => sounds.gate(), 120);
        },
      },
    );
    onDone();
  };
  return (
    <section
      aria-label="Sound"
      className="lm-slide-in-up absolute bottom-5 left-1/2 z-30 flex w-[min(420px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 rounded-md border border-line bg-surface p-3 shadow-3"
      data-sound-offer
    >
      <Croc state="happy" size={40} decorative />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-small font-[620] text-ink">Gates make a sound when they open.</p>
        <p className="m-0 text-small text-ink-2">
          Small sounds for guesses, cards and gates. Off unless you want them.
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
        <Button size="sm" variant="primary" icon={<SpeakerHigh size={14} />} onClick={() => answer(true)}>
          Turn sound on
        </Button>
        <Button size="sm" variant="ghost" onClick={() => answer(false)}>
          Keep it quiet
        </Button>
      </div>
    </section>
  );
}
