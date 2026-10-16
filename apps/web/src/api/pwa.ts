/**
 * PWA registration. Call once at startup. Production builds register `sw.js` at the app's base: the
 * local app (served by the learncroc server) for the instant shell, and the static demo so it keeps
 * playing offline after the first load (its worker precaches every chunk and bundled pack). The Vite
 * dev server skips it.
 */
export function shouldRegisterServiceWorker(env: { PROD?: boolean } = import.meta.env): boolean {
  return !!env.PROD && typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export async function registerServiceWorker(): Promise<void> {
  if (!shouldRegisterServiceWorker()) return;
  const base = import.meta.env.BASE_URL ?? "/";
  try {
    await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  } catch {
    /* not fatal: the app works without it */
  }
}
