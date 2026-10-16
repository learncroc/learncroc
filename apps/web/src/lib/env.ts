/** Build and runtime flags the shell reads. */

/**
 * Developer builds (`bun dev`): invalid maps show in a collapsed "Needs repair" row with their error;
 * everywhere else they are hidden (01 §3.2).
 */
export const isDevBuild = (): boolean => import.meta.env?.DEV === true;

/** The browser says it is offline (Create only cares: article maps need to fetch the page). */
export const isOffline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;
