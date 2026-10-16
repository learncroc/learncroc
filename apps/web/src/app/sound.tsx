/**
 * The app's one sound engine, configured from Settings → Sound (off by default). Screens call
 * `useSound().play("tok")`; nothing plays unless the learner turned sound on.
 */
import { createSoundEngine, type SoundEngine } from "@learncroc/ui";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { useSettings } from "./queries";

const SoundContext = createContext<SoundEngine | null>(null);

export function SoundProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => createSoundEngine());
  const { data: settings } = useSettings();
  useEffect(() => {
    engine.setEnabled(settings?.sound.enabled ?? false);
    engine.setVolume(settings?.sound.volume ?? 0.6);
  }, [engine, settings?.sound.enabled, settings?.sound.volume]);
  useEffect(() => () => engine.close(), [engine]);
  return <SoundContext.Provider value={engine}>{children}</SoundContext.Provider>;
}

const SILENT: SoundEngine = createSoundEngine({ enabled: false });

/** The sound engine (a silent one outside the provider, e.g. in isolated tests). */
export function useSound(): SoundEngine {
  return useContext(SoundContext) ?? SILENT;
}
