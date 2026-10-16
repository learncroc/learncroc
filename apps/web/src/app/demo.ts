/** The keyless static demo (GitHub Pages): built with VITE_LM_DEMO=1 and/or VITE_LM_STATIC=1 (in-browser API). */
export const isDemo = (): boolean => import.meta.env?.VITE_LM_DEMO === "1" || import.meta.env?.VITE_LM_STATIC === "1";

/** Where "How to install" points from the demo banner. */
export const INSTALL_URL = "https://github.com/learncroc/learncroc#install";
export const REPO_URL = "https://github.com/learncroc/learncroc";
/**
 * The command that starts the full app. The CLI keeps its package name (`learncroc`) until the code
 * rename; only the product name in the UI is Learncroc.
 */
export const INSTALL_COMMAND = "npx learncroc";
export const DOCTOR_COMMAND = "npx learncroc doctor";
