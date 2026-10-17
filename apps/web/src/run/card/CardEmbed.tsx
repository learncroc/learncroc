/**
 * "Try the first card" in the marketplace: plays the pack's suggested start from the registry's try
 * bundle. The server keeps it in a temporary store, so nothing is written to progress. No Moss, no
 * progress, no modal chrome; the close says "Install to keep going".
 */
import { useMemo } from "react";
import type { CardEmbedProps } from "../../slots";
import { CardPlayer } from "./CardPlayer";

export function CardEmbed({ registry, packId, onExit }: CardEmbedProps) {
  const start = useMemo(() => ({ kind: "try" as const, registry, packId }), [registry, packId]);
  return (
    <section
      data-slot="card-embed"
      aria-label={`Try ${packId}`}
      className="flex h-[min(760px,calc(100dvh-160px))] min-h-[560px] flex-col overflow-hidden rounded-stage border border-line bg-surface shadow-2"
    >
      <CardPlayer start={start} onExit={onExit} variant="embed" />
    </section>
  );
}
