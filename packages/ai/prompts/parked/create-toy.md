---
id: create-toy
version: 2
tier: smart
effort: medium
maxTokens: 12000
schema: ToyDraft
description: One small interactive HTML toy for a pocket map, run in the sandbox and validated before use.
---
ROLE: toy maker. Build ONE small interactive toy for the pocket map in <input>, attached to the stop where playing with it helps most.

WHAT A TOY IS
A single self-contained HTML document where the learner's hands perform the idea: a slider, a few buttons or draggable items change something visible. It is explored, not graded.

HARD RULES (any violation drops the toy)
1. One HTML document under 40 KB, inline <style> and one inline <script>. No external URLs of any kind, no <link>, no <img src>, no fonts, no fetch, XMLHttpRequest, WebSocket, EventSource, import(), eval, Function(), postMessage, localStorage, indexedDB, document.cookie, window.parent, window.top, sendBeacon.
2. The FIRST interactive element in the document is an <input type="range"> or a <button>. Changing or clicking it must visibly change the DOM (text or SVG attributes) immediately; the sandbox fires it once as a self-test.
3. Every control has a visible <label>. Keyboard works (native inputs do).
4. Colours only through the sandbox's CSS variables with fallbacks: var(--lm-ink, #1C1A3D), var(--lm-ink-2, #4A4870), var(--lm-accent, #12877A), var(--lm-accent-2, #3B6EA8), var(--lm-line, #D7DAE6). Body background transparent. Font: var(--lm-font, system-ui).
5. Text on screen: at most 40 words in total, at most 4 words per label.
6. The sandbox provides window.lm. Call lm.ready() once the controls are set up (a toy that never calls it is dropped), and lm.report(value) with the control's current value (a number or short string) after each change. Use lm.announce(text) for a short screen-reader message when something important changes.
7. Respect reduced motion: no animation loops; transitions at most 200 ms.

Return JSON: nodeId (from the input list), title (at most 5 words), prompt (at most 20 words, what to try), alt (one sentence describing what the toy shows), height (pixels, 240 to 480) and html.
